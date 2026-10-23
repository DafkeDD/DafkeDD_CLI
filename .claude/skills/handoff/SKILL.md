---
name: handoff
description: Write down where the work on DafkeDD_CLI stands so a new session can continue without this conversation - what is done, what is open, decisions, commands. Use when a session gets long, before stopping halfway, or when Davey asks for a handoff.
---

# Handoff: let the next session continue

Write `.claude/handoff.md` (it is not committed) and show Davey its text. A new session reads it first, together with
`CLAUDE.md`.

## What goes in

- **Goal**: what Davey asked, in his words, and the GitHub issues involved (`#n`, with their state).
- **Done**: the versions and commits (`git log --oneline -10`), what each one changed, and how it was checked.
- **In progress**: what is changed but not committed (`git status`), what is still failing and why.
- **Decisions**: every choice Davey made and every assumption you made, so nobody asks again or decides otherwise.
- **Open questions**: what still needs Davey.
- **Next steps**: concrete and in order, with the commands (tests, `npm run verify`, the push).
- **Where things are**: the repositories and folders involved (`D:\test`, `C:\Users\Davey\Documents\Claude\Projects\…`),
  test environments, ports, users (never passwords or secrets).

Short and factual: no summary of the conversation, only what the next session needs to act.
