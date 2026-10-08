# Changelog

All notable changes to agent-handoff are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases before 2.0.0
were development builds and were never published, so they are not listed.

The version in [package.json](https://github.com/Alot1z/agent-handoff/blob/main/package.json)
and [skill.json](https://github.com/Alot1z/agent-handoff/blob/main/skill.json) is the release
version. The version of the separate installer package is in
[install/package.json](https://github.com/Alot1z/agent-handoff/blob/main/install/package.json)
and has its own
[changelog](https://github.com/Alot1z/agent-handoff/blob/main/install/CHANGELOG.md).

## [Unreleased]

Add entries under the headings below as changes land:

```
### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security
```

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
- **Installer** (`install/`, package `agent-handoff-install`): `install`, `update`, `remove`,
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
