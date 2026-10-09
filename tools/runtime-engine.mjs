#!/usr/bin/env node
// runtime-engine.mjs v1.1.0 — runtime MVP Tasks 5+6: permission engine, bounded
// execution engine skeleton, and checkpoint/resume. Zero-dep (node:* only),
// filesystem-backed policy (permission-policy.json implements
// docs/PERMISSION-BOUNDARY.md).
//
// ENFORCEMENT ORDER (the contract): every operation is EVALUATED first; execution
// happens ONLY on an ALLOWED verdict. DENIED and NEEDS_AUTH operations never run —
// the record shows verdict + enforced_before_execution=true.
//
// Commands:
//   node tools/runtime-engine.mjs evaluate --risk R0..R4 --target <path> [--json]
//   node tools/runtime-engine.mjs run --risk R0|R1 --op read --target <path>
//   node tools/runtime-engine.mjs run --risk R1 --op spawn --args "<args for node>"
//   node tools/runtime-engine.mjs policy
//   node tools/runtime-engine.mjs job --session S --steps N [--fail-at K] [--json]
//   node tools/runtime-engine.mjs resume --session S --steps N [--json]
//   node tools/runtime-engine.mjs status --session S [--json]
// Exit codes: 0 ALLOWED/executed/completed; 2 usage/config error; 3 DENIED;
// 4 NEEDS_AUTH or missing checkpoint; 5 corrupt checkpoint (integrity failure);
// 137 simulated abrupt kill (job --fail-at); otherwise the child's captured exit
// code (bounded execution).
// Checkpoints (Task 6): after EACH bounded step of a job a durable checkpoint is
// written to .agents-handoff/checkpoints/<session>.json with a sha256 integrity
// seal. Resume reconstructs state from disk ONLY — zero shared memory. A missing
// checkpoint fails honestly (exit 4, never guessed); a tampered checkpoint fails
// the integrity seal (exit 5). Abrupt termination is simulated by process.exit(137)
// before the --fail-at step executes — deterministic, hermetic kill equivalent.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DEFAULT_POLICY = path.join(REPO, 'permission-policy.json');
// State root: overridable so oracles run hermetically and the repo accumulates
// nothing. Env: AGENT_HANDOFF_STATE_DIR=<dir>
const STATE_DIR = process.env.AGENT_HANDOFF_STATE_DIR
  ? path.resolve(process.env.AGENT_HANDOFF_STATE_DIR)
  : path.join(REPO, '.agents-handoff');
const EXEC_DIR = path.join(STATE_DIR, 'executions');
const CKPT_DIR = path.join(STATE_DIR, 'checkpoints');
const JOBS_DIR = path.join(STATE_DIR, 'jobs');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const argOf = (n, f) => { const i = process.argv.indexOf(n); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : (f ? f() : null); };
const hasFlag = n => process.argv.includes(n);
const out = (o) => { console.log(hasFlag('--json') ? JSON.stringify(o, null, 2) : JSON.stringify(o)); };

function loadPolicy(p) {
  if (!fs.existsSync(p)) return { error: 'policy not found: ' + p };
  try {
    const pol = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!pol.grants || !pol.risk_to_level) return { error: 'policy missing grants/risk_to_level: ' + p };
    return { pol };
  } catch (e) { return { error: 'policy invalid JSON: ' + p + ' (' + e.message + ')' }; }
}

const rel = p => path.isAbsolute(p) ? path.normalize(p) : path.normalize(path.join(REPO, p));
function contains(root, target) {
  const r = path.relative(path.normalize(root), path.normalize(target));
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
}
// Classification precedence, most specific first:
//   1. denied_roots           — an explicit denial always wins
//   2. the tool's OWN STATE_DIR — explicit, wherever AGENT_HANDOFF_STATE_DIR points
//   3. approved_workspaces    — the operator's explicit allow-list ('.', repo-upstream, ...)
//   4. personal_data_roots    — a BROAD default root (C:\Users, /home/<user>)
//   5. system_read_only_roots — broad default (C:\Windows, Program Files)
//   6. EXTERNAL_PATH
//
// (3) MUST come before (4): the broad default usually CONTAINS the workspace. A globally
// installed skill lives in ~/.agents/skills, %APPDATA%/... or ~/.config/..., all inside the
// personal-data root, so with the broad root winning, every in-workspace operation of a real
// install was denied at any risk — the acceptance-D read of the shipped fixture exited 3
// instead of 0 from every installed copy while passing in the dev tree at E:\. Specific
// approval beats the broad default; the broad default still governs everything OUTSIDE the
// workspace, and an explicit denied_roots entry still beats both.
function classify(pol, target) {
  if (pol.denied_roots && pol.denied_roots.some(rt => contains(rel(rt), target))) return 'DENIED_ROOT';
  if (target && contains(STATE_DIR, target)) return 'APPROVED_WORKSPACE';
  if (pol.approved_workspaces && pol.approved_workspaces.some(rt => contains(rel(rt), target))) return 'APPROVED_WORKSPACE';
  if (pol.personal_data_roots && pol.personal_data_roots.some(rt => contains(rel(rt), target))) return 'PERSONAL_DATA_PATH';
  if (pol.system_read_only_roots && pol.system_read_only_roots.some(rt => contains(rel(rt), target))) return 'SYSTEM_PATH';
  return 'EXTERNAL_PATH';
}

