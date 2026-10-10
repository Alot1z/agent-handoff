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
// This file travels to the published repository, and it also runs from the authoring skill
// tree. `package.json` is NOT one of those two trees' shared files: sync-upstream publishes an
// allowlist of skill files, and the root package.json is authored in repo-upstream only. A
// publish-tree assertion therefore cannot be satisfied in the authoring tree, and is named as
// such rather than failed there. The published tree — and CI, which runs at the repo root —
// still runs it.
const IS_PUBLISH_TREE = fs.existsSync(path.join(REPO, 'package.json'));
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

  // skill.json is PUBLISHED metadata: the changelog tells readers that package.json and
  // skill.json carry the release version, and the installer copies it into every install.
  // It lagged at 2.0.4 while SKILL.md and package.json said 2.0.5 — a published
  // contradiction with no runtime consumer to catch it, so the test is the catcher.
  const skillJson = JSON.parse(fs.readFileSync(path.join(REPO, 'skill.json'), 'utf8'));
  assert.equal(skillJson.version, version[1],
    'skill.json version must equal SKILL.md version');
  assert.equal(skillJson.installer && skillJson.installer.packageVersion, version[1],
    'skill.json installer.packageVersion must equal SKILL.md version');
});

// The published identity is one name in one manifest, and every page a user reads has to agree
// with it. Two drifts are possible here and both are silent until a stranger runs npx: a rename
// that misses a guide, and a `files` list that drops a directory the installer copies from —
// which would install an incomplete skill while reporting success.
test('package: the published name, the packed file list and the docs agree', (t) => {
  if (!fs.existsSync(INSTALLER_SRC)) {
    return t.skip('no install/ in this tree — an installed copy omits the installer by design');
  }
  if (!IS_PUBLISH_TREE) {
    return t.skip('authoring skill tree — the root package.json is authored in repo-upstream');
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'agents-handoff', 'the published package name');
  const skillMd = fs.readFileSync(path.join(REPO, 'SKILL.md'), 'utf8');
  assert.equal(pkg.version, /^version:\s*(\S+)/m.exec(skillMd)[1],
    'package.json version must equal SKILL.md version');
  assert.ok(!pkg.private, 'the root package must be publishable — install/ is the private one');
  for (const entry of pkg.files) {
    const rel = entry.replace(/\/$/, '');
    assert.ok(fs.existsSync(path.join(REPO, rel)), 'package.json files entry does not exist: ' + entry);
  }
  for (const [bin, target] of Object.entries(pkg.bin || {})) {
    assert.ok(fs.existsSync(path.join(REPO, target)), 'bin ' + bin + ' points at a missing file: ' + target);
  }

  // What the installer copies has to be inside what npm packs, or the published package installs
  // a partial skill. Each manifest source is covered by a `files` entry for itself or its dir.
  const src = fs.readFileSync(INSTALLER_SRC, 'utf8');
  const list = src.match(/const SKILL_FILES = \[([\s\S]*?)\n\];/);
  const froms = [...list[1].matchAll(/from: '([^']+)'/g)].map((m) => m[1]);
  const packed = pkg.files.map((f) => f.replace(/\/$/, ''));
  for (const from of froms) {
    assert.ok(packed.includes(from) || packed.includes(from.split('/')[0]),
      'installer source is not in package.json files, so npm would not ship it: ' + from);
  }

  // The retired PACKAGE name must not survive anywhere a reader would follow it. The install
  // provenance file is `.agents-handoff-install.json`, which contains the old token as a
  // substring without being it, so both sides are anchored: not preceded by a dot, not the
  // `.json` record.
  const retired = /(?<!\.)agents-handoff-install(?!\.json)/;
  const readers = fs.readdirSync(path.join(REPO, 'docs'))
    .filter((f) => f.endsWith('.md')).map((f) => path.join('docs', f));
  readers.push('README.md', 'skill.json', path.join('install', 'README.md'), path.join('.github', 'workflows', 'release.yml'));
  for (const rel of readers) {
    const abs = path.join(REPO, rel);
    if (!fs.existsSync(abs)) continue;
    assert.ok(!retired.test(fs.readFileSync(abs, 'utf8')),
      rel + ' still names the retired package agents-handoff-install');
  }
});

// ---- installer behaviour -------------------------------------------------------------------
// The installer is the only thing a new user runs, and its jobs are one sentence each: install
// into the harness(es) named, update every copy on the machine, verify each copy, and never
// delete the store. Those are behaviours rather than file lists, so they are exercised by
// running the real installer against a scratch home.
//
// APPDATA/LOCALAPPDATA are redirected with USERPROFILE/HOME because the global resolver
// DISCOVERS stores under those roots: a test that left them real would read — and, for
// `--update`, WRITE TO — the developer's own installations.
const INSTALLER = path.join(REPO, 'install', 'install.mjs');
const skillVersion = () => /^version:\s*(\S+)/m.exec(fs.readFileSync(path.join(REPO, 'SKILL.md'), 'utf8'))[1];
// An INSTALLED copy deliberately has no install/ — the manifest leaves the installer out — so
// these tests skip there by name rather than failing the suite that proves the copy works. This
// is not a formality: running the suite from an installation is exactly how the missing guard
// was found, because the failures were `spawnSync` on a path that does not exist.
// `t.skip()` returns undefined, so a helper that RETURNED it would be falsy and every guarded
// test would go on to run — which is how this looked like a passing suite with failing tests
// inside it. The helper returns the verdict, and the caller returns on true.
function noInstaller(t) {
  if (fs.existsSync(INSTALLER)) return false;
  t.skip('no install/ in this tree — an installed copy omits the installer by design');
  return true;
}

function scratchHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-home-'));
  for (const d of ['.claude', '.codex', '.agents']) fs.mkdirSync(path.join(home, d), { recursive: true });
  return home;
}
function runInstaller(args, home, extraEnv = {}) {
  return spawnSync(process.execPath, [INSTALLER, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      USERPROFILE: home,
      HOME: home,
      APPDATA: path.join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
      AGENT_HANDOFF_GLOBAL_DIR: '',
    }, extraEnv),
  });
}
const installAt = (home, harness) => path.join(home, harness, 'skills', 'agents-handoff');

for (const t of [
  ['installer: one run installs into every harness named, each with its own record', (t) => {
    if (noInstaller(t)) return;
    const home = scratchHome();
    try {
      const r = runInstaller(['--claude', '--codex', '--agents'], home);
      assert.equal(r.status, 0, 'install exit ' + r.status + '\n' + r.stdout + r.stderr);
      for (const harness of ['.claude', '.codex', '.agents']) {
        const target = installAt(home, harness);
        assert.ok(fs.existsSync(path.join(target, 'SKILL.md')), harness + ': install missing');
        assert.equal(fs.readdirSync(path.join(target, 'docs')).length > 5, true, harness + ': docs did not install');
        const prov = JSON.parse(fs.readFileSync(path.join(target, '.agents-handoff-install.json'), 'utf8'));
        assert.equal(prov.product, 'agents-handoff');
        assert.equal(prov.harness, harness.slice(1), 'the record names the harness it went into');
        assert.match(prov.files_sha256, /^[0-9a-f]{64}$/, 'file-set sha256');
        assert.equal(prov.package.name, 'agents-handoff', 'the record names the npm package');
        assert.equal(prov.package.version, prov.version, 'and the version it was made from');
      }
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  }],

  ['installer: --update with no target flag updates every copy, restoring a tampered file, store untouched', (t) => {
    if (noInstaller(t)) return;
    const home = scratchHome();
    try {
      const a = runInstaller(['--claude', '--agents'], home);
      assert.equal(a.status, 0, 'setup install: ' + a.stdout + a.stderr);
      const claude = installAt(home, '.claude');
      const agents = installAt(home, '.agents');
      // A store in one copy, and a tampered manifest file in the other.
      const store = path.join(claude, 'projects', 'demo', 's1');
      fs.mkdirSync(store, { recursive: true });
      fs.writeFileSync(path.join(store, 'manifest.json'), '{"keep":true}');
      fs.writeFileSync(path.join(agents, 'SKILL.md'), 'tampered\n');

      const u = runInstaller(['--update'], home);
      assert.equal(u.status, 0, 'update exit ' + u.status + '\n' + u.stdout + u.stderr);
      assert.ok(/2 of 2 installation\(s\) updated|already current/.test(u.stdout), 'summary: ' + u.stdout);
      assert.equal(fs.readFileSync(path.join(agents, 'SKILL.md'), 'utf8'),
        fs.readFileSync(path.join(REPO, 'SKILL.md'), 'utf8'), 'the tampered copy was restored');
      assert.equal(fs.readFileSync(path.join(store, 'manifest.json'), 'utf8'), '{"keep":true}',
        'an update must not touch the store');
      for (const target of [claude, agents]) {
        const prov = JSON.parse(fs.readFileSync(path.join(target, '.agents-handoff-install.json'), 'utf8'));
        assert.equal(prov.version, skillVersion(), target + ': record version after update');
      }
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  }],

  ['installer: --verify with no target flag fails on a tampered copy and passes once repaired', (t) => {
    if (noInstaller(t)) return;
    const home = scratchHome();
    try {
      assert.equal(runInstaller(['--claude', '--agents'], home).status, 0, 'setup install');
      const bad = installAt(home, '.claude');
      fs.writeFileSync(path.join(bad, 'SKILL.md'), 'tampered\n');
      const v = runInstaller(['--verify'], home);
      assert.notEqual(v.status, 0, 'verify must fail on a tampered copy: ' + v.stdout);
      assert.ok(/file-set sha256 matches the install record|SKILL\.md/.test(v.stdout + v.stderr), 'reason: ' + v.stdout);
      assert.equal(runInstaller(['--update'], home).status, 0, 'repair');
      const ok = runInstaller(['--verify'], home);
      assert.equal(ok.status, 0, 'verify after repair: ' + ok.stdout + ok.stderr);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  }],

  ['installer: remove keeps the store and the config, and says so', (t) => {
    if (noInstaller(t)) return;
    const home = scratchHome();
    try {
      assert.equal(runInstaller(['--agents'], home).status, 0, 'setup install');
      const target = installAt(home, '.agents');
      for (const dir of ['projects/demo/s1', 'handoffs', '.agent-handoff']) {
        fs.mkdirSync(path.join(target, dir), { recursive: true });
      }
      fs.writeFileSync(path.join(target, 'projects', 'demo', 's1', 'manifest.json'), '{"keep":true}');
      fs.writeFileSync(path.join(target, 'handoff.config.json'), '{"store":"mine"}');

      const r = runInstaller(['--remove', '--force', '--path', target], home);
      assert.equal(r.status, 0, 'remove exit ' + r.status + '\n' + r.stdout + r.stderr);
      assert.ok(!fs.existsSync(path.join(target, 'tools', 'handoff.mjs')), 'the engine is gone');
      assert.ok(!fs.existsSync(path.join(target, 'SKILL.md')), 'SKILL.md is gone');
      assert.equal(fs.readFileSync(path.join(target, 'projects', 'demo', 's1', 'manifest.json'), 'utf8'),
        '{"keep":true}', 'the store survives');
      assert.equal(fs.readFileSync(path.join(target, 'handoff.config.json'), 'utf8'), '{"store":"mine"}',
        'the config survives');
      assert.ok(r.stdout.includes('Kept — not the installer\'s to delete'), 'it reports what it kept: ' + r.stdout);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  }],

  ['installer: verify-package refuses a version npm does not serve, and never claims otherwise', (t) => {
    if (noInstaller(t)) return;
    const home = scratchHome();
    try {
      assert.equal(runInstaller(['--agents'], home).status, 0, 'setup install');
      const target = installAt(home, '.agents');
      // A version that cannot exist: the registry answers 404 (or the network is absent). Both
      // are the same verdict here — the check cannot be satisfied, so it must fail rather than
      // pass by default. What is asserted is the honesty of the answer, not the network.
      const md = fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')
        .replace(/^version:\s*\S+/m, 'version: 0.0.0-not-a-release');
      fs.writeFileSync(path.join(target, 'SKILL.md'), md);
      const r = runInstaller(['--verify-package', '--path', target], home);
      assert.notEqual(r.status, 0, 'an unpublished version must not verify: ' + r.stdout);
      assert.ok(/not on the npm registry|unreachable/.test(r.stdout + r.stderr), 'reason: ' + r.stdout + r.stderr);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  }],

  // `--path X` names ONE installation. It used to fall through to machine-wide discovery, so
  // `verify --path ./my-copy` reported on (and failed because of) every OTHER copy on the
  // machine — an explicit request silently widened into a different question.
  ['installer: verify --path checks exactly that copy, not every copy on the machine', (t) => {
    if (noInstaller(t)) return;
    const home = scratchHome();
    try {
      // A decoy the search SHOULD find and fail, so the assertion below cannot pass vacuously.
      assert.equal(runInstaller(['--agents'], home).status, 0, 'setup: decoy install');
      const decoy = installAt(home, '.agents');
      fs.writeFileSync(path.join(decoy, 'SKILL.md'), 'tampered\n');

      // A clean copy somewhere the search does not look.
      const copy = path.join(home, 'elsewhere', 'agents-handoff');
      assert.equal(runInstaller(['--path', copy], home).status, 0, 'setup: clean copy');

      const scoped = runInstaller(['verify', '--path', copy], home);
      assert.equal(scoped.status, 0, 'verify --path must ignore an unrelated stale copy: ' + scoped.stdout + scoped.stderr);
      assert.ok(!scoped.stdout.includes(decoy), 'the out-of-scope copy is not even reported: ' + scoped.stdout);

      // Discovery still works — this is what makes the assertion above meaningful.
      const bare = runInstaller(['verify'], home);
      assert.notEqual(bare.status, 0, 'a bare verify must still find (and fail) the tampered copy: ' + bare.stdout);
      assert.ok(bare.stdout.includes(decoy), 'the bare verify names the copy it found: ' + bare.stdout);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  }],
]) {
  test(t[0], t[1]);
}

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

// ===========================================================================
// REGRESSION BLOCK — the four verified defects from the 2026-10-09 audit.
// Each of these FAILS against 2.0.4 as published; each passes here.
// ===========================================================================

// Every manifest under a scratch store root. The session directory name is derived from
// the source basename, so tests that build from a differently-named file must not hard-code
// 'minimal-transcript' the way sessionDir() does.
function findManifests(root) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.name === 'manifest.json') out.push(p);
    }
  };
  const proj = path.join(root, 'projects');
  if (fs.existsSync(proj)) walk(proj);
  return out;
}
function timelineOf(manifestPath) {
  return fs.readFileSync(path.join(path.dirname(manifestPath), 'timeline.jsonl'), 'utf8')
    .split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}
// The L4 runtime is a SEPARATE executable that acts on a STORE, not on a transcript.
function runL4(args, root, extraEnv = {}) {
  return spawnSync(process.execPath, [path.join(REPO, 'tools', 'agents-handoff.mjs'), ...args], {
    cwd: REPO,
    env: Object.assign({}, process.env, { HANDOFFS_ROOT: root, AGENT_HANDOFF_STATE_DIR: STATE_DIR }, extraEnv),
    encoding: 'utf8',
  });
}

// Fix A — the parser read only TOP-LEVEL text/content/parts, so a real Claude Code or Codex
// export (which NESTS the text) parsed to zero usable turns, while `--harness claude-code`
// merely labelled the result. These are the shapes the harnesses actually write.
test('A: a real Claude Code transcript (nested message.content[]) parses into turns', () => {
  const root = scratch();
  try {
    const src = path.join(root, 'claude-code-session.jsonl');
    fs.writeFileSync(src, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'Create src/sum.js exporting add(a,b).' }, timestamp: '2026-10-09T10:00:00.000Z' }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'plan the module and its test' }] }, timestamp: '2026-10-09T10:00:01.000Z' }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Added src/sum.js and exported add().' }] }, timestamp: '2026-10-09T10:00:02.000Z' }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'src/sum.js' } }] }, timestamp: '2026-10-09T10:00:03.000Z' }),
    ].join('\n') + '\n');
    const r = run(['build', '--source', src, '--project', 'cc-proj', '--harness', 'claude-code'], root);
    assert.equal(r.status, 0, 'the real Claude Code shape must build: ' + r.stderr);
    const mans = findManifests(root);
    assert.equal(mans.length, 1, 'exactly one session built, got ' + mans.length);
    const tl = timelineOf(mans[0]);
    assert.equal(tl.length, 4, 'all four Claude Code records become turns, got ' + tl.length);
    assert.deepEqual(tl.map((t) => t.class), ['USER', 'THOUGHT', 'AGENT', 'TOOL']);
    assert.ok(tl[0].text.includes('Create src/sum.js'), 'the nested user text is kept');
    assert.ok(tl[3].text.includes('tool_use Write'), 'the nested Claude tool call is preserved');
    assert.ok(fs.readFileSync(path.join(path.dirname(mans[0]), 'TOOLS.md'), 'utf8').includes('tool_use Write'),
      'native nested tool calls must appear in the complete tool-call artifact');
    assert.ok(tl[2].text.includes('Added src/sum.js'), 'the nested text block is kept: ' + tl[2].text);
    assert.ok(tl[3].text.includes('tool_use Write'), 'the nested tool_use call is kept: ' + tl[3].text);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// The Codex CLI rollout wraps every event in `payload`. Reading only the top level loses the
