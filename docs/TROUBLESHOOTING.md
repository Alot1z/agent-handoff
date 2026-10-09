---
title: Troubleshooting
---

# Troubleshooting

Each entry names the symptom, the cause, and the fix. Exit codes are the ones documented in
[CLI.md](CLI.md).

## Nothing is listed

**Symptom:** `handoff: no handoffs yet`.

**Cause:** no build has run against the store being read, or the build wrote to a different
store.

**Fix:** check which store the engine resolved, and which rule chose it:

```bash
node tools/handoff.mjs config
```

The rule is one of `env`, `config`, `discover`, `default`. If it is not the store you
expected, set `HANDOFFS_ROOT` for the run, or add a `handoff.config.json` at the project
root. Resolution order is in [FORMAT.md](FORMAT.md#where-handoffs-live).

## `build` exits 2

**Cause:** `--source` was not given, or the value was consumed as another flag.

**Fix:** `build` requires it:

```bash
node tools/handoff.mjs build --source transcript.jsonl --project my-project
```

## `build` exits 4 after reading the file

**Cause:** no turn parsed. A `.jsonl` source is parsed one line at a time and a line that
does not parse is skipped; a text source needs a line starting with `user:`, `human:`,
`assistant:`, `ai:`, `system:` or `tool:`.

**Fix:** inspect the first few lines of the source. If the transcript is JSONL but the fields
are named differently, an adapter is what you want — see [ADAPTERS.md](https://github.com/Alot1z/agent-handoff/blob/main/refs/ADAPTERS.md)
for the canonical shape, and [INTEGRATION.md](INTEGRATION.md) for mapping a new source onto
it.

## `verify` prints FAIL

**Cause:** one of three things — the manifest was edited by hand after the build, the
timeline line count no longer matches `turn_count`, or `HANDOFF.llm.json` does not parse.

**Fix:** do not edit a handoff by hand. Rebuild from the same source:

```bash
node tools/handoff.mjs build --source <original source> --session <id>
```

A rebuild re-seals the manifest and rewrites the renders. If the original source is gone,
the handoff cannot be re-verified, and the honest answer is to say so rather than patch the
hash.

## `show`, `verify`, `rename` or `retitle` exits 3 or 4

**Cause:** 3 means the prefix matched more than one session; 4 means it matched none.

**Fix:** run `handoff.mjs list`, then use a longer prefix.

## `config` exits 2 and names a config file

**Cause:** a `handoff.config.json` was found but is not valid against
`handoff.config.schema.json`. The engine refuses to fall back to another store, because
falling back would write somewhere other than the configured location.

**Fix:** correct the file against the schema, or delete it to fall through to the
`handoffs/` convention.

## A runtime command exits 3 with "capture already in flight"

**Cause:** another run holds the lock for that project and session. Locks are files in
`<root>/.locks/`, named after a hash of the operation target.

**Fix:** wait for the other run. If a previous process was killed abruptly, it can leave a
lock file behind; the file is normally removed when the run finishes, so a lock that is
still present after every process has stopped can be deleted by hand.

## `dispatch` or `merge` produced something that fails the gate

**Cause:** by design. A `merge` writes a timeline with no brief, no payload and no
`TOOLS.md`, so `verify-gate` fails it on `payload` and `contract` until a brief is written
for the merged session. `index` reports the same sessions as stale.

**Fix:** write the brief for the merged session, then re-run `verify-gate`. A brief needs the
seven contract fields — `RESULT`, `WHAT_CHANGED`, `VALIDATION`, `EVIDENCE`, `BLOCKERS`,
`RISKS`, `FOLLOW_UP` — each starting a line.

## `verify-gate` exits 6 and the verdict says REJECTED

**Cause:** at least one of the five checks (`sha`, `counts`, `payload`, `contract`, `evidence`)
failed. The JSON names which, and the message on stderr names them too.

**Fix:** fix the named check. The usual one is `contract`, which requires `RESULT`,
`WHAT_CHANGED`, `VALIDATION`, `EVIDENCE`, `BLOCKERS`, `RISKS` and `FOLLOW_UP` — each starting a
line — in `HANDOFF.md`. That block is hand-authored; a rebuild preserves it and records its
sha256 as `evidence_contract_sha256` on the manifest.

## `promote` refused: evidence gate REJECTED

**Cause:** the gate failed and promotion is gated on it, so the manifest was left unstamped.

**Fix:** add the evidence contract to `HANDOFF.md` (see above) and re-run. If the gate genuinely
cannot apply — an imported session with no hand-authored contract, say — `--force` is the
recorded override: the manifest then carries `promoted_gate: "FORCED"` instead of `"VERIFIED"`.

## `build` failed with `unparseable JSONL line(s)` (exit 5)

**Cause:** a line in the source is not valid JSON. It used to be dropped in silence, which
produced a handoff that looked complete and was not.

**Fix:** repair the export, or pass `--allow-bad-lines` to skip those lines on purpose. The
warning names how many lines were skipped, so the omission is visible in the build output rather
than buried in the result.

## `capability-registry check` fails with `unknown`

**Cause:** a capability declares a probe kind with no implementation, or declares no target
or command for its kind. The registry reports `unknown` with the reason instead of guessing.

**Fix:** read the evidence line for the capability. `unknown` for a required capability is
treated as a failure on purpose: an unanswered question is not a pass.

## `runtime-engine run` exits 3

**Cause:** `DENIED`. An explicit denial, a personal-data path, an unknown risk class or an
unknown grant all land here. A personal-data or denied target is refused at any risk class.

**Fix:** inspect the decision before changing anything:

```bash
node tools/runtime-engine.mjs evaluate --risk R1 --target <path> --json
```

The policy itself is [permission-policy.json](https://github.com/Alot1z/agent-handoff/blob/main/permission-policy.json); read
[PERMISSIONS.md](PERMISSIONS.md) for the levels.

## `runtime-engine resume` exits 4

**Cause:** there is no checkpoint to resume from, either because no job ran for that session
or because the session name does not match. Exit 5 means a checkpoint exists but is corrupt
or its integrity seal does not match.

**Fix:** run `status` for the session to see the durable state, then start a new job.

## The documentation site is missing a page, or a link 404s

**Cause:** the site is built from `docs/`. A page not listed in `docs/_data/nav.yml` does not
appear in the navigation, and a relative link that points at a file outside `docs/` does not
resolve in the built site.

**Fix:** add the page under `docs/`, add it to `nav.yml`, and run the check CI runs:

```bash
node .github/scripts/check-docs.mjs
```

## Node version

The tools require Node.js 18 or newer and use only built-in modules. `node --version` below
18 is the only unsupported configuration; there is no build step and no dependencies to
reinstall. Platform notes are in [COMPATIBILITY.md](COMPATIBILITY.md).
