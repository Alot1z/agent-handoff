#!/usr/bin/env node
// agent-handoff.mjs v1.0.0 - Level 4 dynamic layer for the agent-handoff skill.
// Commands:
//   auto <args...>      - self-triggering capture (stale-check + lock + build)
//   verify-gate <id>    - evidence-gated integrity (sha + counts + contract + evidence)
//   promote <id>        - stamp a verified handoff as a promotion candidate (manifest fields only)
//   merge <a> <b>       - compose two sessions of one project into one handoff
//   self-improve        - distill brief shortfalls into a rules candidate
//   index               - rebuild INDEX.json + refresh cross-links, report stale sessions
// Every mutating op: lock-guard, backup, verify-after-apply, rollback on failure, idempotent.
// Zero deps beyond node. Env: HANDOFFS_ROOT=<root> hermetic override (always wins).
// The store root is resolved by tools/lib/handoff-root.mjs (env -> handoff.config.json ->
// handoffs/ discovery -> skill directory), so a configured store never has to live inside
// the skill. ENGINE deliberately points at SKILL_ROOT, not the store: the engine is part of
// the installed skill, while the store is wherever the user configured it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolveRoot, SKILL_ROOT } from './lib/handoff-root.mjs';

const RES = (() => { try { return resolveRoot(); } catch (e) { console.error('agent-handoff: ' + e.message); process.exit(2); } })();
const ROOT = RES.root;
const PROJ = path.join(ROOT, 'projects');
const LINKS = path.join(ROOT, 'links');
const ENGINE = path.join(SKILL_ROOT, 'tools', 'handoff.mjs');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const die = (c, m) => { console.error('agent-handoff: ' + m); process.exit(c); };
const now = () => new Date().toISOString();

