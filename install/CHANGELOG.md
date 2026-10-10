# Changelog — agents-handoff

The installer ships inside the root
[`agents-handoff`](https://www.npmjs.com/package/agents-handoff) package: its
`install/package.json` is `private` and tracks the release version, and the published
`agents-handoff` bin points at `install/install.mjs`. There is no separate installer
package on the npm registry (verified 2026-10-10: `agents-handoff` serves
`0.0.0-stage`, `2.0.2`, `2.0.3`, `2.0.4`, `2.0.5`; `2.0.6` is a local candidate only), so installer changes are recorded in the
[root changelog](https://github.com/Alot1z/agents-handoff/blob/main/CHANGELOG.md) under
the release version. The 1.x entries below are retained as the installer's own
development history — they are not npm releases. Both changelogs follow the same
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and Semantic Versioning.

## [1.1.0] — 2026-10-09

The installer gained a download path: `npx agents-handoff` now installs the skill on a
machine that has neither a checkout nor an unpacked archive.

### Added

- A download path for the published package. When no skill tree sits beside the installer, the
  archive for the requested version is fetched from
  `https://codeload.github.com/Alot1z/agents-handoff/tar.gz` and unpacked; the same install
  manifest then copies out of it, so an installed copy is identical either way.
  `--version latest` resolves the newest release tag and falls back to the `main` branch,
  saying so, when the repository has no release object.
- An install that cannot resolve a source file fails with the missing paths and the count,
  instead of warning per file and reporting success.

### Changed

- Install sources are written in the shipped tree's terms and resolved against both layouts
  (shipped first, `repo-upstream/` second), so one manifest installs the same files from a
  clone, a release archive, and a fetched archive.
- The version reported after an install is read back from the installed `SKILL.md`, and the
  fallback version used before a tree exists is parsed from `SKILL.md` too. The shipped suite
  asserts the two agree, so a release cannot install under the previous version number.

### Fixed

- `README.md`, `LICENSE` and the twelve guides installed as nothing outside the development
  tree: they were addressed under `repo-upstream/<path>`, which only that tree has.
- `repository` pointed at a repository that does not serve this package; `homepage` and `bugs`
  were missing.

## [1.0.0] — 2026-10-08

### Added

- `install` (default), `update`, `remove`, `verify`, `list` and `where`.
- Location targets `global`, `local` and `project`, with `--path` for an exact directory.
- Global root resolution instead of a hard-coded path: an account-skill store that already
  holds `agents-handoff`, else `~/.agents/skills`, else an account-skill store found on the
  machine, else `~/.agents/skills`, created on install. `where` prints the resolved root and
  the rule that chose it. `AGENT_HANDOFF_GLOBAL_DIR` overrides it.
- `--version` to install a specific version, and `--force` to skip confirmations.
