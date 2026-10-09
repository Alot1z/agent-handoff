---
name: agents-handoff
description: >-
  Write, verify, and hand off complete AI working sessions across any harness
  (Claude Code, Codex, DeepSeek Harness, plain JSONL or text logs). Captures a
  session as a portable, sha256-proven handoff folder a fresh agent can continue
  from with zero shared memory, with versioned contracts, an evidence gate, and
  backup/verify/rollback on every write. Zero runtime dependencies, no network.
version: 2.0.5
domain: orchestration
tokens: 900
allowed-tools: Bash(node:*), Read, Edit, Write
---

# Agent Handoff v2 — cross-harness session capture + verified continuation

ONE handoff system for every harness, every project, every model — backed by versioned
contracts, an evidence gate, and backup/verify/rollback on every write. Pick up any
conversation anywhere, with provenance for every artifact.

## Level map (progressive disclosure)

| Level | When loaded | Token cost | Content |
|-------|-------------|-----------|---------|
| **L1 Metadata** | Always (frontmatter above) | ~100 | name + description |
| **L2 Instructions** | This file, when triggered | <5k | core workflow + commands below |
| **L3 Resources** | As needed | none until read | `docs/`, `templates/`, `refs/`, `tools/handoff.mjs` |
| **L4 Dynamic** | When you need runtime/self-adapting | none until run | `tools/agents-handoff.mjs`: auto, verify-gate, promote, merge, self-improve |
| **L5 Collaborative** | Verified handoff dispatches a worker | none until run | `tools/agents-handoff.mjs` dispatch + `docs/LEVEL5.md` |

## What this skill is (capabilities + contracts)

1. **Capture engine** (`tools/handoff.mjs`, zero deps) — builds
   `projects/<project>/<session>/{HANDOFF.md, HANDOFF.summary.json, HANDOFF.llm.json,
   timeline.jsonl, TOOLS.md, manifest.json}` with sha256 watermark-provenance; update-not-recreate.
2. **Brief discipline** — lossless operational compression (10k-30k token briefs,
   TASK / USER SPECIFICATION / CURRENT STATE / DONE / IN PROGRESS / PLANNED / FAILED / FILES /
   VERIFICATION / ENVIRONMENT / NEXT / DO NOT), with length floors and a bootstrap text.
3. **Evidence contract** — every handoff states RESULT/WHAT_CHANGED/VALIDATION/
   EVIDENCE/BLOCKERS/RISKS/FOLLOW_UP; no evidence = no verified transition.
4. **Write safety** — trigger on staleness, lock-guard, backup before write,
   verify after write, rollback on failure, idempotent re-run.
5. **Pipeline principles**:
   - **Lossless raw**: rawInput/objective is verbatim, never replaced or paraphrased
     (PromptIR rule). Matches handoff "objectives verbatim".
   - **Versioned contracts**: every handoff artifact is a contract (schema v1, sha256);
     re-run merges past watermark. No unversioned writes.
   - **DecisionTrace**: record route/selection stages + provenance on every handoff
     (stages: capture → brief → verify.gate → promote → dispatch).
   - **Evidence-gated completion (ORC-1)**: state transitions only on evidence;
     a worker-DONE is never a verified transition. verify.gate runs before promote/dispatch.
   - **ContextPlan buckets (CTX-1)**: in the brief, classify context as required |
     historical | authoritative | retrievable | sensitive | deferred with budget caps.
   - **EVIDENCE_LEVELS ladder (KNOW-1)**: VERIFIED > OBSERVED > DERIVED > PREDICTED > UNKNOWN;
     never silently upgrade; supersede rather than stack.
   - **Autonomy ladder (CTL-1)**: observe → suggest → request-approval → constrained-execute →
     workflow-execute → autonomous-within-policy. Handoff writes default to constrained-execute;
     dispatch default dry-run.
   - **Honesty rule (FINAL-1)**: oracle registry + success-criteria evaluator; RESULT is
     DONE|PARTIAL|BLOCKED|FAILED — never fabricated.

## Doctrine (unchanged + corpus-backed)

1. Prompts are advisory; validators are authoritative. Fail closed on ambiguity (BLOCKED).
2. Portability over compression: fidelity lives verbatim in the fileset (TOOLS.md, timeline.jsonl,
   HANDOFF.llm.json); briefs reference by pointer.
