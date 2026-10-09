#!/usr/bin/env node
// tools/agent-handoff.mjs — the runtime layer under its PRE-RENAME name.
//
// The product is agents-handoff, and the runtime lives at tools/agents-handoff.mjs. This file
// stays so that a script, a note, a hook or a CI step written against the old path keeps
// working: it forwards every argument to the real runtime and passes stdout, stderr and the
// exit code through unchanged. No verbs live here — do not add any; edit the real file.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const REAL = path.join(HERE, 'agents-handoff.mjs');

if (!fs.existsSync(REAL)) {
  console.error('agent-handoff: the runtime this path forwards to is missing (' +
    path.relative(process.cwd(), REAL) + ')');
  process.exit(2);
}

const r = spawnSync(process.execPath, [REAL, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
