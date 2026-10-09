#!/usr/bin/env node
// .github/scripts/check-docs.mjs — prove the documentation site is complete and linkable.
//
// Two failures this catches, both invisible to a build that only checks that pages render:
//
//   1. A page that exists but is not in docs/_data/nav.yml. It builds, it is reachable by
//      URL, and nothing links to it — the wiki silently grows a dead end. Every page under
//      docs/ must appear in the navigation, and every navigation entry must be a real page.
//   2. A link that resolves in the repository but not on the site. The Pages site is built
//      from docs/ alone, so `../refs/ADAPTERS.md` is a valid path here and a 404 there.
//      A link that leaves docs/ has to be an absolute URL instead.
//
// Run from anywhere:  node .github/scripts/check-docs.mjs
// Exit codes: 0 every check passed; 1 at least one finding; 2 the layout is not what this
// script reads (missing docs/ or nav.yml) — reported as its own failure, never as a pass.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const DOCS = path.join(ROOT, 'docs');
const NAV = path.join(DOCS, '_data', 'nav.yml');
const BLOB = 'https://github.com/Alot1z/agents-handoff/blob/main/';

const findings = [];
const fail = (msg) => findings.push(msg);

if (!fs.existsSync(DOCS) || !fs.existsSync(NAV)) {
  console.error('check-docs: cannot read ' + (fs.existsSync(DOCS) ? NAV : DOCS));
  process.exit(2);
}

// --- collect the documentation pages (underscore-prefixed directories are Jekyll plumbing)
const pages = [];
const walkDocs = (dir, rel) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (e.name.startsWith('_')) continue;
      walkDocs(path.join(dir, e.name), r);
      continue;
    }
    if (e.name.endsWith('.md')) pages.push(r);
  }
};
walkDocs(DOCS, '');
pages.sort();

// --- parse nav.yml (the two keys this script needs: title and path)
const navRaw = fs.readFileSync(NAV, 'utf8');
const navEntries = [];
{
  let title = null;
  for (const line of navRaw.split('\n')) {
    const t = /^\s*-?\s*title:\s*(.+?)\s*$/.exec(line);
    const p = /^\s*path:\s*(.+?)\s*$/.exec(line);
    if (t) title = t[1];
    else if (p) { navEntries.push({ title: title || '(untitled)', path: p[1] }); title = null; }
  }
}
if (!navEntries.length) fail('nav.yml has no entries — the navigation would render empty');

const navTargets = new Set();
for (const { title, path: p } of navEntries) {
  const m = /^\/(.+)\.html$/.exec(p);
  if (!m) { fail('nav.yml: "' + title + '" has a path this check cannot map to a page: ' + p); continue; }
  const rel = (m[1] === 'index' ? 'index' : m[1]) + '.md';
  navTargets.add(rel);
  if (!pages.includes(rel)) fail('nav.yml: "' + title + '" points at ' + p + ' but docs/' + rel + ' does not exist');
}
for (const rel of pages) {
  if (!navTargets.has(rel)) fail('docs/' + rel + ' is not in docs/_data/nav.yml — it would be reachable only by URL');
}

// --- links
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const files = [];
const walkRepo = (dir, rel) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { walkRepo(path.join(dir, e.name), r); continue; }
    if (e.name.endsWith('.md')) files.push(r);
  }
};
walkRepo(ROOT, '');

let checked = 0;
for (const rel of files) {
  const abs = path.join(ROOT, ...rel.split('/'));
  const inDocs = rel.split('/')[0] === 'docs';
  const text = fs.readFileSync(abs, 'utf8');
  for (const m of text.matchAll(LINK)) {
    let target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    if (/^[<{]/.test(target) || target.includes('{{') || target.includes('<')) continue; // template placeholder
    target = target.split('#')[0];
    if (!target) continue;
    checked += 1;
    const resolved = path.resolve(path.dirname(abs), target);
    if (!fs.existsSync(resolved)) {
      fail(rel + ': link target does not exist: ' + m[1]);
      continue;
    }
    // On the site, only docs/ is published. A link from a page into another directory has to
    // be an absolute URL, or it 404s for every reader of the documentation.
    if (inDocs && !resolved.startsWith(DOCS + path.sep)) {
      fail(rel + ': ' + m[1] + ' leaves docs/ and would 404 on the site — use ' + BLOB + target.replace(/^\.\.\//, ''));
    }
  }
}

if (findings.length) {
  console.error('check-docs: ' + findings.length + ' finding(s) across ' + files.length + ' markdown file(s)');
  for (const f of findings) console.error('  ' + f);
  process.exit(1);
}
console.log('check-docs: OK — ' + pages.length + ' page(s), all in nav.yml; ' +
  checked + ' relative link(s) across ' + files.length + ' markdown file(s) resolve where they are read');
