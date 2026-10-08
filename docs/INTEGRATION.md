---
title: Integrating agent-handoff
---

# Integrating agent-handoff

The engine is a command-line program with a file contract. There is no daemon, no network
call and no database. Integration means three things: getting a transcript into the canonical
input shape, running the engine, and reading the artifacts it writes.

- Put a transcript in the canonical shape: [Input contract](#input-contract).
- Run it: [Build a handoff](#build-a-handoff) and [Exit codes](#exit-codes).
- Read the result: [Output artifacts](#output-artifacts) and [Manifest fields](#manifest-fields).

## Input contract

Every input line is one JSON object (JSONL). Any program that can write JSONL can feed the
engine; no client is required.

```json
{"seq":0,"ts":"1787669764492","harness":"dsh","source":"<origin path>",
 "session":"<id>","thread":"<project/thread>","role":"user|assistant|system|tool",
 "kind":"<free-form: reasoning|tool_use|text>","text":"<message body>"}
```

| Field | Used for | Notes |
|---|---|---|
| `seq` | ordering, watermark | Falls back to the line index when absent or non-numeric. |
| `ts` | timeline ordering | `timestamp` is accepted as an alias. |
| `role` | turn class | `user`, `assistant`, `system`, `tool`. |
| `kind` | turn class refinement | `tool_use` → TOOL, `reasoning`/`thinking` → THOUGHT. |
| `text` | the turn body | `content` and `parts[].text` are accepted as aliases. |
| `session` | handoff id | Used when `--session` is not passed. |
| `thread` | project inference | A `--tag--` inside the thread name is read as the project. |
| `harness` | provenance | Not read from the line. Set it with `--harness`; otherwise it is `unknown`. |
| `source` | provenance | Not read from the line. `source_paths` records the file given to `--source`. |

`harness` and `source` are carried for whatever reads the file later. The engine itself reads
`seq`, `ts`, `role`, `kind` and `text`, plus `session` and `thread` from the first line.

Turn classification order (`classify()` in [handoff.mjs](../tools/handoff.mjs)):

1. `kind` contains `tool`, or `role` is `tool` → **TOOL**
2. `kind` contains `reason` or `think` → **THOUGHT**
3. `role` is `user`, or `kind` is `human` → **USER**
4. `role` is `assistant`, or `kind` is `ai` → **AGENT**
5. anything else → **OTHER**

A line whose body is empty after that mapping is skipped. A file whose name ends in `.jsonl`
is parsed as JSONL; every other file is parsed as text, using role markers:

```
user: what needs to happen next
assistant: the plan is in refs/plan.md
```

The marker is `user|human|assistant|ai|system|tool`, optionally prefixed by `#` and followed
by `:` or `>`. Lines after a marker are appended to that turn until the next marker. A
`system:` line becomes OTHER, so it stays in the record without appearing as dialogue.

If no usable turn is parsed, the build fails with exit 4 rather than writing an empty handoff.

## Build a handoff

```bash
node tools/handoff.mjs build --source transcript.jsonl \
  --session my-session --harness claude-code --model <name> \
  --project my-project --objective "what this session was for"
```

| Flag | Effect |
|---|---|
| `--source <file>` | The transcript to ingest. Required. |
| `--session <id>` | Handoff id. Default: the `session` field, else the file name. |
| `--harness <name>` | Provenance label. Default `unknown`; the engine reads no harness field. |
| `--model <name>` | Provenance label. Stored, never invented. |
| `--project <name>` | Project group. Default: config, then the `--tag--` in the thread, then the harness. |
| `--objective <text>` | Overrides the objective taken from the transcript. |
| `--force-harness` | Rewrite an existing harness value. Without it, a set value is kept. |
| `--force-model` | Rewrite an existing model value. Without it, a set value is kept. |

`node tools/handoff.mjs --handoff --source transcript.jsonl` is an alias of `build`.

A rebuild of the same session is incremental: only turns above the manifest watermark are
appended, and a source whose bytes and watermark are unchanged prints `up-to-date` and writes
nothing.

## Where handoffs are stored

The root is resolved by one module, [tools/lib/handoff-root.mjs](../tools/lib/handoff-root.mjs),
in this order:

| # | Source | Detail |
|---|---|---|
| 1 | `HANDOFFS_ROOT` environment variable | Always wins. This is what makes a CI run hermetic. |
| 2 | `handoff.config.json` | Found by walking up from the current directory. |
| 3 | a `handoffs/` directory | Found by walking up from the current directory. |
| 4 | the skill directory | Final fallback when nothing else exists. |

Inside a config, `storage.path` beats `handoff_dir`, and a relative `handoff_dir` resolves
against the config's own directory. The walk is bounded to ten levels. A config file that is
present but invalid fails the run with exit 2 — it is never ignored, because falling back
would write to a different store than the one configured.

`node tools/handoff.mjs config` prints the resolved root, the source that decided it, the
config path, the schema path, the project name and whether cross-linking is on.

## Output artifacts

```
<root>/
├── INDEX.json                        # rebuilt from every manifest
├── projects/<project>/
│   ├── PROJECT.md                    # project name, session list
│   └── <session>/
│       ├── HANDOFF.md                # the brief a human or agent reads
│       ├── HANDOFF.summary.json      # compact payload (schema 2.0.0-summary)
│       ├── HANDOFF.llm.json          # full payload (schema 2.0.0)
│       ├── timeline.jsonl            # append-only, one turn per line
│       ├── TOOLS.md                  # every tool call, verbatim
│       └── manifest.json             # provenance and counters
└── links/<other-project>.md          # cross-project relation notes
```

`TOOLS.md` is the fidelity tier: it carries each tool call in full. The table inside
`HANDOFF.md` is a digest of the same turns.

## Manifest fields

| Field | Meaning |
|---|---|
| `session`, `project`, `harness`, `model` | Identity and provenance. |
| `created_at`, `updated_at` | First write, last write. |
| `source_paths` | Every source file ingested for this session. |
| `watermark` | Highest ingested `seq`. Everything below it is already in the timeline. |
| `raw_sha256` | Hash of the source bytes at the last build. |
| `revisions` | Build count for this session. |
| `turn_count` | Lines in `timeline.jsonl`. |
| `counts` | Turn count per class: USER, AGENT, THOUGHT, TOOL. |
| `manifest_sha256` | Hash of the manifest without this field. |

## Verify a handoff

```bash
node tools/handoff.mjs list                 # all sessions
node tools/handoff.mjs list <project>       # one project
node tools/handoff.mjs show <id-prefix>     # print the brief
node tools/handoff.mjs verify <id-prefix>   # manifest sha, turn count, payload parses
```

`verify` recomputes the manifest hash, compares the timeline line count against
`turn_count`, and parses `HANDOFF.llm.json`. It prints `PASS <id> [...]` or fails with exit 1
and the first broken check. See [PROVENANCE.md](PROVENANCE.md) for what the hash chain does
and does not detect.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. |
| 1 | Integrity failure: tampered manifest, unparsable manifest, unexpected error. |
| 2 | Usage or configuration error: missing `--source`, missing argument, invalid config. |
| 3 | Ambiguous id prefix — more than one session matched. |
| 4 | No usable turns, no handoffs, or no session matching the prefix. |

## CI recipe

```yaml
- name: Build and verify the handoff
  env:
    HANDOFFS_ROOT: ${{ github.workspace }}/.handoffs
  run: |
    node skills/agent-handoff/tools/handoff.mjs build \
      --source exported-transcript.jsonl --project ci --harness generic
    node skills/agent-handoff/tools/handoff.mjs verify "$(ls .handoffs/projects/ci | head -1)"
```

`HANDOFFS_ROOT` keeps the run off any configured store, and `verify` returns the exit code a
pipeline can gate on.

## Limits

- Filesystem only: nothing is uploaded, and no network call is made.
- No watcher: a build happens when it is invoked. See [LEVEL4.md](LEVEL4.md) for the layer
  that probes for staleness and runs the build for you.
- The engine reads whatever the transcript contains, including secrets. Redaction is the
  caller's job. See [SECURITY.md](SECURITY.md).
- Adapter routes for common session stores: [../refs/ADAPTERS.md](../refs/ADAPTERS.md).
