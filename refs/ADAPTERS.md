# Harness adapters — how any client feeds the handoff subsystem

No harness is special-cased in code. The engine consumes ONE canonical input shape;
every adapter below is just "get your store into that shape". Canonical = conversation-vault
raw JSONL line:

```json
{"seq":0,"ts":"1787669764492","harness":"dsh","source":"<origin path>",
 "session":"<id>","thread":"<project/thread>","role":"user|assistant|system|tool",
 "kind":"<free-form: reasoning|tool_use|text>","text":"<message body>"}
```

| Harness | Store | Adapter route | Status |
|---|---|---|---|
| DeepSeek Harness desktop+CI | ~/.dsh/sessions/<proj>/session-*.jsonl.zstd | vault.mjs import (zstd -> canonical) then build --source canonical.jsonl | VERIFIED live (85 sessions archived 2026-08-25) |
| Desktop client with a SQLite session store (machine-specific path) | <client data dir>/projects/*/desktop-v2.db | vault adapter (sqlite read-only, parts_json -> turns) | VERIFIED live on a client whose turns live in a sqlite table |
| Claude Code | ~/.claude/projects/**/*.jsonl | vault adapter (native JSONL -> canonical) | VERIFIED live |
| Codex | ~/.codex/sessions/*.jsonl | generic claude-jsonl parser | OBSERVED compatible shape |
| CI / anything | any exported JSONL | direct: build --source file.jsonl | VERIFIED (self-test) |
| Plain text/markdown log | any file | role-marker fallback parser (user:> / assistant:>) | VERIFIED (self-test) |

!! Preferred route: archive through conversation-vault FIRST (vault.mjs), then point handoff.mjs
at the canonical raw file — lossless capture + provenance + render in one chain.
Direct-to-handoff also works when no vault exists.

Class mapping (engine classify()):
- role=tool or kind contains "tool"   -> TOOL
- kind contains reason|think          -> THOUGHT  (AI-agent thoughts processing)
- role=user                           -> USER
- role=assistant                      -> AGENT
- everything else                     -> OTHER (kept in raw, omitted from render)

Secrets law (#211): no credentials/tokens ever written into handoffs — sources are chat stores only.