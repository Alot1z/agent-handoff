---
title: Uninstall
---

# Uninstall

Uninstalling removes the skill files. Your handoffs and your configuration stay where they are.

## Quick uninstall

```bash
npx agents-handoff --remove
```

Removal asks for confirmation first:

```
This will remove agents-handoff from:
  <install-path>

Your handoffs and anything else you put in this directory will NOT be deleted.
Configuration (handoff.config.json) will NOT be deleted.

Continue? (y/N)
```

Answer `y` to proceed. In a non-interactive shell the prompt is skipped and nothing is removed;
the installer prints `Non-interactive mode, use --force to skip confirmation` instead.

```bash
npx agents-handoff --remove --force
```

## Options

| Option | Effect |
|---|---|
| `--remove` | Remove the installation (interactive confirmation). |
| `--force`, `-f` | Skip the confirmation. |
| `--location <global\|local\|project>` | Which installation to remove. Global is the default and is resolved the same way as for install. |
| `--path <dir>` | Remove the installation at exactly this directory. |
| `--claude`, `--codex`, `--agents` | Remove that harness's installation. Repeatable, and combinable. |
| `--harness <a,b>` | Named harness(es), comma separated. Repeatable. |
| `--all` | Every harness whose configuration directory exists on this machine. |
| `--skills-dir <dir>` | Remove the installation under exactly this directory. Repeatable. |
| `--project` | With a harness flag: the per-repository installation. |

Removing several harnesses at once is the same one run as installing them, and each target is
reported on its own:

```bash
npx agents-handoff --remove --claude --force
npx agents-handoff --remove --all --force
```

Flag form and bare verb are equivalent: `--remove` and `remove`, `--force` and `-f`.

## What is removed

**Only what the installation owns — the manifest.** The rule is a removal set, not a keep
list, so a directory nobody thought to name is kept rather than deleted:

- the engine and runtime: `tools/`, `tools/lib/`
- metadata: `SKILL.md`, `README.md`, `LICENSE`, `skill.json`, the manifest JSON files
- the install record: `.agents-handoff-install.json`
- `schemas/`, `refs/`, `templates/`, `docs/`, `tests/`
- the `package.json` stub the installer wrote, and only that stub — a `package.json` you have
  edited is kept

Each removed entry is printed as `Removed file: <name>` or `Removed directory: <name>/`.

## What is kept

Everything else in the directory — the installer prints the list at the end:

```
Kept — not the installer's to delete:
  .agent-handoff/
  handoff-session.md
  handoff.config.json
  handoffs/
  projects/
```

That includes a store under any name (`.agent-handoff/`, `projects/`, `handoffs/`, or one of
your own), `links/`, notes, your `handoff.config.json`, and anything else you added. Nothing is
deleted for being empty, and nothing outside those paths is touched; if data remains, the
installation directory remains with it.

## Manual uninstall

Remove the skill files and leave the data behind:

```bash
cd "<install-path>"

# Exactly the manifest this same release installs. Your store, notes and
# handoff.config.json are not listed, so they stay.
rm -rf tools docs refs templates schemas tests
rm -f SKILL.md README.md LICENSE skill.json \
      capability-registry.json permission-policy.json \
      handoff.config.schema.json handoff.config.example.json \
      .agents-handoff-install.json
```

A `package.json` the installer wrote (`"private": true`, `"name": "agents-handoff"`) can go
too; one you edited is yours to keep. `--remove` makes that distinction itself.

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
npx agents-handoff --list
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
| The directory is still there after `--remove` | It is not empty: the entries printed under `Kept — not the installer's to delete:` are still inside. Remove them yourself if you no longer want them. |
| Handoff data seems to be missing | `HANDOFFS_ROOT` points elsewhere. Check the root printed by `handoff.mjs config`; `--remove` never deletes a store inside the install directory. |

## See also

- [INSTALL.md](INSTALL.md)
- [UPGRADE.md](UPGRADE.md)
- [../README.md](https://github.com/Alot1z/agents-handoff/blob/main/README.md)
