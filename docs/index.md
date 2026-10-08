---
title: agent-handoff
---

# agent-handoff documentation

agent-handoff turns an AI working session — chat turns, tool calls, reasoning, however the client
stored it — into a folder of plain files that a different agent, a different harness, or a
colleague can read and continue from without the original chat. It builds from a transcript or an
adapter export, keeps a hash chain so a handoff can be re-verified, and merges later turns into the
same session instead of duplicating it.

## Quick start

```bash
# 1. Install the skill
npx agent-handoff-install

# 2. Build a handoff from a transcript
node tools/handoff.mjs build --source transcript.jsonl --project my-project

# 3. Find it, read it, check it
node tools/handoff.mjs list
node tools/handoff.mjs show <id-prefix>
node tools/handoff.mjs verify <id-prefix>
```

`build` also accepts `--session`, `--harness`, `--model` and `--objective`. Run
`node tools/handoff.mjs config` to see which store root the engine resolved and why.

## Documentation

| Document | Contents |
|---|---|
| [INSTALL.md](INSTALL.md) | Installer commands, install locations, requirements |
| [UPGRADE.md](UPGRADE.md) | Updating an installation, pinning a version, what a version change touches |
| [UNINSTALL.md](UNINSTALL.md) | Removing an installation, and which files are deliberately kept |
| [INTEGRATION.md](INTEGRATION.md) | Embedding the engine, configuration and environment, CI and pipeline use |
| [LEVEL4.md](LEVEL4.md) | Dynamic runtime layer: runtime verbs, gates and promotion |
| [LEVEL5.md](LEVEL5.md) | Collaborative dispatch: routing a handoff to another agent |
| [FORMAT.md](FORMAT.md) | Handoff folder layout, every file in it, the manifest and the schemas |
| [PERMISSIONS.md](PERMISSIONS.md) | Permission levels, risk classes, and the policy file |
| [SECURITY.md](SECURITY.md) | What is read and written, secrets, malicious input, guarantees not made |
| [COMPATIBILITY.md](COMPATIBILITY.md) | Platforms, Node versions, input formats, exit codes |
| [PROVENANCE.md](PROVENANCE.md) | The hash chain, how to verify it, what it cannot prove |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Test suite, project layout, how to add an adapter |
| [../refs/ADAPTERS.md](../refs/ADAPTERS.md) | Canonical input shape and how each session source maps onto it |

## Engine commands

| Command | Effect |
|---|---|
| `build --source <file>` | Build or update a handoff from a transcript |
| `--handoff --source <file>` | Alias of `build` |
| `list [project-or-prefix]` | List sessions, newest first |
| `show <id-prefix>` | Print the rendered brief |
| `verify <id-prefix>` | Re-check the hash chain |
| `rename <id-prefix> <project>` | Move a session to another project |
| `retitle <id-prefix> <name>` | Give a session a readable name |
| `config` | Report the resolved store root, its source and the schema path |

Zero dependencies, Node 18 or newer. See [../README.md](../README.md) for the repository overview
and [../SKILL.md](../SKILL.md) for the skill definition.
