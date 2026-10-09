---
title: Architecture
---

# Architecture

## The problem the shape solves

A working session lives inside whatever client recorded it. Continuing that session
elsewhere means either pasting the chat back in, or starting from memory. Both lose the part
that matters: the exact turns, the tool calls, and the ability to prove which source bytes
produced the brief you are reading.

agents-handoff turns the session into files instead. A directory of plain text and JSON, a
hash chain over it, and a fixed folder layout. Anything that can read a file can continue
from one, with no shared memory between the two sessions.

## Layers

Five layers, each with one job, and each usable without the ones above it.

| Layer | File | Job |
|---|---|---|
| Capture engine | `tools/handoff.mjs` | Turns one transcript into one handoff folder. Passive: something has to invoke it. |
| Runtime layer | `tools/agents-handoff.mjs` | Acts on the state of the store: staleness, gates, composition, imports, index. |
| Bounded execution | `tools/runtime-engine.mjs` | Decides whether an operation may run, before running it. |
| Capability probes | `tools/capability-registry.mjs` | Reports what a declared capability actually does on this machine. |
| Distribution | `install/install.mjs` | Puts the skill where a client will look for it — one harness, several at once, or an exact directory — and records what it installed. |

The capture engine has no opinion about installation, and the runtime layer has no opinion
about transcripts — it shells out to the engine for builds and verification. That split is
what lets a store be inspected with one file, `manifest.json`, without loading anything else.

## Data flow

```
transcript ─────────────► build ─────────────► <root>/projects/<project>/<session>/
   (.jsonl or .txt)                    │              HANDOFF.md
                                       │              HANDOFF.summary.json
                                       │              HANDOFF.llm.json
                                       │              timeline.jsonl   (append-only)
                                       │              TOOLS.md
                                       │              manifest.json    (hash chain)
                                       │
             verify ◄──────────────────┘   recompute manifest_sha256
                                           count timeline.jsonl lines
                                           parse HANDOFF.llm.json

INDEX.json  ◄──── index / build          one row per session
links/*.md  ◄──── merge                  cross-project relation notes
```

A second build over a longer transcript appends only the turns above the watermark. Nothing
already written to `timeline.jsonl` is rewritten, so a brief can be regenerated without
invalidating what a consumer already read.

## Where the store lives

`tools/lib/handoff-root.mjs` is the single implementation of the resolution order, so the
engine and the runtime layer can never disagree about which store they are operating on.
First match wins:

1. `HANDOFFS_ROOT`, the environment override.
2. `handoff.config.json`, found by walking up from the current directory, at most 10 levels.
   `storage.path` beats `handoff_dir`; a relative `handoff_dir` resolves against the
   directory holding the config.
3. A `handoffs/` directory, checked at each level of the same upward walk.
4. The skill directory, as the last resort.

A config file that is present but invalid stops the run with exit 2 instead of falling
through to rule 3. Falling back would write the session to a different store than the one
that was configured, which is worse than refusing.

`handoff.mjs config` prints the resolved root and the rule that chose it (`env`, `config`,
`discover`, `default`).

## The provenance chain

Two hashes, and one of them covers the other.

| Value | Definition |
|---|---|
| `raw_sha256` | SHA-256 of the exact source bytes read at the last build. |
| `manifest_sha256` | SHA-256 of the manifest JSON with `manifest_sha256` removed. |

`verify` recomputes the self-hash, requires `timeline.jsonl`, compares its line count with
`turn_count`, and parses `HANDOFF.llm.json`. It prints `PASS` or `FAIL` and exits 0 or 1.

What the chain detects: a manifest edited by hand, a truncated or extended timeline, a
payload that no longer parses. What it does not do is prove that the source was authentic —
read [PROVENANCE.md](PROVENANCE.md) for the precise boundary.

## Install provenance

A handoff folder proves what it was built from. An installation answers a different question:
what is on this machine, and where did it come from. The installer writes
`.agents-handoff-install.json` into every copy it makes, and `verify` re-hashes the same file
set to compare the copy with that record.

