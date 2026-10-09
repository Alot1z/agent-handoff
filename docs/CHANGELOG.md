---
title: Changelog
---

# Changelog

All notable changes to agents-handoff are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases before 2.0.0
were development builds and were never published, so they are not listed.

The version in [package.json](https://github.com/Alot1z/agent-handoff/blob/main/package.json)
and [skill.json](https://github.com/Alot1z/agent-handoff/blob/main/skill.json) is the release
version, and it is the version published to npm: the repository root is the
[`agents-handoff`](https://www.npmjs.com/package/agents-handoff) package.

## [Unreleased]

Add entries under the matching heading as changes land.

## [2.0.5] - 2026-10-09

### Fixed

- **Real Claude Code and Codex exports parse.** The engine read text only from a top-level
  `text`/`content`/`parts[]`, so a genuine Claude Code transcript (`message.content[]`) or a Codex
  CLI rollout (`payload`) produced **zero turns** while `--harness claude-code` merely labelled the
  result. Nested blocks, `message.content[]`, `parts[]`, `item.content[]`, `output` and the Codex
  `payload` wrapper are read now, and a record whose every typed block is a reasoning block
  classifies as `THOUGHT`.
- **A malformed transcript line is no longer dropped in silence.** It stops the build with
  `exit 5`, naming the line number and reason. Dropping it produced a handoff that looked complete
  and was missing part of the session; this restores the fail-closed rule the rest of the tool
  already followed. `--allow-bad-lines` skips such lines deliberately and prints how many were
  skipped.
- **`promote` enforces the evidence gate.** It ran the gate, printed the verdict and promoted
  regardless (`void gateRun`), so a `REJECTED` handoff was stamped as promoted. It now refuses with
  `exit 6`, names the failed checks, leaves the manifest unstamped, and records `promoted_gate`.
  `--force` is the deliberate override, recorded as `FORCED` rather than `VERIFIED`.
- **A rebuild no longer destroys the evidence contract.** `HANDOFF.md` is regenerated on every
  build, which erased the hand-authored `RESULT:`/`EVIDENCE:` block the gate reads — so growing a
  session deleted the gate's own input. The block is carried across verbatim under its own heading
  and hashed into `evidence_contract_sha256` on the manifest.
- `verify-gate` reports a rejection in its exit code (`6`), not only in its JSON.

### Added

- Regression tests for all four defects above, driving the real CLI: a Claude Code transcript, a
  Codex rollout, a mixed valid/corrupt source, a rebuild after a hand-authored contract, and the
  promote / gate / `--force` path (39 tests, up from 34).

## [2.0.4] - 2026-10-09

### Added

- A demo animation on the README and the documentation home page: one run installing into every
  harness, a session captured and verified, and an installation proved against the published
  tarball (`assets/handoff-demo.gif`).
- **[Compatibility](https://github.com/Alot1z/agent-handoff/blob/main/docs/COMPATIBILITY.md)**
  (`docs/COMPATIBILITY.md`) now records what was measured rather than what
  is assumed: Node 26 verified, and Bun verified as an alternative runtime — the engine's
  verbs run unchanged there, and the suite passes 34/34 with `bun test --timeout 30000` (Bun's
  default 5-second per-test timeout is shorter than the suite's child-process tests). It also
  states why the artifacts are JavaScript rather than TypeScript: the contracts are the
  versioned JSON Schemas the runtime validates against, and a build step would put a compiler
  between a user and a working tool.

### Fixed

- `--update` and `--verify` reported "no installations found" on a machine whose copies predate
  the 2.0.3 rename, because they only looked for `agents-handoff/`. Both now recognise the
  `agent-handoff/` directory every earlier release installed and act on it in place.
- The global-root search missed `~/.config`, which is where a desktop client keeps its
  account-skill store on Windows too — so that store's installation was invisible to `--list`,
  `--update`, `--verify` and `doctor` even though the client kept reading it.

### Changed

- `remove` states what it keeps before asking, so its confirmation matches what it does.

## [2.0.3] - 2026-10-09

### Added

- **Named harness targets.** One run can install the skill into Claude Code, Codex CLI and the
  harness-neutral `~/.agents/skills` at once: `--claude`, `--codex`, `--agents`,
  `--harness claude,codex` (repeatable), `--all` for every harness whose directory exists on
  this machine, `--skills-dir <dir>` for any other stack, and `--project` for the
  per-repository form. Every target gets its own copy and its own install record.
- **`verify-package`**, a verb that checks an installation against the package npm is actually
  serving for its version: it verifies the downloaded tarball against the registry's own
  `integrity` and `shasum`, compares the published file set with the installed one file by
  file, and compares the tarball sha256 with the value recorded for that install. `--record`
  stores the tarball hashes in the install record, so later runs compare with a stored value.
- The install record (`.agents-handoff-install.json`) now carries a `package` block — name,
  version, registry, tarball URL, and the sha256/sha512/integrity/shasum filled in by
  `verify-package` — so an installation can be checked against the published artifact rather
  than only against itself.
- Installing from the repository without publishing: `npx github:Alot1z/agent-handoff` runs the
  same installer straight from GitHub, and the installation guide documents both that and the
  clone-and-run path.
- Five installer behaviour tests — multi-harness install with a record per target, `--update`
  over every installation, `--verify` failing on a tampered copy, `remove` keeping user data,
  and `verify-package` refusing a version npm does not serve. The suite is 34 tests.

### Changed

- `--update` and `--verify` with no harness flag now act on **every** installation found on the
  machine instead of the one resolved target. A machine holding the skill in `~/.claude/skills`
  and in `~/.agents/skills` has two copies, and updating only the resolved one left the other
  silently stale; both verbs print a per-target summary.
- The runtime layer's entry point is `tools/agents-handoff.mjs`, matching the product name.
  `tools/agent-handoff.mjs` is installed alongside it as a forwarder, so notes and scripts that
  name the old path keep working.

### Fixed

- `remove` deleted anything that was not one of three expected directory names, which meant a
  handoff store kept under any other name was destroyed by `remove --force`. Removal is now
  driven by the install manifest — what an install owns is what it copied — and the run prints
  the entries it deliberately kept, including the store and `handoff.config.json`.

## [2.0.2] - 2026-10-09

### Added

- **[Session index](https://alot1z.github.io/agent-handoff/SESSIONS.html)** (`docs/SESSIONS.md`):
  a page rendered from a real handoff store, listing the captured sessions in
  `examples/sessions/` with their project, harness, turn count, revision, manifest hash and
  integrity verdict, plus the commands that reproduce each check. The sample store is built by
  the engine from the two transcripts this repository ships, and
  `.github/scripts/build-sessions-index.mjs --check` fails the build when the page and the store
  disagree.
- The skill is published to npm as
  [`agents-handoff`](https://www.npmjs.com/package/agents-handoff), from the repository root,
  and the release workflow publishes it on a tag: it skips a version npm already has, and
  reports — without failing the release — when `NPM_TOKEN` is not configured. The package
  carries the skill tree, so `npx agents-handoff` installs with no download.
- `npm test`, `npm run check:docs` and `npm run check:session-index` are wired into
  `prepublishOnly`, so a tree whose suite, links or session index are stale cannot be published.

### Changed

- `npx agents-handoff` now installs the skill as documented. It previously looked for the skill
  files beside itself, found none, and reported success while installing nothing; a bare copy of
  `install/` still falls back to downloading the archive for the requested version.
- The clean-checkout suite builds its fixture from the shipped projection rather than the
  development tree, which is what let the installer's broken source paths pass every local test.

### Fixed

- The installer lost fourteen files whenever it ran outside the development tree: `README.md`,
  `LICENSE` and the twelve guides were addressed under `repo-upstream/<path>`, a directory only
  the development tree has. Sources are written in the shipped tree's terms and resolved against
  both layouts, and an install that cannot resolve a source now fails with the missing paths
  instead of warning and continuing.
- CI failed on every run: the runtime-layer smoke test ran `agents-handoff.mjs list`, which is not
  a verb of that tool (it exits 2). The step builds a handoff into a scratch store and runs
  `index`, a verb that exists.
- The shipped version disagreed across files: `SKILL.md` said 2.0.0 while `skill.json` and
  `package.json` said 2.0.1, and the installer carried its own 2.0.0 constant, so every install
  reported the previous version. `SKILL.md` is now the single source of truth, the installer
  reads it, and the suite asserts the two agree.
- `install/package.json` pointed `repository` at a different repository from the one serving the
  package; it now names this repository, with `homepage` and `bugs`.
- `handoff.config.schema.json` declared its `$id` under a path that does not serve the schema.
- `examples/demo/example-usage.md` addressed the engine as `../../../tools/handoff.mjs`, one
  directory above the repository root, so every command in it failed when pasted.
- `tests/acceptance/acceptance.yaml` described the development tree: it listed documents that
  are not published, scanned a directory that is not published, and asserted two behaviours the
  shipped CLI does not have (`--help` exiting 0, `list` succeeding on an empty store). Every
  entry was re-run against a clean checkout and now states what was observed.
- Documentation stopped describing files that are not published: `src/` was listed as part of an
  installation in `INSTALL.md`, `UNINSTALL.md` and `UPGRADE.md`, and documented as a repository
  directory in `CONTRIBUTING.md`.
- `ARCHITECTURE.md` claimed nothing in the repository makes a network call, which stopped being
  true once the installer fetched archives.

## [2.0.1] — 2026-10-09

Documentation release. No behaviour changed; no public interface changed.

### Added

- **[Command reference](https://github.com/Alot1z/agent-handoff/blob/main/docs/CLI.md)**
  (`docs/CLI.md`): every executable, verb, flag, exit code, environment variable and file
  written, in one place.
- **[Architecture](https://github.com/Alot1z/agent-handoff/blob/main/docs/ARCHITECTURE.md)**
  (`docs/ARCHITECTURE.md`): the five layers, the data flow, store-root resolution, the
  write-safety discipline, and the boundaries the tool does not cross.
- **[Troubleshooting](https://github.com/Alot1z/agent-handoff/blob/main/docs/TROUBLESHOOTING.md)**
  (`docs/TROUBLESHOOTING.md`): symptom, cause and fix, keyed to the real exit codes.
- This changelog, and a Changelog page on the site rendered from it, so the repository file
  and the published page cannot drift apart.
- A docs-consistency check (`.github/scripts/check-docs.mjs`) run in CI: every page under
  `docs/` must appear in the navigation, and every relative link must resolve where it is
  read.

### Changed

- README now links the published [installation guide](https://alot1z.github.io/agent-handoff/INSTALL.html)
  and the [documentation site](https://alot1z.github.io/agent-handoff/) at the top, and its
  documentation table covers every page.
- Links in `docs/` that pointed outside the published site are absolute URLs, so they resolve
  for a reader of the documentation instead of returning 404.
- `package.json` homepage points at the documentation site.

## [2.0.0] — 2026-10-08

The first public release: a capture engine, a runtime layer over it, an installer, and the
documentation site.

### Added

- **Capture engine** (`tools/handoff.mjs`, published as the `agents-handoff` bin). `build`
  reads a JSONL or plain-text transcript and writes a handoff directory:
  `HANDOFF.md`, `HANDOFF.summary.json`, `HANDOFF.llm.json`, `timeline.jsonl`, `TOOLS.md`,
  `manifest.json`. Also `list`, `show`, `verify`, `rename`, `retitle` and `config`.
- **Incremental builds.** Each build appends only the turns above the recorded `watermark`
  and leaves `timeline.jsonl` untouched, so re-running over a longer transcript extends the
  handoff instead of duplicating it. A rebuild with no new turns and an unchanged source hash
  prints `handoff: up-to-date` and writes nothing.
- **sha256 provenance.** `manifest.json` carries `raw_sha256` over the source bytes and a
  self-hash `manifest_sha256` over itself. `verify` recomputes the self-hash, checks the
  `timeline.jsonl` line count against `turn_count`, and parses `HANDOFF.llm.json`.
- **Store-root resolution** (`tools/lib/handoff-root.mjs`): `HANDOFFS_ROOT`, then
  `handoff.config.json` found by walking up, then a `handoffs/` directory on the same walk,
  then the skill directory. Reported by `handoff.mjs config`.
- **Runtime layer** (`tools/agents-handoff.mjs`): `auto`, `verify-gate`, `promote`, `merge`,
  `federated-merge`, `self-improve`, `index`. Every mutating command takes a lock, backs up
  before writing, verifies after applying, and rolls back on failure.
- **Bounded execution** (`tools/runtime-engine.mjs`): risk classes `R0`–`R4` evaluated against
  `permission-policy.json` before any operation runs, resumable jobs with sealed checkpoints,
  and a per-decision record in the state directory.
- **Capability probes** (`tools/capability-registry.mjs`): `file-exists`, `dir-writable` and
  `command` probes that report `healthy` / `unhealthy` / `unknown` with the evidence behind
  each verdict.
- **Installer** (`install/`, package `agents-handoff`): `install`, `update`, `remove`,
  `verify`, `list`, `where`, targeting a resolved global root, `./local/skills/agents-handoff`,
  or `./skills/agents-handoff`.
- **Documentation site** at <https://alot1z.github.io/agent-handoff/>, built by GitHub Pages
  from `docs/`.
- **CI** (`.github/workflows/ci.yml`): the test suite on Node 18, 20 and 22, a runtime-layer
  smoke test, installer help, and a required-file and JSON-validity check.

### Security

- The engine reads transcripts and writes handoff files. It makes no network calls, and it
  never writes secrets. The limits of what the provenance chain proves are stated in
  [docs/PROVENANCE.md](https://github.com/Alot1z/agent-handoff/blob/main/docs/PROVENANCE.md),
  not implied.

[Unreleased]: https://github.com/Alot1z/agent-handoff/compare/v2.0.1...main
[2.0.1]: https://github.com/Alot1z/agent-handoff/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/Alot1z/agent-handoff/tree/v2.0.0
