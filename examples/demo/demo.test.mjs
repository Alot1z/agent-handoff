import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer, SUPPORTED_HARNESSES, DEMO_SCENARIOS } from './server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const SELF_TEST = path.join(HERE, 'self-test.mjs');
const PUBLIC = path.join(HERE, 'public');
const server = createServer();
let baseUrl = '';

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  baseUrl = 'http://127.0.0.1:' + address.port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('local server advertises offline mode and only the explicit harness allowlist', async () => {
  const healthResponse = await fetch(baseUrl + '/api/health');
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.mode, 'offline-local');
  assert.equal(health.networkRequired, false);
  assert.equal(health.liveModelRequired, false);
  assert.equal(health.supportedHarnesses, SUPPORTED_HARNESSES.length);

  const response = await fetch(baseUrl + '/api/harnesses');
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(SUPPORTED_HARNESSES.map((item) => item.id), ['claude-code', 'codex', 'dsh', 'generic']);
  assert.deepEqual(payload.harnesses.map((item) => item.id), DEMO_SCENARIOS.map((item) => item.id));
  assert.ok(payload.harnesses.every((item) => SUPPORTED_HARNESSES.some((supported) => supported.id === item.harness)));
  assert.ok(payload.harnesses.some((item) => item.id === 'dsh' && /canonical JSONL export/i.test(item.format)));
});

test('every advertised harness runs the real CLI, verifies capture, and retains complete events', async () => {
  for (const scenario of DEMO_SCENARIOS) {
    const response = await fetch(baseUrl + '/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: scenario.id })
    });
    if (response.status !== 200) assert.fail(scenario.id + ': ' + await response.text());
    const result = await response.json();
    assert.equal(result.ok, true, scenario.id);
    assert.equal(result.localOnly, true, scenario.id);
    assert.equal(result.scenario, scenario.id);
    assert.equal(result.harness, scenario.harness);
    assert.equal(result.cli.exitCode, 0, scenario.id + ' CLI');
    assert.equal(result.verification.exitCode, 0, scenario.id + ' verification');
    assert.match(result.verification.stdout, /^PASS /m, scenario.id + ' verification marker');
    assert.ok(result.events.length >= (scenario.id === 'plain-text' ? 6 : 8), scenario.id + ' captured event count');
    assert.ok(result.events.some((event) => event.class === 'USER'), scenario.id + ' user event');
    assert.ok(result.events.some((event) => event.class === 'AGENT'), scenario.id + ' assistant event');
    assert.ok(result.events.some((event) => event.class === 'TOOL'), scenario.id + ' tool event');

    const longToolResult = result.events.find((event) =>
      event.class === 'TOOL' && String(event.text).includes('row-60')
    );
    assert.ok(longToolResult, scenario.id + ' long tool result exists');
    assert.ok(longToolResult.text.length > 2000, scenario.id + ' long tool result is not truncated');
    assert.ok(result.events.some((event) => String(event.text).includes('ERROR: optional metadata field')),
      scenario.id + ' controlled error retained');
    assert.ok(result.events.some((event) => event.class === 'AGENT' && /recovered/i.test(event.text)),
      scenario.id + ' recovery retained');

    assert.equal(result.manifest.turn_count, result.events.length);
    assert.equal(result.manifest.harness, scenario.harness);
    assert.equal(result.manifest.source_paths, undefined, 'private temporary paths are not returned');
    assert.ok(result.artifacts.handoffMarkdown.includes('## Provenance'));
    assert.ok(result.artifacts.toolsMarkdown.includes('inspect_fixture'));
    assert.ok(result.artifacts.summaryJson);
    assert.ok(result.artifacts.llmJson.timeline.length === result.events.length);
    assert.doesNotMatch(result.artifacts.handoffMarkdown, /agents-handoff-demo-[^\\s]+/i);
    assert.ok(result.notes.some((note) => /synthetic/i.test(note)));
  }
});

