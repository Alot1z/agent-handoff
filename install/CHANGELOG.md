# Changelog — agent-handoff-install

The installer is a separate package from the skill. It follows the same
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and Semantic Versioning.

## [1.0.0] — 2026-10-08

### Added

- `install` (default), `update`, `remove`, `verify`, `list` and `where`.
- Location targets `global`, `local` and `project`, with `--path` for an exact directory.
- Global root resolution instead of a hard-coded path: an account-skill store that already
  holds `agent-handoff`, else `~/.agents/skills`, else an account-skill store found on the
  machine, else `~/.agents/skills`, created on install. `where` prints the resolved root and
  the rule that chose it. `AGENT_HANDOFF_GLOBAL_DIR` overrides it.
- `--version` to install a specific version, and `--force` to skip confirmations.