| Value | Definition |
|---|---|
| `files_sha256` | SHA-256 over the sorted `path\0sha256(file)` lines of every manifest file. |
| `files` | Per-file sha256 values, so a mismatch names the file that changed. |
| `source` | `tree` for a copy made from a checkout or archive beside the installer, or `archive` with the tag and the archive's own sha256 when the copy was fetched. |

The install record is a record, not a signature: it proves what was installed and detects
drift, and it cannot prove the tree it came from was trustworthy. That distinction is stated
in full in [PROVENANCE.md](PROVENANCE.md).

## Concurrency and write safety

Every mutating runtime command takes a lock before touching the store. Locks live in
`<root>/.locks/` and are named after a hash of the operation target, so two runs on
different sessions do not block each other while two runs on the same session do. A held
lock exits 3.

The discipline for a mutation is the same everywhere: take the lock, back up what is about
to change, apply, verify the result, and roll back on failure. `federated-merge` backs up a
local manifest to `manifest.json.bak-federated` before copying over it, and verifies every
imported session with the engine afterwards. `promote` backs a manifest up to
`manifest.json.bak` before stamping it.

## Bounded execution

`runtime-engine.mjs` separates the decision from the act. `evaluate` classifies a target and
returns a verdict without running anything; `run` evaluates first and only then acts, and a
denied operation is recorded but never executed. Targets are classified in a fixed order —
an explicit denial, then the engine's own state directory, then approved workspaces, then
the broad personal-data roots, then system read-only roots, otherwise external — so a
personal-data or denied path is refused at any risk class.

Every decision is written to `<state>/executions/<id>.json` with
`enforced_before_execution: true`. Levels, risk classes and grants are in
[PERMISSIONS.md](PERMISSIONS.md).

## Honest verdicts

The capability registry reports `healthy`, `unhealthy` or `unknown`, each with the evidence
that produced it. A probe kind with no implementation returns `unknown` rather than
`healthy`. `check` exits non-zero when a required capability is `unknown`, because an
unanswered question is not a pass.

The same rule applies to the evidence gate. `verify-gate` returns `REJECTED` in its JSON when a
check fails **and exits 6**, so a caller that reads only the status code still fails closed
instead of reading a rejection as success. `promote` runs the same gate and refuses with
`exit 6` unless `--force` is passed; a forced promotion is recorded as `promoted_gate: "FORCED"`
so it stays distinguishable from a verified one.

## Boundaries

- The engine makes no network calls, and neither does the runtime layer. The one component
  that reaches the network is the installer, and only when it runs as the published package:
  it downloads the archive for the version being installed. See
  [COMPATIBILITY.md](COMPATIBILITY.md) and [INSTALL.md](INSTALL.md).
- The source transcript is read and never written.
- No secrets are stored. The code reads no credential files.
- No model is called. The `.llm.json` payload is shaped for a model to read, not produced by
  one.
- `spawn` runs only the local node binary, with a 15000 ms timeout and its output captured
  and hashed rather than streamed.

## Repository layout

```
tools/handoff.mjs          capture engine
tools/agents-handoff.mjs    runtime layer
tools/agent-handoff.mjs     forwarder from the runtime layer's pre-rename path
tools/runtime-engine.mjs   bounded execution
tools/capability-registry.mjs  capability probes
tools/lib/handoff-root.mjs store-root resolution (single owner)
tools/handoff.test.mjs     the hermetic test suite
docs/                      this documentation and the Pages site
docs/SESSIONS.md           the session index, rendered from a real store
.github/scripts/           generators and checks: the session index, the doc link check
refs/                      reference material: adapters, protocol, roles, brief checklist
templates/                 handoff templates and the LLM payload schema
schemas/                   the portable handoff payload schema
install/                   the installer behind the agents-handoff npx package
tests/                     acceptance fixture and a minimal transcript
```

Inside an installed copy — not in this repository — the installer adds
`.agents-handoff-install.json`, the record of what landed there and what it was made from.

The documentation site at <https://alot1z.github.io/agent-handoff/> is built by GitHub Pages
directly from `docs/`. `docs/_data/nav.yml` is the navigation, `docs/_config.yml` is the
Jekyll configuration, and `.github/scripts/check-docs.mjs` fails CI when a page is missing
from the navigation or a relative link does not resolve.
