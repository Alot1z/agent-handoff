---
title: Session index
---

# Session index

A handoff store is a directory of captured sessions. This page is generated from the
sample store in [`examples/sessions/`](https://github.com/Alot1z/agent-handoff/tree/main/examples/sessions), whose sessions the
engine built from the two transcripts this repository ships. Nothing here is written by hand:
the table below is a rendering of that store, re-checked on every build.

| Project | Session | Harness | Turns | Revision | Manifest sha256 | Integrity |
|---|---|---|---:|---:|---|---|
| demo | `typescript-project-setup` | claude-code | 11 | 1 | `141e232eb2ad…` | PASS |
| smoke-test | `fixture-roundtrip` | codex | 2 | 1 | `a81d076e3334…` | PASS |

**2 session(s) across 2 project(s): all verified.**

## What each column proves

| Column | Where it comes from |
|---|---|
| Project, Session | The store layout: `projects/<project>/<session>/` |
| Harness | `harness` in the session manifest — what produced the transcript |
| Turns | Lines in `timeline.jsonl`, checked against `turn_count` in the manifest |
| Revision | `revisions` in the manifest. A rebuild that appends turns raises it; it never forks a session |
| Manifest sha256 | `manifest_sha256`, the hash of the manifest with that field removed |
| Integrity | `PASS` when the manifest hash matches, the turn count matches and `HANDOFF.llm.json` parses |

## Verify a session yourself

Point the engine at the sample store and ask it the same question this page answers:

```bash
# the store this page is rendered from
HANDOFFS_ROOT=examples/sessions node tools/handoff.mjs list
HANDOFFS_ROOT=examples/sessions node tools/handoff.mjs verify typescript-project-setup
HANDOFFS_ROOT=examples/sessions node tools/handoff.mjs verify fixture-roundtrip

# your own store
HANDOFFS_ROOT=/path/to/your/store node tools/handoff.mjs list
```

`verify` exits non-zero the moment one of the three checks fails, so it works as a gate:

```bash
HANDOFFS_ROOT=examples/sessions node tools/handoff.mjs verify typescript-project-setup || echo "do not resume this session"
```

## Generate this page from your own store

The generator is part of this repository, and it reads any store in the format above:

```bash
node .github/scripts/build-sessions-index.mjs --store examples/sessions --out docs/SESSIONS.md
node .github/scripts/build-sessions-index.mjs --check    # exit 1 when the page is stale
```

`--check` is wired into CI, so a store that changes without the page changing fails the build
instead of publishing a table that no longer matches what the engine can read.

## Next

- The file-by-file contract for a session folder is in [FORMAT.md](FORMAT.md).
- The commands that read and write a store are in [CLI.md](CLI.md).
- What the hashes prove, and what they cannot, is in [PROVENANCE.md](PROVENANCE.md).