3. Downgrade unverified claims to their true evidence level — never upgrade.
4. Handoff is prior knowledge, not ground truth: re-verify against the cheapest available
   oracle, and keep instructions self-contained so a fresh agent can act cold.
5. Max-local: every engine here runs with zero network deps; harness adapters are
   probe-absent-safe (Claude Code, Codex, DeepSeek Harness, plain JSONL, plain text).

## Core workflow

### A. Capture (any harness)
```bash
cd <handoffs-store>          # or set HANDOFFS_ROOT
node tools/handoff.mjs build --source <transcript.jsonl|.txt|.md> \
  --session <id> --harness claude-code|codex|dsh|generic \
  --model <name> --project <project> [--objective "text"]
```
Re-run merges past watermark. `verify <id-prefix>` checks manifest sha + turn-count + JSON parse.

### B. Write the lossless brief (COS rules + CTX buckets)
Headings TASK / USER SPECIFICATION / CURRENT STATE / DONE / IN PROGRESS / PLANNED-DECIDED /
FAILED-UNRESOLVED / FILES / VERIFICATION / ENVIRONMENT / NEXT / DO NOT. Enforce floors
(>=200 chars any session; >=1000 chars for >=20k recorded tokens). Preserve exact
paths/ids/commands/error text. Mark context provenance: required | sensitive | deferred.

### C. Gate with evidence (orchestrator + ORC-1)
```
RESULT: DONE | PARTIAL | BLOCKED | FAILED
WHAT_CHANGED:
VALIDATION:
EVIDENCE:          # artifact + sha; must match pending dispatch (phaseId + dispatchId)
BLOCKERS:
RISKS:
FOLLOW_UP:
```

### D. Level 4 runtime + L5 dispatch
```bash
HANDOFFS_ROOT=<store> node tools/agents-handoff.mjs auto --source <file> --session <id> --harness <h> --project <p>
HANDOFFS_ROOT=<store> node tools/agents-handoff.mjs verify-gate <id-prefix>
HANDOFFS_ROOT=<store> node tools/agents-handoff.mjs promote <id-prefix>
HANDOFFS_ROOT=<store> node tools/agents-handoff.mjs merge <a> <b>
HANDOFFS_ROOT=<store> node tools/agents-handoff.mjs self-improve
HANDOFFS_ROOT=<store> node tools/agents-handoff.mjs index
HANDOFFS_ROOT=<store> node tools/agents-handoff.mjs dispatch <id-prefix> --task "<objective>" [--broker <orchestrator-root> --live]
```
Dispatch re-runs the evidence gate first; carries manifest sha256; dry-run by default
(autonomy ladder: workflow-execute requires explicit --live).

## Rules

1. Never dump the whole corpus — load only what the task needs.
2. Preserve provenance — every artifact carries raw + manifest sha256.
3. Verbatim objectives (PromptIR lossless).
4. Evidence gates — RESULT without EVIDENCE never becomes VERIFIED.
5. Update, never duplicate (watermark merge).
6. No secrets.
7. Safety on writes (backup → apply → verify → rollback).
8. User messages are the highest authority in any brief.
9. Raw is never altered — handoffs render from canonical data.
10. Self-improve — a refused/truncated brief is a knowledge candidate.
11. Max-local: zero external-dependency engines; adapters absent-safe.
12. Versioned contracts — every artifact has a schema version, a sha256 and a decided autonomy level.

## Level map (L3 resources — read on demand)

| Need | File |
|------|------|
| Live dispatch protocol | `refs/protocol.md` |
| Role ladder | `refs/roles.md` |
| Validator gate (12-point) | `refs/validator.md` |
| Shared operating rules | `refs/handbook.md` |
| Fresh-session bootstrap | `refs/bootstrap.md` |
| Brief discipline | `refs/brief-checklist.md` |
| Engine source | `tools/handoff.mjs` |
| L4 runtime | `tools/agents-handoff.mjs` |
| L4/L5 design | `docs/LEVEL4.md`, `docs/LEVEL5.md` |
| Cross-harness adapters | `refs/ADAPTERS.md` |
| Handoff format + schema | `docs/FORMAT.md`, `templates/` |
| Installation | `docs/INSTALL.md` |

**Version**: 2.0.5
**Last Updated**: 2026-10-09