# agents-handoff

npx installer for the agents-handoff skill.

## Quick start

```bash
npx agents-handoff
```

## Commands

| Command | Description |
|---------|-------------|
| `install` | Install the skill (default) |
| `update` | Update to latest or specified version |
| `remove` | Remove the installation |
| `verify` | Verify installation integrity |
| `list` | List all installed locations |
| `where` | Show the resolved global root and why it was chosen |

## Options

| Option | Description |
|--------|-------------|
| `--location L` | Install location: `global` (default), `local`, `project` |
| `--path P` | Custom installation path |
| `--version V` | Version to install: `latest` (default) or specific version |
| `--force`, `-f` | Skip confirmations, overwrite existing |

## Examples

```bash
# Install to global location
npx agents-handoff

# Install to project-local
npx agents-handoff --location project

# Update to latest
npx agents-handoff --update

# Remove without confirmation
npx agents-handoff --remove --force

# Verify installation
npx agents-handoff --verify

# Show all installations
npx agents-handoff --list

# Show which global root was chosen, and why
npx agents-handoff where
```

## Locations

- **global**: resolved, not hard-coded — an account-skill root that already holds
  `agents-handoff`, else `~/.agents/skills`, else any account-skill store found on this
  machine (`<store>/<account-id>/<profile-id>/agents-handoff/`), else `~/.agents/skills`,
  created on install. See it resolved:
  `npx agents-handoff where`. Override with `AGENT_HANDOFF_GLOBAL_DIR`, or target an
  exact path with `--path`.
- **local**: `./local/skills/agents-handoff/`
- **project**: `./skills/agents-handoff/` (only detected if in a git repo)

## Requirements

- Node.js >= 18.0.0
- curl, wget, or native fetch for downloading

## Development

This installer is part of the agents-handoff skill source code.

See the [agents-handoff docs](https://github.com/Alot1z/agents-handoff/tree/main/docs) for more.
