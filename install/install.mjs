#!/usr/bin/env node
// agents-handoff - npx installer for the agent-handoff skill
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
const SKILL_NAME = 'agent-handoff';
const REPO_OWNER = 'Alot1z';
const REPO_NAME = 'agent-handoff';
const RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download`;
const TARBALL_URL = `https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz`;
const API_LATEST = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

// THE VERSION THIS INSTALLER SHIPS. SKILL.md owns it: the same frontmatter that `verify` and
// `list` read back out of an installed copy. The literal below is only the fallback for the
// run that has no tree beside it — the published package fetching an archive — and the suite
// asserts it against SKILL.md, so a release that bumps one cannot leave the other behind.
const FALLBACK_SKILL_VERSION = '2.0.2';
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
//     <store>/<account-id>/<profile-id>/agent-handoff/
//
// No client is named here. A store is DISCOVERED by looking for `account-skills` directories
// under the platform's application-data roots, so a client that is absent from this machine
// simply contributes no candidate. These are candidates to search, never a decision:
// `resolveGlobalRoot` picks one and says why. `AGENT_HANDOFF_GLOBAL_DIR` overrides the
// search; `--path` bypasses it.
const DATA_ROOTS = (process.platform === 'win32'
  ? [process.env.APPDATA, process.env.LOCALAPPDATA, path.join(HOME, 'AppData', 'Roaming')]
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

// Every directory that could be the PARENT of a global agent-handoff/, from every account
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
//   2. an account-skill root that ALREADY holds agent-handoff (newest install first)
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
  '--verify': 'verify', '--list': 'list', '--help': 'help', '-h': 'help'
};
const COMMAND = FLAG_COMMANDS[args[0]] || (args[0] && !args[0].startsWith('-') ? args[0] : 'install');
const LOCATION = getArg('--location', 'global');
const CUSTOM_PATH = getArg('--path');
const VERSION = getArg('--version', 'latest');
const FORCE = hasFlag('--force') || hasFlag('-f');

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
  return copied;
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-handoff-fetch-'));
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
  const tarball = path.join(tmp, 'agent-handoff.tar.gz');
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
  const tar = spawnSync('tar', ['-xzf', 'agent-handoff.tar.gz', '-C', 'unpack', '--strip-components=1'],
    { cwd: tmp, encoding: 'utf8' });
  if (tar.status !== 0) {
    const why = String(tar.stderr || '').trim().split('\n')[0];
    error(`Cannot extract the archive (tar exited ${tar.status}${why ? ': ' + why : ''}).\n` +
      `  Extract it yourself, then install from the unpacked tree:\n\n` +
      `    curl -L -o agent-handoff.tar.gz ${url}\n` +
      `    mkdir -p agent-handoff && tar -xzf agent-handoff.tar.gz -C agent-handoff --strip-components=1\n` +
      `    node agent-handoff/install/install.mjs`);
  }
  return { root: unpack, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
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

// Download and verify package
async function downloadAndVerify(installPath, version) {
  const isLatest = version === 'latest';
  const zipName = isLatest ? `${SKILL_NAME}-latest.zip` : `${SKILL_NAME}-v${version}.zip`;
  const zipUrl = isLatest 
    ? `${RELEASES_URL}/latest/${zipName}`
    : `${RELEASES_URL}/v${version}/${zipName}`;
  const zipPath = path.join(installPath, zipName);
  
  log(`Downloading ${SKILL_NAME} v${version}...`);
  
  try {
    const data = await downloadFile(zipUrl, zipPath);
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    log(`Downloaded: ${hash.slice(0, 16)}...`);
    return { zipPath, hash, zipUrl };
  } catch (e) {
    if (e.message.includes('HTTP 404') || e.message.includes('404')) {
      error(`Version ${version} not found. Available versions: Check ${RELEASES_URL}`);
    }
    throw e;
  }
}

// Extract zip (using unzip or native)
function extractZip(zipPath, destDir) {
  // Try unzip first
  const unzip = spawnSync('unzip', ['-o', zipPath, '-d', destDir], { encoding: 'utf8' });
  if (unzip.status === 0) {
    return true;
  }
  
  // Fallback: Node.js doesn't have native unzip, suggest installing unzip
  error(`Cannot extract zip. Please install 'unzip' or use a different method:
  
  # Download manually
  curl -L -o ${SKILL_NAME}.zip ${zipPath.replace(/\\/g, '\\\\')}
  unzip ${SKILL_NAME}.zip -d ${destDir}
  
  Or download from: ${RELEASES_URL}`);
}

// Install skill to path
async function install(location, customPath, version, force) {
  const installPath = resolveInstallPath(location, customPath);
  const alreadyInstalled = isInstalled(installPath);
  const currentVersion = alreadyInstalled ? getInstalledVersion(installPath) : null;
  
  log(`\n${C('bold', 'agent-handoff installer v' + INSTALLER_VERSION)}`);
  log(`Target: ${installPath}`);
  if (!customPath && location === 'global') {
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
  if (haveSourceTree()) {
    log(`\nInstalling from the tree beside the installer...`);
  } else {
    const fetched = await fetchAndUnpack(version);
    sourceRoot = fetched.root;
    cleanup = fetched.cleanup;   // removed after the manifest has read out of it
  }

  // Create directories
  fs.mkdirSync(installPath, { recursive: true });
  for (const subdir of ['tools/lib', 'docs', 'refs', 'templates', 'schemas', 'tests/acceptance', 'tests/fixtures']) {
    fs.mkdirSync(path.join(installPath, subdir), { recursive: true });
  }

  const copied = copyManifest(sourceRoot, installPath);
  if (cleanup) cleanup();

  // The manifest is the completion criterion, so a short install fails here instead of
  // reporting success. This is the check that was missing when the installer looked for its
  // guides under a path that only exists in the development tree: it warned fourteen times
  // and installed a copy with no README, no LICENSE and no docs/ at all.
  const missing = SKILL_FILES.filter(f => !fs.existsSync(path.join(installPath, f.to)));
  if (missing.length) {
    error(`Incomplete install: ${missing.length} of ${SKILL_FILES.length} file(s) missing — ` +
      missing.map(f => f.to).join(', '));
  }
  
  // Create package.json if not exists
  const pkgPath = path.join(installPath, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: SKILL_NAME,
      version: version === 'latest' ? SKILL_VERSION : version,
      description: 'Cross-harness session handoff engine',
      type: 'module'
    }, null, 2));
  }
  
  // The version reported is the one that landed, read back out of the installed SKILL.md —
  // not the requested string, and not a constant that a release has to remember to bump.
  const installedVersion = getInstalledVersion(installPath) || (version === 'latest' ? SKILL_VERSION : version);
  success(`Installed ${SKILL_NAME} v${installedVersion} to ${installPath}`);
  log(`Copied ${copied} files`);
  // `config` is a real verb that exits 0 and prints the resolved root. `--help` is not a verb
  // (it exits 2), so the old hint told every user to run a failing command.
  log(`\nRun with: node ${path.join(installPath, 'tools', 'handoff.mjs')} config`);

  return { installed: true, path: installPath, version: installedVersion };
}

// Update skill
async function update(location, customPath, version) {
  const installPath = resolveInstallPath(location, customPath);
  
  if (!isInstalled(installPath)) {
    error(`Not installed at ${installPath}. Run 'install' first.`);
  }
  
  const currentVersion = getInstalledVersion(installPath);
  log(`\nCurrent version: ${currentVersion}`);
  log(`Updating to: ${version}`);
  
  // For now, just reinstall
  return install(location, customPath, version, true);
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
    log(`\nYour handoffs (projects/, handoffs/, links/) will NOT be deleted.`);
    log(`Configuration (handoff.config.json) will NOT be deleted.`);
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

function doRemove(installPath, force) {
  log(`\nRemoving from ${installPath}...`);
  
  // Keep handoffs, projects, links directories (user data)
  const keepDirs = ['handoffs', 'projects', 'links'];
  const keepFiles = ['handoff.config.json', '.env.example'];
  
  // Read directory contents
  let entries;
  try {
    entries = fs.readdirSync(installPath, { withFileTypes: true });
  } catch {
    entries = [];
  }
  
  for (const entry of entries) {
    const entryPath = path.join(installPath, entry.name);
    
    // Skip user data directories
    if (entry.isDirectory() && keepDirs.includes(entry.name)) {
      if (force) {
        // Check if empty
        try {
          const contents = fs.readdirSync(entryPath);
          if (contents.length === 0) {
            fs.rmdirSync(entryPath);
            log(`Removed empty directory: ${entry.name}/`);
          }
        } catch {}
      }
      continue;
    }
    
    // Skip kept files
    if (!entry.isDirectory() && keepFiles.includes(entry.name)) {
      continue;
    }
    
    // Remove everything else
    if (entry.isDirectory()) {
      fs.rmSync(entryPath, { recursive: true, force: true });
      log(`Removed directory: ${entry.name}/`);
    } else {
      fs.unlinkSync(entryPath);
      log(`Removed file: ${entry.name}`);
    }
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

// Verify installation
function verify(location, customPath) {
  const installPath = resolveInstallPath(location, customPath);
  
  console.log(`\n${C('bold', 'Verifying agent-handoff installation...')}`);
  console.log(`Location: ${installPath}`);
  if (!customPath && location === 'global') console.log(`Global root: ${resolveGlobalRoot().root}`);
  console.log();
  
  if (!isInstalled(installPath)) {
    error(`Not installed at ${installPath}`);
  }
  
  const checks = [];
  let allPassed = true;
  
  // Check required files
  const requiredFiles = SKILL_FILES.map(f => f.to);
  
  for (const file of requiredFiles) {
    const filePath = path.join(installPath, file);
    const exists = fs.existsSync(filePath);
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
  
  console.log();
  if (allPassed) {
    success(`Installation verified ✓`);
    log(`Location: ${installPath}`);
    log(`Version: ${getInstalledVersion(installPath) || 'unknown'}`);
    return { valid: true };
  } else {
    error(`Verification failed. Try reinstalling.`);
  }
}

// List installations
function listInstallations() {
  console.log(`\n${C('bold', 'Installed agent-handoff locations')}\n`);
  
  const g = resolveGlobalRoot();
  const locations = [
    // The resolved global root first: this is the one `install` and `verify` use.
    { name: 'Global (resolved — ' + g.why + ')', root: g.root },
    { name: 'Local (cwd/local/skills)', root: PATHS.local },
  ];
  // Every other candidate root is listed too, so a second account or a stale
  // ~/.agents/skills copy is VISIBLE rather than silently ignored.
  for (const d of accountSkillRoots()) locations.push({ name: 'account-skill candidate', root: d });
  locations.push({ name: 'Harness skills home', root: AGENTS_SKILLS });
  if (fs.existsSync(path.join(process.cwd(), '.git'))) {
    locations.push({ name: 'Project-local (cwd/skills)', root: PATHS.project });
  }
  
  let foundAny = false;
  const seen = new Set();
  
  for (const loc of locations) {
    const skillPath = path.join(loc.root, SKILL_NAME);
    if (seen.has(skillPath)) continue;
    seen.add(skillPath);
    if (isInstalled(skillPath)) {
      foundAny = true;
      const version = getInstalledVersion(skillPath) || 'unknown';
      log(`${C('green', '✓')} ${loc.name}`);
      log(`  Path: ${skillPath}`);
      log(`  Version: ${version}`);
      log(`  Files from the manifest: ${SKILL_FILES.filter(f => fs.existsSync(path.join(skillPath, f.to))).length}/${SKILL_FILES.length}`);
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
        
      case 'list':
      case 'ls':
        listInstallations();
        break;

      case 'where':
        printGlobalResolution();
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
    error(`Error: ${e.message}`);
  }
}

function showHelp() {
  console.log(`
