#!/usr/bin/env node
// .github/scripts/build-sessions-index.mjs — render the session index page from a handoff store.
//
// The sessions page is a VIEW of a real store, not prose about one. This script reads the
// store's INDEX.json (or the per-session manifests when the index is absent), re-runs the
// three checks `handoff.mjs verify` runs on every session, and writes docs/SESSIONS.md.
//
//   node .github/scripts/build-sessions-index.mjs                     # write the page
//   node .github/scripts/build-sessions-index.mjs --check             # 0 = current, 1 = stale
//   --store <dir>   store to read      (default: examples/sessions)
//   --out <file>    page to write      (default: docs/SESSIONS.md)
//
// Run from anywhere. Exit codes: 0 the page matches the store and every session verified;
// 1 the page is stale, or at least one session failed its checks; 2 the layout is not what
// this script reads (no store directory) — reported as its own failure, never as a pass.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..', '..');
const BLOB = 'https://github.com/Alot1z/agent-handoff/tree/main/';

const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
};
const STORE = path.resolve(ROOT, argOf('--store', 'examples/sessions'));
const OUT = path.resolve(ROOT, argOf('--out', 'docs/SESSIONS.md'));
const CHECK = process.argv.includes('--check');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

if (!fs.existsSync(STORE)) {
  console.error('build-sessions-index: no store at ' + STORE + ' (the page is generated FROM a store)');
  process.exit(2);
}

