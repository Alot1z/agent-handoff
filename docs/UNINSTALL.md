---
title: Uninstall
---

# Uninstall

Uninstalling removes the skill files. Your handoffs and your configuration stay where they are.

## Quick uninstall

```bash
npx agent-handoff-install --remove
```

Removal asks for confirmation first:

```
This will remove agent-handoff from:
  <install-path>

Your handoffs (projects/, handoffs/, links/) will NOT be deleted.
Configuration (handoff.config.json) will NOT be deleted.

Continue? (y/N)
```

Answer `y` to proceed. In a non-interactive shell the prompt is skipped and nothing is removed;
the installer prints `Non-interactive mode, use --force to skip confirmation` instead.

```bash
npx agent-handoff-install --remove --force
```

## Options

| Option | Effect |
|---|---|
| `--remove` | Remove the installation (interactive confirmation). |
| `--force`, `-f` | Skip the confirmation, and delete the kept directories when they are empty. |
| `--location <global\|local\|project>` | Which installation to remove. Global is the default and is resolved the same way as for install. |
| `--path <dir>` | Remove the installation at exactly this directory. |

Flag form and bare verb are equivalent: `--remove` and `remove`, `--force` and `-f`.

## What is removed

Everything in the installation directory, except the entries listed in the next section:

- the engine and runtime: `tools/`, `tools/lib/`
- metadata: `SKILL.md`, `skill.json`, `package.json`, the manifest JSON files
- `schemas/`, `refs/`, `templates/`, `docs/`, `tests/`
- `INDEX.json` and any other generated file in that directory

Each removed entry is printed as `Removed file: <name>` or `Removed directory: <name>/`.

## What is kept

| Kept | Why |
|---|---|
| `handoffs/`, `projects/`, `links/` | Your session data. |
| `handoff.config.json` | Your configuration. |
| `.env.example` | Your environment template. |
| Anything you added elsewhere in the directory | The installer only removes entries it walks past; it never deletes a directory it keeps. |

With `--force`, the three data directories are still kept unless they are empty, in which case
they are removed and reported as `Removed empty directory: <name>/`. After that, if the
installation directory itself is empty it is removed too. If handoffs remain in it, the
directory stays.

## Manual uninstall

Remove the skill files and leave the data behind:

```bash
cd "<install-path>"

# Keep these: handoffs/ projects/ links/ handoff.config.json .env.example
rm -rf tools docs refs templates schemas src tests
rm -f SKILL.md skill.json package.json INDEX.json \
      capability-registry.json permission-policy.json \
      handoff.config.schema.json handoff.config.example.json
```

If you never store handoffs inside the installation — for example when `HANDOFFS_ROOT` points
somewhere else — and you do not need anything else in it, the whole directory can go:

```bash
rm -rf "<install-path>"
```

Check where handoff data actually lives before doing that:

```bash
node "<install-path>/tools/handoff.mjs" config
```

`handoff: config root=<dir>` is the directory that holds your handoffs.

## After uninstalling

```bash
npx agent-handoff-install --list
```

The removed location should no longer appear. Handoff data that was kept still exists on disk
and can be read by a later installation, or by any tool that reads a handoff folder directly.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Not installed at <dir>` | That location holds no installation. Check `--list` and `where`, then retry with the right `--location` or `--path`. |
| Nothing was removed | The confirmation was skipped. Pass `--force`. |
| `EPERM` or `EBUSY` on Windows | A process is holding the files. Close it and retry, or check file attributes. |
| Permission denied | The installation is outside your user directory. Remove it with the privileges that created it, or use `--force` from a shell that can write there. |
| Handoff data disappeared | It was an empty kept directory removed by `--force`, or `HANDOFFS_ROOT` points elsewhere. Check the root printed by `handoff.mjs config`. |

## See also

- [INSTALL.md](INSTALL.md)
- [UPGRADE.md](UPGRADE.md)
- [../README.md](https://github.com/Alot1z/agent-handoff/blob/main/README.md)
