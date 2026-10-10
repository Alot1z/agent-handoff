const chipsRoot = document.querySelector('#harness-chips');
const harnessNote = document.querySelector('#harness-note');
const runButton = document.querySelector('#run-button');
const exportButton = document.querySelector('#export-button');
const commandLine = document.querySelector('#command-line');
const cliOutput = document.querySelector('#cli-output');
const cliStatus = document.querySelector('#cli-status');
const cliStderr = document.querySelector('#cli-stderr');
const stderrDetails = document.querySelector('#stderr-details');
const runStatus = document.querySelector('#run-status');
const summaryPanel = document.querySelector('#session-summary');
const timelineRoot = document.querySelector('#timeline');
const timelineSearch = document.querySelector('#timeline-search');
const eventFilter = document.querySelector('#event-filter');
const artifactBody = document.querySelector('#artifact-body');
const artifactTabs = [...document.querySelectorAll('[data-artifact]')];
const modeTabs = [...document.querySelectorAll('.mode-tab')];
const modeViews = { demo: document.querySelector('#mode-demo'), cli: document.querySelector('#mode-cli') };

let scenarios = [];
let selectedId = null;
let result = null;
let selectedArtifact = 'handoff';

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function selectedScenario() {
  return scenarios.find((item) => item.id === selectedId) || null;
}

function setStatus(text, kind) {
  runStatus.textContent = text;
  runStatus.className = 'run-status' + (kind ? ' ' + kind : '');
}

function setCliStatus(text, kind) {
  cliStatus.textContent = text;
  cliStatus.className = 'status-chip' + (kind ? ' ' + kind : '');
}

function shellQuote(value) {
  const text = String(value);
  return /\s/.test(text) ? '"' + text.replaceAll('"', '\\"') + '"' : text;
}

function updateHarnessNote() {
  const item = selectedScenario();
  if (!item) {
    harnessNote.textContent = 'No supported harness information available.';
    return;
  }
  harnessNote.textContent = 'CLI adapter: ' + item.harness + ' · ' + item.format + ' · ' + item.note;
  commandLine.textContent = 'node tools/handoff.mjs build --source <synthetic-fixture> --harness ' + item.harness;
}

function renderChips() {
  chipsRoot.replaceChildren();
  for (const item of scenarios) {
    const chip = make('button', 'chip');
    chip.type = 'button';
    chip.setAttribute('role', 'radio');
    chip.dataset.id = item.id;
    const checked = item.id === selectedId;
    chip.setAttribute('aria-checked', checked ? 'true' : 'false');
    chip.append(make('span', 'chip-label', item.label));
    chip.append(make('span', 'chip-format', item.format));
    chip.addEventListener('click', () => {
      selectedId = item.id;
      for (const node of chipsRoot.querySelectorAll('.chip')) {
        node.setAttribute('aria-checked', node.dataset.id === selectedId ? 'true' : 'false');
      }
      updateHarnessNote();
      if (result) setStatus('Harness switched to ' + item.label + '. Run again to capture this adapter.', 'success');
    });
    chipsRoot.append(chip);
  }
}