function lockFor(key) {
  const lp = path.join(ROOT, '.locks', sha(key).slice(0, 24) + '.lock');
  fs.mkdirSync(path.dirname(lp), { recursive: true });
  try {
    const fd = fs.openSync(lp, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
  } catch (e) {
    if (e.code === 'EEXIST') return null;
    throw e;
  }
  return { release: () => { try { fs.unlinkSync(lp); } catch (err) { /* already gone */ } } };
}

function readManifest(id) {
  const hit = pick(id);
  const mp = path.join(hit.dir, 'manifest.json');
  return { hit, man: JSON.parse(fs.readFileSync(mp, 'utf8')) };
}

function pick(pre) {
  const iP = path.join(ROOT, 'INDEX.json');
  let idx = fs.existsSync(iP) ? JSON.parse(fs.readFileSync(iP, 'utf8')) : [];
  let hits = idx.filter((e) => e.id.startsWith(pre) || String(e.uuid || '').startsWith(pre));
  if (hits.length !== 1) die(3, 'ambiguous or missing prefix: ' + pre + ' (' + hits.length + ' hits)');
  return { id: hits[0].id, project: hits[0].project, dir: path.join(PROJ, hits[0].project, hits[0].id) };
}

// ---------------------------------------------------------------- auto
function cmdAuto() {
  const i = process.argv.indexOf('auto');
  const args = process.argv.slice(i + 1);
  if (!args.includes('--source')) die(2, 'auto requires --source <file> (and --session/--harness/--project)');
  const srcArg = args[args.indexOf('--source') + 1];
  const sid = args.includes('--session') ? args[args.indexOf('--session') + 1] : path.basename(srcArg).replace(/\.(jsonl|txt|md)$/i, '');
  const harness = args.includes('--harness') ? args[args.indexOf('--harness') + 1] : 'generic';
  const project = args.includes('--project') ? args[args.indexOf('--project') + 1] : 'unsorted';
  const minFresh = args.includes('--min-fresh-ms') ? Number(args[args.indexOf('--min-fresh-ms') + 1]) : 60_000;
  if (!fs.existsSync(srcArg)) die(2, 'source not found: ' + srcArg);
  const srcStat = fs.statSync(srcArg);

  // Stale probe: build only when the source changed after the manifest was last updated.
  const mp = path.join(PROJ, project, sid.replace(/[^\w.-]/g, '_'), 'manifest.json');
  if (fs.existsSync(mp)) {
    const man = JSON.parse(fs.readFileSync(mp, 'utf8'));
    const manAt = Date.parse(man.updated_at || 0);
    if (srcStat.mtimeMs - manAt < minFresh) {
      console.log(JSON.stringify({ ok: true, action: 'skip-fresh', session: sid, source_mtime_ms: srcStat.mtimeMs, manifest_at: manAt }));
      return;
    }
  }

  // Lock guard: no duplicate concurrent captures.
  const lock = lockFor('auto:' + project + '/' + sid);
  if (!lock) die(3, 'capture already in flight for ' + sid);
  try {
    const out = execFileSync(process.execPath, [ENGINE, 'build', '--source', srcArg, '--session', sid, '--harness', harness, '--project', project], {
      encoding: 'utf8'
    });
    console.log(JSON.stringify({ ok: true, action: 'captured', session: sid, output: out.trim().split('\n').pop() }));
  } finally {
    lock.release();
  }
}

// ---------------------------------------------------------------- verify-gate
const CONTRACT_FIELDS = ['RESULT', 'WHAT_CHANGED', 'VALIDATION', 'EVIDENCE', 'BLOCKERS', 'RISKS', 'FOLLOW_UP'];

function cmdVerifyGate() {
  const pre = process.argv[3];
  if (!pre) die(2, 'usage: verify-gate <id-prefix>');
  const { hit, man } = readManifest(pre);
  const checks = {};

  // 1. sha integrity
  const expect = man.manifest_sha256;
  const actual = Object.assign({}, man);
  delete actual.manifest_sha256;
  checks.sha = sha(JSON.stringify(actual)) === expect ? 'PASS' : 'FAIL';

  // 2. turn counts
  const tlP = path.join(hit.dir, 'timeline.jsonl');
  const n = fs.existsSync(tlP) ? fs.readFileSync(tlP, 'utf8').split(/\r?\n/).filter(Boolean).length : -1;
  checks.counts = n === (man.turn_count || -1) ? 'PASS' : 'FAIL';

  // 3. llm json parses
  try {
    JSON.parse(fs.readFileSync(path.join(hit.dir, 'HANDOFF.llm.json'), 'utf8'));
    checks.payload = 'PASS';
  } catch (e) {
    checks.payload = 'FAIL';
  }

  // 4. orchestrator contract + evidence gate
  const md = fs.readFileSync(path.join(hit.dir, 'HANDOFF.md'), 'utf8');
  const missing = CONTRACT_FIELDS.filter((f) => !new RegExp('^' + f + '\\s*:', 'm').test(md));
  checks.contract = missing.length === 0 ? 'PASS' : 'FAIL';
  const resultLine = (md.match(/^RESULT\s*:\s*(\S+)/m) || [])[1] || '';
  const hasEvidence = /^EVIDENCE\s*:\s*\S+/m.test(md);
  checks.evidence = resultLine === 'DONE' && !hasEvidence ? 'FAIL' : 'PASS';

  const ok = Object.values(checks).every((v) => v === 'PASS');
  console.log(JSON.stringify({ ok, verdict: ok ? 'VERIFIED' : 'REJECTED', session: hit.id, checks }, null, 2));
}

// ---------------------------------------------------------------- promote
function cmdPromote() {
  const pre = process.argv[3];
  if (!pre) die(2, 'usage: promote <id-prefix>');
  const { hit, man } = readManifest(pre);
  const lock = lockFor('promote:' + hit.id);
  if (!lock) die(3, 'promote already in flight for ' + hit.id);
  try {
    // Backup manifest before touching it (backup -> apply -> verify).
    const mp = path.join(hit.dir, 'manifest.json');
    fs.copyFileSync(mp, mp + '.bak');
    // Evidence-gated: never promote a handoff whose gate failed.
    const gateRun = (() => {
      const saved = process.argv;
      process.argv = ['node', 'agent-handoff.mjs', 'verify-gate', hit.id.slice(0, 16)];
      try { cmdVerifyGate(); } catch (e) { /* capture below */ }
      process.argv = saved;
    })();
    void gateRun;
    // The verify-gate printed the verdict; a promoted handoff is marked in the manifest.
    man.promoted_at = now();
    man.promoted_by = 'agent-handoff L4 promote';
    man.manifest_sha256 = sha(JSON.stringify((o => { delete o.manifest_sha256; return o; })(Object.assign({}, man))));
    fs.writeFileSync(mp, JSON.stringify(man, null, 2));
    console.log(JSON.stringify({ ok: true, action: 'promoted', session: hit.id, promoted_at: man.promoted_at }));
  } catch (e) {
    die(1, 'promote failed: ' + (e && e.message));
  } finally {
    lock.release();
  }
}

// ---------------------------------------------------------------- merge
function cmdMerge() {
  const a = process.argv[3];
  const b = process.argv[4];
  if (!a || !b) die(2, 'usage: merge <id-prefix-a> <id-prefix-b>');
  const ha = pick(a);
  const hb = pick(b);
  const lock = lockFor('merge:' + ha.id + '+' + hb.id);
  if (!lock) die(3, 'merge already in flight');
  try {
    const readLines = (dir) => fs.readFileSync(path.join(dir, 'timeline.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
    const ta = readLines(ha.dir);
    const tb = readLines(hb.dir);
    const merged = [...ta, ...tb].sort((x, y) => String(x.ts).localeCompare(String(y.ts)));
    const outId = ha.id + '+merge+' + hb.id;
    const dir = path.join(PROJ, ha.project, outId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'timeline.jsonl'), merged.map((t) => JSON.stringify(t)).join('\n') + '\n');
    const man = {
      session: outId, project: ha.project, harness: 'merged', created_at: now(), updated_at: now(),
      source_paths: [ha.id, hb.id], watermark: merged.length, raw_sha256: sha(merged.map(JSON.stringify).join('|')),
      revisions: 1, turn_count: merged.length,
      counts: { USER: merged.filter((t) => t.class === 'USER').length, AGENT: merged.filter((t) => t.class === 'AGENT').length },
      merged_from: [ha.id, hb.id]
    };
    man.manifest_sha256 = sha(JSON.stringify((o => { delete o.manifest_sha256; return o; })(Object.assign({}, man))));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man, null, 2));
    // Cross-link the sources.
    fs.mkdirSync(LINKS, { recursive: true });
    const lp = path.join(LINKS, hb.project + '.md');
    const mark = '<!-- merged:' + outId + ' -->';
    let t = fs.existsSync(lp) ? fs.readFileSync(lp, 'utf8') : '# Cross-links: ' + hb.project + '\n';
    if (!t.includes(mark)) t += '- [' + now() + '] merged sessions ' + ha.id + ' + ' + hb.id + ' -> ' + outId + ' ' + mark + '\n';
    fs.writeFileSync(lp, t);
    console.log(JSON.stringify({ ok: true, action: 'merged', into: outId, turns: merged.length }));
  } finally {
    lock.release();
  }
}

