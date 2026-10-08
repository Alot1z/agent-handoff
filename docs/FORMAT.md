---
title: Handoff format
---

# Handoff format

One handoff is a directory of files generated from a session transcript. The source
transcript is read, never written: every handoff file is a render of it, and the
renders carry the digests that let you prove which source bytes produced them.

Everything below describes the behaviour of `tools/handoff.mjs`.

## Where handoffs live

`tools/lib/handoff-root.mjs` is the single implementation of this order. First match wins:

| Order | Source | Notes |
|---|---|---|
| 1 | `HANDOFFS_ROOT` | Environment override. Always wins. The test suite uses it to stay hermetic. |
| 2 | `handoff.config.json` | Found by walking up from the current directory, at most 10 levels. `storage.path` beats `handoff_dir`; a relative `handoff_dir` resolves against the directory holding the config. |
| 3 | `<dir>/handoffs/` | Zero-config convention, checked at each level of the same upward walk. |
| 4 | the skill directory | Default store when no environment variable, config or `handoffs/` directory is found. |

A `handoff.config.json` that is present but invalid fails the run with exit 2 instead of
falling back, because falling back would write the session to a store other than the one
that was configured. The schema for that file is `handoff.config.schema.json`.

```
node tools/handoff.mjs config
```

prints the resolved root, which rule chose it (`env`, `config`, `discover`, `default`),
the config file used, the schema path, the configured project name and whether
cross-project linking is enabled.

## Directory layout

```
<root>/
  INDEX.json                          index of every session, rewritten on each build
  links/<other-project>.md            cross-project relation notes
  projects/<project>/
    PROJECT.md                        project file: one line per session
    <session>/                        one handoff
```

A legacy layout — session directories directly under `<root>` — is migrated on the next
build: any directory holding a `manifest.json` is moved to `projects/<project>/`, using the
project recorded in its manifest.

## Files in a session directory

| File | Written by | Contents |
|---|---|---|
| `HANDOFF.md` | `build`, `retitle`, `rename` | Human render: objective, current state, open loops, the last 40 turns as a table, tool-call digest, where the other files are, provenance. |
| `HANDOFF.summary.json` | `build`, `retitle`, `rename` | Compact machine payload, `schema_version` `2.0.0-summary`. Objective, `state_now` head (600 chars), open loops, counts, artifact names, provenance. |
| `HANDOFF.llm.json` | `build`, `retitle`, `rename` | Full machine payload, `schema_version` `2.0.0`. The summary fields plus the complete `timeline[]` and `tool_calls[]` arrays, with the turn class stored as `class`. |
| `timeline.jsonl` | `build` (append-only) | One JSON object per turn: `{seq, ts, class, text}`. New turns are appended; existing lines are never rewritten. |
| `TOOLS.md` | `build` | Every tool turn in full, untruncated, as `## [seq] <ts>` sections. The table in `HANDOFF.md` is a 120-character digest of the same turns. |
| `manifest.json` | `build`, `retitle`, `rename` | The record the other files are verified against. See below. |

Renders (`HANDOFF.md`, the two JSON payloads) are rewritten on every build; `timeline.jsonl`
is not.

## manifest.json

| Field | Meaning |
|---|---|
| `session` | Session id as resolved for this handoff. |
| `project` | Project slug. |
| `harness`, `model` | From `--harness` / `--model`, from the source's own fields, or `unknown` / `""`. |
| `created_at`, `updated_at` | ISO 8601. `created_at` is set once on creation. |
| `source_paths` | Every source path this session was ever built from. |
| `watermark` | Highest `seq` already emitted. Turn `seq <= watermark` is already in `timeline.jsonl`. |
| `raw_sha256` | SHA-256 of the source bytes at the last build. |
| `revisions` | Number of writes. Increments on every build, `retitle` and `rename`. |
| `turn_count` | Number of turns in `timeline.jsonl` after the build. |
| `counts` | Turn counts by class: `USER`, `AGENT`, `THOUGHT`, `TOOL`. |
| `manifest_sha256` | Self-hash: SHA-256 of the manifest JSON with this field removed. |
| `prev_project` | Set when `rename` moves the session to another project. |
| `titled_from` | Previous directory names, set by `retitle`. |

## Turn classes

`classify()` assigns each turn one class, in this order:

| Class | Rule |
|---|---|
| `TOOL` | `kind` contains `tool`, or `role` is `tool`. |
| `THOUGHT` | `kind` contains `reason` or `think`. |
| `USER` | `role` is `user`, or `kind` is `human`. |
| `AGENT` | `role` is `assistant`, or `kind` is `ai`. |
| `OTHER` | Everything else. Kept in `timeline.jsonl`, omitted from the tables in `HANDOFF.md`. |

Turn text is taken from `text`, then `content`, then `parts[].text`.

## Accepted input

A source file ending in `.jsonl` is read line by line. Each line is parsed
independently; a line that does not parse, or whose text is blank, is skipped. `seq` is used
when it is a finite number, and the line index otherwise.

Any other extension is parsed as text: a line matching `user:`, `human:`, `assistant:`,
`ai:`, `system:` or `tool:` (optionally prefixed with `#`) starts a turn, and following
lines are appended to it. The role marker decides the class. Adapters that produce either
shape are listed in [ADAPTERS.md](https://github.com/Alot1z/agent-handoff/blob/main/refs/ADAPTERS.md).

If no turn parses, the build fails with exit 4.

## Session id and directory name

1. `--session <id>`, if given.
2. else the `session` field of the first JSONL line, if present.
3. else the source file name without its `.jsonl`, `.txt` or `.md` extension.

The directory name replaces every character outside `[\w.-]` with `_`. `INDEX.json` is
checked first: if a session with that id or with the same session UUID already exists, its
project and directory name are reused, so a rebuild lands in the same place.

`retitle <id-prefix> <new-name>` renames the directory to the slugified name, records the
old name in `titled_from`, increments `revisions`, re-seals the manifest and refreshes every
render. `rename <id-prefix> <new-project>` moves the session under another project and sets
`prev_project`.

## Revisions, watermark and idempotence

Each build appends only the turns with `seq > watermark`, then sets `watermark` to the
highest `seq` seen and increments `revisions`. A rebuild with no new turns and an unchanged
`raw_sha256` prints `handoff: up-to-date` and writes nothing.

## Provenance and verification

| Value | Definition |
|---|---|
| `raw_sha256` | SHA-256 of the exact source bytes read. |
| `manifest_sha256` | SHA-256 of the manifest with `manifest_sha256` removed. |
| `provenance` block in both JSON payloads | `sources`, `raw_sha256`, `manifest_sha256`, `revision`, `watermark`, `total_turns`. |

```
node tools/handoff.mjs verify <id-prefix>
```

recomputes the manifest hash, requires `timeline.jsonl` to exist, compares its line count
with `turn_count`, and parses `HANDOFF.llm.json`. It prints `PASS <id> [...]` and exits 0, or
`FAIL <id>: ...` and exits 1. Exit 2 is a usage error, 3 an ambiguous prefix, 4 no match.

## Payload schemas

`schemas/handoff.schema.json` is the portable handoff payload contract, version `1.0`: a
single JSON object with required keys `schema_version`, `handoff_id`, `mission_id`,
`task_id`, `created_at`, `updated_at`, `source`, `state` and `next_action`, and optional
blocks for capabilities, permissions, checkpoint, artifacts, evidence, decisions, errors and
the next action.

The engine does not emit that payload. Its own outputs are the session files listed above,
and the JSON it writes is validated by consumption, not by that schema. The schema is the
interchange contract for a consumer that wants a single structured document.
