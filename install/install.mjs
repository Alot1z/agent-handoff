#!/usr/bin/env node
// agents-handoff - npx installer for the agents-handoff skill
// Commands: install, update, remove, verify, list
// Zero external dependencies, pure Node.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = path.resolve(__dirname);
// The tree the skill is read from when this installer runs inside a checkout or a release
// archive: the parent of install/. A published package has no parent tree, so this path is
// also the test that decides between copying files and fetching an archive.
const SOURCE_DIR = path.resolve(INSTALLER_ROOT, '..');
const SKILL_NAME = 'agents-handoff';
// The directory name every release before 2.0.3 installed under. An upgraded machine holds these
// in exactly the places a new install would go, so the search looks for both names: `--update`
// and `--verify` act on a pre-rename copy in place instead of reporting that nothing is
// installed while it sits right there. A NEW install always uses SKILL_NAME.
const LEGACY_SKILL_NAME = 'agent-handoff';
// The npm package users `npx`. Same name as the product, and the reason the install record can
// verify an installation against the tarball npm is actually serving.
const NPM_PACKAGE = 'agents-handoff';
const REGISTRY = 'https://registry.npmjs.org';
const REPO_OWNER = 'Alot1z';
// Since the 2026-10-09 rename, the PRODUCT and the REPOSITORY share the agents-handoff name
// (the repository was Alot1z/agent-handoff until then, and every pre-rename URL still resolves
// through GitHub's redirect). The one name that deliberately did NOT migrate is the
// LEGACY_SKILL_NAME below: it is the pre-2.0.3 install DIRECTORY name, which still exists on
// user machines and must be found and updated in place.
// This constant is the one place the repository's name lives: the download, release and API
// URLs below all derive from it.
const REPO_NAME = 'agents-handoff';
const RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download`;
const TARBALL_URL = `https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz`;
const API_LATEST = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

// THE VERSION THIS INSTALLER SHIPS. SKILL.md owns it: the same frontmatter that `verify` and
// `list` read back out of an installed copy. The literal below is only the fallback for the
// run that has no tree beside it — the published package fetching an archive — and the suite
// asserts it against SKILL.md, so a release that bumps one cannot leave the other behind.
const FALLBACK_SKILL_VERSION = '2.0.7';
function skillVersion() {
  try {
    const md = fs.readFileSync(path.join(SOURCE_DIR, 'SKILL.md'), 'utf8');
    const m = md.match(/^version:\s*(\S+)/m);
    if (m) return m[1];
  } catch { /* no tree beside the installer */ }
  return FALLBACK_SKILL_VERSION;
}
const SKILL_VERSION = skillVersion();

// The installer's own version, read from the package it ships in — the same file npm
// publishes, so the banner cannot lag a release.
function installerVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(INSTALLER_ROOT, 'package.json'), 'utf8')).version;
  } catch { return 'unknown'; }
}
const INSTALLER_VERSION = installerVersion();

// Locations
const HOME = process.env.USERPROFILE || process.env.HOME || '';

// Where a GLOBAL install can go. Desktop clients keep account skills in their own store with
// two opaque id levels between the store and the skill:
//
//     <store>/<account-id>/<profile-id>/agents-handoff/
//
// No client is named here. A store is DISCOVERED by looking for `account-skills` directories
// under the platform's application-data roots, so a client that is absent from this machine
// simply contributes no candidate. These are candidates to search, never a decision:
// `resolveGlobalRoot` picks one and says why. `AGENT_HANDOFF_GLOBAL_DIR` overrides the
// search; `--path` bypasses it.
const DATA_ROOTS = (process.platform === 'win32'
  ? [
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
    path.join(HOME, 'AppData', 'Roaming'),
    // A desktop client keeps its account-skill store under ~/.config even on Windows, where
    // that directory is not an application-data root at all. Leaving it out is not a cosmetic
    // gap: the machine's real installation is then invisible to every command that resolves a
    // global root or searches for installations, while the store it lives in keeps working.
    path.join(HOME, '.config'),
  ]
  : [path.join(HOME, '.config'), path.join(HOME, '.local', 'share')]
).filter(Boolean);
const AGENTS_SKILLS = path.join(HOME, '.agents', 'skills');

const PATHS = {
  local: path.join(process.cwd(), 'local', 'skills'),
  project: path.join(process.cwd(), 'skills'),
};

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => path.join(dir, e.name));
  } catch { return []; }
}
const mtimeOf = p => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };

// Every `account-skills` store on this machine, whatever client created it.
function accountSkillStores() {
  const out = [];
  for (const dataRoot of DATA_ROOTS) {
    for (const clientDir of listDirs(dataRoot)) {
      const store = path.join(clientDir, 'account-skills');
      try { if (fs.statSync(store).isDirectory()) out.push(store); } catch { /* no store there */ }
    }
  }
  return [...new Set(out)];
}

// Every directory that could be the PARENT of a global agents-handoff/, from every account
// store this machine has.
function accountSkillRoots() {
  const stores = accountSkillStores();
  const out = [];
  for (const store of stores) {
    for (const account of listDirs(store)) {
      out.push(account);
      for (const profile of listDirs(account)) out.push(profile);
    }
  }
  return out;
}

// Resolution order, first hit wins:
//   1. AGENT_HANDOFF_GLOBAL_DIR                 — explicit operator override
//   2. an account-skill root that ALREADY holds agents-handoff (newest install first)
//   3. ~/.agents/skills                         — the harness-wide skills home
//   4. any account-skill root discovered above  — keeps the install where a client reads
//   5. ~/.agents/skills                         — created on install when nothing exists
function resolveGlobalRoot() {
  const override = process.env.AGENT_HANDOFF_GLOBAL_DIR;
  if (override) return { root: path.resolve(override), why: 'AGENT_HANDOFF_GLOBAL_DIR' };

  const roots = accountSkillRoots();
  const installed = roots.filter(d => isInstalled(path.join(d, SKILL_NAME)));
  installed.sort((a, b) => mtimeOf(path.join(b, SKILL_NAME)) - mtimeOf(path.join(a, SKILL_NAME)));
  if (installed.length) {
    return {
      root: installed[0],
      why: 'account-skill store, existing install (newest of ' + installed.length + ' found)',
      others: installed.slice(1),
    };
  }
  if (fs.existsSync(AGENTS_SKILLS)) return { root: AGENTS_SKILLS, why: '~/.agents/skills (harness skills home)' };
  if (roots.length) return { root: roots[0], why: 'account-skill store (no install there yet)' };
  return { root: AGENTS_SKILLS, why: 'harness skills home (created on install)' };
}

// Colors for output
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};
const C = (color, text) => process.stdout.isTTY ? `${COLORS[color]}${text}${COLORS.reset}` : text;

// `log()` is called with no argument for a blank line all over this file, and
// console.log(undefined) prints the literal word "undefined" — so the default is the empty
// string, not the argument passed through.
function log(msg = '') { console.log(msg); }
function warn(msg) { console.warn(C('yellow', `⚠ ${msg}`)); }
function error(msg) { console.error(C('red', `✗ ${msg}`)); process.exit(1); }
function success(msg) { console.log(C('green', `✓ ${msg}`)); }

// Parse args
const args = process.argv.slice(2);
const getArg = (name, defaultVal = null) => {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : defaultVal;
};
const hasFlag = (name) => args.includes(name);

// Accept BOTH the bare verb form (`install`, `verify`) and the flag form the help text
// documents (`--verify`, `--list`, `--remove`, `--update`, `--help`). Previously args[0]
// had to be a bare verb, so every documented flag form exited 1 with "Unknown command".
const FLAG_COMMANDS = {
  '--install': 'install', '--update': 'update', '--remove': 'remove',
  '--verify': 'verify', '--list': 'list', '--doctor': 'doctor',
  '--verify-package': 'verify-package',
  '--help': 'help', '-h': 'help'
};
const COMMAND = FLAG_COMMANDS[args[0]] || (args[0] && !args[0].startsWith('-') ? args[0] : 'install');
const LOCATION = getArg('--location', 'global');
const CUSTOM_PATH = getArg('--path');
const VERSION = getArg('--version', 'latest');
const FORCE = hasFlag('--force') || hasFlag('-f');
const PROJECT_TARGET = hasFlag('--project');
const PROVENANCE = hasFlag('--provenance');
// `--record` writes what `verify-package` fetched (tarball sha256/sha512, the registry's
// integrity string) into the install record, so a later run compares against a stored value
// instead of re-deriving one.
const RECORD = hasFlag('--record');

// Which harnesses to install into. `--claude`, `--codex`, `--agents`, `--harness claude,codex`
// (repeatable) and `--all` (every harness whose home directory exists here). `--skills-dir
// <path>` (repeatable) targets any other stack exactly. NO harness flag keeps the historical
// single target: the resolved global root, ./local/skills, ./skills, or --path.
const HARNESS_FLAGS = { '--claude': 'claude', '--codex': 'codex', '--agents': 'agents' };
const HARNESSES_CHOSEN = [];
const SKILLS_DIRS = [];
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (HARNESS_FLAGS[a]) HARNESSES_CHOSEN.push(HARNESS_FLAGS[a]);
  else if (a === '--harness') {
    HARNESSES_CHOSEN.push(...String(args[i + 1] || '').split(',').map(s => s.trim()).filter(Boolean));
  } else if (a === '--all') HARNESSES_CHOSEN.push('all');
  else if (a === '--skills-dir') SKILLS_DIRS.push(String(args[i + 1] || ''));
}
const MULTI_TARGET = HARNESSES_CHOSEN.length > 0 || SKILLS_DIRS.length > 0;

