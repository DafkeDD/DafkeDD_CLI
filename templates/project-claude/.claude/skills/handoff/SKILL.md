---
name: handoff
description: Write down where the work on this project stands so a new session can continue without this conversation - what is done, what is open, decisions, commands. Use when a session gets long, before stopping halfway, or when asked for a handoff.
---

# Handoff: let the next session continue

Write `.claude/handoff.md` (not committed) and show its text. A new session reads it first, with `CLAUDE.md`.

- **Goal**: what was asked, in the words of the person, and the issues involved (`#n`, state, branch, pull request).
- **Done**: the merged pull requests and the commits on the current branch (`git log --oneline -10`), how they were
  checked.
- **In progress**: what is changed but not committed (`git status`), what fails and why.
- **Decisions**: every choice that was made, and every assumption.
- **Open questions** for the person.
- **Next steps**, in order, with the commands.

Never passwords, tokens or secrets. Short and factual: only what the next session needs to act.
