# agent-handoff-install

npx installer for the agent-handoff skill.

## Quick start

```bash
npx agent-handoff-install
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
npx agent-handoff-install

# Install to project-local
npx agent-handoff-install --location project

# Update to latest
npx agent-handoff-install --update

# Remove without confirmation
npx agent-handoff-install --remove --force

# Verify installation
npx agent-handoff-install --verify

# Show all installations
npx agent-handoff-install --list

# Show which global root was chosen, and why
npx agent-handoff-install where
```

## Locations

- **global**: resolved, not hard-coded — an account-skill root that already holds
  `agent-handoff`, else `~/.agents/skills`, else any account-skill store found on this
  machine (`<store>/<account-id>/<profile-id>/agent-handoff/`), else `~/.agents/skills`,
  created on install. See it resolved:
  `npx agent-handoff-install where`. Override with `AGENT_HANDOFF_GLOBAL_DIR`, or target an
  exact path with `--path`.
- **local**: `./local/skills/agent-handoff/`
- **project**: `./skills/agent-handoff/` (only detected if in a git repo)

## Requirements

- Node.js >= 18.0.0
- curl, wget, or native fetch for downloading

## Development

This installer is part of the agent-handoff skill source code.

See the [agent-handoff docs](https://github.com/Alot1z/agent-handoff/tree/main/docs) for more.