test('invalid harnesses and oversized request bodies fail without running the capture CLI', async () => {
  const invalid = await fetch(baseUrl + '/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario: '../../arbitrary-path' })
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).ok, false);

  const oversized = await fetch(baseUrl + '/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario: 'generic-jsonl', padding: 'x'.repeat(5000) })
  });
  assert.equal(oversized.status, 413);
});

test('the demo UI has no product-version label, external assets, or clipped-only output', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(PUBLIC, 'styles.css'), 'utf8');
  assert.match(html, /agents-handoff/);
  assert.doesNotMatch(html, /\b(?:v)?\d+\.\d+\.\d+\b/, 'UI must not display a product version');
  assert.doesNotMatch(html, /https?:\/\//i, 'UI must not load external assets');
  assert.doesNotMatch(js, /https?:\/\//i, 'browser code must use local API routes only');
  assert.match(html, /Expand long results|Expand full event/i);
  assert.match(js, /Expand full event/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /white-space:\s*pre-wrap/);
  assert.match(html, /synthetic/i);
  assert.match(html, /never reads your own conversations/i);
  // The interactive demo is the primary mode; the CLI is a secondary mode.
  assert.match(html, /Interactive demo/);
  assert.match(html, /CLI mode/);
  assert.match(html, /data-mode="demo"/);
  assert.match(html, /data-mode="cli"/);
  assert.match(html, /id="mode-demo"/);
  assert.match(html, /id="mode-cli"/);
  assert.match(html, /role="radiogroup"/);
  assert.doesNotMatch(html, /Run the CLI first/, 'the interactive demo must lead, not the CLI');
  assert.match(js, /renderChips/);
  assert.match(js, /setAttribute\(\s*'aria-checked'/);
});

test('static responses include security headers and unknown routes do not expose files', async () => {
  const page = await fetch(baseUrl + '/');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.match(page.headers.get('content-security-policy') || '', /default-src 'self'/);

  const missing = await fetch(baseUrl + '/../../tools/handoff.mjs');
  assert.equal(missing.status, 404);
});

test('local self-test captures an explicitly supplied transcript without printing or uploading its contents', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-handoff-self-test-test-'));
  try {
    const source = path.join(root, 'synthetic-private-marker.jsonl');
    const marker = 'SYNTHETIC_PRIVATE_MARKER_MUST_NOT_APPEAR_IN_OUTPUT';
    const rows = [
      { role: 'user', text: marker + ' user message' },
      { role: 'assistant', text: 'This is a local-only smoke test.' },
      { role: 'tool', kind: 'tool_use', text: 'tool_use test_tool {"ok":true}' },
      { role: 'tool', kind: 'tool_result', text: marker + ' tool result' }
    ];
    fs.writeFileSync(source, rows.map(JSON.stringify).join('\n') + '\n');
    const run = spawnSync(process.execPath, [
      SELF_TEST, '--source', source, '--harness', 'generic'
    ], {
      cwd: REPO_ROOT,
      env: Object.assign({}, process.env, { TEMP: root, TMP: root, TMPDIR: root }),
      encoding: 'utf8',
      timeout: 15000
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.mode, 'local-only');
    assert.equal(report.harness, 'generic');
    assert.equal(report.verification, 'PASS');
    assert.equal(report.sourceContentsPrinted, false);
    assert.equal(report.sourcePathPrinted, false);
    assert.equal(report.networkUsed, false);
    assert.equal(report.uploadAttempted, false);
    assert.equal(report.sourceDeleted, false);
    assert.ok(report.eventCount >= 4);
    assert.ok(fs.existsSync(source), 'the source transcript must not be deleted');
    assert.equal(run.stdout.includes(marker), false);
    assert.equal(run.stdout.includes(source), false);
    assert.equal(fs.readdirSync(root).filter((name) => name.startsWith('agents-handoff-self-test-')).length, 0,
      'temporary captured store must be deleted after the report is prepared');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
