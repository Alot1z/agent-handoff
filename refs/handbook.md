# Handbook — shared operating rules for every role (port of choughton/llm-handoff HANDBOOK)

Read this before acting on any `HANDOFF.md` assignment. Role prompts (`refs/roles.md`)
add role-specific rules; this file is the shared protocol.

## How the live handoff works

`HANDOFF.md` is the **live state file**. Only the active dispatcher role owns it
during its turn. Provider-native subagents, skills, or helper agents are internal
support machinery and **must not** independently rewrite the handoff.

Two layers, always:
- **YAML frontmatter** for machine routing (authoritative).
- **Markdown body** for human-readable context, evidence, findings, and work packets.

## State model — no shared memory

Agents do not share memory. Version-controlled files are the source of truth:

- `HANDOFF.md` — the live routing state.
- `PROJECT_STATE.md` — the durable project-state pointer (when the repo uses one).
- Git history — the durable execution record.

Our engine's fileset slots into this: `timeline.jsonl` is append-only turn truth,
`HANDOFF.llm.json` is the machine-replayable payload, `manifest.json` carries the
sha256 provenance, and `TOOLS.md` holds every tool call verbatim.

## Escalation protocol

Use **one** of the canonical statuses, never a synonym:

- `escalate_to_user` + `next_agent: user` — human input required.
- `blocked_missing_context` — the missing input is specific and the next human
  question is clear.
- `blocked_implementation_failure` — an implementation path failed structurally
  and needs re-scoping.

## When to flag uncertainty

Stop and route to `planner`, `validator`, or `user` when **scope, ownership,
routing, tests, or Git state** are ambiguous. Do not widen your role boundary to
avoid asking. Guessing forward on ambiguous state is a protocol violation.

## The operating rule

**Prompts are advisory. Validators and the dispatcher are authoritative.**
If a prompt conflicts with parsed frontmatter, Git state, or repository
instructions, stop and report the conflict — do not silently follow the prompt.

## Common failure modes (catch these; they are your reviewers' checklist)

- Missing or malformed YAML frontmatter.
- Provider names (Codex/Gemini/Claude) used as public workflow roles.
- `scope_sha: HEAD` instead of a concrete SHA.
- Completion claims without `## Verification Evidence`.
- Planner assignments without a concrete Work Packet.
- Auditor approvals that skip spec compliance (phase-1).
- Repeated implementer/auditor bounces on the same story — signal it early.