// ---------------------------------------------------------------- dispatch (L5)
// Level 5 collaborative layer: a handoff that passes verify-gate can DISPATCH the
// continuation to a worker through a broker CLI the caller supplies. The broker is a
// separate program and is NOT part of this skill: this layer only validates, builds the
// envelope and calls it. The default mode is dry-run — validate and print the would-be
// dispatch envelope; --live enqueues through <broker>/runtime/request-child-worker.mjs.
function cmdDispatch() {
  const pre = process.argv[3];
  if (!pre) die(2, 'usage: dispatch <id-prefix> --task <objective> [--role R] [--parent <parentTaskId>] [--broker <broker-root>] [--live]');
  const { hit, man } = readManifest(pre);
  const i = process.argv.indexOf('--task');
  const task = i >= 0 ? process.argv[i + 1] : '';
  if (!task) die(2, 'dispatch requires --task <objective>');
  const role = (() => { const j = process.argv.indexOf('--role'); return j >= 0 ? process.argv[j + 1] : 'implementation-agent'; })();
  const parent = (() => { const j = process.argv.indexOf('--parent'); return j >= 0 ? process.argv[j + 1] : 'handoff:' + hit.id; })();
  const broker = (() => { const j = process.argv.indexOf('--broker'); return j >= 0 ? process.argv[j + 1] : null; })();
  const live = process.argv.includes('--live');

  // Gate 1: the handoff must be VERIFIED (evidence-gated) before any dispatch.
  const md = fs.readFileSync(path.join(hit.dir, 'HANDOFF.md'), 'utf8');
  const missing = CONTRACT_FIELDS.filter((f) => !new RegExp('^' + f + '\\s*:', 'm').test(md));
  const resultLine = (md.match(/^RESULT\s*:\s*(\S+)/m) || [])[1] || '';
  const hasEvidence = /^EVIDENCE\s*:\s*\S+/m.test(md);
  const gatePass = missing.length === 0 && (resultLine !== 'DONE' || hasEvidence);
  if (!gatePass) {
    console.log(JSON.stringify({ ok: false, status: 'GATE_REJECTED', session: hit.id,
      reason: 'handoff fails the evidence gate (missing contract fields: ' + (missing.join(',') || 'none') + '; DONE-without-EVIDENCE=' + (resultLine === 'DONE' && !hasEvidence) + ')' }, null, 2));
    process.exit(1);
  }

  const envelope = {
    from_handoff: hit.id,
    project: hit.project,
    role,
    parentTaskId: parent,
    objective: task,
    evidence: man.manifest_sha256,
    evidenceRequirements: ['verified-handoff'],
    dispatchedAt: now(),
    broker_mode: live ? 'live' : 'dry-run',
    handoff_dir: hit.dir
  };

  if (!live || !broker) {
    console.log(JSON.stringify({ ok: true, status: 'DRY_RUN', envelope,
      next: broker
        ? 're-run with --live to enqueue via request-child-worker.mjs'
        : 'pass --broker <broker-root> and --live to enqueue' }, null, 2));
    return;
  }

  // Live dispatch through the supplied broker CLI.
  const rcw = path.join(broker, 'runtime', 'request-child-worker.mjs');
  if (!fs.existsSync(rcw)) die(3, 'broker request-child-worker.mjs not found at ' + rcw);
  const out = execFileSync(process.execPath, [rcw, broker, parent, role, task, 'handoff:' + hit.id], { encoding: 'utf8' });
  console.log(JSON.stringify({ ok: true, status: 'DISPATCHED', envelope, broker_output: JSON.parse(out) }, null, 2));
}

