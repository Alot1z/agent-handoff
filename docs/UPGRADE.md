---
title: Upgrade
---

# Upgrade

An upgrade replaces skill files. It does not touch the handoff folders, the configuration, or
anything you added next to them.

## Before upgrading

Confirm what is installed:

```bash
npx agent-handoff-install --list
```

`--list` prints each installed location with its version and the number of manifest files
present. The version also appears as `version:` in the `SKILL.md` front matter of the
installation.

Back up handoff data before any manual change. The upgrade path keeps it, but a copy costs
nothing:

```bash
cp -r handoffs/ handoffs-backup/
```

Note any local edits to `handoff.config.json`, since a reinstall overwrites skill files but
leaves that file alone.

## Upgrade with the installer

```bash
npx agent-handoff-install --update
```

`--update` requires an existing installation; without one it exits with
`Not installed at <dir>. Run 'install' first.`

The update then reinstalls: the skill files are copied over the existing installation and
overwrite the files of the same name. Files that are not part of the installation manifest —
`handoffs/`, `projects/`, `links/`, `handoff.config.json`, `.env.example`, and anything you added
— are left in place.

To update into a specific location or version:

```bash
npx agent-handoff-install --update --location project
npx agent-handoff-install --update --version 2.0.0
```

`--version` records the version you request. Confirm what is actually installed with `--verify`,
which prints the installed version, rather than trusting the request.

## Manual upgrade

Replace the skill files and keep the data:

1. Extract the release archive (`agent-handoff-latest.zip`, or
   `agent-handoff-v<version>.zip`) to a temporary directory.
2. Copy the skill files over the installation: `SKILL.md`, `skill.json`, the manifest JSON
   files, `tools/`, `tools/lib/`, `schemas/`, `refs/`, `templates/`, `docs/`, `src/`, `tests/`.
3. Do not delete `handoffs/`, `projects/`, `links/`, or `handoff.config.json`.

```bash
unzip agent-handoff-latest.zip -d /tmp/agent-handoff-new
cp -r /tmp/agent-handoff-new/tools/ /tmp/agent-handoff-new/refs/ \
      /tmp/agent-handoff-new/templates/ /tmp/agent-handoff-new/schemas/ \
      /tmp/agent-handoff-new/docs/ /tmp/agent-handoff-new/src/ \
      "<install-path>/"
cp /tmp/agent-handoff-new/SKILL.md /tmp/agent-handoff-new/skill.json "<install-path>/"
```

## What an upgrade changes

| Changed | Unchanged |
|---|---|
| `tools/` — the engine and the dynamic runtime | `handoffs/` — your session data |
| `refs/`, `templates/`, `schemas/`, `docs/` | `projects/`, `links/` |
| `SKILL.md`, `skill.json`, manifest JSON files | `handoff.config.json` and your edits |
| `src/` reference sources | `HANDOFFS_ROOT`, if you use it |

Handoff folders are read from the handoff root in place, so an upgrade does not move or rewrite
them.

## After upgrading

```bash
npx agent-handoff-install --verify
node "<install-path>/tools/handoff.mjs" config
node "<install-path>/tools/handoff.mjs" list
```

`config` proves the engine starts and prints the handoff root it resolved. `list` proves the
engine still finds the handoff folders that were already there.

The shipped test suite is a stronger check and does not touch existing handoffs when you point
it at a scratch root:

```bash
HANDOFFS_ROOT=/tmp/handoff-check node "<install-path>/tools/handoff.test.mjs"
```

Read an existing handoff to confirm the data survived:

```bash
node "<install-path>/tools/handoff.mjs" show <id-prefix>
node "<install-path>/tools/handoff.mjs" verify <id-prefix>
```

`verify <id-prefix>` recomputes the stored handoff's manifest hash, so it fails loudly if an
upgrade damaged the folder.

## Rollback

1. Restore the previous version's skill files: extract that version's release archive and copy
   the skill files over the installation, as in the manual upgrade above.
2. Or reinstall the files that ship with the installer: `npx agent-handoff-install --force`.
3. Restore handoffs from your backup if you made one, and confirm with `--verify` and
   `handoff.mjs list`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Not installed at <dir>` | Nothing to update at that location. Check `--list`, or drop `--location`/`--path`. |
| Reported version did not change | The installer copies the files it ships. For a pinned version, install from that version's release archive. |
| Verification fails after an upgrade | A file is missing or the engine cannot start. Reinstall with `--force` and read the failing check. |
| Handoffs no longer listed | The engine is reading a different root. Run `config` and compare it with where your handoffs live; set `HANDOFFS_ROOT` if needed. |
| Configuration was overwritten | `handoff.config.json` is preserved, but a manual copy step can still overwrite it. Restore your backup. |

## See also

- [INSTALL.md](INSTALL.md)
- [UNINSTALL.md](UNINSTALL.md)
- [../README.md](https://github.com/Alot1z/agent-handoff/blob/main/README.md)
