# Brief Discipline — "it's working if" (distilled from aihero.dev/skills-handoff + mattpocock/skills handoff)

mattpocock's `/handoff` buys **portability, not compression**. A handoff is a
transit file for work that must travel — a new harness, a new directory, a
colleague, or a forked side-task. When nothing is travelling, stay in the
session and go lighter. This checklist is the quality bar for any brief this
skill produces.

## When a handoff is warranted (the four triggers)

1. Swapping harness (Claude Code → Codex → DeepSeek Harness …) — the new harness can't see the old context.
2. Moving to a different directory/repo — a prototype is the common case.
3. Sending the work to a colleague — they need something readable cold.
4. **Forking a side-task mid-phase** — you keep working; a second agent takes the fork.

If the same harness and same directory and you're just continuing, a compact is
better than a handoff. Reach for this skill only when the work must travel.

## What travels, what does not

Carry:
- The **live thread**: what's in flight, why, and what's next.
- A **suggested-skills section** naming what the next agent should reach for.
- The **next task's focus** (pass the argument: what the next session is for).

Reference, never copy:
- Specs, plans, ADRs, issues, commits, diffs → by **path or URL**, not pasted text.
  Keeps the file small and the settled detail in ONE place (no drift).

Redact:
- API keys, passwords, PII. Nothing in a handoff is a secret.

## "It's working if" — the acceptance test

The handoff is good when **all** hold:

- [ ] The document is a *small fraction* of the conversation, and specs/issues/diffs
      appear as paths/URLs, not copied text.
- [ ] You can read it **cold**, without the original session open, and know what to do next.
- [ ] A fresh agent **starts working** instead of asking you to re-explain setup.
- [ ] In the fork case, your original session is still sitting there untouched when you return.
- [ ] The suggested-skills section names the skill you'd have reached for yourself.
- [ ] Nothing in it is a key, a token, or a password.

## The false-premise trap (downgrade before handoff)

The next agent treats the document as a **contract** and will not re-check it —
so a belief written as a fact becomes a false premise for everything that follows.
Before you hand it over: **read it and downgrade anything you only assumed.**
Unless a claim is oracle-backed, write it at its true evidence level
(INFERRED/UNKNOWN); this is the same rule as our Doctrine #3 and the KB's
never-silently-upgrade law.

## Handing the file to the next agent

Point at the **path**, never paste the summary into a shell command. A summary
containing backticks or `$(...)` gets mangled by interpolation, and the usual
failure is **silent truncation** — the next agent starts with a quietly
incomplete brief. `Read this file, then continue.`

## Handoff vs. durable docs

Ask: *is this true next month?*
- **CLAUDE.md / durable docs** — standing context loaded into every session. Facts that keep getting re-explained live here.
- **Handoff** — one piece of work in flight, dead once that work lands. A half-finished task is a handoff.

## handoff vs compact vs clear (the phase-boundary map)

| Move | What it preserves | When |
|---|---|---|
| **continue** | the primary source (conversation as it happened) | first thing to rule out; no summary needed |
| **/compact** | compresses context, keeps intent, fresh window | same harness, same dir, staying in the loop |
| **/handoff** | a portable file: the work survives the move | work must travel / fork a side-task |
| **/clear** | nothing — empty window | everything behind you is disposable (one-way) |

All three of compact/handoff/clear turn a primary source into a summary;
continuing is the only one that doesn't. Our engine's fileset gives you both:
the brief is the portable summary; `timeline.jsonl` + `TOOLS.md` keep the
fidelity so nothing is silently lost.