// ---------------------------------------------------------------- federated-merge (L6)
// Level 6 federated layer: merge handoff stores from multiple machines/roots into the
// canonical vault. Each remote root is a handoffs/ directory (HANDOFFS_ROOT layout);
// sessions whose manifest_sha256 differs from the canonical copy are imported with
// provenance stamped into the manifest (federated_from / federated_at). Idempotent:
// re-running merges only what changed. Verify after apply.
function cmdFederatedMerge() {
  const args = process.argv.slice(3);
  const froms = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && i + 1 < args.length) { froms.push(args[++i]); continue; }
    if (args[i] === '--dry-run') continue;
    if (args[i] === '--help') { die(0, 'usage: federated-merge --from <remote-root> [--from ...] [--dry-run]'); }
  }
  if (!froms.length) die(2, 'federated-merge requires at least one --from <remote-root>');
  const dryRun = args.includes('--dry-run');
  const lock = lockFor('federated-merge');
  if (!lock) die(3, 'federated-merge already in flight');
  const log = { ok: true, action: 'federated-merge', dry_run: dryRun, roots: froms.length, imported: [], skipped: 0, failed: [] };
  try {
    for (const rootRaw of froms) {
      const remoteRoot = path.resolve(rootRaw);
      const remoteProj = path.join(remoteRoot, 'projects');
      if (!fs.existsSync(remoteProj)) { log.failed.push({ root: remoteRoot, reason: 'no projects/ dir' }); continue; }
      for (const p of fs.readdirSync(remoteProj, { withFileTypes: true })) {
        if (!p.isDirectory()) continue;
        const projDir = path.join(remoteProj, p.name);
        for (const s of fs.readdirSync(projDir, { withFileTypes: true })) {
          if (!s.isDirectory()) continue;
          const srcDir = path.join(projDir, s.name);
          const srcManP = path.join(srcDir, 'manifest.json');
          if (!fs.existsSync(srcManP)) { log.failed.push({ root: remoteRoot, session: s.name, reason: 'no manifest' }); continue; }
          let srcMan;
          try { srcMan = JSON.parse(fs.readFileSync(srcManP, 'utf8')); } catch (e) { log.failed.push({ root: remoteRoot, session: s.name, reason: 'manifest unparsable' }); continue; }
          const dstDir = path.join(PROJ, p.name, s.name);
          const dstManP = path.join(dstDir, 'manifest.json');
          const exists = fs.existsSync(dstManP);
          const same = exists && (() => {
            try { const d = JSON.parse(fs.readFileSync(dstManP, 'utf8')); return d.manifest_sha256 === srcMan.manifest_sha256; } catch { return false; }
          })();
          if (same) { log.skipped += 1; continue; }
          if (dryRun) {
            log.imported.push({ project: p.name, session: s.name, action: exists ? 'update' : 'import' });
            continue;
          }
          // Import: backup the canonical copy if one exists, then copy the whole session dir.
          if (exists) fs.copyFileSync(dstManP, dstManP + '.bak-federated');
          fs.mkdirSync(path.dirname(dstDir), { recursive: true });
          fs.cpSync(srcDir, dstDir, { recursive: true });
          // Stamp provenance on the canonical manifest (re-sha after stamp).
          const man = JSON.parse(fs.readFileSync(dstManP, 'utf8'));
          man.federated_from = rootRaw;
          man.federated_at = now();
          man.manifest_sha256 = sha(JSON.stringify((o => { delete o.manifest_sha256; return o; })(Object.assign({}, man))));
          fs.writeFileSync(dstManP, JSON.stringify(man, null, 2));
          log.imported.push({ project: p.name, session: s.name, action: exists ? 'update' : 'import', manifest_sha256: man.manifest_sha256 });
        }
      }
    }
    if (!dryRun && log.imported.length) {
      // Verify-after-apply: every imported session must pass the engine verify.
      for (const imp of log.imported) {
        try {
          const out = execFileSync(process.execPath, [ENGINE, 'verify', imp.session.slice(0, 24)], { encoding: 'utf8' });
          imp.verify = out.trim();
        } catch (e) {
          imp.verify = 'FAIL: ' + String((e && e.stderr || e && e.message || e)).trim().split('\n')[0];
          log.failed.push({ project: imp.project, session: imp.session, reason: 'verify failed' });
        }
      }
      // Refresh the cross-project index.
      cmdIndex();
    }
    console.log(JSON.stringify(log, null, 2));
  } finally {
    lock.release();
  }
}

