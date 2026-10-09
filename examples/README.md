# Examples

Example usage of agents-handoff.

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

## Sample store

`sessions/` is a real store: two captured sessions the engine built from the demo transcript
and the minimal fixture, with `INDEX.json`, the per-project `PROJECT.md` files and every
artifact a session folder holds. The [session index](https://alot1z.github.io/agents-handoff/SESSIONS.html)
is rendered from it, so the page and the store cannot disagree.

```bash
# read the sample store exactly as you would your own
HANDOFFS_ROOT=examples/sessions node tools/handoff.mjs list
HANDOFFS_ROOT=examples/sessions node tools/handoff.mjs show typescript-project-setup
HANDOFFS_ROOT=examples/sessions node tools/handoff.mjs verify typescript-project-setup

# re-render the page that lists it
node .github/scripts/build-sessions-index.mjs
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
