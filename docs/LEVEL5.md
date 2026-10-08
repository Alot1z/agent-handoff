---
title: Level 5 — collaborative dispatch
---

# Level 5 — collaborative dispatch

A handoff normally ends as files on disk, and something reads it later. The dispatch command
lets a handoff whose own record is complete hand its continuation to a worker through a local
broker, instead of waiting for a reader.

```bash
node tools/agent-handoff.mjs dispatch <id-prefix> --task "<objective>" \
  [--role <role>] [--parent <parentTaskId>] [--broker <broker-root>] [--live]
```

| Argument | Default | Meaning |
|---|---|---|
| `<id-prefix>` | required | The handoff that is handing off its continuation. |
| `--task <objective>` | required | What the worker is being asked to do. |
| `--role <role>` | `implementation-agent` | The role the request is addressed to. |
| `--parent <parentTaskId>` | `handoff:<id>` | The parent the request is attached to. |
| `--broker <root>` | none | Root of the broker program. |
| `--live` | off | Enqueue the request instead of printing it. |

## The gate

Dispatch refuses to hand over work from a handoff that is not internally complete. Before
anything is built, `HANDOFF.md` is read and two things are required:

1. all seven contract fields are present, each at the start of a line — `RESULT`,
   `WHAT_CHANGED`, `VALIDATION`, `EVIDENCE`, `BLOCKERS`, `RISKS`, `FOLLOW_UP`;
2. a record that says `RESULT: DONE` also carries an `EVIDENCE:` line.

When either fails, the command prints the refusal and exits 1:

```json
{ "ok": false, "status": "GATE_REJECTED", "session": "<id>",
  "reason": "handoff fails the evidence gate (missing contract fields: ...; DONE-without-EVIDENCE=true)" }
```

The gate reads `HANDOFF.md` only. It does not recompute the manifest hash, check the timeline
count, or parse the payload — those are `verify-gate` checks. A handoff can therefore pass the
dispatch gate while failing `verify-gate` on `sha`, `counts` or `payload`; run
`verify-gate <id>` first when that matters.

## The envelope

| Field | Value |
|---|---|
| `from_handoff` | The session id the request came from. |
| `project` | The project that session belongs to. |
| `role` | `--role`. |
| `parentTaskId` | `--parent`, by default `handoff:<id>`. |
| `objective` | `--task`. |
| `evidence` | The session's `manifest_sha256`, so the receiver can check what it was given. |
| `evidenceRequirements` | `["verified-handoff"]`. |
| `dispatchedAt` | Timestamp of the envelope. |
| `broker_mode` | `live` or `dry-run`. |
| `handoff_dir` | Absolute path of the session directory. |

## States

| State | When | Exit |
|---|---|---|
| `GATE_REJECTED` | The contract or evidence check failed. Nothing is sent. | 1 |
| `DRY_RUN` | `--live` was not passed, or no broker root was given. The envelope is printed. | 0 |
| `DISPATCHED` | `--live` and a broker root were given and the broker answered. | 0 |

`DRY_RUN` is the default. It prints the envelope and one line of advice: either re-run with
`--live`, or pass a broker root and `--live`. A dry run writes nothing and starts no process.

## Live dispatch

With both `--live` and a broker root, the command requires
`<broker-root>/runtime/request-child-worker.mjs`; if that file is missing it exits 3 and
sends nothing. It then runs:

```
node <broker-root>/runtime/request-child-worker.mjs <broker-root> <parentTaskId> <role> <task> handoff:<id>
```

The broker's stdout is parsed as JSON and returned as `broker_output` alongside the envelope.
A broker that fails to start, or that prints something that is not JSON, exits 1.

Two limits worth knowing:

- **No dedupe and no lock.** Unlike `auto`, `merge` and `promote`, dispatch takes no lock and
  keeps no record of a previous dispatch. Running a live dispatch twice enqueues the request
  twice; a caller that needs once-only delivery must guard it.
- **The broker is a separate program.** This skill builds the envelope, checks the gate and
  invokes the broker entry point. What the broker does with the request — how it queues it,
  which worker picks it up, whether it dedupes — is not implemented or verified here.

The traceability chain that does exist: `parentTaskId` defaults to `handoff:<id>`, and
`evidence` carries the handoff's manifest hash, so a request can be traced back to the session
directory, its manifest, and the source transcripts recorded in `source_paths`.