// THE INSTALL MANIFEST. One list, used to copy AND to verify, so an installed copy
// cannot silently lose a file the runtime needs (the engine now imports
// tools/lib/handoff-root.mjs, and the previous copy list predated that, the runtime MVP
// and the schemas). `from` is relative to the tree the installer runs in; `to` is relative
// to the target. `from` is written in the PUBLIC tree's terms, because that is the tree the
// installer runs in once it ships — see resolveSource() for how the development tree, which
// keeps those same files under repo-upstream/, still resolves them.
const SKILL_FILES = [
  { from: 'SKILL.md', to: 'SKILL.md' },
  { from: 'README.md', to: 'README.md' },
  { from: 'LICENSE', to: 'LICENSE' },
  { from: 'skill.json', to: 'skill.json' },
  { from: 'capability-registry.json', to: 'capability-registry.json' },
  { from: 'permission-policy.json', to: 'permission-policy.json' },
  { from: 'handoff.config.schema.json', to: 'handoff.config.schema.json' },
  { from: 'handoff.config.example.json', to: 'handoff.config.example.json' },
  { from: 'tools/handoff.mjs', to: 'tools/handoff.mjs' },
  { from: 'tools/agents-handoff.mjs', to: 'tools/agents-handoff.mjs' },
  // The pre-rename runtime path, installed as a forwarder so old notes keep working.
  { from: 'tools/agent-handoff.mjs', to: 'tools/agent-handoff.mjs' },
  { from: 'tools/handoff.test.mjs', to: 'tools/handoff.test.mjs' },
  { from: 'tools/capability-registry.mjs', to: 'tools/capability-registry.mjs' },
  { from: 'tools/runtime-engine.mjs', to: 'tools/runtime-engine.mjs' },
  { from: 'tools/lib/handoff-root.mjs', to: 'tools/lib/handoff-root.mjs' },
  { from: 'schemas/handoff.schema.json', to: 'schemas/handoff.schema.json' },
  { from: 'tests/acceptance/acceptance.yaml', to: 'tests/acceptance/acceptance.yaml' },
  { from: 'tests/fixtures/minimal-transcript.jsonl', to: 'tests/fixtures/minimal-transcript.jsonl' },
  { from: 'docs/INTEGRATION.md', to: 'docs/INTEGRATION.md' },
  { from: 'docs/LEVEL4.md', to: 'docs/LEVEL4.md' },
  { from: 'docs/LEVEL5.md', to: 'docs/LEVEL5.md' },
  { from: 'docs/FORMAT.md', to: 'docs/FORMAT.md' },
  { from: 'docs/PERMISSIONS.md', to: 'docs/PERMISSIONS.md' },
  { from: 'docs/CONTRIBUTING.md', to: 'docs/CONTRIBUTING.md' },
  { from: 'docs/INSTALL.md', to: 'docs/INSTALL.md' },
  { from: 'docs/UPGRADE.md', to: 'docs/UPGRADE.md' },
  { from: 'docs/UNINSTALL.md', to: 'docs/UNINSTALL.md' },
  { from: 'docs/SECURITY.md', to: 'docs/SECURITY.md' },
  { from: 'docs/COMPATIBILITY.md', to: 'docs/COMPATIBILITY.md' },
  { from: 'docs/PROVENANCE.md', to: 'docs/PROVENANCE.md' },
  { from: 'refs/ADAPTERS.md', to: 'refs/ADAPTERS.md' },
  { from: 'refs/handbook.md', to: 'refs/handbook.md' },
  { from: 'refs/protocol.md', to: 'refs/protocol.md' },
  { from: 'refs/roles.md', to: 'refs/roles.md' },
  { from: 'refs/validator.md', to: 'refs/validator.md' },
  { from: 'refs/brief-checklist.md', to: 'refs/brief-checklist.md' },
  { from: 'refs/bootstrap.md', to: 'refs/bootstrap.md' },
  { from: 'templates/HANDOFF.template.md', to: 'templates/HANDOFF.template.md' },
  { from: 'templates/HANDOFF.llm.schema.json', to: 'templates/HANDOFF.llm.schema.json' },
];

// Where a manifest `from` lives. The public shape is tried at its own path, and the
// development shape at repo-upstream/<from>. Development is tried FIRST: a bare `README.md`
// in the development tree is the internal one, while the file that ships is the one under
// repo-upstream/. A clone, a release archive and a fetched tarball have no repo-upstream/,
// so the same list resolves there at the public path — one manifest, both trees.
function resolveSource(root, from) {
  for (const rel of [path.join('repo-upstream', from), from]) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

// Is there a skill tree to copy from? Only a checkout or a release archive has one; the
// published package carries install/ alone, which is the case that must fetch instead.
function haveSourceTree() {
  return fs.existsSync(path.join(SOURCE_DIR, 'tools', 'handoff.mjs'));
}

// The manifest is the copy list AND the completion criterion: a run that cannot resolve a
// source reports it, and install() fails the install when any target is missing. A file
// copied but not verified was how the installed engine once went missing its resolver.
function copyManifest(root, installPath) {
  const unresolved = [];
  let copied = 0;
  for (const file of SKILL_FILES) {
    const srcPath = resolveSource(root, file.from);
    if (!srcPath) { unresolved.push(file.from); continue; }
    const destPath = path.join(installPath, file.to);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    copied++;
  }
  if (unresolved.length) warn('source file(s) not found: ' + unresolved.join(', '));
  return { copied, unresolved };
}

// The newest published release tag, or null when the repository has none (or the API cannot
// be reached). Null is not an error here: it selects the main branch and says so.
async function latestTag() {
  if (typeof fetch === 'undefined') return null;
  try {
    const res = await fetch(API_LATEST, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'agents-handoff' },
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j.tag_name || null;
  } catch { return null; }
}

// Fetch and unpack the archive for the requested version, into a throwaway directory the
// caller removes. Returns the unpacked root, so the same manifest copies from it.
async function fetchAndUnpack(version) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-handoff-fetch-'));
  let ref, label;
  if (version === 'latest') {
    const tag = await latestTag();
    ref = tag ? 'refs/tags/' + tag : 'refs/heads/main';
    label = tag || 'main';
    if (!tag) warn('no published release found — fetching the main branch instead');
  } else {
    ref = 'refs/tags/v' + version;
    label = 'v' + version;
  }
  const url = `${TARBALL_URL}/${ref}`;
  const tarball = path.join(tmp, 'agents-handoff.tar.gz');
  log(`Fetching the ${label} archive...`);
  log(`  ${url}`);
  await downloadFile(url, tarball);
  const bytes = fs.statSync(tarball).size;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(tarball)).digest('hex');
  log(`  ${(bytes / 1024).toFixed(1)} kB, sha256 ${hash.slice(0, 16)}…`);
  const unpack = path.join(tmp, 'unpack');
  fs.mkdirSync(unpack, { recursive: true });
  // Run tar from inside the temp directory with RELATIVE names. An absolute Windows path
  // (`C:\Users\…`) is read by tar as a remote host — `tar (child): Cannot connect to C:
  // resolve failed` — so `-xzf C:\…` fails on the very platform this installer targets first.
  // Relative operands, with cwd doing the locating, work the same in GNU tar and bsdtar.
  const tar = spawnSync('tar', ['-xzf', 'agents-handoff.tar.gz', '-C', 'unpack', '--strip-components=1'],
    { cwd: tmp, encoding: 'utf8' });
  if (tar.status !== 0) {
    const why = String(tar.stderr || '').trim().split('\n')[0];
    error(`Cannot extract the archive (tar exited ${tar.status}${why ? ': ' + why : ''}).\n` +
      `  Extract it yourself, then install from the unpacked tree:\n\n` +
      `    curl -L -o agents-handoff.tar.gz ${url}\n` +
      `    mkdir -p agents-handoff && tar -xzf agents-handoff.tar.gz -C agents-handoff --strip-components=1\n` +
      `    node agents-handoff/install/install.mjs`);
  }
  return {
    root: unpack,
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
    ref,
    label,
    url,
    sha256: hash,
  };
}

