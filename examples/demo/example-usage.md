# Example: Building a handoff

This example shows how to use agent-handoff with the demo transcript.

## Step 1: Build a handoff

```bash
cd examples/demo
node ../../../tools/handoff.mjs build \
  --source transcript.jsonl \
  --harness claude-code \
  --project demo-project \
  --objective "Set up a new Node.js project with TypeScript"
```

This creates:

```
handoffs/
  projects/
    demo-project/
      <session-id>/
        HANDOFF.md
        HANDOFF.summary.json
        HANDOFF.llm.json
        timeline.jsonl
        TOOLS.md
        manifest.json
  projects/
    demo-project/
      PROJECT.md
  links/
    demo-project.md (if cross-links found)
INDEX.json
```

## Step 2: View the handoff

```bash
node ../../../tools/handoff.mjs show <session-id>
```

## Step 3: Verify integrity

```bash
node ../../../tools/handoff.mjs verify <session-id>
```

Should output: `PASS <session-id> [...]`

## Step 4: List all handoffs

```bash
node ../../../tools/handoff.mjs list
```

## Step 5: Rebuild (update)

If you add more turns to the transcript and rebuild:

```bash
node ../../../tools/handoff.mjs build \
  --source transcript.jsonl \
  --harness claude-code \
  --project demo-project
```

Only new turns (past the watermark) are appended.

## Expected output

```
handoff: built <session-id> project=demo-project turns=11 new=11 rev=1 -> handoffs/projects/demo-project/<session-id>
```

## Configuring handoff location

By default, handoffs are stored in `handoffs/` relative to the skill installation.
You can override this with the `HANDOFFS_ROOT` environment variable:

```bash
HANDOFFS_ROOT=./my-handoffs node ../../../tools/handoff.mjs build --source transcript.jsonl
```

Or configure in `handoff.config.json`:

```json
{
  "handoff_dir": "my-handoffs/"
}
```