// --- the sessions the store declares, or the ones its manifests describe ------------------
// INDEX.json is what `handoff.mjs list` reads, so the page and the CLI agree by construction.
// A store without one is still readable: every session folder carries its own manifest.
const indexPath = path.join(STORE, 'INDEX.json');
let declared = [];
let indexSource = 'INDEX.json';
if (fs.existsSync(indexPath)) {
  try {
    declared = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch (e) {
    console.error('build-sessions-index: INDEX.json does not parse: ' + e.message);
    process.exit(1);
  }
} else {
  indexSource = 'per-session manifests';
  const projectsDir = path.join(STORE, 'projects');
  if (!fs.existsSync(projectsDir)) {
    console.error('build-sessions-index: store has neither INDEX.json nor projects/ — nothing to list');
    process.exit(2);
  }
  for (const project of fs.readdirSync(projectsDir)) {
    const pd = path.join(projectsDir, project);
    if (!fs.statSync(pd).isDirectory()) continue;
    for (const session of fs.readdirSync(pd)) {
      const mp = path.join(pd, session, 'manifest.json');
      if (fs.existsSync(mp)) declared.push(JSON.parse(fs.readFileSync(mp, 'utf8')));
    }
  }
}

if (!declared.length) {
  console.error('build-sessions-index: the store declares no sessions — the page would be empty');
  process.exit(1);
}

// --- verify each session exactly as `handoff.mjs verify` does -----------------------------
// Three independent facts, the same three the CLI checks: the manifest's own sha256 still
// matches its content, the timeline still holds the number of turns the manifest claims, and
// the machine payload still parses. A page that lists a session has to be able to say this.
function verifySession(entry) {
  const dir = path.join(STORE, 'projects', entry.project, entry.id);
  const mp = path.join(dir, 'manifest.json');
  if (!fs.existsSync(mp)) return { ok: false, why: 'manifest.json is missing' };
  let man;
  try {
    man = JSON.parse(fs.readFileSync(mp, 'utf8'));
  } catch (e) {
    return { ok: false, why: 'manifest.json does not parse' };
  }
  const actual = { ...man };
  const expect = actual.manifest_sha256;
  delete actual.manifest_sha256;
  if (!expect || sha(JSON.stringify(actual)) !== expect) return { ok: false, why: 'manifest sha256 mismatch' };
  const tlp = path.join(dir, 'timeline.jsonl');
  if (!fs.existsSync(tlp)) return { ok: false, why: 'timeline.jsonl is missing' };
  const turns = fs.readFileSync(tlp, 'utf8').split(/\r?\n/).filter(Boolean).length;
  if (turns !== (man.turn_count ?? -1)) {
    return { ok: false, why: 'timeline has ' + turns + ' turns, manifest claims ' + man.turn_count };
  }
  try {
    JSON.parse(fs.readFileSync(path.join(dir, 'HANDOFF.llm.json'), 'utf8'));
  } catch {
    return { ok: false, why: 'HANDOFF.llm.json does not parse' };
  }
  return { ok: true, man, turns, dir };
}

const rows = declared.map((entry) => {
  const id = entry.id || entry.session;
  const project = entry.project;
  const result = verifySession({ project, id });
  const man = result.man || {};
  return {
    id,
    project,
    harness: entry.harness || man.harness || '(unrecorded)',
    model: man.model || entry.model || '',
    turns: result.turns ?? entry.turns,
    revisions: entry.revisions ?? man.revisions ?? 1,
    updated: entry.updated || man.updated_at || '',
    manifest_sha256: entry.manifest_sha256 || man.manifest_sha256 || '',
    status: result.ok ? 'PASS' : 'FAIL',
    why: result.ok ? '' : result.why,
  };
}).sort((a, b) => (a.project + '/' + a.id).localeCompare(b.project + '/' + b.id));

const failed = rows.filter((r) => r.status === 'FAIL');
const projects = [...new Set(rows.map((r) => r.project))].sort();

// --- render --------------------------------------------------------------------------------
const lines = [];
lines.push('---');
lines.push('title: Session index');
lines.push('---');
lines.push('');
lines.push('# Session index');
lines.push('');
lines.push('A handoff store is a directory of captured sessions. This page is generated from the');
lines.push('sample store in [`examples/sessions/`](' + BLOB + 'examples/sessions), whose sessions the');
lines.push('engine built from the two transcripts this repository ships. Nothing here is written by hand:');
lines.push('the table below is a rendering of that store, re-checked on every build.');
lines.push('');
lines.push('| Project | Session | Harness | Turns | Revision | Manifest sha256 | Integrity |');
lines.push('|---|---|---|---:|---:|---|---|');
for (const r of rows) {
  lines.push('| ' + r.project + ' | `' + r.id + '` | ' + r.harness + ' | ' + r.turns + ' | ' +
    r.revisions + ' | `' + String(r.manifest_sha256).slice(0, 12) + '…` | ' + r.status + ' |');
}
lines.push('');
lines.push('**' + rows.length + ' session(s) across ' + projects.length + ' project(s): ' +
  (failed.length ? failed.length + ' FAILED' : 'all verified') + '.**');
lines.push('');
lines.push('## What each column proves');
lines.push('');
lines.push('| Column | Where it comes from |');
lines.push('|---|---|');
lines.push('| Project, Session | The store layout: `projects/<project>/<session>/` |');
lines.push('| Harness | `harness` in the session manifest — what produced the transcript |');
lines.push('| Turns | Lines in `timeline.jsonl`, checked against `turn_count` in the manifest |');
lines.push('| Revision | `revisions` in the manifest. A rebuild that appends turns raises it; it never forks a session |');
lines.push('| Manifest sha256 | `manifest_sha256`, the hash of the manifest with that field removed |');
lines.push('| Integrity | `PASS` when the manifest hash matches, the turn count matches and `HANDOFF.llm.json` parses |');
lines.push('');
lines.push('## Verify a session yourself');
lines.push('');
lines.push('Point the engine at the sample store and ask it the same question this page answers:');
lines.push('');
lines.push('```bash');
lines.push('# the store this page is rendered from');
lines.push('HANDOFFS_ROOT=examples/sessions node tools/handoff.mjs list');
for (const r of rows) {
  lines.push('HANDOFFS_ROOT=examples/sessions node tools/handoff.mjs verify ' + r.id);
}
lines.push('');
lines.push('# your own store');
lines.push('HANDOFFS_ROOT=/path/to/your/store node tools/handoff.mjs list');
lines.push('```');
lines.push('');
lines.push('`verify` exits non-zero the moment one of the three checks fails, so it works as a gate:');
lines.push('');
lines.push('```bash');
lines.push('HANDOFFS_ROOT=examples/sessions node tools/handoff.mjs verify ' + rows[0].id + ' || echo "do not resume this session"');
lines.push('```');
lines.push('');
lines.push('## Generate this page from your own store');
lines.push('');
lines.push('The generator is part of this repository, and it reads any store in the format above:');
lines.push('');
lines.push('```bash');
lines.push('node .github/scripts/build-sessions-index.mjs --store examples/sessions --out docs/SESSIONS.md');
lines.push('node .github/scripts/build-sessions-index.mjs --check    # exit 1 when the page is stale');
lines.push('```');
lines.push('');
lines.push('`--check` is wired into CI, so a store that changes without the page changing fails the build');
lines.push('instead of publishing a table that no longer matches what the engine can read.');
lines.push('');
lines.push('## Next');
lines.push('');
lines.push('- The file-by-file contract for a session folder is in [FORMAT.md](FORMAT.md).');
lines.push('- The commands that read and write a store are in [CLI.md](CLI.md).');
lines.push('- What the hashes prove, and what they cannot, is in [PROVENANCE.md](PROVENANCE.md).');
lines.push('');
const page = lines.join('\n');

const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;

if (CHECK) {
  const stale = existing !== page;
  if (stale || failed.length) {
    if (stale) console.error('build-sessions-index: ' + path.relative(ROOT, OUT) + ' is stale (store: ' + indexSource + ')');
    for (const f of failed) console.error('  FAIL ' + f.project + '/' + f.id + ': ' + f.why);
    console.error('  run: node .github/scripts/build-sessions-index.mjs');
    process.exit(1);
  }
  console.log('build-sessions-index: OK — ' + rows.length + ' session(s) across ' + projects.length +
    ' project(s), all verified; ' + path.relative(ROOT, OUT) + ' matches the store');
  process.exit(0);
}

if (failed.length) {
  console.error('build-sessions-index: ' + failed.length + ' session(s) failed verification — the page was not written');
  for (const f of failed) console.error('  FAIL ' + f.project + '/' + f.id + ': ' + f.why);
  process.exit(1);
}

if (existing === page) {
  console.log('build-sessions-index: ' + path.relative(ROOT, OUT) + ' already current (' + rows.length + ' session(s))');
  process.exit(0);
}
fs.writeFileSync(OUT, page);
console.log('build-sessions-index: wrote ' + path.relative(ROOT, OUT) + ' — ' + rows.length +
  ' session(s) across ' + projects.length + ' project(s) from ' + indexSource + '; all verified');