// evaluate: returns { verdict, reason, risk, level, classification }
// verdict is exactly ALLOWED | DENIED | NEEDS_AUTH. Unknown risk or unknown grant
// value is DENIED (default for unknown — never guessed allowed).
function evaluate(pol, risk, target) {
  const level = pol.risk_to_level[risk];
  if (!level) return { verdict: 'DENIED', reason: 'unknown risk class "' + risk + '" (default denial)', risk, level: null, classification: target ? classify(pol, target) : null };
  // Absolute denials first: personal data and secrets-like paths are DENIED at any risk.
  if (target) {
    const cls = classify(pol, target);
    if (cls === 'PERSONAL_DATA_PATH' || cls === 'DENIED_ROOT') return { verdict: 'DENIED', reason: 'target classified ' + cls + ' — denied at any risk level', risk, level, classification: cls };
    if (level === 'READ_ONLY' || level === 'DISCOVERY_ONLY') {
      if (cls === 'APPROVED_WORKSPACE' || cls === 'SYSTEM_PATH') return { verdict: 'ALLOWED', reason: cls + ' read at ' + risk, risk, level, classification: cls };
      return { verdict: 'DENIED', reason: cls + ' not readable at ' + risk, risk, level, classification: cls };
    }
    if (cls !== 'APPROVED_WORKSPACE') return { verdict: 'DENIED', reason: cls + ' outside approved workspace — writes/effects only inside workspace', risk, level, classification: cls };
  }
  const grant = pol.grants[level];
  if (grant === 'allow') return { verdict: 'ALLOWED', reason: level + ' granted at ' + risk, risk, level, classification: target ? classify(pol, target) : 'APPROVED_WORKSPACE' };
  if (grant === 'needs_auth') return { verdict: 'NEEDS_AUTH', reason: level + ' requires explicit authorization at ' + risk, risk, level, classification: target ? classify(pol, target) : 'APPROVED_WORKSPACE' };
  return { verdict: 'DENIED', reason: 'unknown grant "' + grant + '" for ' + level + ' (default denial)', risk, level, classification: target ? classify(pol, target) : null };
}

function record(rec) {
  try {
    fs.mkdirSync(EXEC_DIR, { recursive: true });
    const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
    const full = Object.assign({ id, enforced_before_execution: true }, rec);
    const p = path.join(EXEC_DIR, id + '.json');
    fs.writeFileSync(p, JSON.stringify(full, null, 2) + '\n');
    // A state dir on another volume cannot be expressed relative to REPO: path.relative
    // returns an ABSOLUTE path there, and consumers that blindly joined it onto REPO then
    // failed with ENOENT. Store whatever actually resolves, and never a broken-looking
    // relative path.
    const relToRepo = path.relative(REPO, p);
    full.record_path = path.isAbsolute(relToRepo) ? p : relToRepo;
    return full;
  } catch (e) {
    rec.record_error = String(e && e.message || e);
    return rec;
  }
}

function evaluateCmd() {
  const polP = rel(argOf('--policy', () => DEFAULT_POLICY));
  const { pol, error } = loadPolicy(polP);
  if (error) { out({ error }); process.exit(2); }
  const risk = argOf('--risk', () => null);
  const target = argOf('--target', () => null);
  if (!risk) { out({ error: 'usage: evaluate --risk R0..R4 [--target path]' }); process.exit(2); }
  const v = evaluate(pol, risk, target ? rel(target) : null);
  out(v);
  process.exit(v.verdict === 'ALLOWED' ? 0 : v.verdict === 'DENIED' ? 3 : 4);
}

