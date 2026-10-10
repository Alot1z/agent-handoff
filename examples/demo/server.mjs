#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const ENGINE = path.join(REPO_ROOT, 'tools', 'handoff.mjs');
const PUBLIC_ROOT = path.join(HERE, 'public');
const BODY_LIMIT = 4096;
const RUN_TIMEOUT_MS = 15000;
const MAX_BUFFER = 4 * 1024 * 1024;

export const SUPPORTED_HARNESSES = Object.freeze([
  { id: 'claude-code', label: 'Claude Code', format: 'Native transcript JSONL', note: 'Nested message blocks, tool calls and tool results' },
  { id: 'codex', label: 'Codex CLI', format: 'Rollout JSONL', note: 'Payload-nested messages and function-call events' },
  { id: 'dsh', label: 'DeepSeek Harness', format: 'Canonical JSONL export', note: 'Normalized export format; not a direct native database reader' },
  { id: 'generic', label: 'Generic adapter', format: 'Generic JSONL or plain text', note: 'Portable role/text events and multiline plain-text logs' }
]);

export const DEMO_SCENARIOS = Object.freeze([
  { id: 'claude-code', harness: 'claude-code', label: 'Claude Code', format: 'Native transcript JSONL', note: 'Nested message blocks, tool calls and tool results' },
  { id: 'codex', harness: 'codex', label: 'Codex CLI', format: 'Rollout JSONL', note: 'Payload-nested messages and function-call events' },
  { id: 'dsh', harness: 'dsh', label: 'DeepSeek Harness export', format: 'Canonical JSONL export', note: 'Normalized export format; not a direct native database reader' },
  { id: 'generic-jsonl', harness: 'generic', label: 'Generic adapter - JSONL', format: 'Role + text JSONL', note: 'Portable user, assistant and tool events; uses the documented generic adapter ID' },
  { id: 'plain-text', harness: 'generic', label: 'Generic adapter - plain text', format: 'Role-marked text', note: 'Multiline user, assistant and tool output; uses the documented generic adapter ID' }
]);

const TOOL_RESULT = [
  'Fixture inspection complete. Synthetic dataset only.',
  ...Array.from({ length: 60 }, (_, i) =>
    'row-' + String(i + 1).padStart(2, '0') + ' | sample-' + String(i + 1).padStart(2, '0') + ' | status=ok | source=demo'
  ),
  'END_OF_SYNTHETIC_ROWS'
].join('\n');

const VALIDATION_ERROR = 'ERROR: optional metadata field is absent; retrying with documented fallback.';
const RECOVERY_TEXT = 'The validation tool reported a non-fatal missing optional field. I kept the full error, recovered with the documented fallback, and completed the capture.';

