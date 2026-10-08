# Bootstrap — load a handoff into a fresh session (port of choughton/llm-handoff SHARED_REPO_INIT_PROMPT)

Use this when a fresh agent session must load repository context before handling
a `HANDOFF.md` assignment. Replaces re-explaining setup: the next agent starts
working by *loading*, not by asking.

## Bootstrap order

1. Read `refs/handbook.md` (shared operating rules) — the equivalent of the source
   HANDBOOK.
2. Read `refs/protocol.md` (frontmatter/status/evidence/work-packet schema).
3. Read `PROJECT_STATE.md` if present (durable project-state pointer).
4. Read the live `HANDOFF.md`.
5. Read the repo's `README.md` / `AGENTS.md` / architecture doc as needed.
6. Read only the extra files the specific assignment requires.

## State model

Agents do not share memory:
- `HANDOFF.md` — live routing state.
- `PROJECT_STATE.md` — durable project state (when the repo uses one).
- Git history — durable execution record.

## Fresh-session contract

A session loaded this way must:
- Know its **role** (`refs/roles.md`) and its exact assignment (Work Packet).
- Know the canonical **status enum** and the **five-field evidence block**
  before it claims anything complete (`refs/protocol.md`).
- Follow the bootstrap order before touching `HANDOFF.md`.

## The operating rule

Prompts are advisory; validators and the dispatcher are authoritative. If the
prompt conflicts with parsed frontmatter, Git state, or repository instructions,
**stop and report the conflict**.

## PROJECT_STATE.md pattern (durable status pointer)

Keep it short. Detailed implementation notes go in commits/handoffs/project docs.

```markdown
# Project State

## Current Status
- **Active Epic:** none / <epic>
- **Current Blocker:** none / <blocker>
- **Active Branch:** main

## Open Followups
- none / <item>

## Completed Scope Ledger
Append one compact line per approved epic close:
- **<Epic Name>** - <one-line summary>. SHA `<sha>`. Verification: <checks>.
```

Two files, two jobs: `HANDOFF.md` is the live state; `PROJECT_STATE.md` is the
durable status; Git history is the durable record of completed work.