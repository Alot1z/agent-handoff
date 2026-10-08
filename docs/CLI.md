---
title: Command reference
---

# Command reference

Every executable in this repository. Each one is a standalone Node script with zero
dependencies; there is no build step and nothing to install to run them from a checkout.

| Executable | Role | Invoked as |
|---|---|---|
| [`tools/handoff.mjs`](https://github.com/Alot1z/agent-handoff/blob/main/tools/handoff.mjs) | Capture engine: transcript in, handoff folder out. | `node tools/handoff.mjs <verb>`, or the published `agent-handoff` bin |
| [`tools/agent-handoff.mjs`](https://github.com/Alot1z/agent-handoff/blob/main/tools/agent-handoff.mjs) | Runtime layer: acts on the state of the store. | `node tools/agent-handoff.mjs <verb>` |
| [`tools/runtime-engine.mjs`](https://github.com/Alot1z/agent-handoff/blob/main/tools/runtime-engine.mjs) | Bounded execution: evaluates an operation against the policy before running it. | `node tools/runtime-engine.mjs <verb>` |
| [`tools/capability-registry.mjs`](https://github.com/Alot1z/agent-handoff/blob/main/tools/capability-registry.mjs) | Health probes for declared capabilities. | `node tools/capability-registry.mjs <verb>` |
| [`install/install.mjs`](https://github.com/Alot1z/agent-handoff/blob/main/install/install.mjs) | Installs, updates and removes the skill. | `npx agent-handoff-install <verb>` |

Requires Node.js 18 or newer.

## `tools/handoff.mjs` — capture engine

Reads a transcript and writes a handoff directory. The source is never written; every
output file is a render of it. The folder layout, the manifest fields and the provenance
chain are in [FORMAT.md](FORMAT.md).

| Verb | Effect |
|---|---|
| `build --source <file>` | Build or update a handoff from a transcript. |
| `--handoff --source <file>` | Alias of `build`. |
| `list [project-or-prefix]` | List sessions, newest first. |
| `show <id-prefix>` | Print the rendered brief. |
| `verify <id-prefix>` | Re-check the provenance chain and the file set. |
| `rename <id-prefix> <new-project>` | Move a session to another project. |
| `retitle <id-prefix> <new-name>` | Give a session a readable directory name. |
| `config` | Report the resolved store root, the rule that chose it, the config file, the schema path and the configured project. |

### `build` flags

| Flag | Meaning |
|---|---|
| `--source <file>` | Required. A `.jsonl` file is read line by line; any other extension is read as text. |
| `--session <id>` | Session id. Defaults to the `session` field on the first JSONL line, else the source file name without its extension. |
| `--harness <name>` | Harness name recorded in the manifest. Defaults to the source's own field, else `unknown`. |
| `--model <name>` | Model recorded in the manifest. Defaults to the source's own field, else empty. |
| `--project <name>` | Project slug. The session directory is created under `projects/<project>/`. |
| `--objective <text>` | Objective line for the brief. |

`build` is incremental. It appends the turns with `seq` above the manifest's `watermark`,
sets the watermark to the highest `seq` seen, and increments `revisions`. `timeline.jsonl`
is append-only; the renders are rewritten. A rebuild with no new turns and an unchanged
source hash writes nothing and prints `handoff: up-to-date`.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. For `verify`, all checks passed. |
| 1 | `verify` failed: the manifest hash, the timeline line count or the LLM payload does not match. |
| 2 | Usage error, for example `build` without `--source`. |
| 3 | The id prefix matched more than one session, or none. |
| 4 | No match for `show`/`verify`/`rename`/`retitle`; also `build` when no turn could be parsed from the source. |

## `tools/agent-handoff.mjs` — runtime layer

Acts on the state of the store rather than being invoked per file. Every mutating command
takes a lock in `<root>/.locks/`, so two runs cannot capture or merge the same session at
once. Behaviour per command is described in [LEVEL4.md](LEVEL4.md).

| Verb | Effect |
|---|---|
| `auto --source <file>` | Build only when the source is newer than the stored manifest; skip within `--min-fresh-ms` (default 60000). |
| `verify-gate <id-prefix>` | Five checks: `sha`, `counts`, `payload`, `contract`, `evidence`. |
| `promote <id-prefix>` | Stamp `promoted_at` and `promoted_by` on the manifest. |
| `merge <a> <b>` | Compose two sessions of one project into `<a>+merge+<b>`. |
| `dispatch <id-prefix> --task <objective>` | Hand the continuation to a worker. See [LEVEL5.md](LEVEL5.md). |
| `federated-merge --from <root> [--from <root> …] [--dry-run]` | Import sessions from another store root. |
| `self-improve` | Scan for brief shortfalls and write a rules candidate file. |
| `index` | Rebuild `INDEX.json` and report sessions with no `HANDOFF.md`. |

`auto` flags: `--source` (required), `--session`, `--harness`, `--project`, `--min-fresh-ms`.
`dispatch` flags: `--task` (required), `--role` (default `implementation-agent`), `--parent`
(default `handoff:<id>`), `--broker <root>`, `--live`.

`verify-gate` exits 0 for both `VERIFIED` and `REJECTED`. Read `ok` or `verdict` from the
JSON; the exit code alone does not report a rejection. `promote` prints the gate result but
does not enforce it — run `verify-gate` and branch on the verdict first.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. |
| 1 | A mutating command failed; the lock was released. |
| 2 | Usage or configuration error, including an unresolvable store root. |
| 3 | A lock is held, an id prefix is ambiguous or missing, or a referenced path is missing. |
| 4 | No session matches the prefix. |

## `tools/runtime-engine.mjs` — bounded execution

Evaluates every operation against [permission-policy.json](https://github.com/Alot1z/agent-handoff/blob/main/permission-policy.json)
before it runs, and records the decision whether it was allowed, refused or failed. Levels,
risk classes and grants are in [PERMISSIONS.md](PERMISSIONS.md).

| Verb | Effect |
|---|---|
| `evaluate --risk R0..R4 [--target <path>] [--json]` | Classify the target and return the verdict without running anything. |
| `run --risk R0\|R1 --op read --target <path>` | Evaluate, then read the file when allowed. |
| `run --risk R1 --op spawn --args "<node args>"` | Evaluate, then run the local node binary with a 15000 ms timeout. |
| `job --session <s> --steps <n> [--fail-at <k>] [--json]` | Run a checkpointed job of `n` steps, gated at `R1`. |
| `resume --session <s> --steps <n> [--json]` | Continue from the last sealed checkpoint. |
| `status --session <s> [--json]` | Report the durable state of a session's job. |
| `policy` | Print the loaded policy. |

Verdicts are `ALLOWED`, `DENIED` and `NEEDS_AUTH`. A denied or personal-data target is
refused at any risk class and is never executed.

| Code | Meaning |
|---|---|
| 0 | Allowed, executed, or completed. |
| 1 | Execution error, or the child produced no exit code. |
| 2 | Usage or configuration error. |
| 3 | Denied. |
| 4 | Needs authorization, or no checkpoint to resume from. |
| 5 | Checkpoint corrupt, or its integrity seal does not match. |
| 137 | Simulated abrupt kill (`--fail-at`). |
| other | The captured exit code of the spawned child. |

## `tools/capability-registry.mjs` — capability probes

Runs a real probe per declared capability and reports what it observed. An unknown probe
kind, a probe error and an unreadable target are reported as `unknown` or `unhealthy` with
the evidence — never interpreted into a passing verdict.

| Verb | Effect |
|---|---|
| `check [--registry <file>] [--json] [<id>]` | Probe every capability, or one by id; write the state file. |
| `list [--registry <file>] [--json]` | Show declared capabilities with the verdict from the last check. |

Probe kinds: `file-exists`, `dir-writable`, `command` (with `command` and `args`; the token
`<node>` means the running node binary).

| Code | Meaning |
|---|---|
| 0 | Every required capability is `healthy`. |
| 1 | A required capability is `unhealthy` or `unknown` — `unknown` is never accepted as healthy. |
| 2 | The registry file is missing, not valid JSON, or has no `capabilities` array. |
| 4 | Unknown capability id, or a usage error. |

State is written to `<state>/capability-state.json`, where `<state>` is
`AGENT_HANDOFF_STATE_DIR` or `.agent-handoff/`.

## `install/install.mjs` — installer

Published as `agent-handoff-install`. Location resolution is documented in
[INSTALL.md](INSTALL.md).

| Verb | Effect |
|---|---|
| `install` (default) | Install the skill. |
| `update` | Update to the latest or a specified version. |
| `remove` | Remove the installation. |
| `verify` | Verify installation integrity. |
| `list` | List every installed location. |
| `where` | Show the resolved global root and why it was chosen. |

| Flag | Meaning |
|---|---|
| `--location global\|local\|project` | Target location. Default `global`. |
| `--path <dir>` | Install to an exact directory. |
| `--version latest\|<v>` | Version to install. Default `latest`. |
| `--force`, `-f` | Skip confirmations and overwrite. |

## Environment variables

| Variable | Read by | Effect |
|---|---|---|
| `HANDOFFS_ROOT` | capture engine, runtime layer | Store root. Always wins over every other rule. |
| `AGENT_HANDOFF_STATE_DIR` | runtime engine, capability registry | State directory for executions, checkpoints, jobs and capability state. Default `<repo>/.agent-handoff`. |
| `AGENT_HANDOFF_GLOBAL_DIR` | installer | Overrides the resolved global install root. |

## Files written

| Path | Written by |
|---|---|
| `<root>/INDEX.json` | `build`, `index` |
| `<root>/projects/<project>/<session>/` | `build`, `merge`, `federated-merge`, `retitle`, `rename` |
| `<root>/links/<project>.md` | `merge` |
| `<root>/.locks/<hash>.lock` | every mutating runtime command |
| `<state>/executions/<id>.json` | `runtime-engine run`, `job` |
| `<state>/checkpoints/<session>.json` | `runtime-engine job`, `resume` |
| `<state>/jobs/<session>/work.log` | `runtime-engine job` |
| `<state>/capability-state.json` | `capability-registry check` |
| `<skill>/docs/self-improve-candidates.json` | `self-improve` |

`self-improve` writes inside the skill directory on purpose: the candidate file describes the
skill's brief rules, so a configured store never collects rule candidates.
