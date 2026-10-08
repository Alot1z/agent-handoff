# Validator Gate — the authoritative check (port of choughton/llm-handoff handoff-validator)

The validator is the **authoritative** half of "prompts are advisory, validators
are authoritative." It inspects the live `HANDOFF.md` routing state and reports
whether the loop can continue safely. It does **not** modify the handoff,
re-route the work, implement code, commit, or push.

## Routing contract (how ambiguity resolves)

| Situation | next_agent |
|---|---|
| Backend/data/CLI/integration implementation | `backend` |
| UI/frontend implementation | `frontend` |
| Planning, scope decomposition, next-story assignment | `planner` |
| Completed implementation needing review | `auditor` |
| Approved final scope, `close_type: epic` only | `finalizer` |
| Broken/malformed/internally-inconsistent handoff state | `validator` |
| Missing human decision, missing credentials, unsafe ambiguity | `user` |

If the handoff names a provider (Codex/Gemini/Claude), translate it to the public
role it is serving in this repo. When route evidence is insufficient, set
`next_agent: user` and ask one concrete question — **never guess.**

## The 12-point check

Ordered. Each item is `PASS | WARN | FAIL` with a one-line detail:

1. YAML frontmatter exists at the top of `HANDOFF.md`.
2. Frontmatter parses as YAML.
3. `next_agent` is one of the public enum.
4. `reason` is present, non-empty, and quoted when it contains punctuation.
5. `close_type`, when present, is `story` or `epic`.
6. `scope_sha` is present when `close_type` is set.
7. `scope_sha` and `prior_sha`, when present, are 7–40 char hex and resolve via
   `git cat-file -t <sha>`.
8. `finalizer` routing is used only with `close_type: epic`.
9. `status`, when present, is a canonical enum value.
10. Completion statuses include the `## Verification Evidence` block.
11. The body has enough detail to act on: files, checks, findings, ACs.
12. Current git state is compatible with the handoff claim — report dirty state
    as WARN unless the repo requires clean state.

## Output shape (Machine-Readable Result)

Return exactly:

```text
VALID: YES | NO | WARNINGS-ONLY
CHECKS:
  FRONTMATTER:    PASS | WARN | FAIL - <detail>
  SHA-PRESENT:    PASS | WARN | FAIL - <detail>
  SHA-FRESH:      PASS | WARN | FAIL - <detail>
  ROUTING:        PASS | WARN | FAIL - <detail>
  CONTENT:        PASS | WARN | FAIL - <detail>
  GIT-STATE:      PASS | WARN | FAIL - <detail>
SUMMARY: <one sentence>
BLOCKERS: <numbered list if VALID=NO, otherwise "none">
```

Only a FAIL makes `VALID: NO`. WARN-only results use `VALID: WARNINGS-ONLY`.
A handoff that is `NO` or `WARNINGS-ONLY` must **not** advance the run — fail
closed, never guess forward.

## Router summary (when this role is exercised as a router)

The router variant *does* rewrite the handoff to make routing deterministic.
After writing, it returns:

```text
ROUTING UPDATED: YES
NEXT_AGENT: <role>
REASON: <one sentence>
```