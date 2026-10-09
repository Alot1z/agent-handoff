---
title: Compatibility
---

# Compatibility

## Platforms

| Platform | Level | Notes |
|---|---|---|
| Windows 10 / 11 | SUPPORTED | Primary development platform |
| macOS 12+ | SUPPORTED | Uses only portable Node APIs |
| Linux | SUPPORTED | Uses only portable Node APIs |

## Runtime

| Requirement | Version | Why |
|---|---|---|
| Node.js | 18.0.0 or newer | ES modules and `node:` built-ins |
| npm | 9.0.0 or newer | Only if you install from the registry |

The engine and the runtime install no packages at run time. `package.json` declares no
dependencies.

## Architectures

| Architecture | Level | Notes |
|---|---|---|
| x64 | SUPPORTED | Primary |
| arm64 (Apple silicon) | TESTED | macOS |
| arm64 (Linux) | UNTESTED | Expected to work; no CI runner exercises it |

## Node version matrix

| Version | Level |
|---|---|
| 18.x | SUPPORTED (minimum) |
| 20.x | SUPPORTED |
| 22.x | SUPPORTED |
| 26.x | VERIFIED (developed and released on it) |
| < 18 | UNSUPPORTED |

## Other runtimes: Bun, Deno, TypeScript

The tools are plain ESM with `node:` built-ins and no dependencies, so another runtime that
implements those APIs runs them unchanged. Bun was tested against this release:

```bash
bun tools/handoff.mjs config
bun tools/handoff.mjs build --source transcript.jsonl --project my-project
bun tools/handoff.mjs verify my-project          # PASS, same hashes as Node
bun tools/agents-handoff.mjs index
bun test --timeout 30000 tools/handoff.test.mjs  # 34 pass, 0 fail
```

One caveat, and it is a property of the runner rather than of the tools: the suite spawns child
Node processes, and Bun's default per-test timeout is 5 seconds, so raising it
(`--timeout 30000`) is what makes all 34 tests pass — at the default, one test times out.

The published artifact is JavaScript, not TypeScript, and there is no build step to add one.
What TypeScript would have declared — the shape of a handoff, a manifest and the LLM payload —
is declared by the versioned JSON Schemas the runtime validates against
(`schemas/handoff.schema.json`, `templates/HANDOFF.llm.schema.json`,
`handoff.config.schema.json`), and `docs/CLI.md` is the interface of record for the commands.

## Input formats the engine parses

| Format | How it is detected | Fields read |
|---|---|---|
| JSONL | `.jsonl` extension | `seq`, `ts`/`timestamp`, `role`, `kind`/`type`, and the text from the top level (`text`, `content`, `output`), from a nested message (`message.content[]`, `message.text`), from an item array (`parts[]`, `item.content[]`), or from a Codex rollout wrapper (`payload.text`, `payload.content[]`, `payload.output`) |
| Plain text | Any other extension | A line opening with `user:`, `human:`, `assistant:`, `ai:`, `system:` or `tool:` (or `>` instead of `:`); following lines are appended to that turn |

This reads the shapes harnesses actually write, not just the canonical one. Claude Code nests the
turn under `message.content[]` (`{type:"text"}`, `{type:"thinking"}`,
`{type:"tool_use"}`, `{type:"tool_result"}`); the Codex CLI rollout wraps each event in
`payload` (`response_item` → `message` / `function_call` / `function_call_output`). Reading only
top-level fields parses those exports to zero turns, which is why `--harness` is a label and not
a parser: nothing here branches on the harness name.

Turn classification, in this order: a `kind`/`type` containing `tool`, or `role: "tool"`, or
`function_call`, becomes `TOOL`; `kind`/`type` containing `reason` or `think`, or a record whose
every typed content block is a reasoning block, becomes `THOUGHT`; `role: "user"` (or
`kind: "human"`) becomes `USER`; `role: "assistant"` (or `kind: "ai"`) becomes `AGENT`; everything
else becomes `OTHER`.

## Malformed and empty input

The two cases are different and are not treated the same way.

| Case | Behaviour |
|---|---|
| A JSONL line that is not valid JSON | **The build stops** with `exit 5` and names the line number and reason. Pass `--allow-bad-lines` to skip them on purpose, which prints a warning and keeps going. |
| A line that parses but carries no user/assistant text | Counted as `skipped` — this is normal harness metadata (usage, summaries, system events), not corruption. |
| A source where *no* turn parses at all | `exit 4`, whether or not bad lines were found. |

Failing closed is deliberate. Silently dropping an unparseable line produces a handoff that looks
complete while missing part of the session, and nothing downstream can tell the difference.

## Session sources

Harness stores are read by adapters that normalise a store into the canonical JSONL shape; the
engine has no harness-specific code. See [../refs/ADAPTERS.md](https://github.com/Alot1z/agent-handoff/blob/main/refs/ADAPTERS.md).

| Source shape | Route |
|---|---|
| JSONL session directory | Adapter projects each session file to canonical JSONL |
| SQLite session database | Adapter reads the database read-only and projects rows to canonical JSONL |
| Exported JSONL | Passed directly to `build --source` |
| Plain text or Markdown log | Role-marker parser built into the engine |

## Filesystem

| Feature | Windows | macOS | Linux |
|---|---|---|---|
| Path separators | `\` and `/` | `/` | `/` |
| Case sensitivity | Insensitive (typical) | Sensitive | Sensitive |
| Symlinks | Limited | Full | Full |
| Permissions | ACLs | POSIX | POSIX |

Path handling goes through `node:path`; no path is hard-coded in the engine.

## Environment variables

| Variable | Required | Effect |
|---|---|---|
| `HANDOFFS_ROOT` | No | Sets the store root and takes precedence over every other rule |

## Configuration

`handoff.config.json` is optional. It is discovered by walking up from the current directory, a
maximum of 10 levels, and validated against `handoff.config.schema.json`. The keys the engine acts
on are `storage.path`, `handoff_dir`, `project_name` and `linking.enabled`. A relative
`handoff_dir` resolves against the directory that holds the config.

Root resolution order, first match wins: `HANDOFFS_ROOT`, then a config-declared directory, then a
`handoffs/` directory found by the same upward walk, then the skill directory itself. Run
`node tools/handoff.mjs config` to see which rule applied.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Integrity failure (manifest mismatch, corrupted manifest) or an unexpected error |
| 2 | Usage error, missing source file, or an invalid config |
| 3 | An id prefix is ambiguous, or a lock is held |
| 4 | No usable turns were parsed, or no session matches the prefix |
| 5 | Unparseable JSONL line(s) with `--allow-bad-lines` absent |
| 3 | Ambiguous session-id prefix |
| 4 | No parsable turns, no handoffs, or no match for the prefix |

## CI

The suite is `node tools/handoff.test.mjs`. It needs no install step, so a CI job is checkout plus
Node 18/20/22. GitHub Actions workflows are under `.github/workflows/`.

| Platform | Level | Notes |
|---|---|---|
| GitHub Actions | SUPPORTED | Workflows included |
| GitLab CI, Azure DevOps, Jenkins | UNTESTED | Any runner with Node 18+ works |

## Offline use

The engine makes no network requests. The installer is the one component that reaches the
network: run from a checkout or an unpacked archive it copies the files beside it, and run as the
published package it downloads that version's archive from this repository. Either way the
network is needed once, while installing; after that the installed skill is offline.

## MCP

The engine is a CLI with text and JSON output, so an MCP server can wrap it. No MCP server ships
with this repository.