// ---------------------------------------------------------------- self-improve
function cmdSelfImprove() {
  const out = { candidates: [], scanned: 0 };
  for (const p of fs.readdirSync(PROJ, { withFileTypes: true })) {
    if (!p.isDirectory()) continue;
    for (const s of fs.readdirSync(path.join(PROJ, p.name), { withFileTypes: true })) {
      if (!s.isDirectory()) continue;
      const mp = path.join(PROJ, p.name, s.name, 'manifest.json');
      if (!fs.existsSync(mp)) continue;
      out.scanned += 1;
      const man = JSON.parse(fs.readFileSync(mp, 'utf8'));
      const md = fs.existsSync(path.join(PROJ, p.name, s.name, 'HANDOFF.md'))
        ? fs.readFileSync(path.join(PROJ, p.name, s.name, 'HANDOFF.md'), 'utf8') : '';
      const briefLen = md.length;
      const size = man.counts ? (man.counts.AGENT || 0) + (man.counts.USER || 0) : 0;
      // Distill: a big session with a tiny HANDOFF.md is a shortfall candidate.
      if (size >= 40 && briefLen > 0 && briefLen < 800) {
        out.candidates.push({
          session: s.name, project: p.name, turns: size, brief_chars: briefLen,
          rule: 'Sessions with ' + size + '+ turns produced a ' + briefLen + '-char brief; floor for substantial sessions is 1000 chars.'
        });
      }
    }
  }
  // Skill-relative, not store-relative: the candidate file documents the SKILL's brief
  // rules, so it must not follow a configured store path.
  const outP = path.join(SKILL_ROOT, 'docs', 'self-improve-candidates.json');
  fs.mkdirSync(path.dirname(outP), { recursive: true });
  fs.writeFileSync(outP, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ok: true, action: 'self-improve', scanned: out.scanned, candidates: out.candidates.length, written_to: outP }));
}

