#!/usr/bin/env node
// handoff.mjs v4.0.0 - cross-harness session handoff builder with project grouping
// Layout: <ROOT>/projects/<project>/<session>/{HANDOFF.md,HANDOFF.summary.json,HANDOFF.llm.json,
//         timeline.jsonl,manifest.json,TOOLS.md} + <ROOT>/projects/<project>/PROJECT.md
//         <ROOT>/links/<other-project>.md (cross-project relation notes)
// Commands:
//   build --source F [--session id] [--harness n] [--model m] [--project name] [--objective text]
//   --handoff --source F        (alias of build)
//   list [project-or-prefix] | show <id-prefix> | verify <id-prefix> | rename <id-prefix> <new-project>
//   config                              - report the resolved handoff root, and why
// Env: HANDOFFS_ROOT=<root> hermetic override (always wins). Otherwise the root comes
// from handoff.config.json (see handoff.config.schema.json) discovered by walking up
// from the current directory, or from a handoffs/ directory found the same way; with
// neither, the skill directory is the store. One implementation: tools/lib/handoff-root.mjs.
// Zero deps. Malformed input -> clean nonzero exit.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveRoot, configProjectName, linkingEnabled } from './lib/handoff-root.mjs';
// A present-but-invalid config is fatal (exit 2) rather than silently ignored: falling back
// would send the session to a different store than the one that was configured.
const RES = (() => { try { return resolveRoot(); } catch (e) { console.error('handoff: ' + e.message); process.exit(2); } })();
const ROOT = RES.root;
const PROJ = path.join(ROOT, 'projects');
const LINKS = path.join(ROOT, 'links');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const die = (c, m) => { console.error('handoff: ' + m); process.exit(c); };
const argOf = (n, f) => { const i = process.argv.indexOf(n); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : (f ? f() : null); };
const hasFlag = n => process.argv.includes(n);
const fence = String.fromCharCode(96).repeat(3);

// The `type` of each nested content block, if the record has a content array at all. The
// documented rule is "kind containing reason/think becomes THOUGHT", and in a real export the
// kind lives on the BLOCK, not on the record.
function blockTypes(r) {
  const pl = (r && r.payload) || {};
  const arr = [r && r.content, r && r.parts, r && r.message && r.message.content,
    pl.content, r && r.item && r.item.content].find(Array.isArray);
  return (arr || []).map((p) => String((p && p.type) || '').toLowerCase()).filter(Boolean);
}

