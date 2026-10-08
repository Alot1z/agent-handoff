---
title: Level 4 — the dynamic runtime layer
---

# Level 4 — the dynamic runtime layer

The engine ([handoff.mjs](https://github.com/Alot1z/agent-handoff/blob/main/tools/handoff.mjs)) is passive: something has to invoke it. The
runtime layer is [tools/agent-handoff.mjs](https://github.com/Alot1z/agent-handoff/blob/main/tools/agent-handoff.mjs), which acts on the
state of the store — it probes for staleness, checks a handoff against a contract, composes
sessions, imports other stores and maintains the index.

Every mutating command takes a lock, so two runs cannot capture or merge the same session at
once. Locks live in `<root>/.locks/` and are named after a hash of the operation target.

```bash
node tools/agent-handoff.mjs <command> [args]
```

| Command | Purpose |
|---|---|
| `auto --source <file>` | Build only when the source is newer than the stored manifest. |
| `verify-gate <id-prefix>` | Five checks: sha, counts, payload, contract, evidence. |
| `promote <id-prefix>` | Stamp promotion metadata on a handoff's manifest. |
| `merge <a> <b>` | Compose two sessions of one project into one handoff. |
| `dispatch <id-prefix> --task <objective>` | Hand the continuation to a worker (Level 5). |
| `federated-merge --from <root>` | Import sessions from another store root. |
| `self-improve` | Collect brief shortfalls into a rules candidate file. |
| `index` | Rebuild `INDEX.json` and report stale sessions. |

An unknown command prints that list and exits 2.

## `auto` — self-triggering capture

```bash
node tools/agent-handoff.mjs auto --source transcript.jsonl \
  [--session <id>] [--harness <name>] [--project <name>] [--min-fresh-ms <n>]
```

`--source` is required. Two gates run before any build:

1. **Freshness.** If the session's manifest exists and `source_mtime - manifest.updated_at`
   is below `--min-fresh-ms` (default 60000), nothing is built and the command prints
   `{"action":"skip-fresh"}`.
2. **Lock.** A capture already in flight for the same project and session exits 3.

It then runs the engine's `build` and prints `{"action":"captured",...}`. A missing source
file exits 2.

## `verify-gate` — the evidence gate

```bash
node tools/agent-handoff.mjs verify-gate <id-prefix>
```

| Check | Passes when |
|---|---|
| `sha` | `manifest_sha256` equals the hash of the manifest without that field. |
| `counts` | Lines in `timeline.jsonl` equal `turn_count`. |
| `payload` | `HANDOFF.llm.json` parses as JSON. |
| `contract` | `HANDOFF.md` contains all seven contract fields, each at the start of a line. |
| `evidence` | Not `RESULT: DONE` with no `EVIDENCE:` line. |

The contract fields are `RESULT`, `WHAT_CHANGED`, `VALIDATION`, `EVIDENCE`, `BLOCKERS`,
`RISKS`, `FOLLOW_UP`. The verdict is `VERIFIED` when every check is `PASS`, otherwise
`REJECTED`, printed as JSON with the per-check table.

**The command exits 0 in both cases.** A caller must read `ok` or `verdict` from the JSON —
the exit code alone does not report a rejection. Only a bad prefix (exit 3) or a missing
manifest is visible as a nonzero status.

## `promote` — stamping verified work

```bash
node tools/agent-handoff.mjs promote <id-prefix>
```

The manifest is backed up to `manifest.json.bak`, the gate above is run and its verdict is
printed, and the manifest is then stamped with `promoted_at` and `promoted_by` and re-hashed.

Two honest caveats:

- The gate result is **printed, not enforced**. The stamp is written even when the verdict is
  `REJECTED`; a caller that wants a gate must run `verify-gate` and branch on `verdict`
  before calling `promote`.
- Promotion is local. It writes one flag pair into one manifest file; it contacts no external
  system and publishes nothing.

## `merge` — composing two sessions

```bash
node tools/agent-handoff.mjs merge <id-prefix-a> <id-prefix-b>
```

Timelines are concatenated and sorted by `ts`, and written to a new session directory named
`<a>+merge+<b>` under the first project. The merged manifest records `harness: "merged"`,
`merged_from: [a, b]` and a fresh `raw_sha256` over the joined timeline. A note is appended
to `links/<project-b>.md` with a `<!-- merged:<id> -->` marker, so a re-run does not duplicate
it.

A merged session has no `HANDOFF.md`, no payload and no `TOOLS.md`, so it fails `verify-gate`
on `contract` and `payload` until a brief is written for it, and `index` reports it as stale.

## `federated-merge` — importing another store root

```bash
node tools/agent-handoff.mjs federated-merge --from <remote-root> [--from <root> ...] [--dry-run]
```

Each remote root is expected to have the same `projects/<project>/<session>/` layout. A
session is imported when its `manifest_sha256` differs from the local copy, or when no local
copy exists; identical sessions are counted as skipped, so re-running imports only what
changed. `--dry-run` lists the actions without writing.

On import: an existing local manifest is backed up to `manifest.json.bak-federated`, the
session directory is copied, and `federated_from` and `federated_at` are stamped on the
canonical manifest, which is then re-hashed. Every imported session is verified with the
engine's `verify` afterwards, and the index is rebuilt. Per-session failures are listed in
the `failed` array rather than aborting the run. A root without a `projects/` directory is
recorded as failed, and a missing `--from` exits 2.

## `self-improve` — brief shortfalls

```bash
node tools/agent-handoff.mjs self-improve
```

Every session is scanned, and a session with 40 or more USER+AGENT turns whose `HANDOFF.md`
is shorter than 800 characters is reported as a candidate. The output is written to
`docs/self-improve-candidates.json` inside the skill directory — deliberately skill-relative,
so a configured store never collects rule candidates. The file lists counts, not content.

## `index` — the store index

```bash
node tools/agent-handoff.mjs index
```

Rebuilds `<root>/INDEX.json` from the manifests, with one entry per session (`id`, `uuid`,
`project`, `harness`, `turns`, `revisions`, `updated`, `manifest_sha256`), and reports
sessions that have a manifest but no `HANDOFF.md`.

## Bounded execution — `runtime-engine.mjs`

[tools/runtime-engine.mjs](https://github.com/Alot1z/agent-handoff/blob/main/tools/runtime-engine.mjs) is the command-execution half of the
runtime: every operation is evaluated against `permission-policy.json` **before** it runs, and
a denied operation is recorded but never executed.

```bash
node tools/runtime-engine.mjs evaluate --risk R0..R4 [--target <path>] [--json]
node tools/runtime-engine.mjs run --risk R0|R1 --op read --target <path>
node tools/runtime-engine.mjs run --risk R1 --op spawn --args "<node args>"
node tools/runtime-engine.mjs policy
node tools/runtime-engine.mjs job --session <s> --steps <n> [--fail-at <k>] [--json]
node tools/runtime-engine.mjs resume --session <s> --steps <n> [--json]
node tools/runtime-engine.mjs status --session <s> [--json]
```

| Verdict | Meaning |
|---|---|
| `ALLOWED` | The grant for the risk class's level is `allow`. |
| `DENIED` | Refused: an explicit denial, a personal-data path, an unknown risk, or an unknown grant. |
| `NEEDS_AUTH` | The grant is `needs_auth`; the operation waits for authorization and does not run. |

Targets are classified in a fixed order: an explicit denial first, then the engine's own
state directory, then the approved workspaces, then the broad personal-data roots, then
system read-only roots, otherwise external. A personal-data or denied path is refused at any
risk. A read-only level is allowed inside an approved workspace or a system path; every other
level requires an approved workspace. Levels, risk classes and grants are documented in
[PERMISSIONS.md](PERMISSIONS.md).

The `spawn` operation is bounded: it runs the local node binary with the given arguments, the
working directory pinned to the repository, a 15000 ms timeout, and the output captured and
hashed rather than streamed. Each decision — allowed, refused or failed — is written to
`<state>/executions/<id>.json` with `enforced_before_execution: true`.

Checkpoints make a job resumable from disk alone: after each step, `<state>/checkpoints/<session>.json`
is rewritten with a sha256 seal, and the step is appended to `<state>/jobs/<session>/work.log`.
Each step is permission-gated at `R1`. `--fail-at <k>` simulates an abrupt kill before step
`k` executes, leaving the durable state at `k-1`.

The state directory is `<repo>/.agent-handoff`, or `AGENT_HANDOFF_STATE_DIR` when set.

| Code | Meaning |
|---|---|
| 0 | Allowed, executed, or completed. |
| 1 | Execution error, or the child produced no exit code. |
| 2 | Usage or configuration error. |
| 3 | Denied. |
| 4 | Needs authorization, or no checkpoint to resume from. |
| 5 | Checkpoint corrupt, or its integrity seal does not match. |
| 137 | Simulated abrupt kill. |
| other | The captured exit code of the spawned child. |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. |
| 1 | A mutating command failed; the lock was released. |
| 2 | Usage or configuration error, including an unresolvable store root. |
| 3 | A lock is held, an id prefix is ambiguous, or a referenced path is missing. |
| 4 | No session matches the prefix. |