// Resolve install path
function resolveInstallPath(location, customPath) {
  if (customPath) {
    return path.resolve(customPath);
  }
  
  switch (location) {
    case 'global':
      return path.join(resolveGlobalRoot().root, SKILL_NAME);
    case 'local':
      return path.join(PATHS.local, SKILL_NAME);
    case 'project':
      return path.join(PATHS.project, SKILL_NAME);
    default:
      error(`Unknown location: ${location}. Use global, local, or project.`);
  }
}

// ---------------------------------------------------------------- harness targets
// The directories each harness actually reads for personal skills, so an install here needs no
// configuration afterwards. `--project` switches to the per-repository form, which is what a
// harness reads when it is run inside that repository.
//   claude  ~/.claude/skills     Claude Code personal skills     project: ./.claude/skills
//   codex   ~/.codex/skills      Codex CLI personal skills       project: ./.codex/skills
//   agents  ~/.agents/skills     harness-neutral store           project: ./.agents/skills
const HARNESSES = {
  claude: { user: path.join(HOME, '.claude', 'skills'), project: path.join(process.cwd(), '.claude', 'skills') },
  codex: { user: path.join(HOME, '.codex', 'skills'), project: path.join(process.cwd(), '.codex', 'skills') },
  agents: { user: AGENTS_SKILLS, project: path.join(process.cwd(), '.agents', 'skills') },
};

// A harness is DETECTED when its configuration directory exists. Detection is a suggestion,
// never a decision: `--all` installs into the detected ones and says which were skipped, and an
// explicit `--claude` installs there whether or not the directory exists yet.
function harnessDetected(name) {
  const home = { claude: '.claude', codex: '.codex', agents: '.agents' }[name];
  return Boolean(home && fs.existsSync(path.join(HOME, home)));
}

function dirForHarness(name, projectForm) {
  const h = HARNESSES[name];
  if (!h) error(`Unknown harness: ${name}. Known harnesses: ${Object.keys(HARNESSES).join(', ')} (or use --skills-dir <path>)`);
  return projectForm ? h.project : h.user;
}

// Every installation target this run will write to, in the order it will write them.
function resolveTargets() {
  if (!MULTI_TARGET) {
    return [{ label: 'resolved target', dir: null, path: resolveInstallPath(LOCATION, CUSTOM_PATH) }];
  }
  const targets = [];
  const names = HARNESSES_CHOSEN.includes('all')
    ? [...new Set([...HARNESSES_CHOSEN.filter(n => n !== 'all'), ...Object.keys(HARNESSES).filter(harnessDetected)])]
    : [...new Set(HARNESSES_CHOSEN)];
  for (const name of names) {
    if (name === 'all') continue;
    const dir = dirForHarness(name, PROJECT_TARGET);
    targets.push({ label: name + (PROJECT_TARGET ? ' (project)' : ''), harness: name, dir, path: path.join(dir, SKILL_NAME) });
  }
  for (const d of SKILLS_DIRS) {
    if (!d) continue;
    const dir = path.resolve(d);
    targets.push({ label: 'custom dir ' + dir, dir, path: path.join(dir, SKILL_NAME) });
  }
  if (!targets.length) error('no installation targets: pass a harness (--claude, --codex, --agents), --all, or --skills-dir <path>');
  return targets;
}

// `--path X` names ONE installation exactly, and must not be widened into a machine-wide search.
// Discovery is the answer to the BARE verb — "everything on this machine" — so `verify --path
// ./my-copy` failing because some unrelated copy elsewhere is stale was the search leaking into
// an explicit request. `--path` is documented as bypassing the search; this makes it true.
function explicitTarget() {
  if (!CUSTOM_PATH) return null;
  const p = resolveInstallPath(LOCATION, CUSTOM_PATH);
  return { label: 'explicit --path', dir: path.dirname(p), path: p };
}
// The targets a verb acts on: named harnesses/custom dirs if any were given, else the explicit
// `--path` if one was given, else every installation found on this machine.
function targetList() {
  if (MULTI_TARGET) return resolveTargets();
  const one = explicitTarget();
  return one ? [one] : discoverInstalls();
}

// EVERY installation this machine has, not just the resolved one. `update` and `verify` with no
// harness flag act on this list, because "keep my install current" is about the copies that
// exist, not about the one target the resolver happens to pick: a machine can hold the same
// skill in ~/.claude/skills and ~/.agents/skills, and updating only the resolved one is how a
// second harness silently keeps an old engine.
function discoverInstalls() {
  const out = [];
  const seen = new Set();
  const push = (label, dir) => {
    if (!dir) return;
    for (const [name, suffix] of [[SKILL_NAME, ''], [LEGACY_SKILL_NAME, ' — pre-2.0.3 name, updated in place']]) {
      const p = path.join(dir, name);
      if (seen.has(p)) continue;
      seen.add(p);
      if (isInstalled(p)) out.push({ label: label + suffix, dir, path: p });
    }
  };
  const g = resolveGlobalRoot();
  push('global (resolved: ' + g.why + ')', g.root);
  push('local', PATHS.local);
  push('project', PATHS.project);
  for (const name of Object.keys(HARNESSES)) push('harness ' + name, HARNESSES[name].user);
  for (const name of Object.keys(HARNESSES)) push('harness ' + name + ' (project)', HARNESSES[name].project);
  for (const d of accountSkillRoots()) push('account-skill candidate', d);
  push('harness skills home', AGENTS_SKILLS);
  for (const d of SKILLS_DIRS) if (d) push('skills-dir ' + d, path.resolve(d));
  return out;
}