function runCmd() {
  const polP = rel(argOf('--policy', () => DEFAULT_POLICY));
  const { pol, error } = loadPolicy(polP);
  if (error) { out({ error }); process.exit(2); }
  const risk = argOf('--risk', () => null);
  const op = argOf('--op', () => null);
  const target = argOf('--target', () => null);
  const args = argOf('--args', () => null);
  if (!risk || !op) { out({ error: 'usage: run --risk R0|R1 --op read --target <path> | --op spawn --args "<node args>"' }); process.exit(2); }

  if (op === 'read') {
    if (!target) { out({ error: 'read op requires --target' }); process.exit(2); }
    const t = rel(target);
    const v = evaluate(pol, risk, t);
    if (v.verdict !== 'ALLOWED') {
      record({ op, risk, verdict: v.verdict, reason: v.reason, target, executed: false });
      out(Object.assign(v, { executed: false }));
      process.exit(v.verdict === 'DENIED' ? 3 : 4);
    }
    try {
      const content = fs.readFileSync(t);
      const rec = record({ op, risk, verdict: 'ALLOWED', reason: v.reason, target, executed: true, bytes: content.length, content_sha256: sha(content) });
      out(Object.assign({ executed: true, bytes: content.length, content_sha256: sha(content) }, { record: rec.record_path }));
      process.exit(0);
    } catch (e) {
      const rec = record({ op, risk, verdict: 'ALLOWED', reason: v.reason, target, executed: false, execution_error: String(e && e.message || e) });
      out({ executed: false, error: String(e && e.message || e), record: rec.record_path });
      process.exit(1);
    }
  }

  if (op === 'spawn') {
    // Bounded: only the local node binary, args from --args, cwd pinned to the
    // approved workspace, hard timeout, output captured and digested.
    const v = evaluate(pol, risk, REPO); // workspace-rooted operation
    if (v.verdict !== 'ALLOWED') {
      record({ op, risk, verdict: v.verdict, reason: v.reason, executed: false, args });
      out(Object.assign(v, { executed: false }));
      process.exit(v.verdict === 'DENIED' ? 3 : 4);
    }
    if (!args || !args.trim()) { out({ error: 'spawn op requires --args' }); process.exit(2); }
    const childArgs = args.split(' ').filter(Boolean);
    const started = new Date().toISOString();
    const r = spawnSync(process.execPath, childArgs, { cwd: REPO, encoding: 'utf8', timeout: 15000 });
    const rec = record({
      op, risk, verdict: 'ALLOWED', reason: v.reason, executed: true,
      command: 'node', args: childArgs, started,
      ended: new Date().toISOString(),
      exit_code: r.status, signal: r.signal || null,
      stdout_sha256: sha(r.stdout || ''), stderr_sha256: sha(r.stderr || ''),
      stdout_bytes: (r.stdout || '').length, stderr_bytes: (r.stderr || '').length,
      timed_out: Boolean(r.error && String(r.error).includes('ETIMEDOUT')) || r.signal === 'SIGTERM',
    });
    out({ executed: true, exit_code: r.status, signal: r.signal || null, record: rec.record_path });
    process.exit(r.status === null ? 1 : r.status);
  }

  out({ error: 'unknown op "' + op + '" (skeleton supports: read, spawn)' });
  process.exit(2);
}

// ---- Task 6: durable checkpoint + resume (zero shared memory) ----

const ckptPath = session => path.join(CKPT_DIR, String(session).replace(/[^\w.-]/g, '_') + '.json');
const workLog = session => path.join(JOBS_DIR, String(session).replace(/[^\w.-]/g, '_'), 'work.log');

function writeCheckpoint(session, ckpt) {
  fs.mkdirSync(CKPT_DIR, { recursive: true });
  ckpt.updated_at = new Date().toISOString();
  const body = Object.assign({}, ckpt);
  delete body.checkpoint_sha256;
  ckpt.checkpoint_sha256 = sha(JSON.stringify(body));
  fs.writeFileSync(ckptPath(session), JSON.stringify(ckpt, null, 2) + '\n');
}

function readCheckpoint(session) {
  const p = ckptPath(session);
  if (!fs.existsSync(p)) return { error: 'no checkpoint for session "' + session + '" (resume requires durable state — never guessed)', code: 4 };
  let ckpt;
  try { ckpt = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return { error: 'corrupt checkpoint (not valid JSON): ' + p, code: 5 }; }
  const body = Object.assign({}, ckpt);
  const expect = body.checkpoint_sha256;
  delete body.checkpoint_sha256;
  if (!expect || sha(JSON.stringify(body)) !== expect) return { error: 'corrupt checkpoint (integrity seal mismatch): ' + p, code: 5 };
  return { ckpt };
}

function execStep(session, seq, pol) {
  // Each bounded step: permission-gated (R1 workspace write), then the step work
  // itself — an append to the session work log. No in-memory carryover between
  // runs: everything resume needs lives in the checkpoint + work log on disk.
  const v = evaluate(pol, 'R1', JOBS_DIR);
  if (v.verdict !== 'ALLOWED') return { error: 'step ' + seq + ' not permitted: ' + v.reason, code: v.verdict === 'DENIED' ? 3 : 4 };
  fs.mkdirSync(path.dirname(workLog(session)), { recursive: true });
  fs.appendFileSync(workLog(session), 'step ' + seq + ' at ' + new Date().toISOString() + '\n');
  return { ok: true };
}

