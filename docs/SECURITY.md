---
title: Security
---

# Security

## Scope

agents-handoff reads session transcripts you point it at and writes a handoff folder to disk. It has
no network code, no third-party dependencies, and no privileged operations. This document states
what the tool does with data, what it refuses to do, and which guarantees it does not make.

## What the tool reads

| Input | How it is used |
|---|---|
| The file passed to `build --source` | Read as UTF-8 text and parsed into turns. A `.jsonl` file is parsed line by line; anything else is parsed with role markers. |
| `handoff.config.json` | Walked up from the current directory and validated against `handoff.config.schema.json`. A present-but-invalid file is fatal (`exit 2`). |

Adapters that read a harness session store are external to the engine. They read stores and never
write to them. See [../refs/ADAPTERS.md](https://github.com/Alot1z/agents-handoff/blob/main/refs/ADAPTERS.md).

## What the tool writes

Under the resolved root (see [FORMAT.md](FORMAT.md)): `HANDOFF.md`, `HANDOFF.summary.json`,
`HANDOFF.llm.json`, `timeline.jsonl`, `TOOLS.md`, `manifest.json`, and per project `PROJECT.md`,
plus `INDEX.json` and `links/*.md`. Nothing else is written and nothing outside the root is
modified.

Writes go straight to the destination path with `fs.writeFileSync`. They are not atomic and are not
staged through a temporary file, so an interrupted run can leave a partial file. `verify` detects
that only indirectly — see [PROVENANCE.md](PROVENANCE.md).

## Secrets

The engine performs **no secret detection and no redaction**. A transcript containing a token or a
key produces a handoff containing that token or key. There is no scanning pass, no allowlist and no
masking.

`handoff.config.example.json` lists an `exclude_from_handoff` array. Treat that as intent, not as an
enforced control: the engine reads `storage.path`, `handoff_dir`, `project_name` and `linking` from a
config, and does not read that array.

Only hand off transcripts you have reviewed. Keep `.env` files and key material out of version
control, and do not commit a handoff folder that quotes them.

## Malicious input

A transcript is data. It is never evaluated, never executed, and never interpreted as configuration
or as a request. Concretely:

- A tool call recorded in a transcript is copied verbatim as text into `TOOLS.md`. The engine does not run it.
- A transcript cannot change the engine's arguments, the store root, or the exit code beyond a parse failure.
- A transcript with no parsable turns stops the run (`exit 4`).
- A malformed JSONL line stops the run (`exit 5`) and is named by line number, because a silent skip would produce a handoff that looks complete and is not. `--allow-bad-lines` is the explicit, warning-printing way to accept a damaged source.

The realistic risk is not code execution but content. A handoff is a readable document that a later
human or agent may treat as instructions, and it inherits whatever instructions the transcript
contained. Review a handoff before handing it to another agent.

## Paths and the workspace boundary

The engine resolves `--source` against the current directory and writes under the resolved root. It
performs no workspace-boundary check of its own: a path you pass is a path it uses.

`permission-policy.json` declares the boundary for the runtime layer — approved workspaces,
read-only system roots, personal-data roots, per-level grants (`READ_ONLY` and `WORKSPACE_WRITE`
allowed; `EXTERNAL_EFFECT`, `DESTRUCTIVE` and `IRREVERSIBLE` need authorization) and the R0–R4 risk
mapping. See [PERMISSIONS.md](PERMISSIONS.md). The handoff engine itself does not consult that file.

## Guarantees that are not made

- No sandboxing. No process isolation, no privilege separation. The tool runs with the permissions of the user who invoked it.
- No encryption. Handoff files are plain text and JSON.
- No authentication. Hashes are self-consistent, not signed — see [PROVENANCE.md](PROVENANCE.md).
- No audit log and no system logging.
- No secret scanning, no PII detection, no redaction.

## Dependencies

None. The engine and the runtime use only `node:` built-ins and require Node 18 or newer. The
installer is a single script with no package dependencies.

## Reporting a vulnerability

Report it privately to the maintainer, not in a public issue. Use the repository's private
vulnerability reporting if it is enabled, otherwise contact the maintainer directly. Include the
command, the input, and the observed result.

## Checklist before publishing a handoff folder

- [ ] The transcript was reviewed and contains no credentials, tokens or personal data.
- [ ] The handoff quotes no private path and no machine identifier.
- [ ] `node tools/handoff.mjs verify <id-prefix>` passes for every session in the folder.