// ---------------------------------------------------------------- install provenance
// What landed, and what it was made from. `verify` re-computes the file-set hash and compares
// it against this record, so an installation can be checked against the tree it was installed
// from instead of against the manifest alone — and an install that came from a tagged archive
// can say WHICH archive, by hash.
const PROVENANCE_FILE = '.agents-handoff-install.json';
const fileSha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// The file-set hash: every manifest path with its own sha256, sorted, folded into one value.
// Paths are part of the hash, so a file moved to another name changes it.
function fileSetHash(installPath) {
  const parts = [];
  for (const f of SKILL_FILES.map(x => x.to).sort()) {
    const abs = path.join(installPath, f);
    parts.push(f + '\u0000' + (fs.existsSync(abs) ? fileSha256(abs) : 'missing'));
  }
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}

// The npm identity this install came from. `verify-package` fills in the hashes on first run
// (they cannot be known while installing from a tree — that is a different artifact from the
// published tarball), and compares against them afterwards, so an install carries its own
// record of the package it should match.
function packageRecord(installPath) {
  const version = getInstalledVersion(installPath) || null;
  return {
    name: NPM_PACKAGE,
    version,
    registry: REGISTRY,
    tarball: version ? `${REGISTRY}/${NPM_PACKAGE}/-/${NPM_PACKAGE}-${version}.tgz` : null,
    sha256: null,
    sha512: null,
    integrity: null,
    shasum: null,
    verified_at: null,
  };
}

function writeProvenance(installPath, info) {
  const record = {
    schema_version: '1.0-install-provenance',
    product: SKILL_NAME,
    version: getInstalledVersion(installPath) || info.version || null,
    installer_version: INSTALLER_VERSION,
    installed_at: new Date().toISOString(),
    harness: info.harness || null,
    target: installPath,
    source: info.source,
    package: packageRecord(installPath),
    file_count: SKILL_FILES.filter(f => fs.existsSync(path.join(installPath, f.to))).length,
    manifest_entries: SKILL_FILES.length,
    files_sha256: fileSetHash(installPath),
    files: Object.fromEntries(SKILL_FILES.map(entry => entry.to).sort().map(rel => [
      rel,
      fs.existsSync(path.join(installPath, rel)) ? fileSha256(path.join(installPath, rel)) : 'missing',
    ])),
  };
  fs.writeFileSync(path.join(installPath, PROVENANCE_FILE), JSON.stringify(record, null, 2) + '\n');
  return record;
}

function readProvenance(installPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(installPath, PROVENANCE_FILE), 'utf8'));
  } catch { return null; }
}

// Compare an installation with its own record. Returns the verdict; the caller decides whether
// a missing record is a failure (it is not: installations predating this feature have none).
function checkProvenance(installPath) {
  const record = readProvenance(installPath);
  if (!record) return { present: false };
  const actual = fileSetHash(installPath);
  const changed = [];
  for (const [rel, want] of Object.entries(record.files || {})) {
    const abs = path.join(installPath, rel);
    const have = fs.existsSync(abs) ? fileSha256(abs) : 'missing';
    if (have !== want) changed.push(rel + ' (' + (have === 'missing' ? 'missing' : 'changed') + ')');
  }
  return { present: true, record, match: actual === record.files_sha256, actual, changed };
}

function describeSource(source) {
  if (!source) return 'unrecorded';
  if (source.kind === 'tree') return 'the tree beside the installer (' + (source.path || 'checkout') + ')';
  return (source.ref || 'archive') + (source.archive_sha256 ? ' archive sha256 ' + source.archive_sha256.slice(0, 16) + '…' : '');
}

// Check if installed
function isInstalled(installPath) {
  return fs.existsSync(path.join(installPath, 'SKILL.md'));
}

// Get installed version
function getInstalledVersion(installPath) {
  try {
    const skillMd = fs.readFileSync(path.join(installPath, 'SKILL.md'), 'utf8');
    const match = skillMd.match(/^version:\s*(\S+)/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// Download file from URL (using fetch if available, fallback to curl/wget)
async function downloadFile(url, destPath) {
  // Try native fetch first (Node 18+)
  if (typeof fetch !== 'undefined') {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(destPath, buffer);
      return buffer;
    } catch (e) {
      if (e.message.includes('HTTP 404')) throw e;
      // Fall through to curl/wget
    }
  }
  
  // Fallback to curl or wget
  const curl = spawnSync('curl', ['-L', '-o', destPath, url], { encoding: 'utf8' });
  if (curl.status === 0) {
    return fs.readFileSync(destPath);
  }
  
  const wget = spawnSync('wget', ['-O', destPath, url], { encoding: 'utf8' });
  if (wget.status === 0) {
    return fs.readFileSync(destPath);
  }
  
  throw new Error(`Failed to download from ${url}. Neither fetch, curl, nor wget available.`);
}

// The zip path a release used to ship (agent-handoff-<tag>.zip, named after the repository) is
// gone: releases attach that zip for humans, and every automated path uses the tag tarball,
// which is what an install records when it fetches instead of copying.

// Install into every target this run selected: one harness, several at once, or the historical
// single target. Each target gets its own copy and its own provenance record, so one run can
// cover Claude Code and Codex without installing twice.
async function install(location, customPath, version, force) {
  const targets = resolveTargets();
  const results = [];
  for (const [i, target] of targets.entries()) {
    if (targets.length > 1) log(`\n${C('bold', '── target ' + (i + 1) + ' of ' + targets.length + ': ' + target.label + ' ──')}`);
    results.push(await installTarget(target, version, force));
  }
  if (targets.length > 1) {
    log(`\n${C('bold', 'Summary')}`);
    for (const r of results) {
      log(`  ${r.skipped ? C('yellow', '–') + ' kept' : C('green', '✓') + ' installed'} ${r.path} — v${r.version}`);
    }
  }
  return results;
}

async function installTarget(target, version, force) {
  const installPath = target.path;
  const alreadyInstalled = isInstalled(installPath);
  const currentVersion = alreadyInstalled ? getInstalledVersion(installPath) : null;
  
  log(`\n${C('bold', 'agents-handoff installer v' + INSTALLER_VERSION)}`);
  log(`Target: ${installPath}` + (target.label && target.label !== 'resolved target' ? `  (${target.label})` : ''));
  if (!MULTI_TARGET && !CUSTOM_PATH && LOCATION === 'global') {
    const g = resolveGlobalRoot();
    log(`Global root: ${g.root} — ${g.why}`);
    // The search is a decision, so the candidates it rejected are shown rather than hidden:
    // a second account (or a stale ~/.agents/skills copy) stays visible.
    for (const other of g.others || []) log(`  not chosen: ${other}`);
  }
  log(`Version: ${version}`);
  
  if (alreadyInstalled) {
    warn(`Already installed (v${currentVersion})`);
    if (!force && version === 'latest') {
      log(`Run with --update to upgrade, or --force to reinstall`);
      return { skipped: true, path: installPath, version: currentVersion };
    }
    if (version !== 'latest' && currentVersion === version) {
      log(`Already at requested version ${version}`);
      return { skipped: true, path: installPath, version };
    }
    log(`Reinstalling...`);
  }
  
  // Check write permission
  try {
    fs.mkdirSync(installPath, { recursive: true });
    const testFile = path.join(installPath, '.install-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
  } catch (e) {
    error(`Cannot write to ${installPath}. Check permissions or choose a different location.`);
  }
  
  // Two ways in, one manifest out. Inside a checkout or a release archive the skill files sit
  // beside install/ and are copied. From the published package there is no tree to copy —
  // install/ IS the package — so the archive for the requested version is fetched and
  // unpacked into a throwaway directory, and the same manifest copies out of it.
  let sourceRoot = SOURCE_DIR;
  let cleanup = null;
  // What this install is made from, recorded so `verify` can say more than "the files are here".
  let sourceInfo = { kind: 'tree', path: path.relative(process.cwd(), SOURCE_DIR) || '.' };
  // `--version` has to mean something. The tree beside the installer wins only when it IS the
  // requested version (or when nothing was requested); asking for another version fetches that
  // version's archive instead of quietly installing the tree in front of it.
  const treeVersion = haveSourceTree() ? getInstalledVersion(SOURCE_DIR) : null;
  const wantsOtherVersion = version !== 'latest' && treeVersion && treeVersion !== version;
  if (haveSourceTree() && !wantsOtherVersion) {
    log(`\nInstalling from the tree beside the installer...`);
  } else {
    if (wantsOtherVersion) {
      log(`\nRequested v${version}; the tree beside the installer is v${treeVersion}, so the v${version} archive is fetched.`);
    }
    const fetched = await fetchAndUnpack(version);
    sourceRoot = fetched.root;
    cleanup = fetched.cleanup;   // removed after the manifest has read out of it
    sourceInfo = {
      kind: 'archive',
      ref: fetched.ref,
      label: fetched.label,
      archive_url: fetched.url,
      archive_sha256: fetched.sha256,
    };
  }

  // Create directories
  fs.mkdirSync(installPath, { recursive: true });
  for (const subdir of ['tools/lib', 'docs', 'refs', 'templates', 'schemas', 'tests/acceptance', 'tests/fixtures']) {
    fs.mkdirSync(path.join(installPath, subdir), { recursive: true });
  }

  const { copied } = copyManifest(sourceRoot, installPath);

  // The manifest is the completion criterion, so a short install fails here instead of reporting
  // success. This is the check that was missing when the installer looked for its guides under a
  // path that only exists in the development tree: it warned fourteen times and installed a copy
  // with no README, no LICENSE and no docs/ at all.
  //
  // Two different things look the same here, and conflating them was a bug: a file the SOURCE
  // does not have (pinning an older version legitimately has fewer files) and a file the source
  // HAS but that did not land (a broken copy). The first is reported, the second fails.
  const missing = SKILL_FILES.filter(f => !fs.existsSync(path.join(installPath, f.to)));
  if (missing.length) {
    const absentFromSource = missing.filter(f => !resolveSource(sourceRoot, f.from));
    const notCopied = missing.filter(f => resolveSource(sourceRoot, f.from));
    if (absentFromSource.length) {
      warn(`${absentFromSource.length} file(s) are not part of this version: ` +
        absentFromSource.map(f => f.to).join(', '));
    }
    if (notCopied.length) {
      error(`Incomplete install: ${notCopied.length} of ${SKILL_FILES.length} file(s) missing — ` +
        notCopied.map(f => f.to).join(', '));
    }
  }
  if (cleanup) cleanup();
  
  // Create package.json if not exists. An installed copy is a skill, not a package: it carries
  // no `files` allowlist and no bin, so `npm publish` run inside one would ship whatever happens
  // to be in the directory — including a handoff store. `private` makes npm refuse there with
  // EPRIVATE before it authenticates (verified); `npm pack` still packs the directory, so the
  // flag is a guard against publishing, not a sandbox. The publishable manifest is the
  // repository root's, which is the package users npx.
  const pkgPath = path.join(installPath, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: SKILL_NAME,
      version: version === 'latest' ? SKILL_VERSION : version,
      description: 'Cross-harness session handoff engine (installed copy — not a publishable package; the npm package is agents-handoff)',
      private: true,
      type: 'module'
    }, null, 2));
  }
  
  // The version reported is the one that landed, read back out of the installed SKILL.md —
  // not the requested string, and not a constant that a release has to remember to bump.
  const installedVersion = getInstalledVersion(installPath) || (version === 'latest' ? SKILL_VERSION : version);

  // Record what was installed and what it was made from. `verify` re-hashes the same file set
  // and compares, which is what makes an installation checkable rather than merely present.
  const record = writeProvenance(installPath, { version: installedVersion, harness: target.harness, source: sourceInfo });
  success(`Installed ${SKILL_NAME} v${installedVersion} to ${installPath}`);
  log(`Copied ${copied} files`);
  log(`Provenance: ${describeSource(sourceInfo)} · file-set sha256 ${record.files_sha256.slice(0, 16)}…  (${PROVENANCE_FILE})`);
  // `config` is a real verb that exits 0 and prints the resolved root. `--help` is not a verb
  // (it exits 2), so the old hint told every user to run a failing command.
  log(`\nRun with: node ${path.join(installPath, 'tools', 'handoff.mjs')} config`);

  return { installed: true, path: installPath, version: installedVersion };
}

