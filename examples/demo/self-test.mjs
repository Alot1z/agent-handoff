#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_HARNESSES } from './server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const ENGINE = path.join(REPO_ROOT, 'tools', 'handoff.mjs');
const args = process.argv.slice(2);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] || '') : '';
}

function usage() {
  process.stdout.write('Local-only self-test. Supply a transcript file that belongs to your own active harness session.\n');
  process.stdout.write('Usage: node examples/demo/self-test.mjs --source <local-transcript-file> --harness <supported-harness>\n');
  process.stdout.write('Supported harnesses: ' + SUPPORTED_HARNESSES.map((item) => item.id).join(', ') + '\n');
  process.stdout.write('The source is never printed, uploaded, or deleted. Temporary captured output is deleted after verification.\n');
}

if (args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}

const sourceArg = valueAfter('--source');
const harness = valueAfter('--harness');
if (!sourceArg || !SUPPORTED_HARNESSES.some((item) => item.id === harness)) {
  process.stderr.write('Self-test needs --source and a supported --harness. No transcript was opened.\n');
  usage();
  process.exit(2);
}

const sourcePath = path.resolve(sourceArg);
let sourceIsFile = false;
try { sourceIsFile = fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile(); } catch {}
if (!sourceIsFile) {
  process.stderr.write('The specified local transcript file is unavailable. No transcript content or source path was printed.\n');
  process.exit(2);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-handoff-self-test-'));
const storeRoot = path.join(tempRoot, 'store');
const session = 'self-test-' + harness + '-' + Date.now().toString(36) + '-' + randomBytes(3).toString('hex');
const project = 'self-test-' + harness;
let result;

function runCli(cliArgs, env) {
  return spawnSync(process.execPath, [ENGINE, ...cliArgs], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true
  });
}

try {
  fs.mkdirSync(storeRoot, { recursive: true });
  const env = Object.assign({}, process.env, {
    HANDOFFS_ROOT: storeRoot,
    AGENT_HANDOFF_STATE_DIR: path.join(tempRoot, 'state'),
    NO_COLOR: '1'
  });

  const build = runCli([
    'build', '--source', sourcePath, '--session', session,
    '--harness', harness, '--project', project,
    '--objective', 'Local-only self-test; transcript text is not emitted'
  ], env);

  if (build.error || build.status !== 0) {
    result = {
      ok: false, stage: 'build', exitCode: build.status ?? 1,
      message: 'Capture failed. Transcript content and source path were not included in this report.'
    };
  } else {
    const verify = runCli(['verify', session], env);
    if (verify.error || verify.status !== 0) {
      result = {
        ok: false, stage: 'verify', exitCode: verify.status ?? 1,
        message: 'Captured output failed verification. Transcript content and source path were not included in this report.'
      };
    } else {
      const sessionDir = path.join(storeRoot, 'projects', project, session);
      const manifest = JSON.parse(fs.readFileSync(path.join(sessionDir, 'manifest.json'), 'utf8'));
      const timeline = fs.readFileSync(path.join(sessionDir, 'timeline.jsonl'), 'utf8')
        .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      result = {
        ok: true,
        mode: 'local-only',
        harness,
        eventCount: timeline.length,
        counts: manifest.counts,
        verification: 'PASS',
        sourceContentsPrinted: false,
        sourcePathPrinted: false,
        networkUsed: false,
        uploadAttempted: false,
        sourceDeleted: false,
        cleanup: 'temporary capture store deleted after report generation'
      };
    }
  }
} catch {
  result = {
    ok: false, stage: 'internal', exitCode: 1,
    message: 'Self-test failed. No transcript content or source path was included in this report.'
  };
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (!result.ok) process.exitCode = 1;
