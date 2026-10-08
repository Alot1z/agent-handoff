#!/usr/bin/env node
// handoff.test.mjs v1.3.0 — zero-dep suite for the canonical engine + runtime MVP.
// Run: node tools/handoff.test.mjs   (also wired as repo-upstream npm test)
// Exercises the REAL CLI through spawnSync, hermetically: every test gets a scratch
// HANDOFFS_ROOT (tmpdir) removed afterwards. Covers plan Task 3 (engine: build,
// verify integrity incl. tamper, list, error exits, idempotence), Task 4 (capability
// registry: honest health verdicts), Task 5 (permission + execution engine:
// evaluate-before-execute, denial, needs-auth, bounded exit-code capture) and
// Task 6 (checkpoint/resume: interrupt-resume without duplication or loss, honest
// missing/corrupt checkpoint failures). node:test + assert only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const ENGINE = path.join(REPO, 'tools', 'handoff.mjs');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'minimal-transcript.jsonl');

// Hermetic by construction: this suite never writes into the repo. When the
// checker supplies AGENT_HANDOFF_STATE_DIR it is used as-is (the checker owns
// cleanup); otherwise the suite makes its own scratch root and removes it on
// exit, so a bare `node tools/handoff.test.mjs` is side-effect-free too.
const STATE_DIR = process.env.AGENT_HANDOFF_STATE_DIR
  ? path.resolve(process.env.AGENT_HANDOFF_STATE_DIR)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'ah-suite-'));
const OWN_STATE_DIR = process.env.AGENT_HANDOFF_STATE_DIR ? null : STATE_DIR;
process.on('exit', () => {
  if (OWN_STATE_DIR) { try { fs.rmSync(OWN_STATE_DIR, { recursive: true, force: true }); } catch { /* best effort */ } }
});
const stateEnv = () => Object.assign({}, process.env, { AGENT_HANDOFF_STATE_DIR: STATE_DIR });

function run(args, root) {
  return spawnSync(process.execPath, [ENGINE, ...args], {
    cwd: REPO,
    env: Object.assign({}, process.env, root ? { HANDOFFS_ROOT: root } : {}),
    encoding: 'utf8',
  });
}
function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ah-test-'));
}
function sessionDir(root, proj) {
  return path.join(root, 'projects', proj, 'minimal-transcript');
}