// Update skill.
//
// With a harness flag (`--update --claude`) the update is scoped to that target. With NO target
// flag it updates EVERY installation this machine has, which is the question the bare verb is
// actually asking: a machine that holds agents-handoff in ~/.claude/skills and in ~/.agents/skills
// has two copies, and updating only the resolved one leaves the other silently stale.
//
// An update copies the manifest and nothing else, so a store (projects/, handoffs/,
// .agent-handoff/) and handoff.config.json are never touched.
async function update(location, customPath, version) {
  if (MULTI_TARGET) return install(location, customPath, version, true);

  const found = discoverInstalls();
  if (!found.length) {
    error('Nothing to update: no agents-handoff installation found.\n' +
      '  Install one with: npx agents-handoff --all\n' +
      '  Or name a target: --claude, --codex, --agents, --all, --skills-dir <dir>, --path <dir>');
  }

  log(`\n${C('bold', 'agents-handoff updater v' + INSTALLER_VERSION)}`);
  log(`Updating ${found.length} installation(s) to ${version === 'latest' ? 'the latest version' : 'v' + version}`);
  for (const f of found) log(`  · ${f.label}: ${f.path}`);

  const results = [];
  for (const target of found) {
    const before = getInstalledVersion(target.path);
    const r = await installTarget(
      { label: target.label, dir: target.dir, path: target.path },
      version,
      true,
    );
    results.push({ ...r, before });
  }

  log(`\n${C('bold', 'Update summary')}`);
  for (const r of results) {
    log(`  ${r.skipped ? C('yellow', '–') + ' unchanged' : C('green', '✓') + ' updated'} ${r.path} — ${r.before} → v${r.version}`);
  }
  const changed = results.filter((r) => !r.skipped).length;
  success(changed
    ? `${changed} of ${results.length} installation(s) updated`
    : `already current — ${results.length} installation(s) at v${results[0] && results[0].version}`);
  return results;
}

// Remove skill
function remove(location, customPath, force) {
  const installPath = resolveInstallPath(location, customPath);
  
  if (!isInstalled(installPath)) {
    warn(`Not installed at ${installPath}`);
    return { removed: false };
  }
  
  if (!force) {
    log(`\nThis will remove ${SKILL_NAME} from:`);
    log(`  ${installPath}`);
    log(`\nYour handoffs and anything else you put in this directory will NOT be deleted.`);
    log(`Configuration (handoff.config.json) will NOT be deleted.`);
    log(`Only what the install manifest owns is removed, and what is kept is listed at the end.`);
    log(`\nContinue? (y/N)`);
    
    // In non-interactive mode, default to no
    if (!process.stdin.isTTY) {
      warn(`Non-interactive mode, use --force to skip confirmation`);
      return { removed: false };
    }
    
    // Simple readline for confirmation
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    return new Promise((resolve) => {
      rl.question('', (answer) => {
        rl.close();
        if (answer.toLowerCase() !== 'y') {
          log('Cancelled');
          resolve({ removed: false });
          return;
        }
        doRemove(installPath, force);
        resolve({ removed: true, path: installPath });
      });
    });
  }
  
  return doRemove(installPath, force);
}