async function loadHarnesses() {
  try {
    const response = await fetch('/api/harnesses', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Harness list unavailable');
    const payload = await response.json();
    scenarios = payload.harnesses || [];
    if (scenarios.length) selectedId = scenarios[0].id;
    renderChips();
    runButton.disabled = scenarios.length === 0;
    updateHarnessNote();
    setStatus('Ready. Every run uses synthetic data and a temporary local store.', 'success');
  } catch {
    chipsRoot.replaceChildren(make('p', 'harness-loading', 'Supported harnesses are unavailable. Start the demo server and reload.'));
    setStatus('Cannot reach the local demo server. Start it with node examples/demo/server.mjs.', 'error');
    setCliStatus('OFFLINE', 'failure');
  }
}

function renderTimeline() {
  timelineRoot.replaceChildren();
  if (!result || !Array.isArray(result.events)) {
    timelineRoot.className = 'timeline-empty';
    timelineRoot.textContent = 'Run a simulated session to inspect the actual captured timeline.';
    return;
  }
  const query = timelineSearch.value.trim().toLowerCase();
  const type = eventFilter.value;
  const filtered = result.events.filter((event) => {
    const matchesType = type === 'ALL' || event.class === type;
    const matchesText = !query || String(event.text || '').toLowerCase().includes(query) || String(event.class || '').toLowerCase().includes(query);
    return matchesType && matchesText;
  });
  if (!filtered.length) {
    timelineRoot.className = 'timeline-empty';
    timelineRoot.textContent = 'No captured events match this search and filter.';
    return;
  }
  timelineRoot.className = 'timeline-list';
  for (const event of filtered) {
    const card = make('article', 'event-card');
    const header = make('div', 'event-header');
    header.append(make('span', 'event-seq', '#' + event.seq));
    header.append(make('span', 'event-type ' + (event.class || 'OTHER'), event.class || 'OTHER'));
    if (event.ts) header.append(make('span', 'event-time', event.ts));
    card.append(header);

    const body = make('div', 'event-content');
    const fullText = String(event.text || '');
    if (fullText.length > 260) {
      const preview = make('pre');
      preview.textContent = fullText.slice(0, 260) + '\n…';
      body.append(preview);
      const details = make('details');
      details.append(make('summary', '', 'Expand full event (' + fullText.length.toLocaleString() + ' characters)'), make('pre', '', fullText));
      card.append(body, details);
    } else {
      body.append(make('pre', '', fullText || '(empty event)'));
      card.append(body);
    }
    timelineRoot.append(card);
  }
}

function artifactValue(name) {
  if (!result) return null;
  if (name === 'handoff') return result.artifacts.handoffMarkdown;
  if (name === 'summary') return JSON.stringify(result.artifacts.summaryJson, null, 2);
  if (name === 'tools') return result.artifacts.toolsMarkdown;
  if (name === 'payload') return JSON.stringify(result.artifacts.llmJson, null, 2);
  if (name === 'manifest') return JSON.stringify(result.manifest, null, 2);
  return '';
}

function renderArtifact() {
  artifactBody.replaceChildren();
  const value = artifactValue(selectedArtifact);
  if (value === null) {
    artifactBody.append(make('p', 'empty-copy', 'Generated files appear here after the local CLI completes.'));
    return;
  }
  artifactBody.append(make('pre', '', String(value)));
}

function selectArtifact(name) {
  selectedArtifact = name;
  for (const tab of artifactTabs) {
    const active = tab.dataset.artifact === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  renderArtifact();
}

function renderResult(next) {
  result = next;
  summaryPanel.hidden = false;
  document.querySelector('#event-count').textContent = String(next.events.length);
  document.querySelector('#tool-count').textContent = String(next.events.filter((event) => event.class === 'TOOL').length);
  document.querySelector('#verification-state').textContent = next.verification.exitCode === 0 ? 'PASS' : 'FAIL';
  document.querySelector('#verification-detail').textContent = next.verification.stdout.trim() || 'Manifest and payload check';
  document.querySelector('#session-id').textContent = next.session;
  document.querySelector('#session-harness').textContent = 'Adapter: ' + next.harness + ' · ' + next.format;
  commandLine.textContent = next.command.map(shellQuote).join(' ');
  cliOutput.textContent = next.cli.stdout || '(No standard output.)';
  cliStderr.textContent = next.cli.stderr || '(No standard error.)';
  stderrDetails.hidden = !next.cli.stderr;
  setCliStatus(next.ok ? 'PASS' : 'FAIL', next.ok ? 'success' : 'failure');
  exportButton.disabled = !next.ok;
  renderTimeline();
  renderArtifact();
  if (next.ok) setStatus('Capture and verification passed. Full events and generated artifacts are available below.', 'success');
  else setStatus(next.error || 'Capture failed. See CLI mode for the raw output.', 'error');
}

async function runSession() {
  const item = selectedScenario();
  if (!item) return;
  runButton.disabled = true;
  exportButton.disabled = true;
  setCliStatus('RUNNING');
  setStatus('Running the actual local capture CLI against a synthetic session…');
  commandLine.textContent = 'node tools/handoff.mjs build --source <synthetic-fixture> --harness ' + item.harness;
  cliOutput.textContent = 'Preparing deterministic fixture…\nExecuting capture…\nVerifying persisted result…';
  cliStderr.textContent = '';
  stderrDetails.hidden = true;
  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ scenario: item.id })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      if (payload.cli) {
        commandLine.textContent = payload.cli.command.map(shellQuote).join(' ');
        cliOutput.textContent = payload.cli.stdout || payload.error || 'Capture failed.';
        cliStderr.textContent = payload.cli.stderr || '';
        stderrDetails.hidden = !payload.cli.stderr;
      } else {
        cliOutput.textContent = payload.error || 'Capture failed.';
      }
      setCliStatus('FAIL', 'failure');
      setStatus(payload.error || 'Capture failed.', 'error');
      result = null;
      summaryPanel.hidden = true;
      renderTimeline();
      renderArtifact();
      return;
    }
    renderResult(payload);
  } catch {
    setCliStatus('FAIL', 'failure');
    setStatus('The local demo server did not return a valid result.', 'error');
    cliOutput.textContent = 'Could not complete the local capture request.';
  } finally {
    runButton.disabled = false;
  }
}

function exportSession() {
  if (!result || !result.ok) return;
  const bundle = {
    localOnly: true,
    syntheticDataOnly: true,
    session: result.session,
    harness: result.harness,
    scenario: result.scenario,
    manifest: result.manifest,
    timeline: result.events,
    artifacts: result.artifacts,
    verification: result.verification
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = make('a');
  link.href = url;
  link.download = 'agents-handoff-demo-' + result.scenario + '.json';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setMode(mode) {
  for (const tab of modeTabs) {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  for (const [name, view] of Object.entries(modeViews)) view.hidden = name !== mode;
}

runButton.addEventListener('click', runSession);
exportButton.addEventListener('click', exportSession);
timelineSearch.addEventListener('input', renderTimeline);
eventFilter.addEventListener('change', renderTimeline);
for (const tab of artifactTabs) tab.addEventListener('click', () => selectArtifact(tab.dataset.artifact));
for (const tab of modeTabs) tab.addEventListener('click', () => setMode(tab.dataset.mode));

loadHarnesses();