// type AND the role, so a Codex session recorded nothing at all.
test('A: a Codex CLI rollout (payload-nested) parses, and its calls classify as TOOL', () => {
  const root = scratch();
  try {
    const src = path.join(root, 'rollout-codex.jsonl');
    fs.writeFileSync(src, [
      JSON.stringify({ timestamp: '2026-10-09T11:00:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Run the full test suite.' }] } }),
      JSON.stringify({ timestamp: '2026-10-09T11:00:01.000Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":["node","tools/handoff.test.mjs"]}' } }),
      JSON.stringify({ timestamp: '2026-10-09T11:00:02.000Z', type: 'response_item', payload: { type: 'function_call_output', output: 'tests 34 pass 34' } }),
      JSON.stringify({ timestamp: '2026-10-09T11:00:03.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'All 34 tests pass.' }] } }),
    ].join('\n') + '\n');
    const r = run(['build', '--source', src, '--project', 'codex-proj', '--harness', 'codex'], root);
    assert.equal(r.status, 0, 'the Codex rollout shape must build: ' + r.stderr);
    const tl = timelineOf(findManifests(root)[0]);
    assert.equal(tl.length, 4, 'all four Codex records become turns, got ' + tl.length);
    assert.deepEqual(tl.map((t) => t.class), ['USER', 'TOOL', 'TOOL', 'AGENT']);
    assert.ok(tl[1].text.includes('function_call shell'), 'the call and its arguments are kept: ' + tl[1].text);
    assert.ok(tl[2].text.includes('34 pass 34'), 'the call output is kept: ' + tl[2].text);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Fix B — a malformed JSONL line used to be dropped in SILENCE (`return null`), which turns
// corruption into a quietly incomplete handoff. Doctrine #1 is fail-closed on ambiguity.
test('B: unparseable JSONL lines fail closed (exit 5) and name the line; --allow-bad-lines is explicit', () => {
  const root = scratch();
  try {
    const src = path.join(root, 'mixed.jsonl');
    fs.writeFileSync(src, [
      JSON.stringify({ role: 'user', text: 'Do the thing.' }),
      '{"role": "assistant", "text": ',
      JSON.stringify({ role: 'assistant', text: 'Done.' }),
    ].join('\n') + '\n');
    const strict = run(['build', '--source', src, '--project', 'mixed'], root);
    assert.equal(strict.status, 5, 'a mixed file must fail closed, got ' + strict.status + ' ' + strict.stderr);
    assert.ok(/unparseable JSONL line\(s\) at 2 \(invalid JSON\)/.test(strict.stderr), 'the bad LINE is named: ' + strict.stderr);
    const lax = run(['build', '--source', src, '--project', 'mixed', '--allow-bad-lines'], root);
    assert.equal(lax.status, 0, '--allow-bad-lines proceeds: ' + lax.stderr);
    assert.ok(/WARNING — skipped 1 unparseable line/.test(lax.stderr), 'the skip is announced, never silent: ' + lax.stderr);
    assert.equal(timelineOf(findManifests(root)[0]).length, 2, 'the two good turns are the handoff');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Fix D — HANDOFF.md is the gate's INPUT (the gate reads RESULT:/EVIDENCE: out of it), but a
// rebuild regenerated the file and erased the hand-authored contract, destroying the very
// input the next gate run needs.
test('D: a hand-authored evidence contract survives a rebuild and is hashed into the manifest', () => {
  const root = scratch();
  try {
    const src = path.join(root, 'growing.jsonl');
    fs.copyFileSync(FIXTURE, src);
    assert.equal(run(['build', '--source', src, '--project', 'ev-proj'], root).status, 0, 'setup build');
    const manP = findManifests(root)[0];
    const mdP = path.join(path.dirname(manP), 'HANDOFF.md');
    assert.ok(/\(none yet\)/.test(fs.readFileSync(mdP, 'utf8')), 'a fresh handoff still has no contract');
    const contract = [
      'RESULT: PARTIAL',
      'WHAT_CHANGED: src/sum.js added',
      'VALIDATION: node --test tools/handoff.test.mjs',
      'EVIDENCE: dist/sum.js sha256=abc123',
      'BLOCKERS: none',
      'RISKS: none',
      'FOLLOW_UP: wire sum() into the CLI', ''].join('\n');
    fs.appendFileSync(mdP, '\n' + contract);
    // Grow the source so the rebuild is a REAL rewrite, not the up-to-date short circuit.
    fs.appendFileSync(src, JSON.stringify({ seq: 9, ts: '2026-10-09T12:00:00Z', role: 'assistant', text: 'Wired sum() into the CLI.' }) + '\n');
    const b2 = run(['build', '--source', src, '--project', 'ev-proj'], root);
    assert.equal(b2.status, 0, 'rebuild: ' + b2.stderr);
    assert.ok(!b2.stdout.includes('up-to-date'), 'the rebuild must actually rewrite HANDOFF.md: ' + b2.stdout);
    const md2 = fs.readFileSync(mdP, 'utf8');
    for (const field of ['RESULT:', 'WHAT_CHANGED:', 'VALIDATION:', 'EVIDENCE:', 'BLOCKERS:', 'RISKS:', 'FOLLOW_UP:']) {
      assert.ok(md2.includes(field), field + ' was destroyed by the rebuild');
    }
    assert.ok(md2.includes('dist/sum.js sha256=abc123'), 'the evidence VALUE survived verbatim');
    const man = JSON.parse(fs.readFileSync(manP, 'utf8'));
    assert.ok(/^[0-9a-f]{64}$/.test(man.evidence_contract_sha256 || ''), 'the contract is hashed into the manifest: ' + man.evidence_contract_sha256);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Fix C — `promote` called the gate, printed its verdict and threw it away (`void gateRun`),
// so a REJECTED handoff was promoted anyway: the gate was decorative.
test('C: promote refuses a handoff whose evidence gate FAILED; --force is the auditable override', () => {
  const root = scratch();
  try {
    assert.equal(run(['build', '--source', FIXTURE, '--project', 'gate-proj'], root).status, 0, 'setup build');
    const manP = findManifests(root)[0];
    const id = JSON.parse(fs.readFileSync(manP, 'utf8')).session;
    const pre = id.slice(0, 16);

    // (1) no contract at all → the gate FAILS and the EXIT CODE carries that verdict.
    const g1 = runL4(['verify-gate', pre], root);
    assert.equal(g1.status, 6, 'a REJECTED gate must not exit 0: ' + g1.stdout + g1.stderr);
    assert.equal(JSON.parse(g1.stdout).verdict, 'REJECTED', 'verdict: ' + g1.stdout);

    // (2) promote must REFUSE. This is the defect: it used to print REJECTED and promote.
    const p1 = runL4(['promote', pre], root);
    assert.equal(p1.status, 6, 'promote must refuse a failed gate, got ' + p1.status + ' ' + p1.stdout + p1.stderr);
    assert.ok(/promote refused: evidence gate REJECTED/.test(p1.stderr), 'the refusal names the gate: ' + p1.stderr);
    assert.equal(JSON.parse(fs.readFileSync(manP, 'utf8')).promoted_at, undefined, 'a refused promote must not mark the manifest');

    // (3) --force is deliberate and RECORDED as forced, never as verified.
    const p2 = runL4(['promote', pre, '--force'], root);
    assert.equal(p2.status, 0, 'the override proceeds: ' + p2.stdout + p2.stderr);
    assert.equal(JSON.parse(p2.stdout).gate, 'FORCED', 'an override is recorded as FORCED: ' + p2.stdout);

    // (4) the positive control: with a real contract the gate PASSES and promote carries VERIFIED.
    const mdP = path.join(path.dirname(manP), 'HANDOFF.md');
    fs.appendFileSync(mdP, '\n' + [
      'RESULT: PARTIAL',
      'WHAT_CHANGED: src/sum.js added',
      'VALIDATION: node --test tools/handoff.test.mjs',
      'EVIDENCE: dist/sum.js sha256=abc123',
      'BLOCKERS: none',
      'RISKS: none',
      'FOLLOW_UP: wire sum() into the CLI', ''].join('\n'));
    const g2 = runL4(['verify-gate', pre], root);
    assert.equal(g2.status, 0, 'a complete contract must pass the gate: ' + g2.stdout + g2.stderr);
    assert.equal(JSON.parse(g2.stdout).verdict, 'VERIFIED');
    const p3 = runL4(['promote', pre], root);
    assert.equal(p3.status, 0, 'a verified handoff promotes without --force: ' + p3.stdout + p3.stderr);
    assert.equal(JSON.parse(p3.stdout).gate, 'VERIFIED', 'a clean gate records VERIFIED: ' + p3.stdout);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Public CLI surface: the verbs below are documented in docs/CLI.md. Each command is
// exercised as a subprocess against an isolated HANDOFFS_ROOT, never the user's store.
test('CLI: --handoff alias, show, config, rename and retitle remain usable end to end', () => {
  const root = scratch();
  try {
    const b = run(['--handoff', '--source', FIXTURE, '--session', 'cli-surface-session', '--project', 'cli-before'], root);
    assert.equal(b.status, 0, 'alias build: ' + b.stderr);
    const show = run(['show', 'cli-surface-session'], root);
    assert.equal(show.status, 0, 'show: ' + show.stderr);
    assert.ok(show.stdout.includes('# Handoff: cli-surface-session'));
    const config = run(['config'], root);
    assert.equal(config.status, 0, 'config: ' + config.stderr);
    assert.ok(config.stdout.includes('root=' + root));
    const rename = run(['rename', 'cli-surface-session', 'cli-after'], root);
    assert.equal(rename.status, 0, 'rename: ' + rename.stderr);
    assert.equal(run(['verify', 'cli-surface-session'], root).status, 0, 'verify after rename');
    const retitle = run(['retitle', 'cli-surface-session', 'readable-session-title'], root);
    assert.equal(retitle.status, 0, 'retitle: ' + retitle.stderr);
    const listed = run(['list', 'cli-after'], root);
    assert.equal(listed.status, 0, 'list after retitle: ' + listed.stderr);
    assert.ok(listed.stdout.includes('readable-session-title'), listed.stdout);
    const verify = run(['verify', 'readable-session-title'], root);
    assert.equal(verify.status, 0, 'verify after retitle: ' + verify.stdout + verify.stderr);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('parser: plain-text logs preserve multiline tool output without truncation', () => {
  const root = scratch();
  try {
    const src = path.join(root, 'plain-session.txt');
    const longOutput = 'row-output-' + 'x'.repeat(6000);
    fs.writeFileSync(src, 'user: Inspect the synthetic fixture.\nassistant: I will inspect it.\ntool: inspect_fixture --file demo.csv\n' + longOutput + '\nassistant: The fixture was inspected successfully.\n');
    const b = run(['build', '--source', src, '--session', 'plain-session', '--harness', 'generic-text', '--project', 'plain-project'], root);
    assert.equal(b.status, 0, 'plain-text build: ' + b.stdout + b.stderr);
    const dir = path.join(root, 'projects', 'plain-project', 'plain-session');
    const tools = fs.readFileSync(path.join(dir, 'TOOLS.md'), 'utf8');
    const timeline = fs.readFileSync(path.join(dir, 'timeline.jsonl'), 'utf8');
    assert.ok(tools.includes(longOutput), 'complete long tool output retained');
    assert.ok(timeline.includes(longOutput), 'complete long tool output retained in canonical timeline');
    const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    assert.equal(man.counts.TOOL, 1);
    assert.equal(run(['verify', 'plain-session'], root).status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('parser: canonical JSONL from a harness export retains user, assistant and tool events', () => {
  const root = scratch();
  try {
    const src = path.join(root, 'canonical-export.jsonl');
    const rows = [
      { seq: 1, ts: '2026-10-10T10:00:00Z', harness: 'dsh', role: 'user', kind: 'text', text: 'Inspect this synthetic fixture.' },
      { seq: 2, ts: '2026-10-10T10:00:01Z', harness: 'dsh', role: 'assistant', kind: 'text', text: 'I will inspect it.' },
      { seq: 3, ts: '2026-10-10T10:00:02Z', harness: 'dsh', role: 'tool', kind: 'tool_use', text: 'tool_use inspect_fixture {"file":"demo.csv"}' },
      { seq: 4, ts: '2026-10-10T10:00:03Z', harness: 'dsh', role: 'tool', kind: 'tool_result', text: 'rows=12; columns=3' },
      { seq: 5, ts: '2026-10-10T10:00:04Z', harness: 'dsh', role: 'assistant', kind: 'text', text: 'Inspection complete.' }
    ];
    fs.writeFileSync(src, rows.map(JSON.stringify).join('\n') + '\n');
    const b = run(['build', '--source', src, '--session', 'dsh-export-session', '--harness', 'dsh', '--project', 'dsh-project'], root);
    assert.equal(b.status, 0, 'canonical export build: ' + b.stdout + b.stderr);
    const dir = path.join(root, 'projects', 'dsh-project', 'dsh-export-session');
    const timeline = fs.readFileSync(path.join(dir, 'timeline.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
    assert.equal(timeline.length, 5);
    assert.deepEqual(timeline.map(x => x.class), ['USER', 'AGENT', 'TOOL', 'TOOL', 'AGENT']);
    assert.ok(fs.readFileSync(path.join(dir, 'TOOLS.md'), 'utf8').includes('rows=12; columns=3'));
    assert.equal(run(['verify', 'dsh-export-session'], root).status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Level 4/5/6 public verbs: every non-live command is exercised in isolated stores.
// No test enqueues a worker or contacts an external broker.
test('L4: auto captures once, then skips a fresh session without duplicating turns', () => {
  const root = scratch();
  try {
    const src = path.join(root, 'auto-source.jsonl');
    fs.copyFileSync(FIXTURE, src);
    const args = ['auto', '--source', src, '--session', 'auto-session', '--harness', 'generic', '--project', 'auto-project'];
    const first = runL4(args, root);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.equal(JSON.parse(first.stdout).action, 'captured');
    const second = runL4(args, root);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.equal(JSON.parse(second.stdout).action, 'skip-fresh');
    const man = JSON.parse(fs.readFileSync(path.join(root, 'projects', 'auto-project', 'auto-session', 'manifest.json'), 'utf8'));
    assert.equal(man.revisions, 1);
    assert.equal(man.turn_count, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('L4: merge produces a complete verifiable handoff, not only a manifest and timeline', () => {
  const root = scratch();
  try {
    for (const id of ['merge-left', 'merge-right']) {
      const b = run(['build', '--source', FIXTURE, '--session', id, '--project', 'merge-project'], root);
      assert.equal(b.status, 0, b.stdout + b.stderr);
    }
    const m = runL4(['merge', 'merge-left', 'merge-right'], root);
    assert.equal(m.status, 0, m.stdout + m.stderr);
    const result = JSON.parse(m.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(result.action, 'merged');
    const dir = path.join(root, 'projects', 'merge-project', result.into);
    for (const file of ['manifest.json', 'timeline.jsonl', 'HANDOFF.md', 'HANDOFF.summary.json', 'HANDOFF.llm.json', 'TOOLS.md']) {
      assert.ok(fs.existsSync(path.join(dir, file)), 'merge artifact missing: ' + file);
    }
    const verify = run(['verify', result.into], root);
    assert.equal(verify.status, 0, 'merged handoff verify: ' + verify.stdout + verify.stderr);
    const llm = JSON.parse(fs.readFileSync(path.join(dir, 'HANDOFF.llm.json'), 'utf8'));
    assert.equal(llm.timeline.length, result.turns);
    assert.ok(fs.readFileSync(path.join(dir, 'TOOLS.md'), 'utf8').startsWith('# Tool calls:'));
    const idx = JSON.parse(fs.readFileSync(path.join(root, 'INDEX.json'), 'utf8'));
    assert.ok(idx.some(row => row.id === result.into), 'merged session is indexed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('L5: dispatch dry-run requires the full authoritative evidence gate, including manifest integrity', () => {
  const root = scratch();
  try {
    const b = run(['build', '--source', FIXTURE, '--session', 'dispatch-session', '--project', 'dispatch-project'], root);
    assert.equal(b.status, 0, b.stdout + b.stderr);
    const dir = path.join(root, 'projects', 'dispatch-project', 'dispatch-session');
    fs.appendFileSync(path.join(dir, 'HANDOFF.md'), '\n' + [
      'RESULT: PARTIAL', 'WHAT_CHANGED: synthetic fixture inspected', 'VALIDATION: local capture',
      'EVIDENCE: local test fixture', 'BLOCKERS: none', 'RISKS: none', 'FOLLOW_UP: none', ''
    ].join('\n'));
    const good = runL4(['dispatch', 'dispatch-session', '--task', 'Continue from this verified handoff'], root);
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.equal(JSON.parse(good.stdout).status, 'DRY_RUN');
    const mp = path.join(dir, 'manifest.json');
    const man = JSON.parse(fs.readFileSync(mp, 'utf8'));
    man.turn_count = 999;
    fs.writeFileSync(mp, JSON.stringify(man, null, 2));
    const bad = runL4(['dispatch', 'dispatch-session', '--task', 'This must not dispatch'], root);
    assert.equal(bad.status, 1, 'tampered handoff must be rejected: ' + bad.stdout + bad.stderr);
    assert.equal(JSON.parse(bad.stdout).status, 'GATE_REJECTED');
    assert.ok(JSON.parse(bad.stdout).failed.includes('sha'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('L6: federated-merge supports dry-run and imports a verified session with provenance', () => {
  const remoteRoot = scratch();
  const canonicalRoot = scratch();
  try {
    const b = run(['build', '--source', FIXTURE, '--session', 'federated-session', '--project', 'federated-project'], remoteRoot);
    assert.equal(b.status, 0, b.stdout + b.stderr);
    const dry = runL4(['federated-merge', '--from', remoteRoot, '--dry-run'], canonicalRoot);
    assert.equal(dry.status, 0, dry.stdout + dry.stderr);
    assert.equal(JSON.parse(dry.stdout).dry_run, true);
    assert.equal(fs.existsSync(path.join(canonicalRoot, 'projects', 'federated-project', 'federated-session')), false);
    const applied = runL4(['federated-merge', '--from', remoteRoot], canonicalRoot);
    assert.equal(applied.status, 0, applied.stdout + applied.stderr);
    const dir = path.join(canonicalRoot, 'projects', 'federated-project', 'federated-session');
    const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    assert.equal(man.federated_from, remoteRoot);
    assert.ok(man.federated_at);
    assert.equal(run(['verify', 'federated-session'], canonicalRoot).status, 0);
  } finally {
    fs.rmSync(remoteRoot, { recursive: true, force: true });
    fs.rmSync(canonicalRoot, { recursive: true, force: true });
  }
});

test('L4: self-improve and index write to the configured isolated paths', () => {
  const root = scratch();
  try {
    const b = run(['build', '--source', FIXTURE, '--session', 'index-session', '--project', 'index-project'], root);
    assert.equal(b.status, 0, b.stdout + b.stderr);
    const candidatePath = path.join(root, 'self-improve-candidates.json');
    const improve = runL4(['self-improve'], root, { AGENTS_HANDOFF_CANDIDATES_PATH: candidatePath });
    assert.equal(improve.status, 0, improve.stdout + improve.stderr);
    assert.equal(JSON.parse(improve.stdout).scanned, 1);
    const candidates = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
    assert.equal(candidates.scanned, 1);
    const index = runL4(['index'], root);
    assert.equal(index.status, 0, index.stdout + index.stderr);
    assert.equal(JSON.parse(index.stdout).sessions, 1);
    assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'INDEX.json'), 'utf8')).some(row => row.id === 'index-session'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('parser: native Claude tool_result blocks are TOOL events, not user messages', () => {
  const root = scratch();
  try {
    const src = path.join(root, 'claude-tool-result.jsonl');
    const rows = [
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Inspect the synthetic fixture.' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-1', name: 'inspect_fixture', input: { file: 'demo.csv' } }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'rows=12; columns=3' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'The inspection completed.' }] } }
    ];
    fs.writeFileSync(src, rows.map(JSON.stringify).join('\n') + '\n');
    const b = run(['build', '--source', src, '--session', 'claude-tool-result', '--harness', 'claude-code', '--project', 'claude-project'], root);
    assert.equal(b.status, 0, b.stdout + b.stderr);
    const dir = path.join(root, 'projects', 'claude-project', 'claude-tool-result');
    const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const timeline = timelineOf(path.join(dir, 'manifest.json'));
    assert.equal(man.counts.TOOL, 2);
    assert.deepEqual(timeline.map(row => row.class), ['USER', 'TOOL', 'TOOL', 'AGENT']);
    const tools = fs.readFileSync(path.join(dir, 'TOOLS.md'), 'utf8');
    assert.ok(tools.includes('inspect_fixture'));
    assert.ok(tools.includes('rows=12; columns=3'));
    assert.equal(run(['verify', 'claude-tool-result'], root).status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('L4: verify-gate reports failure before evidence is added and passes after a valid contract', () => {
  const root = scratch();
  try {
    const b = run(['build', '--source', FIXTURE, '--session', 'gate-session', '--project', 'gate-project'], root);
    assert.equal(b.status, 0, b.stdout + b.stderr);
    const before = runL4(['verify-gate', 'gate-session'], root);
    assert.equal(before.status, 6);
    assert.equal(JSON.parse(before.stdout).ok, false);
    const dir = path.join(root, 'projects', 'gate-project', 'gate-session');
    fs.appendFileSync(path.join(dir, 'HANDOFF.md'), '\n' + [
      'RESULT: PARTIAL', 'WHAT_CHANGED: verified fixture parsing', 'VALIDATION: CLI capture and verify passed',
      'EVIDENCE: local synthetic fixture and test result', 'BLOCKERS: none', 'RISKS: none', 'FOLLOW_UP: none', ''
    ].join('\n'));
    const after = runL4(['verify-gate', 'gate-session'], root);
    assert.equal(after.status, 0, after.stdout + after.stderr);
    assert.equal(JSON.parse(after.stdout).ok, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('installer: help, where and doctor are read-only and isolated from the real user profile', (t) => {
  if (noInstaller(t)) return;
  const root = scratch();
  try {
    const installer = INSTALLER;
    const fakeHome = path.join(root, 'fake-home');
    const globalRoot = path.join(root, 'global-install');
    fs.mkdirSync(fakeHome, { recursive: true });
    const env = Object.assign({}, process.env, {
      USERPROFILE: fakeHome,
      HOME: fakeHome,
      APPDATA: path.join(fakeHome, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(fakeHome, 'AppData', 'Local'),
      AGENT_HANDOFF_GLOBAL_DIR: globalRoot,
      HANDOFFS_ROOT: path.join(root, 'store')
    });
    const runInstaller = (args) => spawnSync(process.execPath, [installer, ...args], {
      cwd: root, env, encoding: 'utf8', timeout: 10000
    });
    const help = runInstaller(['--help']);
    assert.equal(help.status, 0, help.stdout + help.stderr);
    assert.match(help.stdout, /doctor/);
    assert.match(help.stdout, /where/);
    const where = runInstaller(['where']);
    assert.equal(where.status, 0, where.stdout + where.stderr);
    assert.ok(where.stdout.includes(globalRoot), where.stdout);
    const doctor = runInstaller(['doctor']);
    assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
    assert.match(doctor.stdout, /agents-handoff doctor/i);
    assert.match(doctor.stdout, /Store \(where handoffs are written\)/i);
    assert.equal(fs.existsSync(globalRoot), false, 'read-only diagnostics must not install anything');
    assert.equal(fs.existsSync(path.join(fakeHome, '.claude')), false, 'diagnostics must not touch real or fake harness stores');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('legacy tools/agent-handoff.mjs shim forwards runtime arguments and exit status', () => {
  const root = scratch();
  try {
    const shim = path.join(REPO, 'tools', 'agent-handoff.mjs');
    const env = Object.assign({}, process.env, {
      HANDOFFS_ROOT: root,
      AGENT_HANDOFF_STATE_DIR: path.join(root, 'state')
    });
    const indexed = spawnSync(process.execPath, [shim, 'index'], {
      cwd: REPO, env, encoding: 'utf8', timeout: 15000
    });
    assert.equal(indexed.status, 0, indexed.stdout + indexed.stderr);
    assert.equal(JSON.parse(indexed.stdout).ok, true);
    const invalid = spawnSync(process.execPath, [shim, 'not-a-runtime-command'], {
      cwd: REPO, env, encoding: 'utf8', timeout: 15000
    });
    assert.equal(invalid.status, 2);
    assert.match(invalid.stdout + invalid.stderr, /commands:/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
