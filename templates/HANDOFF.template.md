# Handoff: <SESSION-ID>

**Harness:** <claude-code|codex|dsh|ci|generic>  |  **Model:** <name>
**Updated:** <ISO>  |  **Turns:** N  |  **Watermark:** seq <= N  |  **Revision:** R

## Objective (verbatim head)

```
<first USER (else AGENT) turn, <=400 chars, never paraphrased>
```

## State right now (verbatim tail)

```
<last AGENT (else USER) turn tail, <=1200 chars>
```

## Open loops / next steps
- <lines matching next step|todo|blocked|open loop|remaining>

## Timeline (recent turns)

| seq | class | text (head 140) |
|---:|---|---|
| 0 | USER | ... |

<!-- classes: USER · AGENT · THOUGHT (reasoning) · TOOL (tool_use/result) · OTHER (raw-fidelity meta, omitted from render) -->

## Tool calls (full)
- [seq] ts: excerpt <=500 chars

## Provenance
- sources: <original store paths>
- raw sha256: <hash of exact ingested bytes>
- manifest sha256: <self-hash of manifest minus this field>
- incremental: revisions=N (update-not-recreate; watermark skips emitted turns)

!! Laws: RAW IS NEVER ALTERED — handoffs RENDER from canonical/vault data · objectives verbatim ·
re-run = merge not duplicate (watermark) · every artifact carries sha256 provenance · works on ANY
harness that emits JSONL or plain text (refs/ADAPTERS.md).