function doRemove(installPath, force) {  log(`\nRemoving from ${installPath}...`);

  // WHAT AN INSTALL OWNS IS THE MANIFEST. Everything else in the directory belongs to the user,
  // so the rule below is a removal set, not a keep list: a keep list removes whatever nobody
  // remembered to name, which is how a store called anything other than the three expected
  // directories would have been deleted by `remove --force`. Store directories, notes, config
  // and anything a future version writes as user data therefore survive by default.
  const owned = new Set(SKILL_FILES.map((f) => f.to.split('/')[0]));
  const KEPT_FILES = new Set(['handoff.config.json', '.env.example']);

  let entries;
  try {
    entries = fs.readdirSync(installPath, { withFileTypes: true });
  } catch {
    entries = [];
  }

  const kept = [];
  for (const entry of entries) {
    const entryPath = path.join(installPath, entry.name);
    const isOwned = owned.has(entry.name) && !KEPT_FILES.has(entry.name);
    if (!isOwned) {
      kept.push(entry.name + (entry.isDirectory() ? '/' : ''));
      continue;
    }
    if (entry.isDirectory()) {
      fs.rmSync(entryPath, { recursive: true, force: true });
      log(`Removed directory: ${entry.name}/`);
    } else {
      fs.unlinkSync(entryPath);
      log(`Removed file: ${entry.name}`);
    }
  }

  // The installer's own record, and the private package.json stub it writes. The stub is only
  // removed when it is still the stub — a package.json a user has edited is theirs.
  try {
    fs.unlinkSync(path.join(installPath, PROVENANCE_FILE));
    log(`Removed file: ${PROVENANCE_FILE}`);
  } catch { /* none written */ }
  let stubRemoved = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(installPath, 'package.json'), 'utf8'));
    if (pkg.private === true && pkg.name === SKILL_NAME) {
      fs.unlinkSync(path.join(installPath, 'package.json'));
      stubRemoved = true;
      log('Removed file: package.json (installer stub)');
    } else {
      kept.push('package.json (yours — kept)');
    }
  } catch { /* no package.json, or not JSON: leave it */ }

  const survivors = kept
    .filter((k) => k !== PROVENANCE_FILE && !(k === 'package.json' && stubRemoved))
    .sort();
  if (survivors.length) {
    log(`\nKept — not the installer's to delete:`);
    for (const k of survivors) log(`  ${k}`);
  }
  
  
  // Try to remove install directory if empty
  try {
    if (fs.readdirSync(installPath).length === 0) {
      fs.rmdirSync(installPath);
      log(`Removed empty install directory: ${installPath}`);
    }
  } catch {}
  
  success(`Removed ${SKILL_NAME} from ${installPath}`);
  return { removed: true, path: installPath };
}

// Verify every target this run selected. One harness behaves exactly as before; several are
// verified in turn, and the run fails if any of them fails. With no target flag, every
// installation found on the machine is verified — the same list `update` acts on, so
// "update everything" and "verify everything" cannot disagree about what exists.
function verify(location, customPath) {
  const targets = targetList();
  if (!targets.length) {
    error('Nothing to verify: no agents-handoff installation found.\n' +
      '  Install one with: npx agents-handoff --all');
  }
  if (targets.length > 1) log(`\n${C('bold', 'Verifying ' + targets.length + ' installation(s)')}`);
  let ok = true;
  for (const target of targets) {
    const r = verifyOne(target, PROVENANCE);
    if (!r.valid) ok = false;
  }
  if (!ok) error('Verification failed. Try reinstalling.');
  return { valid: true };
}

// ----------------------------------------------------------- verify against the package
// The strongest check this installer can make: does the copy on disk match the tarball npm is
// actually serving for its version? Everything else compares an installation with itself, or
// with the tree it came from. This compares it with the published artifact, and it works
// whichever way the install happened — tree, GitHub archive, or `npx`.
//
// Three things are checked, in this order, because each one makes the next meaningful:
//   1. the tarball we downloaded matches the hashes the REGISTRY declares for that version
//      (otherwise "the published package" is whatever this network handed us)
//   2. the tarball's manifest file set hashes to the same value as the installed file set
//      (per-file differences are named)
//   3. if the install record already holds a package sha256, it matches too
async function registryMeta(version) {
  if (typeof fetch === 'undefined') return null;
  try {
    const res = await fetch(`${REGISTRY}/${NPM_PACKAGE}/${encodeURIComponent(version)}`, {
      headers: { accept: 'application/json', 'user-agent': NPM_PACKAGE },
    });
    if (!res.ok) return null;
    const j = await res.json();
    return {
      tarball: (j.dist && j.dist.tarball) || null,
      integrity: (j.dist && j.dist.integrity) || null,
      shasum: (j.dist && j.dist.shasum) || null,
    };
  } catch { return null; }
}

function recordPackageVerification(installPath, actual, meta) {
  const prov = readProvenance(installPath);
  if (!prov) {
    warn('no install record to update — reinstall to create one');
    return false;
  }
  prov.package = {
    ...packageRecord(installPath),
    ...(prov.package || {}),
    tarball: meta.tarball,
    integrity: meta.integrity || null,
    shasum: meta.shasum || null,
    sha256: actual.sha256,
    sha512: actual.sha512,
    verified_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(installPath, PROVENANCE_FILE), JSON.stringify(prov, null, 2) + '\n');
  return true;
}

