---
title: Provenance
---

# Provenance

## What this document covers

Every handoff carries a hash chain that ties its rendered files to the transcript it was built from.
This document states what is hashed, how to re-verify it, and what the check cannot prove.

## The chain

| Artifact | Field | Definition |
|---|---|---|
| Source transcript | `raw_sha256` | SHA-256 of the whole source file, read as UTF-8 at build time |
| `manifest.json` | `manifest_sha256` | SHA-256 of `JSON.stringify(manifest)` with `manifest_sha256` removed |
| `HANDOFF.summary.json` | `provenance.raw_sha256`, `provenance.manifest_sha256` | Copies of the two hashes above |
| `HANDOFF.llm.json` | `provenance.manifest_sha256` | Copy of the manifest hash |
| `HANDOFF.md` | *Provenance* section | Both hashes and the revision, rendered as text |

`manifest.json` also records `source_paths` (every transcript ever merged into the session),
`watermark` (the highest turn sequence emitted), `revisions` and `turn_count`.

## Verification

```bash
node tools/handoff.mjs verify <id-prefix>
```

`verify` recomputes `manifest_sha256` from the stored manifest and compares it, then requires
`timeline.jsonl` to exist and to hold exactly `turn_count` lines, then parses `HANDOFF.llm.json`.
It prints one `PASS` line, or `FAIL` with the reason.

| Exit | Meaning |
|---|---|
| 0 | All three checks passed |
| 1 | Manifest mismatch, timeline missing, turn-count drift, or unparsable payload |
| 2 | No prefix given |
| 3 | Prefix matched more than one session |
| 4 | No session matched, or no handoffs exist |

## What the check detects

- A stored manifest whose fields have been edited or added.
- A truncated or padded `timeline.jsonl`, because its line count must equal `turn_count`.
- A missing timeline.
- A `HANDOFF.llm.json` that is no longer valid JSON.

## What the check cannot detect

- **Edits to unhashed renders.** `HANDOFF.md`, `HANDOFF.summary.json` and `TOOLS.md` are not hashed.
  Their bytes can be changed freely and `verify` still passes.
- **Timeline content edits that preserve the line count.** A rewritten turn keeps the count.
- **Re-hashing by the editor.** The hashes are self-consistent, not signed. Anyone who edits the
  manifest can recompute `manifest_sha256` and produce a folder that verifies clean. There is no key
  material, no signature and no external trust anchor.
- **Anything outside the session folder.** `PROJECT.md`, `INDEX.json` and `links/*.md` carry no
  hashes.

Treat the chain as damage detection, not as authentication.

## Install provenance

An installation carries its own record, `.agents-handoff-install.json`, written by the
installer into the copy it made. It is separate from every handoff folder: it says what was
installed and where the bytes came from, not what a session contains. `verify` run from the
installer re-hashes the installed file set and compares it with the record.

| Field group | What it records |
|---|---|
| `product`, `version`, `installer_version`, `installed_at` | Which version landed, and which installer wrote the record. |
| `harness`, `target` | Where the copy went (`claude`, `codex`, `agents`, or `null` for a direct path). |
| `source` | The tree beside the installer (`kind: 'tree'`), or the tagged archive it was fetched from (`kind: 'archive'`) with that archive's sha256. |
| `file_count`, `files_sha256`, `files` | That the files present are the files that were installed — one hash over the set, and one per path. |

What it detects: a file edited, replaced or removed after the install, because the per-file
values and the set hash no longer match. `verify` exits non-zero and names the differing
files, and `doctor` reports the same state for every harness installation it finds.

What it cannot detect:

- **A compromised source.** The record is written from whatever tree the installer ran in, so a
  copy made from a tampered tree carries a record that matches that tree.
- **Files outside the manifest.** The hash covers the manifest files, not anything added beside
  them.
- **A rewritten record.** Anyone who edits an installed copy can recompute the hashes, exactly
  as a manifest can be re-hashed. There is no signature and no external trust anchor.

## Update instead of recreate

Re-running `build` on the same session id merges rather than duplicates: turns with a sequence above
`watermark` are appended to `timeline.jsonl`, `revisions` increments, and the manifest hash is
recomputed. If the source is unchanged and no new turns exist, the run reports `up-to-date` and
bumps nothing. The rendered summary, payload and `HANDOFF.md` are regenerated from the full
timeline, so a revision never mixes stale and fresh text.

## Privacy note on `source_paths`

A manifest records the absolute path of every transcript that fed the session. A handoff folder
therefore contains the local paths of the machine it was built on. Review that field before sharing
a folder outside the machine.

## Repository provenance

- License: MIT, see [../LICENSE](https://github.com/Alot1z/agents-handoff/blob/main/LICENSE).
- The engine and runtime use only `node:` built-ins. No third-party source is bundled and
  `package.json` declares no dependencies.
- Development notes, internal plans and research material are not part of this repository and are
  not published with it.