function fixtureFor(harness) {
  const user = 'Inspect the synthetic dataset, retain every tool result, recover from the controlled validation error, and summarize the capture.';
  const assistant1 = 'I will inspect the fixture, validate its metadata, and preserve the complete tool output.';
  const assistant2 = 'The row inspection completed. I will now run the validation check.';
  const assistant3 = RECOVERY_TEXT;
  const stamp = '2026-10-10T10:00:00.000Z';

  if (harness === 'claude-code') {
    const rows = [
      { type: 'user', timestamp: stamp, message: { role: 'user', content: [{ type: 'text', text: user }] } },
      { type: 'assistant', timestamp: stamp, message: { role: 'assistant', content: [{ type: 'text', text: assistant1 }] } },
      { type: 'assistant', timestamp: stamp, message: { role: 'assistant', content: [{ type: 'tool_use', id: 'demo-tool-1', name: 'inspect_fixture', input: { file: 'synthetic-dataset.csv' } }] } },
      { type: 'user', timestamp: stamp, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'demo-tool-1', content: TOOL_RESULT }] } },
      { type: 'assistant', timestamp: stamp, message: { role: 'assistant', content: [{ type: 'text', text: assistant2 }] } },
      { type: 'assistant', timestamp: stamp, message: { role: 'assistant', content: [{ type: 'tool_use', id: 'demo-tool-2', name: 'validate_fixture', input: { required: ['id', 'status'], optional: ['metadata'] } }] } },
      { type: 'user', timestamp: stamp, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'demo-tool-2', content: VALIDATION_ERROR }] } },
      { type: 'assistant', timestamp: stamp, message: { role: 'assistant', content: [{ type: 'text', text: assistant3 }] } }
    ];
    return { fileName: 'claude-code-transcript.jsonl', content: rows.map(JSON.stringify).join('\n') + '\n' };
  }

  if (harness === 'codex') {
    const rows = [
      { type: 'response_item', timestamp: stamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: user }] } },
      { type: 'response_item', timestamp: stamp, payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: assistant1 }] } },
      { type: 'response_item', timestamp: stamp, payload: { type: 'function_call', name: 'inspect_fixture', arguments: JSON.stringify({ file: 'synthetic-dataset.csv' }) } },
      { type: 'response_item', timestamp: stamp, payload: { type: 'function_call_output', output: TOOL_RESULT } },
      { type: 'response_item', timestamp: stamp, payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: assistant2 }] } },
      { type: 'response_item', timestamp: stamp, payload: { type: 'function_call', name: 'validate_fixture', arguments: JSON.stringify({ required: ['id', 'status'], optional: ['metadata'] }) } },
      { type: 'response_item', timestamp: stamp, payload: { type: 'function_call_output', output: VALIDATION_ERROR } },
      { type: 'response_item', timestamp: stamp, payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: assistant3 }] } }
    ];
    return { fileName: 'codex-rollout.jsonl', content: rows.map(JSON.stringify).join('\n') + '\n' };
  }

  if (harness === 'dsh' || harness === 'generic-jsonl') {
    const dsh = harness === 'dsh';
    const rows = [
      { seq: 0, ts: stamp, ...(dsh ? { harness: 'dsh' } : {}), role: 'user', kind: 'text', text: user },
      { seq: 1, ts: stamp, ...(dsh ? { harness: 'dsh' } : {}), role: 'assistant', kind: 'text', text: assistant1 },
      { seq: 2, ts: stamp, ...(dsh ? { harness: 'dsh' } : {}), role: 'tool', kind: 'tool_use', text: 'tool_use inspect_fixture ' + JSON.stringify({ file: 'synthetic-dataset.csv' }) },
      { seq: 3, ts: stamp, ...(dsh ? { harness: 'dsh' } : {}), role: 'tool', kind: 'tool_result', text: TOOL_RESULT },
      { seq: 4, ts: stamp, ...(dsh ? { harness: 'dsh' } : {}), role: 'assistant', kind: 'text', text: assistant2 },
      { seq: 5, ts: stamp, ...(dsh ? { harness: 'dsh' } : {}), role: 'tool', kind: 'tool_use', text: 'tool_use validate_fixture ' + JSON.stringify({ required: ['id', 'status'], optional: ['metadata'] }) },
      { seq: 6, ts: stamp, ...(dsh ? { harness: 'dsh' } : {}), role: 'tool', kind: 'tool_result', text: VALIDATION_ERROR },
      { seq: 7, ts: stamp, ...(dsh ? { harness: 'dsh' } : {}), role: 'assistant', kind: 'text', text: assistant3 }
    ];
    return { fileName: harness + '-transcript.jsonl', content: rows.map(JSON.stringify).join('\n') + '\n' };
  }

  if (harness === 'plain-text') {
    return {
      fileName: 'plain-text-transcript.txt',
      content: [
        'user: ' + user,
        'assistant: ' + assistant1,
        'tool: inspect_fixture --file synthetic-dataset.csv',
        TOOL_RESULT,
        'assistant: ' + assistant2,
        'tool: validate_fixture --required id,status --optional metadata',
        VALIDATION_ERROR,
        'assistant: ' + assistant3,
        ''
      ].join('\n')
    };
  }

  throw new Error('Unsupported harness');
}