async function verifyPackageOne(target) {
  const installPath = target.path;
  const version = getInstalledVersion(installPath);
  console.log(`\n${C('bold', 'Verifying ' + NPM_PACKAGE + '@' + (version || '?') + ' against the published tarball')}`);
  console.log(`Install: ${installPath}`);
  if (!isInstalled(installPath)) {
    console.error(`  ${C('red', '✗')} not installed at ${installPath}`);
    return false;
  }
  if (!version) {
    console.error(`  ${C('red', '✗')} SKILL.md carries no version — nothing to look up`);
    return false;
  }

  const meta = await registryMeta(version);
  if (!meta || !meta.tarball) {
    console.error(`  ${C('red', '✗')} ${NPM_PACKAGE}@${version} is not on the npm registry, or the registry is unreachable`);
    console.error('    the installation itself is untouched by this result — this check needs the network');
    return false;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-handoff-npm-'));
  try {
    const tgz = path.join(tmp, 'package.tgz');
    await downloadFile(meta.tarball, tgz);
    const bytes = fs.readFileSync(tgz);
    const actual = {
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      sha512: crypto.createHash('sha512').update(bytes).digest('hex'),
      sha1: crypto.createHash('sha1').update(bytes).digest('hex'),
    };

    const checks = [];
    if (meta.integrity) {
      checks.push({
        name: 'tarball matches the registry integrity (' + meta.integrity.slice(0, 20) + '…)',
        passed: meta.integrity === 'sha512-' + Buffer.from(actual.sha512, 'hex').toString('base64'),
      });
    }
    if (meta.shasum) {
      checks.push({
        name: 'tarball matches the registry shasum (' + meta.shasum.slice(0, 12) + '…)',
        passed: meta.shasum === actual.sha1,
      });
    }

    const unpack = path.join(tmp, 'unpack');
    fs.mkdirSync(unpack, { recursive: true });
    const tar = spawnSync('tar', ['-xzf', 'package.tgz', '-C', 'unpack', '--strip-components=1'],
      { cwd: tmp, encoding: 'utf8' });
    if (tar.status !== 0) {
      console.error(`  ${C('red', '✗')} cannot extract the published tarball (tar exited ${tar.status})`);
      return false;
    }

    const differing = [];
    for (const rel of SKILL_FILES.map((f) => f.to).sort()) {
      const inPackage = path.join(unpack, ...rel.split('/'));
      const installed = path.join(installPath, ...rel.split('/'));
      const hPackage = fs.existsSync(inPackage) ? fileSha256(inPackage) : 'missing';
      const hInstalled = fs.existsSync(installed) ? fileSha256(installed) : 'missing';
      if (hPackage !== hInstalled) {
        differing.push(rel + ' (' + (hInstalled === 'missing' ? 'not installed'
          : hPackage === 'missing' ? 'not in the published package' : 'content differs') + ')');
      }
    }
    checks.push({
      name: `all ${SKILL_FILES.length} manifest file(s) are identical to the published tarball`,
      passed: differing.length === 0,
    });
    for (const d of differing.slice(0, 12)) console.error(`      ${d}`);
    if (differing.length > 12) console.error(`      … ${differing.length - 12} more`);

    const prov = readProvenance(installPath);
    const recorded = prov && prov.package ? prov.package : null;
    if (recorded && recorded.sha256) {
      checks.push({
        name: 'tarball sha256 matches the hash recorded for this install',
        passed: recorded.sha256 === actual.sha256,
      });
    } else {
      log(`  ${C('yellow', '·')} no package sha256 recorded for this install${RECORD ? '' : ' — pass --record to store it'}`);
    }

    for (const c of checks) log(`  ${c.passed ? C('green', '✓') : C('red', '✗')} ${c.name}`);
    log(`  package: ${NPM_PACKAGE}@${version}`);
    log(`  tarball: ${meta.tarball}`);
    log(`  sha256:  ${actual.sha256}`);

    if (RECORD) {
      if (recordPackageVerification(installPath, actual, meta)) {
        log(`  recorded in ${PROVENANCE_FILE} (package.sha256 / sha512 / integrity)`);
      }
    }

    const ok = checks.every((c) => c.passed);
    console.log();
    if (ok) {
      success(`Installation matches the published package`);
      return true;
    }
    console.error(`The installation does NOT match agents-handoff@${version} as published`);
    return false;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function verifyPackage() {
  const targets = targetList();
  if (!targets.length) {
    error('Nothing to verify: no agents-handoff installation found.\n' +
      '  Install one with: npx agents-handoff --all');
  }
  let ok = true;
  for (const target of targets) {
    if (!(await verifyPackageOne(target))) ok = false;
  }
  if (!ok) error('Package verification failed.');
  return { valid: true };
}

function verifyOne(target, showProvenance) {
  const installPath = target.path;
  
  console.log(`\n${C('bold', 'Verifying agents-handoff installation...')}`);
  console.log(`Location: ${installPath}`);
  if (!MULTI_TARGET && !CUSTOM_PATH && LOCATION === 'global') console.log(`Global root: ${resolveGlobalRoot().root}`);
  console.log();
  
  if (!isInstalled(installPath)) {
    error(`Not installed at ${installPath}`);
  }
  
  const checks = [];
  let allPassed = true;

  // What this installation is supposed to contain: the manifest, minus the entries its own
  // install record marks absent because that version never had them. Pinning an older version
  // is legitimate, so an expected absence is reported as such rather than failed — the same
  // distinction the install path makes.
  const prov = checkProvenance(installPath);
  const expectedAbsent = new Set(prov.present
    ? Object.entries(prov.record.files || {}).filter(([, v]) => v === 'missing').map(([k]) => k)
    : []);

  for (const file of SKILL_FILES.map(f => f.to)) {
    if (expectedAbsent.has(file)) {
      checks.push({ name: `File: ${file} (not part of v${prov.record.version})`, passed: true });
      continue;
    }
    const exists = fs.existsSync(path.join(installPath, file));
    checks.push({ name: `File: ${file}`, passed: exists });
    if (!exists) allPassed = false;
  }
  
  // Check SKILL.md has version
  try {
    const skillMd = fs.readFileSync(path.join(installPath, 'SKILL.md'), 'utf8');
    const hasVersion = /^version:/m.test(skillMd);
    const hasName = /^name:/m.test(skillMd);
    checks.push({ name: 'SKILL.md: has version', passed: hasVersion });
    checks.push({ name: 'SKILL.md: has name', passed: hasName });
    if (!hasVersion || !hasName) allPassed = false;
  } catch {
    checks.push({ name: 'SKILL.md: readable', passed: false });
    allPassed = false;
  }
  
  // Check the tools actually run. `--help` is NOT a verb of the engine (it exits 2 and
  // prints usage to stderr), so the previous probe reported EVERY correct installation as
  // broken. `config` exits 0 and prints a stable marker, and it exercises the engine's
  // import graph - including tools/lib/handoff-root.mjs - so a missing module fails here.
  try {
    const handoffPath = path.join(installPath, 'tools', 'handoff.mjs');
    const result = spawnSync(process.execPath, [handoffPath, 'config'], { cwd: installPath, encoding: 'utf8' });
    const isRunnable = result.status === 0 && String(result.stdout).includes('handoff: config root=');
    checks.push({ name: 'handoff.mjs config: exits 0 with the resolved-root marker', passed: isRunnable });
    if (!isRunnable) {
      console.error(String(result.stderr || '').trim().slice(0, 400));
      allPassed = false;
    }
  } catch {
    checks.push({ name: 'handoff.mjs config: runs', passed: false });
    allPassed = false;
  }
  
  // Print results
  for (const check of checks) {
    log(`  ${check.passed ? C('green', '✓') : C('red', '✗')} ${check.name}`);
  }
  
  // Provenance: compare the installation with the record written when it was installed. An
  // installation without a record is NOT a failure — it predates this feature — so that case is
  // reported and skipped, never silently passed.
  if (prov.present) {
    checks.push({ name: 'provenance: file-set sha256 matches the install record', passed: prov.match });
    if (!prov.match) {
      allPassed = false;
      for (const c of prov.changed) console.error(`      ${c}`);
    }
    if (showProvenance) {
      log(`  provenance record`);
      log(`    installed_at: ${prov.record.installed_at}`);
      log(`    source: ${describeSource(prov.record.source)}`);
      log(`    harness: ${prov.record.harness || '(resolved target)'}`);
      log(`    files: ${prov.record.file_count} · file-set sha256 ${prov.record.files_sha256}`);
    }
  } else {
    log(`  ${C('yellow', '·')} no provenance record — installed before 2.0.3; reinstall to record one`);
  }

  console.log();
  if (allPassed) {
    success(`Installation verified ✓`);
    log(`Location: ${installPath}`);
    log(`Version: ${getInstalledVersion(installPath) || 'unknown'}`);
    return { valid: true, path: installPath };
  }
  console.error(`Verification failed for ${installPath}`);
  return { valid: false, path: installPath };
}

// List installations
function listInstallations() {
  console.log(`\n${C('bold', 'Installed agents-handoff locations')}\n`);
  
  const g = resolveGlobalRoot();
  const locations = [
    // The resolved global root first: this is the one `install` and `verify` use.
    { name: 'Global (resolved — ' + g.why + ')', root: g.root },
    { name: 'Local (cwd/local/skills)', root: PATHS.local },
  ];
  // Every harness this installer knows about, present on this machine or not, so a missing
  // install is visible as "not there" instead of invisible.
  for (const name of Object.keys(HARNESSES)) {
    locations.push({ name: `Harness ${name}${harnessDetected(name) ? '' : ' (not detected)'}`, root: HARNESSES[name].user });
    locations.push({ name: `Harness ${name} (project form)`, root: HARNESSES[name].project });
  }
  // Every other candidate root is listed too, so a second account or a stale
  // ~/.agents/skills copy is VISIBLE rather than silently ignored.
  for (const d of accountSkillRoots()) locations.push({ name: 'account-skill candidate', root: d });
  locations.push({ name: 'Harness skills home', root: AGENTS_SKILLS });
  if (fs.existsSync(path.join(process.cwd(), '.git'))) {
    locations.push({ name: 'Project-local (cwd/skills)', root: PATHS.project });
  }
  
  let foundAny = false;
  const seen = new Set();
  
  const candidates = [];
  for (const loc of locations) {
    candidates.push({ name: loc.name, skillPath: path.join(loc.root, SKILL_NAME) });
    // A copy installed before the rename is listed too — under the name it actually has, so a
    // stale `agent-handoff/` is visible rather than silently absent from `list`.
    candidates.push({ name: loc.name + ' (pre-2.0.3 name)', skillPath: path.join(loc.root, LEGACY_SKILL_NAME) });
  }

  for (const cand of candidates) {
    const skillPath = cand.skillPath;
    if (seen.has(skillPath)) continue;
    seen.add(skillPath);
    if (isInstalled(skillPath)) {
      const loc = { name: cand.name };
      foundAny = true;
      const version = getInstalledVersion(skillPath) || 'unknown';
      log(`${C('green', '✓')} ${loc.name}`);
      log(`  Path: ${skillPath}`);
      log(`  Version: ${version}`);
      log(`  Files from the manifest: ${SKILL_FILES.filter(f => fs.existsSync(path.join(skillPath, f.to))).length}/${SKILL_FILES.length}`);
      const prov = checkProvenance(skillPath);
      log(`  Provenance: ${prov.present
        ? (prov.match ? 'matches the install record' : 'MISMATCH — ' + prov.changed.join(', '))
        : 'none recorded'}`);
      log();
    }
  }
  
  if (!foundAny) {
    log(`${C('yellow', 'No installations found.')}`);
    log(`Install with: npx agents-handoff`);
  }
  
  return foundAny;
}

// Where `--location global` would land, and why — the same answer install/verify/update use.
function printGlobalResolution() {
  const g = resolveGlobalRoot();
  log(`\nGlobal install root: ${g.root}`);
  log(`  chosen because: ${g.why}`);
  for (const other of g.others || []) log(`  also holds an install: ${other}`);
  log(`  override with: AGENT_HANDOFF_GLOBAL_DIR=<dir> or --path <dir>`);
  return g;
}

// `doctor` answers the whole question in one shot: which harnesses exist here, what is
// installed where, whether each installation still matches the record written when it was
// installed, and where the engine will keep handoffs. It reads and reports; it never installs.
function doctor() {
  console.log(`\n${C('bold', 'agents-handoff doctor')}`);
  console.log(`  product v${SKILL_VERSION} · installer v${INSTALLER_VERSION} · node ${process.version}`);
  console.log(`\n${C('bold', 'Harnesses')}`);
  let installed = 0;
  for (const name of Object.keys(HARNESSES)) {
    const dir = HARNESSES[name].user;
    const target = path.join(dir, SKILL_NAME);
    const present = harnessDetected(name);
    const here = isInstalled(target);
    if (here) installed += 1;
    console.log(`  ${present ? C('green', '✓') : C('yellow', '·')} ${name.padEnd(7)} ${present ? 'present' : 'not found'}  ${dir}`);
    if (!here) continue;
    const prov = checkProvenance(target);
    const files = SKILL_FILES.filter(f => fs.existsSync(path.join(target, f.to))).length;
    console.log(`      v${getInstalledVersion(target) || '?'} · ${files}/${SKILL_FILES.length} files · ` +
      (prov.present
        ? (prov.match ? 'provenance OK' : C('red', 'PROVENANCE MISMATCH') + ' (' + prov.changed.length + ' file(s))')
        : 'no provenance record'));
  }
  const g = resolveGlobalRoot();
  console.log(`\n${C('bold', 'Global resolution')}`);
  console.log(`  ${g.root} — ${g.why}`);
  for (const other of g.others || []) console.log(`  also holds an install: ${other}`);
  console.log(`\n${C('bold', 'Store (where handoffs are written)')}`);
  if (haveSourceTree()) {
    const r = spawnSync(process.execPath, [path.join(SOURCE_DIR, 'tools', 'handoff.mjs'), 'config'], { encoding: 'utf8' });
    for (const line of String(r.stdout || '').trim().split('\n')) console.log('  ' + line);
  } else {
    console.log(`  ask an installed engine: node <install>${path.sep}tools${path.sep}handoff.mjs config`);
  }
  console.log(`\n${C('bold', 'Verdict')}`);
  console.log(installed
    ? `  ${installed} harness installation(s) found.`
    : '  nothing installed yet — run: npx agents-handoff --all');
  log('');
  return installed;
}

// Main
async function main() {
  try {
    switch (COMMAND) {
      case 'install':
      case 'i':
        await install(LOCATION, CUSTOM_PATH, VERSION, FORCE);
        break;
        
      case 'update':
      case 'u':
        await update(LOCATION, CUSTOM_PATH, VERSION);
        break;
        
      case 'remove':
      case 'rm':
        await remove(LOCATION, CUSTOM_PATH, FORCE);
        break;
        
      case 'verify':
      case 'v':
        await verify(LOCATION, CUSTOM_PATH);
        break;

      case 'verify-package':
      case 'vp':
        await verifyPackage();
        break;

      case 'list':
      case 'ls':
        listInstallations();
        break;

      case 'where':
        printGlobalResolution();
        break;

      case 'doctor':
      case 'doc':
        doctor();
        break;
        
      case '--help':
      case '-h':
      case 'help':
        showHelp();
        break;
        
      default:
        error(`Unknown command: ${COMMAND}. Use install, update, remove, verify, or list.`);
    }
  } catch (e) {
    // An unexpected failure prints its stack when AGENTS_HANDOFF_DEBUG is set, because a bare
    // message is not enough to repair one; the message alone stays the default so the normal
    // output stays readable.
    if (process.env.AGENTS_HANDOFF_DEBUG) console.error(e.stack || e);
    error(`Error: ${e.message}`);
  }
}

function showHelp() {
  console.log(`
${C('bold', 'agents-handoff')} - Install assistant for agents-handoff skill

${C('bold', 'Usage:')}
  npx agents-handoff <command> [options]

${C('bold', 'Commands:')}
  install, i          Install the skill (default)
  update, u           Update to the latest (or a named) version. With no harness flag it
                      updates EVERY installation found on this machine
  remove, rm          Remove the installation; your store and config are never deleted
  verify, v           Verify integrity against the install record. With no harness flag it
                      verifies every installation found
  verify-package, vp  Verify the installation against the tarball npm actually serves,
                      including the registry's own hashes
  list, ls            List all installed locations
  where               Show the resolved global root and why it was chosen
  doctor              Which harnesses exist here, what is installed, and whether it still matches

${C('bold', 'Harness targets (install into the one you use, or several at once):')}
  --claude        Claude Code      ~/.claude/skills
  --codex         Codex CLI        ~/.codex/skills
  --agents        neutral store    ~/.agents/skills
  --harness H     named harness(es), comma separated; repeatable
  --all           every harness whose directory exists on this machine
  --skills-dir D  any other stack, exactly; repeatable
  --project       use the per-repository form (./.claude/skills, ./.codex/skills)

${C('bold', 'Options:')}
  --location L    Install location: global (default), local, project
  --path P        Custom installation path
  --version V     Version to install: latest (default) or specific version
  --force, -f     Skip confirmations, overwrite existing
  --provenance    With verify: print the install record it was checked against
  --record        With verify-package: store the tarball hashes in the install record

${C('bold', 'Examples:')}
  npx agents-handoff --all               # every harness found here, one run
  npx agents-handoff --claude --codex    # exactly these two
  npx agents-handoff --project --claude  # this repository, for Claude Code
  npx agents-handoff --skills-dir ~/.config/mytool/skills
  npx agents-handoff --doctor            # what is here, and is it intact
  npx agents-handoff --verify --provenance
  npx agents-handoff --verify-package --record   # prove the install matches the npm tarball
  npx agents-handoff --update            # every installation on this machine, one run

${C('bold', 'Locations:')}
  global   resolved, not hard-coded: an account-skill root that already holds
           agents-handoff, else ~/.agents/skills, else any account-skill store found on this
           machine, else ~/.agents/skills (created on install). A store holds the skill two
           id levels below it — <store>/<account-id>/<profile-id>/agents-handoff/ — so the
           store itself is not an install target.
           Override with AGENT_HANDOFF_GLOBAL_DIR, or target an exact path with --path.
           See it resolved: npx agents-handoff where
  local    ./local/skills/agents-handoff
  project  ./skills/agents-handoff (only if in a git repo)

${C('bold', 'Repository:')}
  https://github.com/${REPO_OWNER}/${REPO_NAME}
`);
}

main();
