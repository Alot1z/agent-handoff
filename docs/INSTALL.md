---
title: Installation
---

# Installation

agent-handoff turns a working session into a portable handoff folder, and verifies that folder
later. It is a Node.js command-line skill with no runtime dependencies.

## Requirements

| Requirement | Notes |
|---|---|
| Node.js >= 18.0.0 | The engine uses ES modules and `node:fs`. |
| `unzip` | Only needed to extract a release archive by hand. |
| No network at run time | The engine never makes a network call. |

## Quick start

```bash
npx agent-handoff-install
```

The installer copies the skill files into the resolved global root, then reports how many files
it copied. Confirm the installation:

```bash
node "<install-path>/tools/handoff.mjs" config
```

That prints the handoff root the engine will use:

```
handoff: config root=<dir>
handoff: config source=default
handoff: config file=none
handoff: config schema=<dir>/handoff.config.schema.json
```

## Where a global install goes

`--location global` does not point at a fixed directory. The installer searches for a store and
reports the reason it chose one. The order is:

| # | Condition | Result |
|---|---|---|
| 1 | `AGENT_HANDOFF_GLOBAL_DIR` is set | that directory |
| 2 | A skill store already holds an `agent-handoff` install | the newest such location |
| 3 | `~/.agents/skills` exists | `~/.agents/skills` |
| 4 | A skill store exists | its first account-skill root |
| 5 | Nothing found | the default store, created on install |

An account-skill store keeps skills two identifier levels below the store itself:

```
<store>/<account-id>/<profile-id>/agent-handoff/
```

`<store>` is `%APPDATA%\<client>\account-skills` on Windows, and `~/.<client>/account-skills` or
`~/.config/<client>/account-skills` on macOS and Linux, for whichever desktop client keeps
skills there. The installer searches every store it can find and never assumes one of them.

Inspect the decision before installing anything:

```bash
npx agent-handoff-install where
```

```
Global install root: <dir>
  chosen because: <reason>
  override with: AGENT_HANDOFF_GLOBAL_DIR=<dir> or --path <dir>
```

`--list` shows the resolved root, the local location, every candidate root, the harness skills
home, and — inside a git repository — the project location. Each installed location is printed
with its version and the number of manifest files present.

## Locations

| Location | Target directory |
|---|---|
| `global` (default) | `<resolved global root>/agent-handoff` |
| `local` | `./local/skills/agent-handoff` |
| `project` | `./skills/agent-handoff` |
| `--path <dir>` | exactly `<dir>` |

## Options

| Option | Default | Effect |
|---|---|---|
| `--location <global\|local\|project>` | `global` | Which location to install, update, remove or verify. |
| `--path <dir>` | none | Use this directory instead of a resolved location. |
| `--version <v>` | `latest` | Request a version. Confirm what landed with `--verify`, which prints the installed version. |
| `--force`, `-f` | off | Skip confirmations and overwrite an existing installation. |
| `--help`, `-h` | — | Print the installer usage text. |

The installer accepts both bare verbs and flag forms: `install`/`--install`, `update`/`--update`,
`remove`/`--remove`, `verify`/`--verify`, `list`/`--list`.

## Commands

| Command | Description |
|---|---|
| `install`, `i` (default) | Copy the skill files to the target. |
| `update`, `u` | Reinstall over an existing installation. See [UPGRADE.md](UPGRADE.md). |
| `remove`, `rm` | Remove the installation. See [UNINSTALL.md](UNINSTALL.md). |
| `verify`, `v` | Check every manifest file, the skill metadata, and that the engine runs. |
| `list`, `ls` | List installed locations with version and manifest file count. |
| `where` | Print the global root and why it was chosen. |

## Verify an installation

```bash
npx agent-handoff-install --verify
```

Verification runs three kinds of check:

1. every file named in the installer manifest exists in the target;
2. `SKILL.md` declares both `name` and `version`;
3. `node tools/handoff.mjs config` exits 0 and prints the `handoff: config root=` marker — this
   exercises the engine's module graph, so a missing module fails here.

Each check is printed with a pass or fail mark. On success the installer also prints the
installed location and version; on failure it exits non-zero and tells you to reinstall.

There is no `--verbose` flag.

## Installing again

Installing over an existing installation does nothing by default when the requested version is
`latest`: the installer reports the version already present, then stops. It tells you to use
`--update` to upgrade, or `--force` to reinstall the same files.

## Manual installation

Use the release archive when you cannot run `npx`.

1. Download the archive from the repository releases page: `agent-handoff-latest.zip`, or
   `agent-handoff-v<version>.zip` for a pinned version.
2. Extract it into the target directory with `unzip`.
3. Confirm the engine runs: `node "<target>/tools/handoff.mjs" config`.

A complete installation contains `SKILL.md`, `skill.json`, the manifest JSON files,
`tools/` (the engine and its runtime), `tools/lib/`, `schemas/`, `refs/`, `templates/`, `docs/`,
and `tests/`. That list is not a description: it is the installer's manifest, and a run that
cannot resolve any entry fails rather than reporting an incomplete installation as a success.

## Handoff storage is separate

Two environment variables decide two different things, and they are not interchangeable:

| Variable | Decides |
|---|---|
| `AGENT_HANDOFF_GLOBAL_DIR` | Where the installer puts the skill. |
| `HANDOFFS_ROOT` | Where the engine stores handoff data. |

By default the engine stores handoff data under its own root, inside the installation. Set
`HANDOFFS_ROOT` when you want handoffs somewhere else, for example in a versioned directory.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Cannot write to <dir>` | The target is not writable. Pick another location with `--path`, or fix permissions. |
| `Not installed at <dir>` | `update` and `verify` require an existing installation. Run `install` first. |
| `Incomplete install: <n> of <m> file(s) missing — …` | The tree the installer reads from is not a complete one. Install from a fresh clone, or from a freshly downloaded archive. |
| `no published release found — fetching the main branch` | Not an error: `--version latest` found no release object, so the archive of `main` is used instead. Pass `--version <x>` to install a released tag. |
| `Cannot extract the archive (tar exited …)` | `tar` is missing, or the download did not arrive intact. The message prints the `curl` and `tar` commands that do the same job by hand. |
| The wrong root was chosen | Run `where` to see the reason, then set `AGENT_HANDOFF_GLOBAL_DIR` or pass `--path`. |
| `remove` did nothing | Removal asks for confirmation, and refuses in a non-interactive shell. Pass `--force`. |
| Verification fails | The output names the failing check. Fix it, or reinstall with `--force`. |

## See also

- [UPGRADE.md](UPGRADE.md)
- [UNINSTALL.md](UNINSTALL.md)
- [../README.md](https://github.com/Alot1z/agent-handoff/blob/main/README.md)