function classify(r) {
  // `payload` is the Codex CLI rollout wrapper: the event type and the role live one level
  // down, so reading only the top level mislabels (or drops) every Codex turn.
  const pl = (r && r.payload) || {};
  const mrole = String((r.message && r.message.role) || pl.role || '');
  const k = String(r.kind || r.type || '').toLowerCase();
  const kp = String(pl.kind || pl.type || '').toLowerCase();
  const role = String(r.role || mrole || '').toLowerCase();
  const ks = k + ' ' + kp;
  if (ks.includes('tool') || role === 'tool' || ks.includes('function_call')) return 'TOOL';
  if (ks.includes('reason') || ks.includes('think')) return 'THOUGHT';
  // A record whose every typed block is reasoning is a THOUGHT turn. A record that MIXES
  // reasoning with text/tool blocks is not — it keeps its AGENT class and keeps the text.
  const bt = blockTypes(r);
  if (bt.length && bt.every((t) => t.includes('think') || t.includes('reason'))) return 'THOUGHT';
  if (role === 'user' || k === 'human' || k === 'user') return 'USER';
  if (role === 'assistant' || k === 'ai' || k === 'assistant') return 'AGENT';
  return 'OTHER';
}
// One element of a nested content array: an Anthropic block, an OpenAI part, a Codex item.
function partText(p) {
  if (typeof p === 'string') return p;
  if (!p || typeof p !== 'object') return '';
  if (typeof p.text === 'string') return p.text;
  if (typeof p.thinking === 'string') return p.thinking;
  if (typeof p.content === 'string') return p.content;
  if (Array.isArray(p.content)) return p.content.map(partText).filter(Boolean).join('\n');
  if (p.type === 'tool_use') return 'tool_use ' + (p.name || '') + ' ' + JSON.stringify(p.input === undefined ? {} : p.input);
  if (p.type === 'tool_result') return 'tool_result ' + (typeof p.content === 'string' ? p.content : JSON.stringify(p.content === undefined ? {} : p.content));
  if (p.type === 'function_call') return 'function_call ' + (p.name || '') + ' ' + String(p.arguments || '');
  if (p.type === 'function_call_output') return 'function_call_output ' + String(p.output || '');
  return '';
}
// Real harness exports NEST the text: Claude Code keeps it under message.content[],
// Codex/OpenAI under content[] or output[]. Reading only top-level fields is exactly
// why --harness was a label instead of a parser; every shipped shape is read here.
function textOf(r) {
  if (!r || typeof r !== 'object') return '';
  const pl = r.payload || {};
  if (typeof r.text === 'string' && r.text.trim()) return r.text;
  for (const v of [r.content, r.output, r.message && r.message.content, r.message && r.message.text,
    pl.content, pl.output, pl.text, pl.message && pl.message.content]) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  for (const v of [r.parts, r.content, r.output, r.message && r.message.content, r.item && r.item.content,
    pl.parts, pl.content, pl.output, pl.items]) {
    if (Array.isArray(v)) {
      const s = v.map(partText).filter(Boolean).join('\n').trim();
      if (s) return s;
    }
  }
  // A bare Codex function call/output carries no `content` at all — only name/arguments/output.
  if (pl.type === 'function_call' || pl.type === 'function_call_output') return partText(pl);
  return '';
}
// Lines that are not valid JSON are CORRUPTION and are reported, never dropped in
// silence (doctrine #1: fail closed on ambiguity). Lines that parse but carry no
// user/assistant text are normal harness metadata (summaries, usage, system events)
// and are counted as `skipped`, not as corruption.
const fmtLines = (bs) => bs.slice(0, 5).map(b => b.line + ' (' + b.reason + ')').join(', ') + (bs.length > 5 ? ' +' + (bs.length - 5) + ' more' : '');
function loadTurns(src) {
  const raw = fs.readFileSync(src, 'utf8');
  const badLines = [];
  let skipped = 0;
  if (/\.jsonl$/i.test(src)) {
    const turns = [];
    raw.split(/\r?\n/).forEach((l, i) => {
      if (!l.trim()) return;
      let r = null;
      try { r = JSON.parse(l); } catch (e) { badLines.push({ line: i + 1, reason: 'invalid JSON', sample: l.trim().slice(0, 80) }); return; }
      const t = textOf(r);
      if (!t.trim()) { skipped++; return; }
      return turns.push({ seq: Number.isFinite(+r.seq) ? +r.seq : i, ts: String(r.ts || r.timestamp || (r.message && r.message.created_at) || ''), cls: classify(r), text: t });
    });
    return { turns, badLines, skipped };
  }
  const turns = []; let cur = null;
  raw.split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*(?:#*\s*)?(user|human|assistant|ai|system|tool)\s*[:>]\s*(.*)$/i);
    if (m) { cur = { seq: turns.length, ts: '', cls: /^u|^h/i.test(m[1]) ? 'USER' : (/^a/i.test(m[1]) ? 'AGENT' : (/^tool/i.test(m[1]) ? 'TOOL' : 'OTHER')), text: m[2] }; turns.push(cur); }
    else if (cur) cur.text += '\n' + l;
  });
  return { turns: turns.filter(t => t.text.trim()), badLines, skipped };
}
// A hand-authored evidence contract (RESULT:/EVIDENCE:/... at line start) is the gate's
// INPUT. Rebuilding regenerates HANDOFF.md, which used to erase it — silently destroying
// the very input the gate requires. It is now carried across every rebuild verbatim.
function preservedEvidence(mdPath) {
  if (!fs.existsSync(mdPath)) return null;
  const lines = fs.readFileSync(mdPath, 'utf8').split(/\r?\n/);
  const isField = (l) => /^(RESULT|WHAT_CHANGED|VALIDATION|EVIDENCE|BLOCKERS|RISKS|FOLLOW_UP)\s*:/.test(l);
  let first = -1, last = -1;
  lines.forEach((l, i) => { if (isField(l)) { if (first < 0) first = i; last = i; } });
  if (first < 0) return null;
  let end = last;
  for (let i = last + 1; i < lines.length; i++) { if (/^#{1,6}\s/.test(lines[i])) break; end = i; }
  const block = lines.slice(first, end + 1).join('\n').replace(/\s+$/, '');
  return block.trim() ? block : null;
}
const NOTICE_RE = /^(the )?(approval policy|approval|policy changed|system[: ]|notice\b|context low|<\w)/i;
function pickObjective(turns, override) {
  if (override) return String(override).slice(0, 400);
  const users = turns.filter(t => t.cls === 'USER');
  const good = users.find(t => t.text.length >= 20 && !NOTICE_RE.test(t.text.trim()));
  const agents = turns.filter(t => t.cls === 'AGENT');
  return ((good || users[0] || agents[0] || { text: '(none)' }).text || '').slice(0, 400);
}
function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48); }
function tagToProject(tag) {
  let s = String(tag).replace(/^([A-Za-z])-/, '');
  const parts = s.split('-').filter(Boolean);
  let pick = parts[parts.length - 1] || '';
  if (pick.length < 3 && parts.length > 1) pick = parts.slice(-2).join('-');
  return slugify(pick) || 'unsorted';
}
function inferProject(src, firstRaw, harnessArg) {
  const p = argOf('--project', () => null);
  if (p) return slugify(p) || 'unsorted';
  const cfgName = configProjectName(RES);
  if (cfgName) return slugify(cfgName) || 'unsorted'; // explicit config beats inference
  const thread = String((firstRaw && firstRaw.thread) || '');
  let m = thread.match(/--([A-Za-z0-9._~-]+)--/);
  if (m) return tagToProject(m[1]);
  const parent = path.basename(path.dirname(path.resolve(src)));
  m = parent.match(/--([A-Za-z0-9._~-]+)--/);
  if (m) return tagToProject(m[1]);
  return slugify(harnessArg || '') || 'unsorted';
}
function migrateLegacy() {
  if (!fs.existsSync(ROOT)) return;
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (['projects', 'links', 'tools', 'templates', 'refs'].includes(e.name)) continue;
    const mp = path.join(ROOT, e.name, 'manifest.json');
    if (!fs.existsSync(mp)) continue;
    let man = {};
    try { man = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch (err) { continue; }
    const proj = slugify(man.project || man.harness || 'unsorted') || 'unsorted';
    const dst = path.join(PROJ, proj, e.name);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (!fs.existsSync(dst)) { fs.renameSync(path.join(ROOT, e.name), dst); console.log('handoff: migrated legacy ' + e.name + ' -> projects/' + proj); }
  }
}
const STOP = new Set('the a an and or of to in for with on is are was were this that it its as at by be from not will shall into your when what'.split(' '));
function keywords(s) { return new Set(String(s).toLowerCase().split(/[^a-z0-9_.-]+/).filter(w => w.length >= 4 && !STOP.has(w))); }
function jaccard(a, b) { let n = 0; for (const w of a) if (b.has(w)) n++; return n / (a.size + b.size - n || 1); }
function crossLink(proj, sid, objText) {
  if (!linkingEnabled(RES)) return 0; // handoff.config.json: linking.enabled === false
  try { fs.mkdirSync(LINKS, { recursive: true }); } catch (e) { return 0; }
  const me = keywords(objText);
  if (me.size < 3) return 0;
  let added = 0;
  for (const d of fs.readdirSync(PROJ, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name === proj) continue;
    const pp = path.join(PROJ, d.name, 'PROJECT.md');
    if (!fs.existsSync(pp)) continue;
    const score = jaccard(me, keywords(fs.readFileSync(pp, 'utf8')));
    if (score < 0.06) continue;
    const mark = '<!-- xlink:' + proj + '/' + sid + ' -->';
    const lp = path.join(LINKS, d.name + '.md');
    let t = fs.existsSync(lp) ? fs.readFileSync(lp, 'utf8') : ('# Cross-links: ' + d.name + '\n\nRelated sessions from other projects:\n');
    if (t.includes(mark)) continue;
    t += '- [' + new Date().toISOString() + '] related: projects/' + proj + '/' + sid + ' (overlap=' + score.toFixed(2) + ') :: ' + objText.slice(0, 100).split('\n').join(' ') + ' ' + mark + '\n';
    fs.writeFileSync(lp, t);
    added++;
  }
  return added;
}
function index() {
  fs.mkdirSync(PROJ, { recursive: true });
  const iP = path.join(ROOT, 'INDEX.json');
  let idx = [];
  if (fs.existsSync(iP)) { try { idx = JSON.parse(fs.readFileSync(iP, 'utf8')); } catch (e) { idx = []; } }
  idx = idx.filter(e => e.dir && fs.existsSync(e.dir));
  for (const p of fs.readdirSync(PROJ, { withFileTypes: true })) {
    if (!p.isDirectory()) continue;
    for (const s of fs.readdirSync(path.join(PROJ, p.name), { withFileTypes: true })) {
      if (!s.isDirectory()) continue;
      const mp = path.join(PROJ, p.name, s.name, 'manifest.json');
      if (!fs.existsSync(mp)) continue;
      let m;
      try { m = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch (e) { continue; }
      idx = idx.filter(e => e.id !== s.name);
      idx.push({ id: s.name, uuid: m.session, project: p.name, harness: m.harness, turns: m.turn_count || 0, revisions: m.revisions, updated: m.updated_at, manifest_sha256: m.manifest_sha256, dir: path.join(PROJ, p.name, s.name) });
    }
  }
  fs.writeFileSync(iP, JSON.stringify(idx.map(({ dir, ...rest }) => rest), null, 2));
  return idx;
}
function sessionLine(sid, turns, man, objective) {
  return '- session ' + sid + ' (turns=' + turns.length + ', rev=' + man.revisions + ') :: ' + String(objective).slice(0, 80).split('\n').join(' ');
}
function build() {
  migrateLegacy();
  let src = argOf('--source', () => { const i = process.argv.indexOf('build'); return i >= 0 ? process.argv[i + 1] : null; });
  if (src && !fs.existsSync(src)) die(2, 'source not found: ' + src);
  if (!src) die(2, 'usage: build --source <file> [--session id] [--harness n] [--model m] [--project name] [--objective text]');
  const parsed = loadTurns(src);
  const turnsAll = parsed.turns;
  if (!turnsAll.length) die(4, 'no usable turns parsed from ' + src +
    (parsed.badLines.length ? ' — ' + parsed.badLines.length + ' unparseable line(s) at ' + fmtLines(parsed.badLines) : ''));
  if (parsed.badLines.length && !hasFlag('--allow-bad-lines')) {
    die(5, 'refusing to continue: ' + parsed.badLines.length + ' unparseable JSONL line(s) at ' + fmtLines(parsed.badLines) +
      ' — fixing the input is the default (doctrine #1); pass --allow-bad-lines to skip them explicitly');
  }
  if (parsed.badLines.length) console.error('handoff: WARNING — skipped ' + parsed.badLines.length + ' unparseable line(s) because --allow-bad-lines was given');
  let firstRaw = null;
  try { firstRaw = JSON.parse(fs.readFileSync(src, 'utf8').split(/\r?\n/)[0]); } catch (e) {}
  const mArg = argOf('--model', () => null);
  let sid = argOf('--session', () => null);
  if (!sid && firstRaw && firstRaw.session) sid = String(firstRaw.session);
  if (!sid) sid = path.basename(src).replace(/\.(jsonl|txt|md)$/i, '');
  const hArg = argOf('--harness', () => null);
  let proj = inferProject(src, firstRaw, hArg) || 'unsorted';
  let dirName = sid.replace(/[^\w.-]/g, '_');
  if (!hasFlag('--project')) {
    const rows = index();
    const known = rows.find(e => e.id === sid || e.uuid === sid);
    if (known) { proj = known.project; dirName = known.id; }
  }
  const dir = path.join(PROJ, proj, dirName);
  fs.mkdirSync(dir, { recursive: true });
  const manP = path.join(dir, 'manifest.json');
  let man;
  if (fs.existsSync(manP)) {
    try { man = JSON.parse(fs.readFileSync(manP, 'utf8')); } catch (e) { die(1, 'corrupt manifest at ' + manP); }
  } else {
    man = { session: sid, project: proj, harness: hArg || 'unknown', model: argOf('--model', () => null) || '', created_at: new Date().toISOString(), source_paths: [], watermark: -1, raw_sha256: null, revisions: 0 };
  }
  if (man.project !== proj) { man.prev_project = man.project; man.project = proj; }
  const rsha = sha(fs.readFileSync(src, 'utf8'));
  if (!man.source_paths.includes(src)) man.source_paths.push(src);
  if (hArg && (man.harness === 'unknown' || hasFlag('--force-harness'))) man.harness = hArg;
  if (mArg && (man.model === '' || hasFlag('--force-model'))) man.model = mArg;  // persist model on recreate (never drop/empty it)
  const fresh = turnsAll.filter(t => t.seq > man.watermark);
  if (!fresh.length && man.raw_sha256 === rsha) { index(); console.log('handoff: up-to-date (' + sid + ', watermark ' + man.watermark + ', rev ' + man.revisions + ')'); return; }
  const tlP = path.join(dir, 'timeline.jsonl');
  const prior = fs.existsSync(tlP) ? fs.readFileSync(tlP, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  fs.writeFileSync(tlP, [...prior, ...fresh.map(t => JSON.stringify({ seq: t.seq, ts: t.ts, class: t.cls, text: t.text }))].join('\n') + '\n');
  const turns = fs.readFileSync(tlP, 'utf8').split(/\r?\n/).filter(Boolean).map(l => { const o = JSON.parse(l); return { seq: o.seq, ts: o.ts, cls: o.class, text: o.text }; });
  const users = turns.filter(t => t.cls === 'USER');
  const agents = turns.filter(t => t.cls === 'AGENT');
  const objective = pickObjective(turns, argOf('--objective', () => null));
  const stateNow = ((agents.at(-1) || users.at(-1) || { text: '(none)' }).text || '').slice(-1200);
  const openLoops = [...new Set(turns.flatMap(t => String(t.text).split(/\r?\n/)).filter(l => /(next step|todo|blocked|open loop|remaining work)/i.test(l)).map(l => l.trim()))].slice(0, 20);
  const toolCalls = turns.filter(t => t.cls === 'TOOL');
  const evidenceBlock = preservedEvidence(path.join(dir, 'HANDOFF.md'));
  if (evidenceBlock) man.evidence_contract_sha256 = sha(evidenceBlock);
  else delete man.evidence_contract_sha256;
  man.watermark = Math.max(...turnsAll.map(t => t.seq));
  man.raw_sha256 = rsha;
  man.revisions++;
  man.updated_at = new Date().toISOString();
  man.turn_count = turns.length;
  man.counts = { USER: users.length, AGENT: agents.length, THOUGHT: turns.filter(t => t.cls === 'THOUGHT').length, TOOL: toolCalls.length };
  man.manifest_sha256 = sha(JSON.stringify((o => { delete o.manifest_sha256; return o; })(Object.assign({}, man))));
  const sum = { schema_version: '2.0.0-summary', session: { id: sid, harness: man.harness, model: man.model }, project: proj, generated_at: man.updated_at, objective, state_now: stateNow.slice(0, 600), open_loops: openLoops, evidence_class: 'OBSERVED', counts: man.counts, artifacts: { full_payload: 'HANDOFF.llm.json', timeline: 'timeline.jsonl', tool_calls: 'TOOLS.md' }, provenance: { sources: man.source_paths, raw_sha256: rsha, manifest_sha256: man.manifest_sha256, revision: man.revisions, watermark: man.watermark, total_turns: turns.length } };
  fs.writeFileSync(path.join(dir, 'HANDOFF.summary.json'), JSON.stringify(sum, null, 2));
  const llm = Object.assign({}, sum, { schema_version: '2.0.0', state_now: stateNow, timeline: turns.map(({ cls, ...rest }) => ({ ...rest, class: cls })), tool_calls: toolCalls.map(({ cls, ...rest }) => ({ ...rest, class: cls })) });
  fs.writeFileSync(path.join(dir, 'HANDOFF.llm.json'), JSON.stringify(llm, null, 2));
  const md = [
    '# Handoff: ' + sid, '',
    '**Project:** ' + proj + '  |  **Harness:** ' + man.harness + (man.model ? '  |  **Model:** ' + man.model : ''),
    '**Updated:** ' + man.updated_at + '  |  **Turns:** ' + turns.length + '  |  **Revision:** ' + man.revisions + '  |  **Watermark:** seq <= ' + man.watermark, '',
    '## Objective (verbatim)', '', fence, objective, fence, '',
    '## State right now (verbatim tail)', '', fence, stateNow, fence, ''
  ];
  if (openLoops.length) md.push('## Open loops / next steps', ...openLoops.map(l => '- ' + l), '');
  md.push('## Recent timeline (last 40 of ' + turns.length + ' turns)', '',
    '| seq | class | text (head 120) |', '|---:|---|---|',
    ...turns.slice(-40).map(t => '| ' + t.seq + ' | ' + t.cls + ' | ' + String(t.text).slice(0, 120).split('|').join('\\|').split('\n').join(' ') + ' |'), '',
    '## Where everything lives',
    '- Full timeline (append-only): timeline.jsonl (' + turns.length + ' turns)',
    '- All ' + toolCalls.length + ' tool calls verbatim: TOOLS.md',
    '- Machine payload: HANDOFF.llm.json / Compact payload: HANDOFF.summary.json', '',
    '## Provenance',
    '- sources: ' + man.source_paths.join(', '),
    '- raw sha256: ' + rsha,
    '- manifest sha256: ' + man.manifest_sha256,
    '- incremental: revisions=' + man.revisions + ' (update-not-recreate)', '',
    '## Evidence contract (hand-authored — preserved across rebuilds)', '',
    ...(evidenceBlock
      ? [evidenceBlock, '', '- contract sha256: ' + man.evidence_contract_sha256 +
         ' (carried forward verbatim; the L4 gate reads this section)']
      : ['(none yet) — add RESULT/WHAT_CHANGED/VALIDATION/EVIDENCE/BLOCKERS/RISKS/FOLLOW_UP and the next rebuild keeps it;',
         '`agents-handoff.mjs verify-gate <id>` reads this section.']));
  fs.writeFileSync(path.join(dir, 'HANDOFF.md'), md.join('\n'));
  // TOOLS.md carries EVERY tool call verbatim (full text, never truncated) —
  // this is the lossless fidelity tier that answers "does the handoff contain all calls/bits".
  fs.writeFileSync(path.join(dir, 'TOOLS.md'),
    ['# Tool calls: ' + sid, '', 'Total: ' + toolCalls.length, '',
     'Entire tool-call corpus (every shell command, every edit, every tool return) verbatim.',
     'The head-120 table in HANDOFF.md is a digest view; THIS file is the full record.']
      .concat(toolCalls.map(t => '## [' + t.seq + '] ' + (t.ts || '') + '\n' + String(t.text)))
      .join('\n\n') + '\n');
  fs.writeFileSync(manP, JSON.stringify(man, null, 2));
  const pmP = path.join(PROJ, proj, 'PROJECT.md');
  if (!fs.existsSync(pmP)) {
    fs.writeFileSync(pmP, '# Project: ' + proj + '\n\n<!-- suggested-title: replace me -->\n\n## Sessions\n' + sessionLine(sid, turns, man, objective) + '\n');
  } else {
    let pm = fs.readFileSync(pmP, 'utf8');
    if (!pm.includes(sid)) pm = pm.replace(/\s*$/, '\n' + sessionLine(sid, turns, man, objective) + '\n');
    fs.writeFileSync(pmP, pm);
  }
  let suggest = '';
  if (/^[a-z0-9]{8}-[a-z0-9]{4}/i.test(sid) || /^[a-z]{1,4}\d{4,}$/i.test(sid)) {
    const kw = [...keywords(objective)].slice(0, 3).join('-');
    const dstr = new Date().toISOString().slice(0, 10);
    const sug = slugify(dstr + '-' + (kw || 'session'));
    suggest = ' suggest: node handoff.mjs retitle ' + sid.slice(0, 12) + ' ' + sug;
    const pmS = path.join(PROJ, proj, 'PROJECT.md');
    if (fs.existsSync(pmS)) { let pms = fs.readFileSync(pmS, 'utf8');
      if (!pms.includes('<!-- suggested-session-name: ' + sug + ' -->')) pms += '\n<!-- suggested-session-name: ' + sug + ' -->\n'; fs.writeFileSync(pmS, pms); }
  }
  const xl = crossLink(proj, sid, objective);
  index();
  console.log('handoff: built ' + sid + ' project=' + proj + ' turns=' + turns.length + ' new=' + fresh.length + ' rev=' + man.revisions + (xl ? ' xlink-notes=' + xl : '') + suggest + ' -> ' + dir);
}
function list() {
  index();
  const iP = path.join(ROOT, 'INDEX.json');
  let rows = fs.existsSync(iP) ? JSON.parse(fs.readFileSync(iP, 'utf8')) : [];
  if (!rows.length) die(4, 'no handoffs yet');
  const pre = process.argv[3];
  if (pre) rows = rows.filter(e => e.project === pre || e.id.startsWith(pre));
  if (!rows.length) die(4, 'no handoffs matching ' + pre);
  for (const e of rows.sort((a, b) => String(b.updated).localeCompare(String(a.updated))))
    console.log('[' + e.project + '] ' + e.id.slice(0, 44) + '  harness=' + e.harness + '  turns=' + e.turns + '  rev=' + e.revisions + '  updated=' + e.updated);
}
function pick(pre) {
  const idxFresh = index();
  const iP = path.join(ROOT, 'INDEX.json');
  let hits = idxFresh.filter(e => e.id.startsWith(pre) || (e.uuid && String(e.uuid).startsWith(pre)));
  if (!hits.length && !/^session-/i.test(pre)) { const alt = 'session-' + pre; hits = idxFresh.filter(e => e.id.startsWith(alt) || (e.uuid && String(e.uuid).startsWith(alt))); }
  if (!hits.length) die(4, 'no handoff matches prefix: ' + pre);
  if (hits.length > 1) die(3, 'ambiguous prefix (' + hits.length + ' hits): ' + pre);
  hits[0].dir = path.join(PROJ, hits[0].project, hits[0].id);
  return hits[0];
}
function show() {
  const pre = process.argv[3];
  if (!pre) die(2, 'usage: show <id-prefix>');
  const h = pick(pre);
  console.log(fs.readFileSync(path.join(h.dir, 'HANDOFF.md'), 'utf8'));
}
function verify() {
  const pre = process.argv[3];
  if (!pre) die(2, 'usage: verify <id-prefix>');
  const h = pick(pre), d = h.dir;
  const man = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'));
  const expect = man.manifest_sha256;
  const actual = Object.assign({}, man);
  delete actual.manifest_sha256;
  if (sha(JSON.stringify(actual)) !== expect) die(1, 'FAIL ' + h.id + ': manifest tampered (sha mismatch)');
  const tlP = path.join(d, 'timeline.jsonl');
  if (!fs.existsSync(tlP)) die(1, 'FAIL ' + h.id + ': timeline.jsonl missing');
  const n = fs.readFileSync(tlP, 'utf8').split(/\r?\n/).filter(Boolean).length;
  if (n !== (man.turn_count || -1)) die(1, 'FAIL ' + h.id + ': turn count drift (' + n + ' vs manifest ' + man.turn_count + ')');
  JSON.parse(fs.readFileSync(path.join(d, 'HANDOFF.llm.json'), 'utf8'));
  console.log('PASS ' + h.id + ' [' + man.project + ']: manifest sha ok / timeline=' + n + ' turns / llm json parses');
}
function retitleCmd() {
  const pre = process.argv[3];
  const nn = slugify(process.argv[4] || '');
  if (!pre || !nn) die(2, 'usage: retitle <id-prefix> <new-human-readable-name>');
  const h = pick(pre);
  const nd2 = path.join(PROJ, h.project, nn);
  if (fs.existsSync(nd2)) die(4, 'target name already exists: ' + nd2);
  fs.renameSync(h.dir, nd2);
  const mp = path.join(nd2, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  m.titled_from = m.titled_from || [];
  if (!m.titled_from.includes(h.id)) m.titled_from.push(h.id);
  m.revisions++;
  m.updated_at = new Date().toISOString();
  m.manifest_sha256 = sha(JSON.stringify((o => { delete o.manifest_sha256; return o; })(Object.assign({}, m))));
  fs.writeFileSync(mp, JSON.stringify(m, null, 2));
  // refresh EVERY render from the bumped manifest - no stale provenance may survive
  for (const [f, isJson] of [['HANDOFF.summary.json', true], ['HANDOFF.llm.json', true]]) {
    const fp = path.join(nd2, f);
    if (!fs.existsSync(fp)) continue;
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    j.session = j.session || {};
    j.session.title = nn;
    j.generated_at = m.updated_at;
    j.provenance = j.provenance || {};
    j.provenance.manifest_sha256 = m.manifest_sha256;
    j.provenance.revision = m.revisions;
    fs.writeFileSync(fp, JSON.stringify(j, null, 2));
  }
  const mdP = path.join(nd2, 'HANDOFF.md');
  let md = fs.readFileSync(mdP, 'utf8');
  md = md.replace(/^\*session-id:.*\n?/gm, '');
  md = md.replace(/^# Handoff: .*$/m, '# Handoff: ' + nn + '\n\n*session-id: ' + m.session + '*');
  md = md.replace(/\*\*Updated:\*\* [^|]+\|/, '**Updated:** ' + m.updated_at + '  |');
  md = md.replace(/\*\*Revision:\*\* \d+/, '**Revision:** ' + m.revisions);
  md = md.replace(/- manifest sha256: [0-9a-f]{64}/, '- manifest sha256: ' + m.manifest_sha256);
  md = md.replace(/- incremental: revisions=\d+/, '- incremental: revisions=' + m.revisions);
  fs.writeFileSync(mdP, md);
  index();
  console.log('handoff: retitled ' + h.id + ' -> ' + nn + ' [project ' + h.project + '] renders refreshed rev=' + m.revisions);
}
function renameCmd() {
  const pre = process.argv[3];
  const np = slugify(process.argv[4] || '');
  if (!pre || !np) die(2, 'usage: rename <id-prefix> <new-project-name>');
  const h = pick(pre);
  const nd = path.join(PROJ, np, h.id);
  fs.mkdirSync(path.dirname(nd), { recursive: true });
  fs.renameSync(h.dir, nd);
  const mp = path.join(nd, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  m.prev_project = m.project;
  m.project = np;
  m.revisions++;
  m.updated_at = new Date().toISOString();
  m.manifest_sha256 = sha(JSON.stringify((o => { delete o.manifest_sha256; return o; })(Object.assign({}, m))));
  fs.writeFileSync(mp, JSON.stringify(m, null, 2));
  const llp = path.join(nd, 'HANDOFF.llm.json');
  const ll = JSON.parse(fs.readFileSync(llp, 'utf8'));
  ll.project = np;
  ll.provenance.manifest_sha256 = m.manifest_sha256;
  fs.writeFileSync(llp, JSON.stringify(ll, null, 2));
  const sp = path.join(nd, 'HANDOFF.summary.json');
  if (fs.existsSync(sp)) { const sm = JSON.parse(fs.readFileSync(sp, 'utf8')); sm.project = np; sm.provenance.manifest_sha256 = m.manifest_sha256; fs.writeFileSync(sp, JSON.stringify(sm, null, 2)); }
  let md = fs.readFileSync(path.join(nd, 'HANDOFF.md'), 'utf8').replace(/\*\*Project:\*\* [^|]*\|/, '**Project:** ' + np + '  |');
  fs.writeFileSync(path.join(nd, 'HANDOFF.md'), md);
  index();
  console.log('handoff: renamed ' + h.id + ' -> project ' + np);
}
function configCmd() {
  console.log('handoff: config root=' + ROOT);
  console.log('handoff: config source=' + RES.source);
  console.log('handoff: config file=' + (RES.configPath || 'none'));
  console.log('handoff: config schema=' + RES.schemaPath);
  console.log('handoff: config project=' + (configProjectName(RES) || 'auto-detected'));
  console.log('handoff: config linking=' + (linkingEnabled(RES) ? 'enabled' : 'disabled'));
}
const cmd = process.argv[2];
try {
  if (cmd === 'build' || hasFlag('--handoff')) build();
  else if (cmd === 'config') configCmd();
  else if (cmd === 'list') list();
  else if (cmd === 'show') show();
  else if (cmd === 'verify') verify();
  else if (cmd === 'rename') renameCmd();
  else if (cmd === 'retitle') retitleCmd();
  else die(2, 'commands: build --source F [--session id][--harness n][--model m][--project p][--objective t] | --handoff | list [proj] | show P | verify P | rename P NAME | retitle P NAME | config');
} catch (e) { die(1, String(e && e.message || e)); }
