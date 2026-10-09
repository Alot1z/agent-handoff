---
title: Installation
---

# Installation

agents-handoff turns a working session into a portable handoff folder, and verifies that folder
later. It is a Node.js command-line skill with no runtime dependencies.

## Requirements

| Requirement | Notes |
|---|---|
| Node.js >= 18.0.0 | The engine uses ES modules and `node:fs`. |
| `unzip` | Only needed to extract a release archive by hand. |
| `tar` | Only needed when the installer fetches an archive instead of copying the tree beside it. |
| No network at run time | The engine never makes a network call. `npx` and `--verify-package` do. |

## Quick start

```bash
npx agents-handoff --all      # every harness found on this machine
```

One run covers one harness, several, or a directory of your own; the table in
[Install into the harness you use](#install-into-the-harness-you-use) has the whole set. The
installer copies the skill files into the resolved global root (or the harness directories
named), then reports how many files it copied. The published package carries the whole tree, so
this needs no download; only a bare copy of `install/` falls back to fetching the archive for
the requested version.

Confirm the installation:

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

## Installing from GitHub

Two ways, and both install the same tree:

```bash
# npm runs the repository's own package straight from GitHub — no registry copy involved
npx github:Alot1z/agents-handoff --all

# or clone it and run the installer from the checkout
git clone https://github.com/Alot1z/agents-handoff.git
cd agent-handoff
node install/install.mjs --all
```

The clone is also the way to install a version that is not on npm at all: a branch, a commit or
a tag. The installer accepts the same flags either way, and a checkout installs the tree in front
of it.

## Install into the harness you use

With no harness flag the installer uses the resolved global root (next section). A harness flag
puts the skill where that tool reads its skills, and several flags cover several tools in one
run:

```bash
npx agents-handoff --claude             # Claude Code
npx agents-handoff --codex              # Codex CLI
npx agents-handoff --agents             # the harness-neutral store
npx agents-handoff --all                # every harness found on this machine
npx agents-handoff --claude --codex     # exactly these two, one run
npx agents-handoff --harness claude,codex
npx agents-handoff --skills-dir ~/.config/mytool/skills
npx agents-handoff --project --claude   # this repository only (./.claude/skills)
```

| Flag | Harness | User-level directory | Per-repository directory, with `--project` |
|---|---|---|---|
| `--claude` | Claude Code | `~/.claude/skills` | `./.claude/skills` |
| `--codex` | Codex CLI | `~/.codex/skills` | `./.codex/skills` |
| `--agents` | the harness-neutral store | `~/.agents/skills` | `./.agents/skills` |
| `--harness <a,b>` | named harness(es), comma separated, repeatable | as above | as above |
| `--skills-dir <dir>` | any other stack, exactly | `<dir>` | `<dir>` |
| `--all` | every harness whose configuration directory exists here | as above | — |

Each target gets the skill folder `agents-handoff/` below that directory, so Claude Code finds
`~/.claude/skills/agents-handoff/`. Targets are installed, reported and recorded one by one,
and the run ends with a summary:

```
── target 1 of 2: claude ──
✓ Installed agents-handoff v<version> to <dir>/agents-handoff
Provenance: the tree beside the installer (.) · file-set sha256 3dab5c0d754a27fd…  (.agents-handoff-install.json)

── target 2 of 2: custom dir <dir> ──
…

Summary
  ✓ installed <dir> — v<version>
  ✓ installed <dir> — v<version>
```

`--all` installs into the harnesses whose configuration directory exists in your home directory
and names the ones it skipped; `--claude` and its siblings install there whether or not the
directory exists yet. Detection is a suggestion, never a decision.

Ask what this machine has, and whether what is installed is still intact:

```bash
npx agents-handoff doctor
```

```
agents-handoff doctor
  product v<version> · installer v<version> · node v<node version>

Harnesses
  ✓ claude  present  <home>/.claude/skills
      v<version> · 39/39 files · provenance OK
  · codex   not found  <home>/.codex/skills
  ✓ agents  present  <home>/.agents/skills

Global resolution
  <dir> — <reason>

Store (where handoffs are written)
  handoff: config root=<dir>

Verdict
  1 harness installation(s) found.
```

`doctor` reads and reports. It never installs, updates or removes anything.

## Where a global install goes

`--location global` does not point at a fixed directory. The installer searches for a store and
reports the reason it chose one. The order is:

| # | Condition | Result |
|---|---|---|
| 1 | `AGENT_HANDOFF_GLOBAL_DIR` is set | that directory |
| 2 | A skill store already holds an `agents-handoff` install | the newest such location |
| 3 | `~/.agents/skills` exists | `~/.agents/skills` |
| 4 | A skill store exists | its first account-skill root |
| 5 | Nothing found | the default store, created on install |

An account-skill store keeps skills two identifier levels below the store itself:

```
<store>/<account-id>/<profile-id>/agents-handoff/
```

`<store>` is `%APPDATA%\<client>\account-skills` on Windows, and `~/.<client>/account-skills` or
`~/.config/<client>/account-skills` on macOS and Linux, for whichever desktop client keeps
skills there. The installer searches every store it can find and never assumes one of them.

Inspect the decision before installing anything:

```bash
npx agents-handoff where
```

```
Global install root: <dir>
  chosen because: <reason>
  override with: AGENT_HANDOFF_GLOBAL_DIR=<dir> or --path <dir>
```

`--list` shows the resolved root, the local location, every candidate root, each harness
directory (whether or not it exists on this machine), and — inside a git repository — the
project location. Each installation found is printed with its version, the number of manifest
files present, and whether it still matches its install record.

## Locations

| Location | Target directory |
|---|---|
| `global` (default) | `<resolved global root>/agents-handoff` |
| `local` | `./local/skills/agents-handoff` |
| `project` | `./skills/agents-handoff` |
| `--path <dir>` | exactly `<dir>` |

## Options

| Option | Default | Effect |
|---|---|---|
| `--location <global\|local\|project>` | `global` | Which location to install, update, remove or verify. |
| `--path <dir>` | none | Use this directory instead of a resolved location. |
| `--version <v>` | `latest` | Request a version. Confirm what landed with `--verify`, which prints the installed version. |
| `--force`, `-f` | off | Skip confirmations and overwrite an existing installation. |
| `--claude`, `--codex`, `--agents` | none | Install into that harness's skills directory (table above). Repeatable, and combinable. |
| `--harness <a,b>` | none | Named harness(es), comma separated. Repeatable. |
| `--all` | none | Every harness whose configuration directory exists on this machine. |
| `--skills-dir <dir>` | none | Any other stack, exactly. Repeatable. |
| `--project` | off | With a harness flag: use the per-repository directory instead of the user-level one. |
| `--provenance` | off | With `verify`: print the install record the verification was checked against. |
| `--record` | off | With `verify-package`: store the tarball hashes in the install record. |
| `--help`, `-h` | — | Print the installer usage text. |

The installer accepts both bare verbs and flag forms: `install`/`--install`, `update`/`--update`,
`remove`/`--remove`, `verify`/`--verify`, `verify-package`/`--verify-package`, `list`/`--list`,
`doctor`/`--doctor`.

## Commands

| Command | Description |
|---|---|
| `install`, `i` (default) | Copy the skill files to the target. |
| `update`, `u` | Update every installation found, or the harnesses named. See [UPGRADE.md](UPGRADE.md). |
| `remove`, `rm` | Remove an installation, keeping everything the manifest does not own. See [UNINSTALL.md](UNINSTALL.md). |
| `verify`, `v` | Check every installation found: each manifest file, the skill metadata, that the engine runs, and the install record. |
| `verify-package`, `vp` | Check an installation against the published npm tarball for its version. |
| `list`, `ls` | List installed locations with version, manifest file count and provenance state. |
| `where` | Print the global root and why it was chosen. |
| `doctor` | Which harnesses are present here, what is installed where, and whether each installation still matches its record. |

## Verify an installation

```bash
npx agents-handoff --verify
```

Verification runs four kinds of check:

1. every file named in the installer manifest exists in the target;
2. `SKILL.md` declares both `name` and `version`;
3. `node tools/handoff.mjs config` exits 0 and prints the `handoff: config root=` marker — this
   exercises the engine's module graph, so a missing module fails here;
4. the installation still matches the provenance record written when it was installed.

Each check is printed with a pass or fail mark. On success the installer also prints the
installed location and version; on failure it exits non-zero and names the files that changed.

With no harness flag, `--verify` verifies **every installation found on this machine**, not just
the one the global resolver would pick: a machine that holds the skill in `~/.claude/skills` and
in `~/.agents/skills` has two copies, and both are checked. A harness flag or `--skills-dir`
scopes the run to those targets. The run fails if any installation fails.

There is no `--verbose` flag.

## Prove an installation matches the published package

`--verify` compares an installation with its own record. `--verify-package` compares it with the
artifact npm is actually serving for its version — the strongest check available, and it works
whichever way the install happened: from a tree, from a GitHub archive, or from `npx`.

```bash
npx agents-handoff --verify-package
npx agents-handoff --verify-package --record
```

It runs three checks, in this order, because each one makes the next meaningful:

1. the downloaded tarball matches the hashes the **registry declares** for that version
   (`dist.integrity` and `dist.shasum`) — otherwise "the published package" would be whatever
   the network handed over;
2. every file named in the installer manifest is byte-identical to the file of that name in the
   published tarball — each difference is named, with `not installed`, `not in the published
   package` or `content differs`;
3. the tarball's sha256 matches the one recorded for this installation, when one was recorded.

It prints the package name and version, the tarball URL and the tarball's sha256. `--record`
stores that sha256 (plus sha512, the integrity string and the shasum) in the `package` block of
the install record, so every later run compares against a stored value instead of re-deriving
one.

This check needs the network. When the registry cannot be reached, or the installed version is
not published, it fails and says so — it never passes by default.

## The install record (provenance)

Every install writes `.agents-handoff-install.json` inside the installed copy. It records what
landed and what it was made from:

| Field | Meaning |
|---|---|
| `product`, `version`, `installer_version` | What was installed, and which installer did it. |
| `installed_at` | When. |
| `harness`, `target` | Which harness flag selected the target, and its absolute path. |
| `source` | `the tree beside the installer`, or the tag archive with its URL and sha256. |
| `package` | The npm identity this installation should match: `name`, `version`, `registry`, `tarball`, and — once `--verify-package --record` has run — `sha256`, `sha512`, `integrity`, `shasum` and `verified_at`. |
| `file_count`, `files_sha256` | The installed file set, folded into one hash. |
| `files` | Every manifest path with its own sha256. |

`verify` re-hashes the same file set and compares it with the record, so a changed, missing or
renamed file fails the check and is named. That is the difference between an installation being
present and being checkable: the file that changed is reported, not just `verification failed`.

```bash
npx agents-handoff --verify --provenance
```

`--provenance` prints the record it checked against, so the verification can be read without
opening the file:

```
  provenance record
    installed_at: <iso timestamp>
    source: the tree beside the installer (.)
    harness: claude
    files: 39 · file-set sha256 3dab5c0d754a27fd…
```

An installation made before the record existed reports
`· no provenance record — installed before 2.0.3; reinstall to record one` and is otherwise
verified as before. Reinstall to write one.

The `package` block is the hook for the published-tarball check: installing from a tree cannot
know the hash of a tarball it did not download, so the hash is recorded the first time
`npx agents-handoff --verify-package --record` runs, and compared on every run after that.

## What `remove` keeps

`remove` deletes exactly what the install manifest owns — the skill files, and the two files the
installer writes for itself — and nothing else. Everything the manifest does not own is kept and
listed:

```
Kept — not the installer's to delete:
  .agent-handoff/
  handoff-session.md
  handoff.config.json
  handoffs/
  projects/
```

The rule is stated as a removal set rather than a keep list on purpose: a keep list deletes
whatever nobody remembered to name, so a store called anything other than the expected
directories would have gone with the skill. A `package.json` you wrote yourself is kept too; only
the installer's own private stub is removed.

## Installing again

Installing over an existing installation does nothing by default when the requested version is
`latest`: the installer reports the version already present, then stops. It tells you to use
`--update` to upgrade, or `--force` to reinstall the same files.

## Manual installation

Use the release archive when you cannot run `npx`.

1. Download the archive the release attaches: `agents-handoff-v<version>.zip` from the
   [releases page](https://github.com/Alot1z/agents-handoff/releases) (there is no
   `latest` asset — the newest release carries its own version in the file name).
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
| `Not installed at <dir>` | `--path` or a harness flag named a directory that holds no installation. Drop the flag to act on every installation found, or run `install` first. |
| `Nothing to update:` / `Nothing to verify:` | No installation was found anywhere the installer looks. Install one, or name a target with `--path`. |
| `verify-package` fails with `is not on the npm registry, or the registry is unreachable` | The installed version has no published tarball to compare against (a checkout install, or no network). The installation itself is untouched by that result. |
| `verify-package` fails with `does NOT match ... as published` | The check names each differing file. Reinstall with `--force`, then run it again; a file you edited on purpose will keep failing until it is reverted. |
| `Incomplete install: <n> of <m> file(s) missing — …` | The tree the installer reads from is not a complete one. Install from a fresh clone, or from a freshly downloaded archive. |
| `no published release found — fetching the main branch` | Not an error: `--version latest` found no release object, so the archive of `main` is used instead. Pass `--version <x>` to install a released tag. |
| `Cannot extract the archive (tar exited …)` | `tar` is missing, or the download did not arrive intact. The message prints the `curl` and `tar` commands that do the same job by hand. |
| The wrong root was chosen | Run `where` to see the reason, then set `AGENT_HANDOFF_GLOBAL_DIR` or pass `--path`. |
| `remove` did nothing | Removal asks for confirmation, and refuses in a non-interactive shell. Pass `--force`. |
| Verification fails | The output names the failing check. Fix it, or reinstall with `--force`. |
| `provenance: file-set sha256 matches the install record` fails | A file in the installation changed or went missing after it was installed. The changed paths are listed under the check; reinstall with `--force` to restore them, or keep the edit knowingly. |
| `no provenance record` | The installation predates the record. That is not a failure; reinstall to write one. |
| A harness install went somewhere unexpected | Harness directories are listed in the table above and by `doctor`/`list`. Use `--path` or `--skills-dir` to name the directory yourself. |

## See also

- [UPGRADE.md](UPGRADE.md)
- [UNINSTALL.md](UNINSTALL.md)
- [../README.md](https://github.com/Alot1z/agents-handoff/blob/main/README.md)
