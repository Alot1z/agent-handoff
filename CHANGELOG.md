# Changelog

All notable changes to agent-handoff are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases before 2.0.0
were development builds and were never published, so they are not listed.

The version in [package.json](https://github.com/Alot1z/agent-handoff/blob/main/package.json)
and [skill.json](https://github.com/Alot1z/agent-handoff/blob/main/skill.json) is the release
version, and it is the version published to npm: the repository root is the
[`agents-handoff`](https://www.npmjs.com/package/agents-handoff) package.

## [Unreleased]

Add entries under the matching heading as changes land.

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
- CI failed on every run: the runtime-layer smoke test ran `agent-handoff.mjs list`, which is not
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

- **Capture engine** (`tools/handoff.mjs`, published as the `agent-handoff` bin). `build`
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
- **Runtime layer** (`tools/agent-handoff.mjs`): `auto`, `verify-gate`, `promote`, `merge`,
  `federated-merge`, `self-improve`, `index`. Every mutating command takes a lock, backs up
  before writing, verifies after applying, and rolls back on failure.
- **Bounded execution** (`tools/runtime-engine.mjs`): risk classes `R0`–`R4` evaluated against
  `permission-policy.json` before any operation runs, resumable jobs with sealed checkpoints,
  and a per-decision record in the state directory.
- **Capability probes** (`tools/capability-registry.mjs`): `file-exists`, `dir-writable` and
  `command` probes that report `healthy` / `unhealthy` / `unknown` with the evidence behind
  each verdict.
- **Installer** (`install/`, package `agents-handoff`): `install`, `update`, `remove`,
  `verify`, `list`, `where`, targeting a resolved global root, `./local/skills/agent-handoff`,
  or `./skills/agent-handoff`.
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
