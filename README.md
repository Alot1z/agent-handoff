# agent-handoff

**[Installation guide →](https://alot1z.github.io/agent-handoff/INSTALL.html)**  ·  **[Documentation →](https://alot1z.github.io/agent-handoff/)**  ·  **[Changelog](CHANGELOG.md)**

[![CI](https://github.com/Alot1z/agent-handoff/actions/workflows/ci.yml/badge.svg)](https://github.com/Alot1z/agent-handoff/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](#requirements)

One handoff format for every AI coding harness. A working session — messages, tool calls,
reasoning, and the provenance to prove where each byte came from — is captured as a folder
that a fresh agent can continue from with zero shared memory.

- Zero runtime dependencies; Node.js 18 or newer.
- Reads any JSONL or plain-text transcript, whatever produced it.
- Every artifact carries a sha256 provenance chain, and `verify` recomputes it.
- Writes are backed up, verified and rolled back on failure.

## Install

```bash
npx agent-handoff-install
npx agent-handoff-install where     # show the resolved install root, and why it was chosen
```

The installer resolves the global root instead of hard-coding one. The resolution order,
the location targets and the requirements are in the
**[installation guide](https://alot1z.github.io/agent-handoff/INSTALL.html)** and
[docs/INSTALL.md](docs/INSTALL.md).

## Quick start

```bash
# Capture a session
node tools/handoff.mjs build --source session.jsonl --harness claude-code --project my-project

# List, inspect and verify what you captured
node tools/handoff.mjs list
node tools/handoff.mjs show <id-prefix>
node tools/handoff.mjs verify <id-prefix>
```

`build` is incremental: re-running it over a longer transcript merges past the recorded
watermark instead of creating a second handoff. `verify` exits non-zero when the manifest
hash, the timeline line count or the LLM payload no longer match what was written.

## What a handoff folder contains

| File | Contents |
|---|---|
| `HANDOFF.md` | The brief a reader picks up cold: objective, current state, open loops, recent timeline |
| `HANDOFF.summary.json` | The same brief as structured fields |
| `HANDOFF.llm.json` | Payload shaped for a model to consume |
| `timeline.jsonl` | Every turn, one per line, appended and never paraphrased |
| `TOOLS.md` | The full tool-call log |
| `manifest.json` | Counts, classes, source paths, and the sha256 provenance chain |

The field-by-field contract is in [docs/FORMAT.md](docs/FORMAT.md).

## Documentation

Full documentation is published at **<https://alot1z.github.io/agent-handoff/>**.

| Document | Covers |
|---|---|
| [docs/index.md](docs/index.md) | Start here: what the tool does and how the docs fit together |
| [docs/INSTALL.md](docs/INSTALL.md) · [site](https://alot1z.github.io/agent-handoff/INSTALL.html) | Install, locations, install options, troubleshooting |
| [docs/UPGRADE.md](docs/UPGRADE.md) | Updating an install, and what an update leaves alone |
| [docs/UNINSTALL.md](docs/UNINSTALL.md) | Removing an install, and what is kept |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the layers fit together, the data flow, and the boundaries |
| [docs/CLI.md](docs/CLI.md) | Every executable, verb, flag, exit code and state file |
| [docs/FORMAT.md](docs/FORMAT.md) | Handoff folder layout, manifest fields, provenance chain |
| [docs/SESSIONS.md](docs/SESSIONS.md) · [site](https://alot1z.github.io/agent-handoff/SESSIONS.html) | Session index: a sample store, its sessions, and the commands that verify them |
| [docs/INTEGRATION.md](docs/INTEGRATION.md) | Feeding a transcript in from another program or a CI job |
| [docs/LEVEL4.md](docs/LEVEL4.md) | The runtime layer: verbs, the evidence gate, bounded execution |
| [docs/LEVEL5.md](docs/LEVEL5.md) | Dispatching a verified handoff to a worker |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md) | Permission levels, risk classes, and what is enforced |
| [docs/SECURITY.md](docs/SECURITY.md) | What is read and written, and the guarantees that are not made |
| [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) | Platforms, Node versions, transcript formats |
| [docs/PROVENANCE.md](docs/PROVENANCE.md) | The hash chain, what it detects, what it cannot |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Symptom, cause and fix, keyed to the real exit codes |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | Running the tests and adding an adapter |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release |
| [refs/ADAPTERS.md](refs/ADAPTERS.md) | The canonical input shape and how each store maps onto it |

## Repository layout

```
tools/handoff.mjs              capture engine (the CLI above)
tools/agent-handoff.mjs        runtime layer: auto, verify-gate, promote, merge, self-improve, index, dispatch
tools/runtime-engine.mjs       bounded execution and the permission gate
tools/capability-registry.mjs  capability health probes
tools/lib/                     shared store-root resolution
docs/  refs/  templates/       documentation, reference material, output templates
schemas/                       handoff payload and configuration schemas
install/                       the npx installer package
tests/                         acceptance fixture and a minimal transcript
```

## Requirements

Node.js 18 or newer. No dependencies, no build step, no network access at runtime. See
[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Contributing

Run the suite with `node tools/handoff.test.mjs`. It is hermetic — it writes to a scratch
directory and needs no network. See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