function jsonResponse(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function textResponse(res, status, body, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      body += chunk.toString('utf8');
      if (Buffer.byteLength(body) > BODY_LIMIT) tooLarge = true;
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

function runCli(args, env) {
  return spawnSync(process.execPath, [ENGINE, ...args], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    windowsHide: true
  });
}

function redact(value, tempRoot, sourcePath) {
  return String(value ?? '')
    .split(tempRoot).join('<temporary-demo-directory>')
    .split(sourcePath).join('<synthetic-fixture>');
}

function captureSession(scenarioId) {
  const scenario = DEMO_SCENARIOS.find((item) => item.id === scenarioId);
  if (!scenario) throw new Error('Unsupported demo scenario');
  const harness = scenario.harness;
  const fixture = fixtureFor(scenarioId);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-handoff-demo-'));
  const storeRoot = path.join(tempRoot, 'store');
  const sourcePath = path.join(tempRoot, fixture.fileName);
  const session = 'demo-' + scenarioId + '-' + Date.now().toString(36) + '-' + randomBytes(3).toString('hex');
  const project = 'demo-' + scenarioId;
  fs.mkdirSync(storeRoot, { recursive: true });
  fs.writeFileSync(sourcePath, fixture.content, 'utf8');

  const env = Object.assign({}, process.env, {
    HANDOFFS_ROOT: storeRoot,
    AGENT_HANDOFF_STATE_DIR: path.join(tempRoot, 'state')
  });
  const buildArgs = [
    'build', '--source', sourcePath, '--session', session,
    '--harness', harness, '--model', 'simulated-local', '--project', project,
    '--objective', 'Demonstrate complete local capture using synthetic data only'
  ];

  try {
    const build = runCli(buildArgs, env);
    if (build.error || build.status !== 0) {
      return {
        ok: false, scenario: scenarioId, harness, session, project,
        error: 'Local capture CLI failed.',
        cli: {
          command: ['node', 'tools/handoff.mjs', 'build', '--source', '<synthetic-fixture>', '--session', session, '--harness', harness, '--project', project],
          exitCode: build.status ?? 1,
          stdout: redact(build.stdout, tempRoot, sourcePath),
          stderr: redact(build.stderr || build.error?.message, tempRoot, sourcePath)
        }
      };
    }

    const verify = runCli(['verify', session], env);
    if (verify.error || verify.status !== 0) {
      return {
        ok: false, scenario: scenarioId, harness, session, project,
        error: 'Captured session failed verification.',
        cli: {
          command: ['node', 'tools/handoff.mjs', 'verify', session],
          exitCode: verify.status ?? 1,
          stdout: redact(verify.stdout, tempRoot, sourcePath),
          stderr: redact(verify.stderr || verify.error?.message, tempRoot, sourcePath)
        }
      };
    }

    const sessionDir = path.join(storeRoot, 'projects', project, session);
    const manifest = JSON.parse(fs.readFileSync(path.join(sessionDir, 'manifest.json'), 'utf8'));
    const timeline = fs.readFileSync(path.join(sessionDir, 'timeline.jsonl'), 'utf8')
      .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    const handoffMarkdown = redact(fs.readFileSync(path.join(sessionDir, 'HANDOFF.md'), 'utf8'), tempRoot, sourcePath);
    const toolsMarkdown = redact(fs.readFileSync(path.join(sessionDir, 'TOOLS.md'), 'utf8'), tempRoot, sourcePath);
    const summaryJson = JSON.parse(redact(fs.readFileSync(path.join(sessionDir, 'HANDOFF.summary.json'), 'utf8'), tempRoot, sourcePath));
    const llmJson = JSON.parse(redact(fs.readFileSync(path.join(sessionDir, 'HANDOFF.llm.json'), 'utf8'), tempRoot, sourcePath));
    const safeManifest = { ...manifest };
    delete safeManifest.source_paths;

    return {
      ok: true,
      localOnly: true,
      scenario: scenarioId,
      label: scenario.label,
      harness,
      session,
      project,
      format: scenario.format,
      command: ['node', 'tools/handoff.mjs', ...buildArgs.map((arg) => arg === sourcePath ? '<synthetic-fixture>' : arg)],
      cli: {
        command: ['node', 'tools/handoff.mjs', 'build', '--source', '<synthetic-fixture>', '--session', session, '--harness', harness, '--project', project],
        exitCode: build.status,
        stdout: redact(build.stdout, tempRoot, sourcePath),
        stderr: redact(build.stderr, tempRoot, sourcePath)
      },
      verification: {
        command: ['node', 'tools/handoff.mjs', 'verify', session],
        exitCode: verify.status,
        stdout: redact(verify.stdout, tempRoot, sourcePath),
        stderr: redact(verify.stderr, tempRoot, sourcePath)
      },
      steps: [
        { label: 'Created synthetic harness transcript', status: 'PASS' },
        { label: 'Executed the real local capture CLI', status: 'PASS' },
        { label: 'Verified manifest, timeline and JSON payload', status: 'PASS' },
        { label: 'Read the persisted capture artifacts', status: 'PASS' }
      ],
      manifest: safeManifest,
      events: timeline,
      artifacts: { handoffMarkdown, toolsMarkdown, summaryJson, llmJson },
      notes: [
        'The agent conversation is scripted and synthetic.',
        'The real local agents-handoff CLI performs capture and verification.',
        'Temporary transcript and store are deleted after the result is prepared.',
        'DeepSeek Harness uses its documented canonical JSONL export shape here; this demo does not read a native compressed database.'
      ]
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function createServer() {
  return createHttpServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");

    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return jsonResponse(res, 200, { ok: true, mode: 'offline-local', networkRequired: false, liveModelRequired: false, supportedHarnesses: SUPPORTED_HARNESSES.length });
    }
    if (req.method === 'GET' && url.pathname === '/api/harnesses') {
      return jsonResponse(res, 200, { harnesses: DEMO_SCENARIOS });
    }
    if (req.method === 'POST' && url.pathname === '/api/run') {
      try {
        const body = await readJsonBody(req);
        const scenario = String(body.scenario || '');
        if (!DEMO_SCENARIOS.some((item) => item.id === scenario)) {
          return jsonResponse(res, 400, { ok: false, error: 'Choose one of the supported demo scenarios.' });
        }
        const result = captureSession(scenario);
        return jsonResponse(res, result.ok ? 200 : 500, result);
      } catch (error) {
        return jsonResponse(res, error.statusCode || 400, { ok: false, error: error.statusCode === 413 ? 'Request body too large.' : 'Invalid demo request.' });
      }
    }

    if (req.method === 'GET') {
      const routes = {
        '/': ['index.html', 'text/html; charset=utf-8'],
        '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
        '/styles.css': ['styles.css', 'text/css; charset=utf-8']
      };
      const route = routes[url.pathname];
      if (route) {
        try {
          return textResponse(res, 200, fs.readFileSync(path.join(PUBLIC_ROOT, route[0]), 'utf8'), route[1]);
        } catch {
          return textResponse(res, 500, 'Demo asset unavailable.', 'text/plain; charset=utf-8');
        }
      }
    }
    return jsonResponse(res, 404, { ok: false, error: 'Not found.' });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write('PORT must be an integer between 1 and 65535.\n');
    process.exit(2);
  }
  const server = createServer();
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write('Local demo: http://127.0.0.1:' + port + '/\n');
    process.stdout.write('Offline mode: synthetic data only; no model API or network access required.\n');
  });
}
