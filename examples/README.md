# Examples

Example usage of agent-handoff.

## Demo

See [demo/](demo/) for a complete example:

- `demo/transcript.jsonl` - Sample transcript
- `demo/example-usage.md` - Step-by-step guide

### Quick test

```bash
cd examples/demo
node ../../tools/handoff.mjs build --source transcript.jsonl --harness claude-code --project demo
node ../../tools/handoff.mjs list
node ../../tools/handoff.mjs show <session-id>
node ../../tools/handoff.mjs verify <session-id>
```

## Harness examples

Different harnesses produce different transcript formats. See [refs/ADAPTERS.md](../refs/ADAPTERS.md) for format details.

### Claude Code

```bash
node tools/handoff.mjs build --source claude-transcript.jsonl --harness claude-code --project my-project
```

### Codex

```bash
node tools/handoff.mjs build --source codex-transcript.jsonl --harness codex --project my-project
```

### Plain text

```bash
node tools/handoff.mjs build --source conversation.txt --harness generic --project my-project
```

## Project-local handoffs

To store handoffs within a project (instead of global location):

```bash
# Create handoffs directory in your project
mkdir handoffs

# Build with HANDOFFS_ROOT pointing to your project
HANDOFFS_ROOT=./handoffs node tools/handoff.mjs build --source transcript.jsonl --project my-project
```

This keeps handoffs version-controlled with your project.
