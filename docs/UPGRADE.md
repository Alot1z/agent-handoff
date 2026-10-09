---
title: Upgrade
---

# Upgrade

An upgrade replaces skill files. It does not touch the handoff folders, the configuration, or
anything you added next to them.

## Before upgrading

Confirm what is installed:

```bash
npx agents-handoff --list
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
npx agents-handoff --update
```

With no target flag, `--update` updates **every installation found on this machine**. That is
the whole answer to "keep my install current": a machine can hold the same skill in
`~/.claude/skills` and in `~/.agents/skills`, and updating only one of them is how the other
keeps running an old engine. Each installation is updated and reported on its own, and the run
ends with a summary naming the version it moved from and to:

```
Update summary
  ✓ updated <dir>/agents-handoff — 2.0.2 → v2.0.3
  ✓ updated <dir>/agents-handoff — 2.0.2 → v2.0.3
✓ 2 of 2 installation(s) updated
```

When nothing is installed anywhere the installer can see, it says so and exits non-zero:
`Nothing to update: no agents-handoff installation found.`

The update then reinstalls: the skill files are copied over the existing installation and
overwrite the files of the same name. Files that are not part of the installation manifest —
`handoffs/`, `projects/`, `links/`, `.agent-handoff/`, `handoff.config.json`, `.env.example`, and
anything you added — are left in place. Nothing outside the manifest is read or rewritten.

Scope the update to one harness, or several, with the same flags install uses:

```bash
npx agents-handoff --update --claude     # just Claude Code
npx agents-handoff --update --codex      # just Codex CLI
npx agents-handoff --update --all        # every harness found on this machine
npx agents-handoff --update --location project
npx agents-handoff --update --version 2.0.0
```

`--all` covers the harnesses whose configuration directory exists here; a named harness is
updated whether or not that directory exists.

`--version` asks for a version, and the installer resolves it honestly: the tree beside the
installer is used when it **is** that version (or when nothing was requested), and when it is a
different version the requested tag's archive is fetched instead, with its sha256 recorded in
the install record's `source`. To switch versions, ask npm for the one you want
(`npx agents-handoff@<version>`), pass `--version <x>`, or install manually from that version's
tag archive. Confirm what is actually installed with `--verify`, which prints the version read
back from the installed `SKILL.md`, rather than trusting the request.

An update rewrites the install record as well, so `--verify --provenance` describes the new
state afterwards and reports the archive (with its sha256) when the files came from a download
rather than from a tree. The record's `package` block names the npm package and version the
installation should match; `npx agents-handoff --verify-package --record` fills in that
package's tarball hashes.

## Manual upgrade

Replace the skill files and keep the data:

1. Extract the release archive (`agents-handoff-v<version>.zip` from the
   [releases page](https://github.com/Alot1z/agent-handoff/releases); the newest release carries
   its own version in the file name) into a temporary directory.
2. Copy the skill files over the installation: `SKILL.md`, `skill.json`, the manifest JSON
   files, `tools/`, `tools/lib/`, `schemas/`, `refs/`, `templates/`, `docs/`, `tests/`.
3. Do not delete `handoffs/`, `projects/`, `links/`, or `handoff.config.json`.

```bash
unzip agents-handoff-v<version>.zip -d /tmp/agents-handoff-new
cp -r /tmp/agents-handoff-new/tools/ /tmp/agents-handoff-new/refs/ \
      /tmp/agents-handoff-new/templates/ /tmp/agents-handoff-new/schemas/ \
      /tmp/agents-handoff-new/docs/ "<install-path>/"
cp /tmp/agents-handoff-new/SKILL.md /tmp/agents-handoff-new/skill.json "<install-path>/"
```

## What an upgrade changes

| Changed | Unchanged |
|---|---|
| `tools/` — the engine and the dynamic runtime | `handoffs/` — your session data |
| `refs/`, `templates/`, `schemas/`, `docs/` | `projects/`, `links/` |
| `SKILL.md`, `skill.json`, manifest JSON files | `handoff.config.json` and your edits |
| `install/` — the installer itself | `HANDOFFS_ROOT`, if you use it |
| `.agents-handoff-install.json` — the install record, rewritten for the new version, including its `package` block | — |
| `.agent-handoff/` and any other store directory, whatever it is called | — |

Handoff folders are read from the handoff root in place, so an upgrade does not move or rewrite
them.

## After upgrading

```bash
npx agents-handoff --verify                  # every installation found
npx agents-handoff --verify --provenance
npx agents-handoff --verify-package --record  # and prove it matches the published tarball
npx agents-handoff doctor
node "<install-path>/tools/handoff.mjs" config
node "<install-path>/tools/handoff.mjs" list
```

`config` proves the engine starts and prints the handoff root it resolved. `list` proves the
engine still finds the handoff folders that were already there. `--verify --provenance` prints
the install record the verification was checked against — version, source, harness and the
file-set hash — which is the shortest way to prove an upgrade landed and left nothing behind.

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
2. Or reinstall the files that ship with the installer: `npx agents-handoff --force`.
3. Restore handoffs from your backup if you made one, and confirm with `--verify` and
   `handoff.mjs list`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Not installed at <dir>` | `--path`, `--location` or a harness flag named a directory that holds no installation. Drop the flag to update every installation found, or check `--list`. |
| `Nothing to update: no agents-handoff installation found.` | Nothing to update anywhere the installer looks. Run `npx agents-handoff --all`, or name the directory with `--path`. |
| Reported version did not change | The installer uses the tree beside it when that tree **is** the requested version (or nothing was requested), so running it from a checkout installs that checkout. Use the published package, pass `--version <x>` to fetch that tag's archive, or check `--verify --provenance` to see which source the record names. |
| `verify-package` fails with `does NOT match … as published` | A file changed after the update. The check names it; reinstall with `--force`. |
| Verification fails after an upgrade | A file is missing or the engine cannot start. Reinstall with `--force` and read the failing check. |
| Handoffs no longer listed | The engine is reading a different root. Run `config` and compare it with where your handoffs live; set `HANDOFFS_ROOT` if needed. |
| `no provenance record` after upgrading | The record is written by installs from 2.0.3 on. Reinstall with `--force` to write one for this target. |
| Configuration was overwritten | `handoff.config.json` is preserved, but a manual copy step can still overwrite it. Restore your backup. |

## See also

- [INSTALL.md](INSTALL.md)
- [UNINSTALL.md](UNINSTALL.md)
- [../README.md](https://github.com/Alot1z/agent-handoff/blob/main/README.md)