test('build from deterministic fixture succeeds with expected marker', () => {
  const root = scratch();
  try {
    const r = run(['build', '--source', FIXTURE, '--project', 'test-suite-proj'], root);
    assert.equal(r.status, 0, 'exit 0, stderr: ' + r.stderr);
    assert.ok(r.stdout.includes('handoff: built'), 'marker: ' + r.stdout);
    assert.ok(r.stdout.includes('turns=2'), 'fixture turn count: ' + r.stdout);
    const man = JSON.parse(fs.readFileSync(path.join(sessionDir(root, 'test-suite-proj'), 'manifest.json'), 'utf8'));
    assert.equal(man.session, 'minimal-transcript');
    assert.equal(man.project, 'test-suite-proj');
    assert.equal(man.turn_count, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('verify detects manifest tampering (integrity oracle)', () => {
  const root = scratch();
  try {
    const b = run(['build', '--source', FIXTURE, '--project', 'test-suite-proj'], root);
    assert.equal(b.status, 0, 'setup build failed: ' + b.stderr);
    const manP = path.join(sessionDir(root, 'test-suite-proj'), 'manifest.json');
    const man = JSON.parse(fs.readFileSync(manP, 'utf8'));
    man.turn_count = 99; // tamper WITHOUT fixing manifest_sha256
    fs.writeFileSync(manP, JSON.stringify(man, null, 2));
    const v = run(['verify', 'minimal-transcript'], root);
    assert.equal(v.status, 1, 'tampered verify must exit 1, got ' + v.status + ' out=' + v.stdout);
    assert.ok(/FAIL .*manifest tampered/.test(v.stdout + v.stderr), 'tamper message: ' + v.stdout + v.stderr);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('verify passes on an untampered handoff', () => {
  const root = scratch();
  try {
    const b = run(['build', '--source', FIXTURE, '--project', 'test-suite-proj'], root);
    assert.equal(b.status, 0, 'setup build failed: ' + b.stderr);
    const v = run(['verify', 'minimal-transcript'], root);
    assert.equal(v.status, 0, 'verify exit: ' + v.status + ' out=' + v.stdout + v.stderr);
    assert.ok(v.stdout.includes('PASS '), 'PASS marker: ' + v.stdout);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('list shows the built session under its project', () => {
  const root = scratch();
  try {
    const b = run(['build', '--source', FIXTURE, '--project', 'test-suite-proj'], root);
    assert.equal(b.status, 0, 'setup build failed: ' + b.stderr);
    const l = run(['list', 'test-suite-proj'], root);
    assert.equal(l.status, 0, 'list exit: ' + l.status + ' err=' + l.stderr);
    assert.ok(l.stdout.includes('[test-suite-proj]'), 'project row: ' + l.stdout);
    assert.ok(l.stdout.includes('minimal-transcript'), 'session row: ' + l.stdout);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('malformed .jsonl source is rejected with non-zero exit', () => {
  const root = scratch();
  try {
    const bad = path.join(root, 'garbage.jsonl');
    fs.writeFileSync(bad, 'not json at all\n{"broken": tru}\nalso junk\n');
    const r = run(['build', '--source', bad, '--project', 'test-suite-proj'], root);
    assert.equal(r.status, 4, 'malformed source must exit 4, got ' + r.status + ' out=' + r.stdout);
    assert.ok(/no usable turns/.test(r.stderr), 'rejection message: ' + r.stderr);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('missing source file is rejected with non-zero exit', () => {
  const root = scratch();
  try {
    const r = run(['build', '--source', path.join(root, 'does-not-exist.jsonl'), '--project', 'p'], root);
    assert.equal(r.status, 2, 'missing source must exit 2, got ' + r.status + ' out=' + r.stdout);
    assert.ok(/source not found/.test(r.stderr), 'message: ' + r.stderr);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('usage errors exit non-zero (verify without prefix, bad command)', () => {
  const root = scratch();
  try {
    const v = run(['verify'], root);
    assert.equal(v.status, 2, 'verify-without-prefix must exit 2, got ' + v.status);
    const x = run(['definitely-not-a-command'], root);
    assert.equal(x.status, 2, 'unknown command must exit 2, got ' + x.status);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- Plan Task 4: capability registry (tools/capability-registry.mjs) ----

const REG = path.join(REPO, 'capability-registry.json');
const REGCLI = path.join(REPO, 'tools', 'capability-registry.mjs');

function runReg(args) {
  return spawnSync(process.execPath, [REGCLI, ...args], { cwd: REPO, env: stateEnv(), encoding: 'utf8' });
}

test('capability registry check: all declared capabilities probe healthy through the CLI', () => {
  const r = runReg(['check', '--registry', REG]);
  assert.equal(r.status, 0, 'check exit: ' + r.status + ' out=' + r.stdout + r.stderr);
  for (const id of ['filesystem.read', 'filesystem.write', 'process.execute'])
    assert.ok(r.stdout.includes('[healthy] ' + id), 'healthy verdict for ' + id + ': ' + r.stdout);
  const state = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'capability-state.json'), 'utf8'));
  assert.ok(Array.isArray(state.results) && state.results.length >= 3, 'filesystem-backed state written');
  for (const res of state.results) assert.ok(['healthy', 'unhealthy', 'unknown'].includes(res.verdict), 'verdict class: ' + res.verdict);
});

test('capability registry: unknown capability id reported honestly, non-zero exit', () => {
  const r = runReg(['check', '--registry', REG, 'no-such-capability']);
  assert.equal(r.status, 4, 'unknown id must exit 4, got ' + r.status);
  assert.ok(/unknown capability id/.test(r.stdout + r.stderr), 'message: ' + r.stdout + r.stderr);
});

test('capability registry: unknown probe kind is never guessed healthy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-reg-'));
  try {
    const bad = path.join(root, 'bad-registry.json');
    fs.writeFileSync(bad, JSON.stringify({ schema_version: 'x', capabilities: [
      { id: 'telepathy.link', kind: 'telepathy', required: true },
      { id: 'optional.extra', kind: 'file-exists', target: 'does-not-matter.txt', required: false },
    ] }));
    const r = runReg(['check', '--registry', bad]);
    assert.equal(r.status, 1, 'unknown kind on a REQUIRED capability must fail the gate, got ' + r.status);
    assert.ok(r.stdout.includes('[unknown] telepathy.link'), 'unknown verdict: ' + r.stdout);
    assert.ok(r.stdout.includes('no guessed verdicts'), 'honesty note: ' + r.stdout);
    assert.ok(r.stdout.includes('[healthy] optional.extra') || r.stdout.includes('[unhealthy] optional.extra'), 'optional probed anyway: ' + r.stdout);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('capability registry: missing registry file is a config error (exit 2)', () => {
  const r = runReg(['check', '--registry', path.join(os.tmpdir(), 'ah-no-such-registry.json')]);
  assert.equal(r.status, 2, 'missing registry must exit 2, got ' + r.status);
  assert.ok(/registry not found/.test(r.stdout + r.stderr), 'message: ' + r.stdout + r.stderr);
});

// ---- Plan Task 5: permission engine + execution engine skeleton ----

const ENGINECLI = path.join(REPO, 'tools', 'runtime-engine.mjs');
const EXEC_DIR = path.join(STATE_DIR, 'executions');

function runEng(args) {
  return spawnSync(process.execPath, [ENGINECLI, ...args], { cwd: REPO, env: stateEnv(), encoding: 'utf8' });
}
// record_path is REPO-relative when it can be expressed that way, and ABSOLUTE when the
// state dir lives on another volume (cross-drive path.relative returns an absolute path).
// Resolve both honestly instead of assuming relative.
const resolveRecord = rp => (path.isAbsolute(rp) ? rp : path.join(REPO, rp));

function latestRecord(filterFn) {
  const files = fs.readdirSync(EXEC_DIR).filter(f => f.endsWith('.json')).sort().reverse();
  for (const f of files) {
    const r = JSON.parse(fs.readFileSync(path.join(EXEC_DIR, f), 'utf8'));
    if (filterFn(r)) return r;
  }
  return null;
}

// Acceptance scenario D — safe execution through the runtime.
test('runtime: safe execution path (D) — allowed R0 read executes with captured record', () => {
  const r = runEng(['run', '--risk', 'R0', '--op', 'read', '--target', 'tests/fixtures/minimal-transcript.jsonl']);
  assert.equal(r.status, 0, 'safe read exit: ' + r.status + ' out=' + r.stdout + r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.executed, true);
  assert.ok(o.content_sha256 && o.bytes > 0, 'digest captured');
  const rec = JSON.parse(fs.readFileSync(resolveRecord(o.record), 'utf8'));
  assert.equal(rec.verdict, 'ALLOWED');
  assert.equal(rec.enforced_before_execution, true);
});

// Acceptance scenario C — permission denial through the runtime.
test('runtime: permission denial path (C) — personal-data read DENIED, never executed', () => {
  const personal = path.join(os.homedir(), 'secret-test.txt');
  const v = runEng(['evaluate', '--risk', 'R4', '--target', personal]);
  assert.equal(v.status, 3, 'evaluate DENIED must exit 3, got ' + v.status);
  assert.ok(v.stdout.includes('"DENIED"'), 'verdict: ' + v.stdout);
  const r = runEng(['run', '--risk', 'R4', '--op', 'read', '--target', personal]);
  assert.equal(r.status, 3, 'run DENIED must exit 3, got ' + r.status);
  const o = JSON.parse(r.stdout);
  assert.equal(o.executed, false, 'denied op must not execute: ' + r.stdout);
  const rec = latestRecord(x => x.op === 'read' && x.risk === 'R4');
  assert.ok(rec, 'denial record written');
  assert.equal(rec.verdict, 'DENIED');
  assert.equal(rec.executed, false);
  assert.equal(rec.enforced_before_execution, true);
});

test('runtime: R2 on workspace is NEEDS_AUTH (exit 4), not silently allowed', () => {
  // README.md is a file every layout has — a clone, a release archive and the development
  // tree — so the target stays valid wherever this suite runs.
  const r = runEng(['evaluate', '--risk', 'R2', '--target', 'README.md']);
  assert.equal(r.status, 4, 'NEEDS_AUTH must exit 4, got ' + r.status);
  assert.ok(r.stdout.includes('"NEEDS_AUTH"'), 'verdict: ' + r.stdout);
});

test('runtime: bounded spawn captures the child exit code exactly', () => {
  const r = runEng(['run', '--risk', 'R1', '--op', 'spawn', '--args', '-e process.exit(7)']);
  assert.equal(r.status, 7, 'engine must propagate child exit 7, got ' + r.status);
  const o = JSON.parse(r.stdout);
  assert.equal(o.exit_code, 7);
  const rec = JSON.parse(fs.readFileSync(resolveRecord(o.record), 'utf8'));
  assert.equal(rec.exit_code, 7);
  assert.ok(rec.stdout_sha256, 'stdout digest captured');
});

test('runtime: unknown risk class is default-denied; unknown op is usage error', () => {
  const r1 = runEng(['evaluate', '--risk', 'RX', '--target', 'README.md']);
  assert.equal(r1.status, 3, 'unknown risk must DENIED exit 3, got ' + r1.status);
  assert.ok(r1.stdout.includes('default denial'), 'reason: ' + r1.stdout);
  const r2 = runEng(['run', '--risk', 'R1', '--op', 'format-c-drive']);
  assert.equal(r2.status, 2, 'unknown op must exit 2, got ' + r2.status);
});

// ---- Plan Task 6: durable checkpoint + resume ----

const CKPT_FILE = s => path.join(STATE_DIR, 'checkpoints', s + '.json');
const WORK_LOG = s => path.join(STATE_DIR, 'jobs', s, 'work.log');

function logSteps(session) {
  if (!fs.existsSync(WORK_LOG(session))) return [];
  return fs.readFileSync(WORK_LOG(session), 'utf8').split(/\r?\n/).filter(Boolean)
    .map(l => Number(l.match(/^step (\d+) /)[1]));
}

// The plan's scripted interrupt-resume oracle.
test('runtime: kill mid-action then resume completes without duplication or loss', () => {
  const s = 'ckpt-oracle-' + Date.now();
  // 1. abrupt kill before step 3 of 5
  const job = runEng(['job', '--session', s, '--steps', '5', '--fail-at', '3']);
  assert.equal(job.status, 137, 'simulated kill exit, got ' + job.status + ' out=' + job.stdout + job.stderr);
  assert.ok(job.stdout.includes('killed_at_step":3'), 'kill point: ' + job.stdout);
  assert.deepEqual(logSteps(s), [1, 2], 'exactly the pre-kill steps ran');
  // 2. fresh process resumes purely from disk state (zero shared memory)
  const res = runEng(['resume', '--session', s, '--steps', '5']);
  assert.equal(res.status, 0, 'resume exit: ' + res.status + ' out=' + res.stdout + res.stderr);
  const steps = logSteps(s);
  assert.equal(steps.length, 5, 'no loss: ' + steps.length + ' steps');
  assert.deepEqual([...new Set(steps)].sort((a, b) => a - b), [1, 2, 3, 4, 5], 'no duplication: unique steps ' + steps);
  const st = JSON.parse(runEng(['status', '--session', s]).stdout);
  assert.equal(st.completed, true);
  assert.equal(st.work_log_lines, 5);
});

test('runtime: clean job completes with durable checkpoint per step', () => {
  const s = 'ckpt-clean-' + Date.now();
  const r = runEng(['job', '--session', s, '--steps', '4']);
  assert.equal(r.status, 0, 'job exit: ' + r.status + ' out=' + r.stdout + r.stderr);
  assert.deepEqual(logSteps(s), [1, 2, 3, 4]);
  const ck = JSON.parse(fs.readFileSync(CKPT_FILE(s), 'utf8'));
  assert.equal(ck.seq, 4);
  assert.equal(ck.completed, true);
  assert.ok(ck.checkpoint_sha256, 'integrity seal present');
  assert.equal(ck.steps.length, 4, 'checkpoint per step');
});

test('runtime: resume from missing checkpoint fails honestly (never guesses)', () => {
  const r = runEng(['resume', '--session', 'no-such-session-' + Date.now(), '--steps', '3']);
  assert.equal(r.status, 4, 'missing checkpoint must exit 4, got ' + r.status);
  assert.ok(/no checkpoint for session/.test(r.stdout), 'message: ' + r.stdout);
});

test('runtime: corrupt (tampered) checkpoint fails the integrity seal', () => {
  const s = 'ckpt-tamper-' + Date.now();
  const j = runEng(['job', '--session', s, '--steps', '3', '--fail-at', '2']);
  assert.equal(j.status, 137, 'setup kill: ' + j.status);
  const p = CKPT_FILE(s);
  const ck = JSON.parse(fs.readFileSync(p, 'utf8'));
  ck.seq = 99; // tamper without re-sealing
  fs.writeFileSync(p, JSON.stringify(ck, null, 2));
  const r = runEng(['resume', '--session', s, '--steps', '3']);
  assert.equal(r.status, 5, 'tampered checkpoint must exit 5, got ' + r.status);
  assert.ok(/integrity seal mismatch/.test(r.stdout), 'message: ' + r.stdout);
  assert.deepEqual(logSteps(s), [1], 'tampered resume must not have executed any step');
});

test('runtime: job refuses to overwrite an existing session checkpoint', () => {
  const s = 'ckpt-dup-' + Date.now();
  const j1 = runEng(['job', '--session', s, '--steps', '2']);
  assert.equal(j1.status, 0, 'first job: ' + j1.status);
  const j2 = runEng(['job', '--session', s, '--steps', '2']);
  assert.equal(j2.status, 2, 'second job must refuse, got ' + j2.status);
  assert.ok(/already exists/.test(j2.stdout), 'message: ' + j2.stdout);
  assert.deepEqual(logSteps(s), [1, 2], 'no duplicate execution');
});

test('runtime: resume already_completed reports the CHECKPOINT steps_total, not the caller flag', () => {
  const s = 'ckpt-fin-' + Date.now();
  const j = runEng(['job', '--session', s, '--steps', '4']);
  assert.equal(j.status, 0, 'setup job: ' + j.status);
  const r = runEng(['resume', '--session', s, '--steps', '4']);
  assert.equal(r.status, 0, 'resume exit: ' + r.status);
  const o = JSON.parse(r.stdout);
  assert.equal(o.already_completed, true);
  assert.equal(o.steps_total, 4, 'steps_total from durable checkpoint: ' + r.stdout);
  assert.deepEqual(logSteps(s), [1, 2, 3, 4], 'no extra execution');
});

test('runtime: resume with mismatched --steps is refused (job shape must match durable state)', () => {
  const s = 'ckpt-mismatch-' + Date.now();
  const j = runEng(['job', '--session', s, '--steps', '5', '--fail-at', '3']);
  assert.equal(j.status, 137, 'setup kill: ' + j.status);
  const r = runEng(['resume', '--session', s, '--steps', '3']);
  assert.equal(r.status, 2, 'mismatch must exit 2, got ' + r.status);
  assert.ok(/mismatches the durable checkpoint/.test(r.stdout), 'message: ' + r.stdout);
  assert.deepEqual(logSteps(s), [1, 2], 'refused resume executes nothing');
  const res = runEng(['resume', '--session', s, '--steps', '5']);
  assert.equal(res.status, 0, 'matching resume still works: ' + res.status);
});

test('runtime: whitespace-only spawn args are a usage error, not a silent no-op', () => {
  const r = runEng(['run', '--risk', 'R1', '--op', 'spawn', '--args', '   ']);
  assert.equal(r.status, 2, 'whitespace args must exit 2, got ' + r.status);
  assert.ok(/requires --args/.test(r.stdout), 'message: ' + r.stdout);
});

test('runtime: path traversal outside the workspace is DENIED before execution', () => {
  const r = runEng(['run', '--risk', 'R1', '--op', 'read', '--target', '../../Windows/win.ini']);
  assert.equal(r.status, 3, 'traversal must DENIED exit 3, got ' + r.status);
  assert.ok(r.stdout.includes('"DENIED"'), 'verdict: ' + r.stdout);
  // The CONTRACT under test is denial-before-execution for a target outside the workspace.
  // WHICH class the denial names depends on where this copy lives: `../../Windows/win.ini`
  // resolves under C:\Windows from a shallow install path, but under C:\Users (a personal
  // root, denied at any risk) when the skill itself sits under a personal root - which is
  // every os.tmpdir() copy on Windows, i.e. every installed or relocated one. Pinning
  // EXTERNAL_PATH made this suite fail for a relocation reason rather than a defect, which
  // is exactly what the clean-checkout test (acceptance J) exists to catch. Any
  // outside-workspace class still proves the denial; APPROVED_WORKSPACE would not.
  const rec = latestRecord(x => x.op === 'read' && x.risk === 'R1' && x.executed === false && /EXTERNAL_PATH|PERSONAL_DATA_PATH|SYSTEM_PATH/.test(x.reason || ''));
  assert.ok(rec, 'denial record naming an outside-workspace class, executed=false');
  assert.ok(!/APPROVED_WORKSPACE/.test(rec.reason || ''), 'traversal must not be treated as inside the workspace: ' + rec.reason);
});

// A workspace is approved by CONFIG, not by where it happens to live. `personal_data_roots`
// is a BROAD default (C:\Users, /home/<user>) and a real install's workspace is INSIDE it:
// ~/.agents/skills, %APPDATA%/... and ~/.config/... are all under the user's home. If the
// broad default won, every in-workspace operation of an installed copy would be denied at any
// risk - the acceptance-D read of the shipped fixture exited 3 instead of 0 from every global
// install, while passing in the dev tree at E:\..., so no test there could see it. This
// reproduces that layout PORTABLY by pointing --policy at a temp policy that declares the
// repo's own parent a personal-data root, and asserts all three precedence steps.
test('runtime: an approved workspace wins over a broad personal-data root it lives inside', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-pol-'));
  try {
    const base = JSON.parse(fs.readFileSync(path.join(REPO, 'permission-policy.json'), 'utf8'));
    base.personal_data_roots = [path.dirname(REPO)]; // the skill now sits INSIDE a personal root
    const polPath = path.join(root, 'policy.json');
    fs.writeFileSync(polPath, JSON.stringify(base, null, 2));

    // 1. Inside the workspace: the explicit approval wins, so the shipped fixture is readable.
    const inside = runEng(['evaluate', '--policy', polPath, '--risk', 'R0', '--target', 'tests/fixtures/minimal-transcript.jsonl']);
    assert.equal(inside.status, 0, 'approved workspace must win: exit ' + inside.status + ' out=' + inside.stdout);
    assert.ok(inside.stdout.includes('APPROVED_WORKSPACE'), 'classified as the workspace: ' + inside.stdout);
    const realRun = runEng(['run', '--policy', polPath, '--risk', 'R0', '--op', 'read', '--target', 'tests/fixtures/minimal-transcript.jsonl']);
    assert.equal(realRun.status, 0, 'an in-workspace read must actually execute: ' + realRun.stdout + realRun.stderr);
    assert.equal(JSON.parse(realRun.stdout).executed, true, 'executed: ' + realRun.stdout);

    // 2. Outside it: the broad root still governs, so the boundary is not weakened.
    const outside = runEng(['evaluate', '--policy', polPath, '--risk', 'R0', '--target', path.join(path.dirname(REPO), 'not-in-workspace.txt')]);
    assert.equal(outside.status, 3, 'outside the workspace it is still personal data: ' + outside.stdout);
    assert.ok(outside.stdout.includes('PERSONAL_DATA_PATH'), 'classification: ' + outside.stdout);

    // 3. An explicit denial outranks the workspace approval.
    const denied = JSON.parse(JSON.stringify(base));
    denied.denied_roots = [REPO];
    const deniedPath = path.join(root, 'policy-denied.json');
    fs.writeFileSync(deniedPath, JSON.stringify(denied, null, 2));
    const d = runEng(['evaluate', '--policy', deniedPath, '--risk', 'R0', '--target', 'README.md']);
    assert.equal(d.status, 3, 'an explicit denial must outrank the workspace approval: ' + d.stdout);
    assert.ok(d.stdout.includes('DENIED_ROOT'), 'classification: ' + d.stdout);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// The installer's manifest is the one list that decides what an installed copy contains, and
// it is written in the PUBLIC tree's terms so that a clone and a release archive resolve it at
// the same paths. Two drifts are possible, and both happened: a source addressed under a path
// only the development tree has (the guides, which installed as fourteen "Source file not
// found" warnings and no docs/ at all), and a fallback version a release bumps in one place
// but not the other. This test pins both against the tree it runs in.
// An INSTALLED copy does not ship install/ — the manifest deliberately leaves the installer
// out — so this test is about the tree that has one, and an installed copy skips it by name
// rather than failing the suite that proves the installed copy works.
const INSTALLER_SRC = path.join(REPO, 'install', 'install.mjs');
test('installer: every manifest source resolves here, and the fallback version matches SKILL.md', (t) => {
  if (!fs.existsSync(INSTALLER_SRC)) {
    return t.skip('no install/ in this tree — an installed copy omits the installer by design');
  }
  const src = fs.readFileSync(INSTALLER_SRC, 'utf8');
  const list = src.match(/const SKILL_FILES = \[([\s\S]*?)\n\];/);
  assert.ok(list, 'SKILL_FILES must be readable from the installer source');
  const froms = [...list[1].matchAll(/from: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(froms.length >= 30, 'non-vacuous manifest, entries=' + froms.length);
  // Resolved exactly as the installer resolves it: repo-upstream/<from> first, then <from>.
  for (const from of froms) {
    const dev = path.join(REPO, 'repo-upstream', from);
    const pub = path.join(REPO, from);
    assert.ok(fs.existsSync(dev) || fs.existsSync(pub),
      'install manifest source resolves nowhere (' + from + ') — an installed copy would silently lose it');
  }

  // The fallback is what the published package uses before it has a tree, so a release that
  // bumps SKILL.md without bumping it would install and report the previous version.
  const fallback = /const FALLBACK_SKILL_VERSION = '([^']+)'/.exec(src);
  assert.ok(fallback, 'the installer must declare its fallback version');
  const skillMd = fs.readFileSync(path.join(REPO, 'SKILL.md'), 'utf8');
  const version = /^version:\s*(\S+)/m.exec(skillMd);
  assert.ok(version, 'SKILL.md must declare a version');
  assert.equal(fallback[1], version[1],
    'installer fallback version must equal SKILL.md version');
});

test('rebuild of identical source is idempotent (up-to-date, revision stable)', () => {
  const root = scratch();
  try {
    const b1 = run(['build', '--source', FIXTURE, '--project', 'test-suite-proj'], root);
    assert.equal(b1.status, 0, 'first build failed: ' + b1.stderr);
    const manP = path.join(sessionDir(root, 'test-suite-proj'), 'manifest.json');
    const rev1 = JSON.parse(fs.readFileSync(manP, 'utf8')).revisions;
    const b2 = run(['build', '--source', FIXTURE, '--project', 'test-suite-proj'], root);
    assert.equal(b2.status, 0, 'second build failed: ' + b2.stderr);
    assert.ok(b2.stdout.includes('up-to-date'), 'idempotent marker: ' + b2.stdout);
    const rev2 = JSON.parse(fs.readFileSync(manP, 'utf8')).revisions;
    assert.equal(rev2, rev1, 'revision must not bump on identical rebuild');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