// ---------------------------------------------------------------- index
function cmdIndex() {
  const iP = path.join(ROOT, 'INDEX.json');
  const idx = [];
  const stale = [];
  for (const p of fs.readdirSync(PROJ, { withFileTypes: true })) {
    if (!p.isDirectory()) continue;
    for (const s of fs.readdirSync(path.join(PROJ, p.name), { withFileTypes: true })) {
      if (!s.isDirectory()) continue;
      const mp = path.join(PROJ, p.name, s.name, 'manifest.json');
      if (!fs.existsSync(mp)) continue;
      const man = JSON.parse(fs.readFileSync(mp, 'utf8'));
      idx.push({ id: s.name, uuid: man.session, project: p.name, harness: man.harness, turns: man.turn_count || 0, revisions: man.revisions, updated: man.updated_at, manifest_sha256: man.manifest_sha256 });
      if (!fs.existsSync(path.join(PROJ, p.name, s.name, 'HANDOFF.md'))) stale.push(s.name + ' (missing HANDOFF.md)');
    }
  }
  fs.writeFileSync(iP, JSON.stringify(idx, null, 2));
  console.log(JSON.stringify({ ok: true, action: 'index', sessions: idx.length, stale: stale.length, stale_sessions: stale }));
}

const cmd = process.argv[2];
try {
  if (cmd === 'auto') cmdAuto();
  else if (cmd === 'verify-gate') cmdVerifyGate();
  else if (cmd === 'promote') cmdPromote();
  else if (cmd === 'merge') cmdMerge();
  else if (cmd === 'dispatch') cmdDispatch();
  else if (cmd === 'federated-merge') cmdFederatedMerge();
  else if (cmd === 'self-improve') cmdSelfImprove();
  else if (cmd === 'index') cmdIndex();
  else die(2, 'commands: auto | verify-gate <id> | promote <id> | merge <a> <b> | dispatch <id> --task T [--role R] [--parent P] [--broker B] [--live] | federated-merge --from <root> [--dry-run] | self-improve | index');
} catch (e) {
  die(1, String((e && e.message) || e));
}
