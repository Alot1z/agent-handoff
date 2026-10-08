# Sample Handoff

This is an example of what a handoff looks like.

## Structure

```
handoffs/
  projects/
    <project-name>/
      <session-id>/
        HANDOFF.md           # Human+LLM brief
        HANDOFF.summary.json # Machine payload
        HANDOFF.llm.json     # Full payload
        timeline.jsonl       # Raw turns
        TOOLS.md             # Tool calls
        manifest.json        # SHA256 + metadata
```

## Example: Minimal Handoff

```markdown
# Handoff: session-abc123

**Project:** my-project  
**Harness:** claude-code  
**Model:** claude-3-opus  
**Updated:** 2026-10-08T10:00:00Z  
**Turns:** 10  
**Revision:** 1  
**Watermark:** seq <= 9

## Objective (verbatim)

```
Help me set up a TypeScript project
```

## State right now (verbatim tail)

```
I've created the project structure with:
- package.json
- tsconfig.json
- src/index.ts

Let me know if you need anything else!
```

## Open loops / next steps

- None

## Recent timeline (last 10 of 10 turns)

| seq | class | text (head 120) |
|----:|-------|-----------------|
| 0 | USER | Help me set up a TypeScript project |
| 1 | AGENT | I'll help you set up a TypeScript project... |
| ... | ... | ... |

## Where everything lives

- Full timeline: timeline.jsonl (10 turns)
- Tool calls: TOOLS.md
- Machine payload: HANDOFF.llm.json

## Provenance

- sources: transcript.jsonl
- raw sha256: abc123...
- manifest sha256: def456...
- incremental: revisions=1
```

## Example: Machine Payload (HANDOFF.summary.json)

```json
{
  "schema_version": "2.0.0-summary",
  "session": {
    "id": "session-abc123",
    "harness": "claude-code",
    "model": "claude-3-opus"
  },
  "project": "my-project",
  "generated_at": "2026-10-08T10:00:00Z",
  "objective": "Help me set up a TypeScript project",
  "state_now": "I've created the project structure...",
  "open_loops": [],
  "evidence_class": "OBSERVED",
  "counts": {
    "USER": 3,
    "AGENT": 5,
    "THOUGHT": 0,
    "TOOL": 2
  },
  "artifacts": {
    "full_payload": "HANDOFF.llm.json",
    "timeline": "timeline.jsonl",
    "tool_calls": "TOOLS.md"
  },
  "provenance": {
    "sources": ["transcript.jsonl"],
    "raw_sha256": "abc123...",
    "manifest_sha256": "def456...",
    "revision": 1,
    "watermark": 9,
    "total_turns": 10
  }
}
```

## Using This Example

1. Copy this to `examples/handoff/sample-handoff.md`
2. Use as reference when building handoffs
3. See `examples/demo/` for working demo