function parseIntArg(name, min) {
  const raw = argOf(name, () => null);
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < min) { out({ error: name + ' must be an integer >= ' + min }); process.exit(2); }
  return n;
}

function jobCmd() {
  const { pol, error } = loadPolicy(rel(argOf('--policy', () => DEFAULT_POLICY)));
  if (error) { out({ error }); process.exit(2); }
  const session = argOf('--session', () => null);
  if (!session) { out({ error: 'job requires --session' }); process.exit(2); }
  const steps = parseIntArg('--steps', 1);
  const failAt = argOf('--fail-at', () => null);
  if (failAt !== null) {
    const k = Number(failAt);
    if (!Number.isInteger(k) || k < 2 || k > steps) { out({ error: '--fail-at must be an integer in [2,' + steps + ']' }); process.exit(2); }
  }
  const existing = readCheckpoint(session);
  if (existing.ckpt) { out({ error: 'checkpoint already exists for session "' + session + '" — use resume' }); process.exit(2); }
  runJob(session, steps, failAt === null ? null : Number(failAt), pol, { seq: 0, steps: [] });
}

function resumeCmd() {
  const { pol, error } = loadPolicy(rel(argOf('--policy', () => DEFAULT_POLICY)));
  if (error) { out({ error }); process.exit(2); }
  const session = argOf('--session', () => null);
  if (!session) { out({ error: 'resume requires --session' }); process.exit(2); }
  const steps = parseIntArg('--steps', 1);
  const { ckpt, error: ckptError, code } = readCheckpoint(session);
  if (ckptError) { out({ error: ckptError }); process.exit(code); }
  if (ckpt.completed) { out({ session, already_completed: true, seq: ckpt.seq, steps_total: ckpt.steps_total }); process.exit(0); }
  if (ckpt.steps_total && steps !== ckpt.steps_total) {
    out({ error: '--steps ' + steps + ' mismatches the durable checkpoint (steps_total ' + ckpt.steps_total + ') — resume must match the recorded job shape' });
    process.exit(2);
  }
  runJob(session, steps, null, pol, ckpt);
}

function runJob(session, steps, failAt, pol, ckpt) {
  let seq = ckpt.seq || 0;
  ckpt.steps = ckpt.steps || [];
  while (seq < steps) {
    const next = seq + 1;
    if (failAt !== null && next === failAt) {
      // Simulated abrupt kill BEFORE executing this step and BEFORE any checkpoint
      // for it: the last durable state is seq = next-1. A real crash (SIGKILL,
      // power loss) leaves exactly the same on-disk state.
      out({ session, killed_at_step: next, checkpoint_seq: seq, note: 'simulated abrupt kill (exit 137) — durable checkpoint intact at seq ' + seq });
      process.exit(137);
    }
    const r = execStep(session, next, pol);
    if (r.error) { out({ error: r.error }); process.exit(r.code); }
    seq = next;
    ckpt.seq = seq;
    ckpt.steps.push({ seq, ts: new Date().toISOString(), op: 'work-log-append' });
    ckpt.steps_total = steps;
    ckpt.session = session;
    writeCheckpoint(session, ckpt);
  }
  ckpt.completed = true;
  writeCheckpoint(session, ckpt);
  out({ session, completed: true, steps, seq, work_log: path.relative(REPO, workLog(session)) });
  process.exit(0);
}

function statusCmd() {
  const session = argOf('--session', () => null);
  if (!session) { out({ error: 'status requires --session' }); process.exit(2); }
  const { ckpt, error, code } = readCheckpoint(session);
  if (error) { out({ error }); process.exit(code); }
  const log = fs.existsSync(workLog(session)) ? fs.readFileSync(workLog(session), 'utf8').split(/\r?\n/).filter(Boolean) : [];
  out({ session, seq: ckpt.seq, steps_total: ckpt.steps_total || null, completed: Boolean(ckpt.completed), work_log_lines: log.length });
  process.exit(0);
}

function policyCmd() {
  const { pol, error } = loadPolicy(rel(argOf('--policy', () => DEFAULT_POLICY)));
  if (error) { out({ error }); process.exit(2); }
  out(pol);
  process.exit(0);
}

const cmd = process.argv[2];
if (cmd === 'evaluate') evaluateCmd();
else if (cmd === 'run') runCmd();
else if (cmd === 'job') jobCmd();
else if (cmd === 'resume') resumeCmd();
else if (cmd === 'status') statusCmd();
else if (cmd === 'policy') policyCmd();
else { out({ error: 'usage: runtime-engine.mjs evaluate|run|job|resume|status|policy' }); process.exit(2); }
