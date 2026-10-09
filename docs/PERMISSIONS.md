---
title: Permissions
---

# Permissions

The runtime layer evaluates a permission policy before it executes anything. The policy is a
JSON file; the implementation is `tools/runtime-engine.mjs`.

```
node tools/runtime-engine.mjs run --risk R0 --op read --target tests/fixtures/minimal-transcript.jsonl
```

Every operation is evaluated first and executed only on an `ALLOWED` verdict. A `DENIED` or
`NEEDS_AUTH` operation does not run, and its decision record is written with
`enforced_before_execution: true`.

## The policy file

`permission-policy.json` in the skill root is the default. Every runtime verb accepts
`--policy <path>`; a relative path resolves against the skill root.

| Key | Shipped value |
|---|---|
| `approved_workspaces` | `.` (the skill root), `repo-upstream`, `.agents-handoff`, `.context` |
| `system_read_only_roots` | `C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)` |
| `personal_data_roots` | `C:\Users` |
| `denied_roots` | empty |
| `grants` | `DISCOVERY_ONLY` allow, `READ_ONLY` allow, `WORKSPACE_WRITE` allow, `EXTERNAL_EFFECT` needs_auth, `DESTRUCTIVE` needs_auth, `IRREVERSIBLE` needs_auth |
| `risk_to_level` | `R0` → `READ_ONLY`, `R1` → `WORKSPACE_WRITE`, `R2` → `EXTERNAL_EFFECT`, `R3` → `DESTRUCTIVE`, `R4` → `IRREVERSIBLE` |

The shipped roots are Windows-shaped. On macOS and Linux they match no existing path, so
anything outside `approved_workspaces` classifies as `EXTERNAL_PATH`. Set platform-appropriate
roots before relying on classification outside the workspace.

A policy that is missing, is not valid JSON, or lacks `grants` or `risk_to_level` is a
configuration error: exit 2, nothing executed.

## Levels and grants

| Level | Grant in the shipped policy | Meaning |
|---|---|---|
| `DISCOVERY_ONLY` | allow | Read metadata, list, inspect. |
| `READ_ONLY` | allow | Read files and state. |
| `WORKSPACE_WRITE` | allow | Write inside an approved workspace. |
| `EXTERNAL_EFFECT` | needs_auth | Network or external service. |
| `DESTRUCTIVE` | needs_auth | Delete or overwrite. |
| `IRREVERSIBLE` | needs_auth | Operations that cannot be undone. |

A grant value of `allow` yields `ALLOWED`, `needs_auth` yields `NEEDS_AUTH`, and any other
value yields `DENIED`. Unknown risk classes are denied, not allowed.

Because grants are keyed by level rather than by operation, an operator can permit every
`EXTERNAL_EFFECT` operation, or require authorization for every workspace write, with one
edit.

## Target classification

`classify()` tests the target against the policy roots, most specific rule first:

| Order | Class | Source |
|---|---|---|
| 1 | `DENIED_ROOT` | `denied_roots` |
| 2 | `APPROVED_WORKSPACE` | the runtime's own state directory, wherever `AGENT_HANDOFF_STATE_DIR` points |
| 3 | `APPROVED_WORKSPACE` | `approved_workspaces` |
| 4 | `PERSONAL_DATA_PATH` | `personal_data_roots` |
| 5 | `SYSTEM_PATH` | `system_read_only_roots` |
| 6 | `EXTERNAL_PATH` | nothing matched |

Rule 3 must precede rule 4. A globally installed skill lives under the user's home
directory, which is normally inside a personal-data root; if the broad root won, every
operation inside a real installation would be denied at any risk.

## Verdicts

| Target class | `READ_ONLY` / `DISCOVERY_ONLY` | `WORKSPACE_WRITE` and above |
|---|---|---|
| `APPROVED_WORKSPACE` | allowed | grant applies |
| `SYSTEM_PATH` | allowed | denied |
| `PERSONAL_DATA_PATH` | denied | denied |
| `DENIED_ROOT` | denied | denied |
| `EXTERNAL_PATH` | denied | denied |

Personal data and explicitly denied roots are denied at every risk level. Writes and effects
are allowed only inside an approved workspace.

| Verdict | Exit code |
|---|---|
| `ALLOWED` | 0 |
| `DENIED` | 3 |
| `NEEDS_AUTH` | 4 |
| usage or configuration error | 2 |

## What the gateway covers

| Operation | How it is gated |
|---|---|
| `run --op read --target <path>` | Evaluated against the target. On `ALLOWED` the file is read and the record carries `bytes` and `content_sha256`. |
| `run --op spawn --args "<node args>"` | Evaluated against the workspace root. The child is the running Node binary with the given arguments, working directory pinned to the skill root, 15-second timeout, stdout and stderr digested into the record, child exit code propagated. |
| `job` / `resume` steps | Each step is evaluated at `R1` against the job state directory before the work log is appended. |
| `evaluate` | Decides and prints; executes nothing. |
| `policy` | Prints the loaded policy and exits 0. |

Every decision, allowed or denied, is written to
`<state dir>/executions/<timestamp>-<pid>-<random>.json`. The state directory is
`AGENT_HANDOFF_STATE_DIR` when set, and `<skill>/.agents-handoff` otherwise; it is treated as
an approved workspace wherever it points.

## Declared but not enforced

- `DISCOVERY_ONLY` has a grant, but the shipped `risk_to_level` maps no risk to it, so no
  `--risk` value reaches that level. It becomes reachable only if a policy maps a risk class
  to it.
- The policy gates the runtime engine only. `tools/handoff.mjs`, the capability registry and
  the installer do not consult it: the handoff engine writes to its resolved store without a
  permission decision, and the registry probes are classified by their own declarations.
- There is no interactive approval prompt. `NEEDS_AUTH` reports that authorization is
  required; granting it means changing the policy, and the decision is recorded either way.

## Changing the policy

1. Decide the level. Operations are keyed by risk class (`R0`–`R4`), which maps to a level.
2. Edit `permission-policy.json`, or write a separate policy file and pass
   `--policy <path>`.
3. Change `grants` to move a whole level between allow, needs-auth and denial; change
   `risk_to_level` to reclassify a risk class; add entries to `approved_workspaces`,
   `personal_data_roots`, `system_read_only_roots` or `denied_roots` to move a path between
   classes.
4. Test one decision without executing it:

```
node tools/runtime-engine.mjs evaluate --risk R2 --target README.md --json
```

5. Confirm what the runtime actually loaded:

```
node tools/runtime-engine.mjs policy --json
```

A `denied_roots` entry outranks an approved workspace, so it is the switch to use when a
path must be off limits regardless of any other rule.

See [INTEGRATION.md](INTEGRATION.md) for wiring these commands into another system, and
[LEVEL4.md](LEVEL4.md) for the runtime verbs as a whole.