${C('bold', 'agents-handoff')} - Install assistant for agent-handoff skill

${C('bold', 'Usage:')}
  npx agents-handoff <command> [options]

${C('bold', 'Commands:')}
  install, i      Install the skill (default)
  update, u       Update to latest or specified version
  remove, rm      Remove the installation
  verify, v       Verify installation integrity
  list, ls        List all installed locations
  where           Show the resolved global root and why it was chosen

${C('bold', 'Options:')}
  --location L    Install location: global (default), local, project
  --path P        Custom installation path
  --version V     Version to install: latest (default) or specific version
  --force, -f     Skip confirmations, overwrite existing

${C('bold', 'Examples:')}
  npx agents-handoff                      # Install to global
  npx agents-handoff --location project   # Install to project
  npx agents-handoff --update             # Update to latest
  npx agents-handoff --remove --force     # Remove without asking
  npx agents-handoff --verify              # Check installation
  npx agents-handoff --list                # Show all installations

${C('bold', 'Locations:')}
  global   resolved, not hard-coded: an account-skill root that already holds
           agent-handoff, else ~/.agents/skills, else any account-skill store found on this
           machine, else ~/.agents/skills (created on install). A store holds the skill two
           id levels below it — <store>/<account-id>/<profile-id>/agent-handoff/ — so the
           store itself is not an install target.
           Override with AGENT_HANDOFF_GLOBAL_DIR, or target an exact path with --path.
           See it resolved: npx agents-handoff where
  local    ./local/skills/agent-handoff
  project  ./skills/agent-handoff (only if in a git repo)

${C('bold', 'Repository:')}
  https://github.com/${REPO_OWNER}/${REPO_NAME}
`);
}

main();
