---
title: Command reference
---

# Command reference

Every executable in this repository. Each one is a standalone Node script with zero
dependencies; there is no build step and nothing to install to run them from a checkout.

| Executable | Role | Invoked as |
|---|---|---|
| [`tools/handoff.mjs`](https://github.com/Alot1z/agent-handoff/blob/main/tools/handoff.mjs) | Capture engine: transcript in, handoff folder out. | `node tools/handoff.mjs <verb>`, or the published `agents-handoff` bin |
| [`tools/agents-handoff.mjs`](https://github.com/Alot1z/agent-handoff/blob/main/tools/agents-handoff.mjs) | Runtime layer: acts on the state of the store. | `node tools/agents-handoff.mjs <verb>` |
| [`tools/agent-handoff.mjs`](https://github.com/Alot1z/agent-handoff/blob/main/tools/agent-handoff.mjs) | Compatibility forwarder: the runtime layer's pre-rename path, kept so older notes and hooks keep working. | `node tools/agent-handoff.mjs <verb>` (forwards to `tools/agents-handoff.mjs`) |
| [`tools/runtime-engine.mjs`](https://github.com/Alot1z/agent-handoff/blob/main/tools/runtime-engine.mjs) | Bounded execution: evaluates an operation against the policy before running it. | `node tools/runtime-engine.mjs <verb>` |
| [`tools/capability-registry.mjs`](https://github.com/Alot1z/agent-handoff/blob/main/tools/capability-registry.mjs) | Health probes for declared capabilities. | `node tools/capability-registry.mjs <verb>` |
| [`install/install.mjs`](https://github.com/Alot1z/agent-handoff/blob/main/install/install.mjs) | Installs, updates and removes the skill. | `npx agents-handoff <verb>` |

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
| 5 | `build` found unparseable JSONL line(s) it would otherwise skip silently. The message names the line number and reason; pass `--allow-bad-lines` to accept the damaged source deliberately. |

## `tools/agents-handoff.mjs` — runtime layer

Acts on the state of the store rather than being invoked per file. Every mutating command
takes a lock in `<root>/.locks/`, so two runs cannot capture or merge the same session at
once. Behaviour per command is described in [LEVEL4.md](LEVEL4.md).

| Verb | Effect |
|---|---|
| `auto --source <file>` | Build only when the source is newer than the stored manifest; skip within `--min-fresh-ms` (default 60000). |
| `verify-gate <id-prefix>` | Five checks: `sha`, `counts`, `payload`, `contract`, `evidence`. |
| `promote <id-prefix>` | Run the evidence gate and, only if it passes, stamp `promoted_at`, `promoted_by` and `promoted_gate` on the manifest. `--force` overrides a rejected gate on purpose and records `promoted_gate: "FORCED"`. |
| `merge <a> <b>` | Compose two sessions of one project into `<a>+merge+<b>`. |
| `dispatch <id-prefix> --task <objective>` | Hand the continuation to a worker. See [LEVEL5.md](LEVEL5.md). |
| `federated-merge --from <root> [--from <root> …] [--dry-run]` | Import sessions from another store root. |
| `self-improve` | Scan for brief shortfalls and write a rules candidate file. |
| `index` | Rebuild `INDEX.json` and report sessions with no `HANDOFF.md`. |

`tools/agent-handoff.mjs` is a forwarder, not a second implementation: it spawns
`tools/agents-handoff.mjs`, passes every argument through, and exits with the same code. Its
stdout and stderr are the runtime's own. Use the new path in anything you write today; the
old one exists only so a command that already names it does not break.

`auto` flags: `--source` (required), `--session`, `--harness`, `--project`, `--min-fresh-ms`.
`dispatch` flags: `--task` (required), `--role` (default `implementation-agent`), `--parent`
(default `handoff:<id>`), `--broker <root>`, `--live`.

`verify-gate` reports a rejection twice: `ok: false` and `verdict: "REJECTED"` in the JSON, and
`exit 6`. A gate that failed is not a success, so a caller that only reads the exit code still
fails closed. `promote` runs the same gate and **refuses** (`exit 6`) when it is rejected — pass
`--force` to override deliberately, which is recorded in the manifest as `promoted_gate:
"FORCED"` rather than `"VERIFIED"`.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. |
| 1 | A mutating command failed; the lock was released. |
| 2 | Usage or configuration error, including an unresolvable store root. |
| 3 | A lock is held, an id prefix is ambiguous, or a referenced path is missing. |
| 4 | No session matches the prefix. |
| 6 | An evidence gate rejected the handoff (`verify-gate` and `promote`). |
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
`AGENT_HANDOFF_STATE_DIR` or `.agents-handoff/`.

## `install/install.mjs` — installer

Published as `agents-handoff`. Location resolution is documented in
[INSTALL.md](INSTALL.md).

A bare verb and its flag form are the same command: `npx agents-handoff update` and
`npx agents-handoff --update` behave identically.

| Verb | Flag form | Effect |
|---|---|---|
| `install` (default), `i` | `--install` | Install the skill into every selected target. |
| `update`, `u` | `--update` | Update to the latest or a named version. |
| `remove`, `rm` | `--remove` | Remove the installation, keeping everything that is not the installer's. |
| `verify`, `v` | `--verify` | Verify each installation against the record written when it was installed. |
| `verify-package`, `vp` | `--verify-package` | Verify each installation against the tarball npm publishes for its version. |
| `list`, `ls` | `--list` | List every installed location, with its provenance state. |
| `where` | — | Show the resolved global root and why it was chosen. |
| `doctor` | `--doctor` | Report which harnesses exist here, what is installed where, and whether each installation still matches its record. Read-only: it never installs. |
| `help` | `--help`, `-h` | Print the usage block. |

Harness targets. With no harness flag the installer keeps its historical single target
(`--location` / `--path`); any of these switches to named targets, and several may be combined
in one run — each target gets its own copy and its own install record.

| Flag | Target |
|---|---|
| `--claude` | `~/.claude/skills/` — Claude Code personal skills. |
| `--codex` | `~/.codex/skills/` — Codex CLI personal skills. |
| `--agents` | `~/.agents/skills/` — the harness-neutral store. |
| `--harness <a,b>` | Named harnesses, comma separated; repeatable. |
| `--all` | Every harness whose directory exists on this machine. |
| `--skills-dir <dir>` | Any other stack, exactly; repeatable. |
| `--project` | Use the per-repository form of the harness directories (`./.claude/skills`, `./.codex/skills`). |

| Flag | Meaning |
|---|---|
| `--location global\|local\|project` | Target location. Default `global`. |
| `--path <dir>` | Install to an exact directory. |
| `--version latest\|<v>` | Version to install. Default `latest`. |
| `--force`, `-f` | Skip confirmations and overwrite. |
| `--provenance` | With `verify`: print the install record the check was run against. |
| `--record` | With `verify-package`: store the fetched tarball hashes in the install record. |

### `update` and `verify` with no harness flag

A machine can hold the same skill in several places at once — `~/.claude/skills` for Claude
Code, `~/.agents/skills` for a neutral store, an account-skill store a desktop client reads.
With no harness flag, `update` and `verify` act on **every** installation they can find rather
than on the single target the resolver happens to pick, because updating only the resolved one
is how a second harness keeps an old engine without anyone noticing.

The search covers the resolved global root, `./local/skills`, `./skills`, `~/.claude/skills`,
`~/.codex/skills`, `~/.agents/skills`, each harness's per-repository form, and every
account-skill root discovered under the platform's application-data directories. `update`
reports one line per installation, with the version before and after; `verify` fails the run
when any copy fails. Neither touches a store, `handoff.config.json` or any file the install
manifest does not name.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | The command ran and everything it checked passed. |
| 1 | Any failure: a usage error, nothing installed to act on, a verification that did not match, or a `verify-package` mismatch. |

### The install record

Every install writes `.agents-handoff-install.json` into the copy it just made. [FORMAT.md](FORMAT.md)
lists the fields and [PROVENANCE.md](PROVENANCE.md) states what the record does and does not prove.

| Field | Contents |
|---|---|
| `schema_version` | `1.0-install-provenance`. |
| `product`, `version` | `agents-handoff`, and the version read back out of the installed `SKILL.md`. |
| `installer_version` | The installer package's own version. |
| `installed_at` | ISO timestamp of the write. |
| `harness` | The harness the copy went into, or `null` for the resolved single target. |
| `target` | Absolute install directory. |
| `source` | What the copy was made from: `{kind: "tree", path}` for a checkout or release archive, or `{kind: "archive", ref, label, archive_url, archive_sha256}` for a fetched tag archive. |
| `package` | The npm identity this install should match: `name`, `version`, `registry`, `tarball`, `sha256`, `sha512`, `integrity`, `shasum`, `verified_at`. The hashes are `null` until `verify-package --record` fills them, because a copy made from a tree is not the published tarball. |
| `file_count`, `manifest_entries` | Files present, and entries in the installer's manifest. |
| `files_sha256` | One sha256 folded over every manifest path together with that file's own hash. |
| `files` | Per-path sha256, or `missing` for a path this version does not have. |

### What `verify` compares

For each installation: that every manifest file exists (a path the version never had is
reported as not part of that version rather than failed), that `SKILL.md` carries a name and a
version, that the engine actually runs — `tools/handoff.mjs config` must exit 0 with its
resolved-root marker, which also proves the import graph resolves — and that a recomputed
`files_sha256` equals the recorded one. An installation made before this record existed is
reported as having none, never silently passed.

### What `verify-package` checks, and in what order

Each step makes the next one meaningful:

1. **The registry's own hashes.** The tarball is downloaded for the installed version and must
   match the `integrity` (sha512) and `shasum` (sha1) the registry declares for it; otherwise
   "the published package" is just whatever the network handed over.
2. **Per-file identity.** The manifest is compared file by file against the extracted tarball,
   and every difference is named (`not installed`, `not in the published package`, or
   `content differs`).
3. **The recorded hash.** When the install record already holds a package `sha256`, it must
   match too.

Without `--record` nothing is written; with it, the fetched `sha256`, `sha512`, `integrity`
and `shasum` are stored in `package`. A version that is not on the registry cannot pass this
check, and it says so rather than reporting success.

### What `remove` deletes

`remove` deletes what the install manifest owns, plus the record it wrote itself and the
`private` `package.json` stub it created — and nothing else. Store directories, notes, a
`handoff.config.json`, and any file a later version treats as user data survive by default,
and every entry that was left is printed under `Kept — not the installer's to delete:`.

## Environment variables

| Variable | Read by | Effect |
|---|---|---|
| `HANDOFFS_ROOT` | capture engine, runtime layer | Store root. Always wins over every other rule. |
| `AGENT_HANDOFF_STATE_DIR` | runtime engine, capability registry | State directory for executions, checkpoints, jobs and capability state. Default `<repo>/.agents-handoff`. |
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
| `<install>/.agents-handoff-install.json` | `install`, `update`, `verify-package --record` |

`self-improve` writes inside the skill directory on purpose: the candidate file describes the
skill's brief rules, so a configured store never collects rule candidates.
