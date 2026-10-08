#!/usr/bin/env node
// capability-registry.mjs v1.0.0 — runtime MVP Task 4: capability registry.
// Zero-dep (node:* only), filesystem-backed, exercises capabilities through real
// health probes. HONESTY CONTRACT: every verdict is healthy / unhealthy / unknown
// with observed evidence — never a guessed verdict. An unknown probe kind, a probe
// error, or an unreadable target is reported, not interpreted away.
//
// Commands:
//   node tools/capability-registry.mjs check [--registry F] [--json] [id]
//   node tools/capability-registry.mjs list [--registry F] [--json]
// Exit codes: 0 all required capabilities healthy; 1 any required capability not
// healthy (unhealthy OR unknown — unknown is never accepted as healthy);
// 2 registry file missing/corrupt/invalid; 4 unknown capability id or usage error.
// State: writes <AGENT_HANDOFF_STATE_DIR>/capability-state.json after every check
// (default .agent-handoff/capability-state.json when the env override is absent).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DEFAULT_REGISTRY = path.join(REPO, 'capability-registry.json');
// State root: overridable so oracles run hermetically and the repo accumulates
// nothing. Env: AGENT_HANDOFF_STATE_DIR=<dir>
const STATE_DIR = process.env.AGENT_HANDOFF_STATE_DIR
  ? path.resolve(process.env.AGENT_HANDOFF_STATE_DIR)
  : path.join(REPO, '.agent-handoff');
const STATE_PATH = path.join(STATE_DIR, 'capability-state.json');

const argOf = (n, f) => { const i = process.argv.indexOf(n); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : (f ? f() : null); };
const hasFlag = n => process.argv.includes(n);
const die = (c, m) => { if (hasFlag('--json')) console.log(JSON.stringify({ error: m })); else console.error('capability-registry: ' + m); process.exit(c); };
const rel = p => path.isAbsolute(p) ? p : path.join(REPO, p);

function loadRegistry(p) {
  if (!fs.existsSync(p)) die(2, 'registry not found: ' + p);
  let reg;
  try { reg = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { die(2, 'registry is not valid JSON: ' + p + ' (' + e.message + ')'); }
  if (!reg || !Array.isArray(reg.capabilities)) die(2, 'registry has no capabilities array: ' + p);
  return reg;
}

// Each probe returns { verdict, evidence } — verdict is exactly one of
// healthy | unhealthy | unknown. Probes OBSERVE; they never assume.
function runProbe(cap) {
  const id = cap.id || '(no id)';
  const kind = String(cap.kind || '');
  const target = cap.target ? rel(cap.target) : null;
  try {
    if (kind === 'file-exists') {
      if (!target) return { id, verdict: 'unknown', evidence: 'file-exists capability has no target declared' };
      const ok = fs.existsSync(target) && fs.statSync(target).isFile();
      return { id, verdict: ok ? 'healthy' : 'unhealthy', evidence: (ok ? 'file present: ' : 'file missing: ') + target };
    }
    if (kind === 'dir-writable') {
      if (!target) return { id, verdict: 'unknown', evidence: 'dir-writable capability has no target declared' };
      fs.mkdirSync(target, { recursive: true });
      const probe = path.join(target, '.write-probe-' + process.pid + '-' + Date.now());
      fs.writeFileSync(probe, 'probe');
      const wrote = fs.existsSync(probe) && fs.readFileSync(probe, 'utf8') === 'probe';
      fs.unlinkSync(probe);
      return { id, verdict: wrote ? 'healthy' : 'unhealthy', evidence: (wrote ? 'wrote+read+deleted probe in ' : 'write probe failed in ') + target };
    }
    if (kind === 'command') {
      if (!cap.command) return { id, verdict: 'unknown', evidence: 'command capability has no command declared' };
      const cmd = cap.command === '<node>' ? process.execPath : cap.command;
      const r = spawnSync(cmd, cap.args || [], { cwd: REPO, encoding: 'utf8', timeout: 15000 });
      if (r.error) return { id, verdict: 'unhealthy', evidence: 'spawn error: ' + String(r.error) };
      if (r.status === 0) return { id, verdict: 'healthy', evidence: 'command exited 0: ' + cap.command };
      return { id, verdict: 'unhealthy', evidence: 'command exited ' + r.status + ': ' + String(r.stderr || r.stdout || '').slice(0, 200) };
    }
    return { id, verdict: 'unknown', evidence: 'no probe implemented for kind "' + kind + '" (no guessed verdicts)' };
  } catch (e) {
    return { id, verdict: 'unhealthy', evidence: 'probe error: ' + String(e && e.message || e) };
  }
}

function check() {
  const regPath = rel(argOf('--registry', () => DEFAULT_REGISTRY));
  const reg = loadRegistry(regPath);
  const only = process.argv.find((a, i) => i > 2 && !a.startsWith('-') && a !== regPath && process.argv[i - 1] !== '--registry');
  const caps = only ? reg.capabilities.filter(c => c.id === only) : reg.capabilities;
  if (only && !caps.length) die(4, 'unknown capability id: ' + only);
  const results = caps.map(c => { const r = runProbe(c); return Object.assign(r, { required: c.required !== false, kind: c.kind }); });
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify({ schema_version: '1.0-capability-state', generated_at: new Date().toISOString(), registry: path.relative(REPO, regPath), results }, null, 2) + '\n');
  } catch (e) { die(1, 'could not persist capability state: ' + e.message); }
  const ok = results.filter(r => r.required).every(r => r.verdict === 'healthy');
  if (hasFlag('--json')) {
    console.log(JSON.stringify({ ok, results, state: path.relative(REPO, STATE_PATH) }, null, 2));
  } else {
    console.log('capability-registry: ' + (ok ? 'OK' : 'FAIL') + ' registry=' + path.relative(REPO, regPath));
    for (const r of results) console.log('  [' + r.verdict + '] ' + r.id + (r.required ? '' : ' (optional)') + ' — ' + r.evidence);
  }
  process.exit(ok ? 0 : 1);
}

function list() {
  const regPath = rel(argOf('--registry', () => DEFAULT_REGISTRY));
  const reg = loadRegistry(regPath);
  let state = null;
  if (fs.existsSync(STATE_PATH)) { try { state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { state = null; } }
  if (hasFlag('--json')) {
    console.log(JSON.stringify({ registry: path.relative(REPO, regPath), capabilities: reg.capabilities, last_state: state }, null, 2));
  } else {
    console.log('capability-registry: ' + reg.capabilities.length + ' declared (' + path.relative(REPO, regPath) + ')');
    for (const c of reg.capabilities) {
      const last = state && Array.isArray(state.results) ? state.results.find(r => r.id === c.id) : null;
      console.log('  ' + c.id + ' kind=' + c.kind + (c.required === false ? ' (optional)' : ' (required)') + (last ? ' last=' + last.verdict + ' at ' + state.generated_at : ' last=NEVER-CHECKED'));
    }
  }
  process.exit(0);
}

const cmd = process.argv[2];
if (cmd === 'check') check();
else if (cmd === 'list') list();
else die(2, 'usage: capability-registry.mjs check [--registry F] [--json] [id] | list [--registry F] [--json]');
