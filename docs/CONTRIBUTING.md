---
title: Contributing
---

# Contributing

## Requirements

Node.js 18 or newer. The tools import `node:*` only, so there is no runtime dependency to
install and no lockfile to keep in sync.

## Run the suite

```
node tools/handoff.test.mjs
```

`npm test` runs the same command. The suite uses `node:test` and `node:assert` only, and
drives the real CLIs through `spawnSync`. It is hermetic: every test builds into a temporary
`HANDOFFS_ROOT`, batch runtime state goes to a temporary `AGENT_HANDOFF_STATE_DIR`, and both
are removed afterwards. A bare run leaves no files behind.

| Area | Asserted |
|---|---|
| Engine: build, verify, list | Build from the shipped fixture, `verify` prints `PASS` and exits 0, a tampered manifest fails `verify` with exit 1, `list` shows the session under its project, a malformed source exits 4, a missing source exits 2, usage errors exit 2, a rebuild of identical input stays up to date without a new revision. |
| Capability registry | Required capabilities probe healthy, an unknown capability id exits 4, an unknown probe kind is never reported healthy, a missing registry file exits 2. |
| Permission engine | Evaluation precedes execution (records carry `enforced_before_execution`), a personal-data read is denied with exit 3 and never executed, `R2` on the workspace is `NEEDS_AUTH` with exit 4, a bounded spawn propagates the child's exit code, an unknown risk class is default-denied, an approved workspace outranks a broad personal-data root, a traversal target is denied. |
| Checkpoint and resume | A job killed mid-run resumes from disk alone with no step duplicated or lost, a missing checkpoint exits 4, a tampered checkpoint fails its seal with exit 5, a second job refuses an existing session checkpoint, a mismatched `--steps` exits 2. |

## Drive a CLI by hand

```
node tools/handoff.mjs build --source tests/fixtures/minimal-transcript.jsonl --project demo
node tools/handoff.mjs list
node tools/handoff.mjs show minimal-transcript
node tools/handoff.mjs verify minimal-transcript
node tools/handoff.mjs config

node tools/runtime-engine.mjs policy
node tools/runtime-engine.mjs evaluate --risk R0 --target tests/fixtures/minimal-transcript.jsonl

node tools/capability-registry.mjs check --registry capability-registry.json
```

`build`, `rename` and `retitle` write into the resolved store. Point `HANDOFFS_ROOT` at a
temporary directory while experimenting so a test session is not added to your own store:

```
HANDOFFS_ROOT=/tmp/ah-scratch node tools/handoff.mjs build --source tests/fixtures/minimal-transcript.jsonl
```

On Windows use `set HANDOFFS_ROOT=...` in cmd, or `$env:HANDOFFS_ROOT="..."` in PowerShell.

| Tool | Exit codes |
|---|---|
| `tools/handoff.mjs` | 0 success, 1 verification failure or I/O error, 2 usage or invalid config, 3 ambiguous id prefix, 4 no matching handoff or no usable turns |
| `tools/runtime-engine.mjs` | 0 allowed, 2 usage or config error, 3 denied, 4 needs authorization or missing checkpoint, 5 corrupt checkpoint, 137 simulated kill, otherwise the child's exit code |
| `tools/capability-registry.mjs` | 0 all required capabilities healthy, 1 a required capability is unknown or unhealthy, 2 registry missing or invalid, 4 unknown capability id |

## Add a harness adapter

The engine consumes one canonical input shape, so an adapter is anything that turns a
session store into that shape. One JSONL line:

```json
{"seq":0,"ts":"<epoch or ISO>","harness":"<name>","source":"<origin path>","session":"<id>",
 "thread":"<project/thread>","role":"user|assistant|system|tool","kind":"<reasoning|tool_use|text>",
 "text":"<message body>"}
```

Rules the parser applies. Text is taken from `text`, then `content`, then `parts[].text`. A
JSONL line that does not parse, or whose text is blank, is skipped. The class comes from
`kind` and `role`: `tool` in `kind`, or `role: tool`, is `TOOL`; `reason` or `think` in
`kind` is `THOUGHT`; `role: user` or `kind: human` is `USER`; `role: assistant` or `kind: ai`
is `AGENT`; anything else is `OTHER`. A `.txt` or `.md` source is read as role-marked text
instead (`user:`, `assistant:`, `tool:`, optionally prefixed with `#`).

Checklist:

1. Produce the canonical JSONL from the store, without modifying the store.
2. Build from it with `HANDOFFS_ROOT` set to a temporary directory and read the result.
3. Add a row to [ADAPTERS.md](../refs/ADAPTERS.md): store path, adapter route, status. Claim
   `VERIFIED` only for a source you actually ran.
4. If the parser changed, add a fixture under `tests/fixtures/` and a test to
   `tools/handoff.test.mjs`.

## Rules for a change

- Add no runtime dependency. The engine stays importable and runnable with a bare Node
  installation.
- Keep the exit codes. They are contracts (see the table above and
  [INTEGRATION.md](INTEGRATION.md)).
- Never commit session data or credentials: no `handoffs/`, `projects/`, `links/`,
  `.agent-handoff/`, no `*.key`, `*.pem`, `*.token`, and no transcript copied from a real
  session. Test input belongs in `tests/fixtures/`.
- A behaviour change comes with a test in `tools/handoff.test.mjs` and an update to the
  document that owns the contract: [FORMAT.md](FORMAT.md) for the files and fields,
  [PERMISSIONS.md](PERMISSIONS.md) for policy semantics, [INTEGRATION.md](INTEGRATION.md)
  for the command surface.
- Run the suite before proposing the change and report its actual result, including
  failures you could not fix.

## Repository layout

| Path | Contents |
|---|---|
| `SKILL.md` | The skill definition a harness reads: when to use it, its commands and its rules. |
| `docs/` | These documents. |
| `install/` | `install.mjs`, the `npx` installer, and its own README. |
| `tools/handoff.mjs` | The handoff engine: build, list, show, verify, rename, retitle, config. |
| `tools/agent-handoff.mjs` | The runtime verbs layered over the engine. |
| `tools/runtime-engine.mjs` | Permission policy, bounded execution, checkpoints and resume. |
| `tools/capability-registry.mjs` | Probes declared capabilities and reports honest verdicts. |
| `tools/handoff.test.mjs` | The test suite. |
| `tools/lib/handoff-root.mjs` | The single definition of where handoffs are stored. |
| `schemas/` | `handoff.schema.json`, the portable payload contract. |
| `templates/` | The handoff render template. |
| `refs/` | Reference documents: harness adapters, protocol, roles, validator, brief checklist. |
| `tests/fixtures/` | Deterministic inputs for the suite. |
| `src/` | Reference sources collected from the systems this skill was assembled from. Nothing under `tools/` imports them. |
| `permission-policy.json` | The default permission policy. |
| `capability-registry.json` | The default capability declarations. |
| `handoff.config.schema.json`, `handoff.config.example.json` | Schema and example for `handoff.config.json`. |
| `.github/workflows/` | Continuous integration and release workflows. |

## Documentation is part of the contract

A claim in these documents is expected to be checkable against the code. If you change a
file layout, a field, a flag or an exit code, update the document that states it in the same
change. Do not document an option that a tool does not implement; if something is reserved
but not implemented, say so, as `handoff.config.schema.json` does for `auto_capture`.

## License

MIT. By contributing you agree your contribution is distributed under it.
