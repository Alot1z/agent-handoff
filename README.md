# agents-handoff

**[Installation guide →](https://alot1z.github.io/agent-handoff/INSTALL.html)**  ·  **[Documentation →](https://alot1z.github.io/agent-handoff/)**  ·  **[Changelog](CHANGELOG.md)**

[![CI](https://github.com/Alot1z/agent-handoff/actions/workflows/ci.yml/badge.svg)](https://github.com/Alot1z/agent-handoff/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](#requirements)

One handoff format for every AI coding harness. A working session — messages, tool calls,
reasoning, and the provenance to prove where each byte came from — is captured as a folder
that a fresh agent can continue from with zero shared memory. Zero runtime dependencies,
Node.js 18 or newer, nothing read from the network at run time.

![agents-handoff: one install into every harness, a verified handoff, and an installation
proved against the published npm tarball](assets/handoff-demo.gif)

*An abbreviated run of 2.0.3: `--all` installs into every harness found, a session is captured
and verified, and `--verify-package` proves the installed copy is the published one. The sample
session is illustrative; the command and output shapes are the real ones.*

## Install

```bash
npx agents-handoff --all      # every harness found on this machine, in one run
```

That is the whole install. Choose your stack instead — one harness, several, or a skills
directory of your own:

| Command | Installs into |
|---|---|
| `npx agents-handoff --claude` | `~/.claude/skills` — Claude Code |
| `npx agents-handoff --codex` | `~/.codex/skills` — Codex CLI |
| `npx agents-handoff --agents` | `~/.agents/skills` — the harness-neutral store |
| `npx agents-handoff --harness claude,codex` | the named harnesses, in one run |
| `npx agents-handoff --project --claude` | `./.claude/skills` — this repository only |
| `npx agents-handoff --skills-dir <dir>` | any other stack, exactly |

Without a harness flag the installer resolves the global root rather than hard-coding one and
reports which it chose — `npx agents-handoff where` prints the same decision on its own.

### Or straight from the repository

```bash
npx github:Alot1z/agent-handoff --claude   # run the installer from GitHub, no npm
```

```bash
git clone https://github.com/Alot1z/agent-handoff.git
cd agent-handoff
node install/install.mjs --all      # the same installer, run from the tree
```

### Update it, and check it against the published package

```bash
npx agents-handoff --update                    # every installation found, one run
npx agents-handoff --verify --provenance       # every installation, against its own record
npx agents-handoff --verify-package --record   # against the tarball npm is serving
npx agents-handoff --doctor                    # what is here, and is it intact
npx agents-handoff --remove                    # removes the skill; your store is kept
```

Every install writes `.agents-handoff-install.json` beside the skill: a sha256 over the
installed file set, what it was installed from, and a `package` block naming the version it
should match. `verify` recomputes that hash and fails when a file changed, so an installation
is checkable rather than merely present; `verify-package` fetches the published tarball,
checks it against the registry's own integrity and shasum, and compares the installed files
with the package file by file — `--record` stores the tarball hashes in the install record.
`update` and `verify` with no harness flag act on **every** installation found, and `remove`
deletes only what the install manifest owns, printing what it kept, so a store survives under
any name. The resolution order, the location targets and the requirements are in the
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
tools/agents-handoff.mjs        runtime layer: auto, verify-gate, promote, merge, self-improve, index, dispatch
tools/agent-handoff.mjs        forwarder to the above, kept so older notes keep working
tools/runtime-engine.mjs       bounded execution and the permission gate
tools/capability-registry.mjs  capability health probes
tools/lib/                     shared store-root resolution
docs/  refs/  templates/       documentation, reference material, output templates
schemas/                       handoff payload and configuration schemas
install/                       the installer behind the agents-handoff npx package
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
