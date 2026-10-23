---
name: plan
description: Turn a wish for this project into a GitHub spec issue and ticket issues (areas, acceptance criteria, blocking order), after asking every open question first. Use for any feature or change bigger than a few lines, before building.
---

# Plan: from a wish to GitHub issues

Issues are made with the GitHub CLI (`gh`) in the repository of this project. Read `CLAUDE.md` first; the labels are
made once with `node .claude/scripts/setup-labels.mjs`.

1. **Understand it, ask first.** Read the code the wish touches (and `.claude/design/pasport.md` for screens). Ask every
   open question in one round with AskUserQuestion (a recommended option first): what the user sees, which parts
   (frontend, backend, database), which texts (four languages), what happens with existing data. Decisions about design,
   names on screen and what is paid are asked, never assumed.
   A decision that is hard to undo (a data model, an external service, tenancy, hosting) goes to the **architect**
   agent first: it compares the options and writes the ADR in `docs/adr`.
2. **The spec issue**: `gh issue create --label spec --label type:feature --title "<what>" --body-file <file>` with Why,
   What (per part, with the decisions), Out of scope, Acceptance (checkable) and a task list for the tickets.
3. **The tickets**: one issue per piece that can be built, tested and merged on its own, in an order in which every
   ticket leaves the project working. Labels `type:*`, `area:frontend|backend|database|docs`, `status:ready` or
   `status:blocked`; body: `Part of #<spec>`, `Blocked by #<n>`, what to build, which agent builds it (frontend, nestjs,
   postgresql), the tests, the docs, acceptance criteria.
4. Link every ticket in the task list of the spec, and give their numbers. Nothing is built here: that is `implement`.
