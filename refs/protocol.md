# Handoff Protocol — live dispatch state, frontmatter, status, evidence (port of choughton/llm-handoff)

> Adapted from `choughton/llm-handoff` (Apache-2.0). This fuses its file-based
> dispatch protocol into agents-handoff's fileset. Where our engine already
> existed (RESULT/WHAT_CHANGED..., sha256 manifests), this ADDS the live
> routing layer: a single `HANDOFF.md` file that doubles as **the mutex and the
> debugger** — every transition is visible as text, and a run only advances when
> the frontmatter parses, routes, and validates.

## The inversion (core doctrine)

> **Prompts are advisory. Validators are authoritative.**

Agents may write prose, but a run only advances when the handoff state parses,
routes, and validates. `HANDOFF.md` is the shared state file, `git rev-parse
HEAD` SHAs are the durable record of completed work, and when routing is
ambiguous or unsafe the run **fails closed and pauses** instead of guessing.

## Two layers of every handoff

1. **YAML frontmatter** — machine routing (authoritative; the dispatcher reads
   this, not the prose).
2. **Markdown body** — human/agent-readable context, evidence, findings, and
   work packets.

## Required frontmatter schema

Every `HANDOFF.md` write begins with YAML frontmatter. The YAML block is
authoritative; prose is context.

```yaml
---
next_agent: <enum>       # required: planner | backend | frontend | auditor | validator | finalizer | user
reason: <string>         # required: quote every `reason` value
epic_id: <string>        # optional active epic identifier
story_id: <string>       # optional active story identifier
story_title: <string>    # optional short active story title
remaining_stories:       # optional remaining story IDs/titles
  - <story id/title>
status: <enum>           # canonical status when the handoff claims completion/blockage
bounce_count: 0          # optional dispatcher-maintained retry count
evidence_present: true   # optional validator hint for evidence-aware handoffs
scope_sha: <git SHA>     # required when close_type is story|epic; concrete 7-40 hex, NEVER "HEAD"
close_type: <enum>       # optional: story | epic
prior_sha: <git SHA>     # optional prior verified SHA
producer: <string>       # required: the role that wrote this handoff
---
```

Hard rules:
- **Quote every `reason`.**
- **Run `git rev-parse HEAD`** for concrete SHAs; never write `scope_sha: HEAD`,
  a branch name, or a placeholder.
- `scope_sha` must be a 7–40 char hex SHA that `git cat-file -t` resolves.

## Status enum (canonical — no synonyms)

Use exactly one. Do **not** invent `done`, `approved`, or `blocked`.

| Status | Meaning | Typical emitter |
|---|---|---|
| `ready_for_review` | Implementation complete, needs audit | backend, frontend |
| `verified_pass` | Auditor verified assignment + quality gates | auditor |
| `verified_fail` | Auditor found a defect; routes back to implementer | auditor |
| `blocked_missing_context` | Cannot proceed without more info | any role |
| `blocked_implementation_failure` | Implementation attempted but structurally failed | backend, frontend |
| `escalate_to_user` | Human decision required | any role |

Maps to our engine's RESULT values: `ready_for_review`→*needs review*, `verified_pass`→`DONE`, `verified_fail`→*returned*, `blocked_*`→`BLOCKED`, `escalate_to_user`→*needs human*. The two vocabularies coexist: the enum is the routing state, the RESULT is the completion contract.

## Verification Evidence block (required for completion statuses)

Required when `status` is `ready_for_review`, `verified_pass`, or `verified_fail`.
Exact five-field shape:

```markdown
## Verification Evidence

- **Commands run:** verbatim command lines
- **Output summary:** one line per command with exit codes
- **Commit SHA verified:** concrete 7-40 char Git SHA; never `HEAD`
- **Files changed or reviewed:** relative paths
- **Unresolved concerns:** list or `none`
```

**Evidence must come from the current turn.** Prior output, assumptions, and
model confidence are not evidence. This is the same law as our
RESULT-without-EVIDENCE-never-becomes-VERIFIED.

## Work Packet (planner → backend/frontend)

Planner assignments include exactly these six fields:

```markdown
## Work Packet

- **Objective:** one bounded result
- **Files in scope:** relative paths
- **Files out of bounds:** relative paths or `none`  ← never omit, even "none"
- **Context:** required reading or background
- **Verification command:** exact command to run
- **Expected next route:** role after success
```

Never use vague placeholders: `add validation`, `handle errors appropriately`,
`write tests`, `implement later`, `as needed`. Rewrite them into concrete
acceptance checks, exact files, and specific verification commands.

## Common failure modes to catch

- Missing or malformed YAML frontmatter.
- Provider names (Codex/Gemini/Claude) used as public workflow roles — translate to the public role.
- `scope_sha: HEAD` instead of a concrete SHA.
- Completion claims without `## Verification Evidence`.
- Planner assignments without a concrete work packet.
- Auditor approvals that skip spec compliance.
- Repeated implementer/auditor bounces on the same story.