---
name: plan
description: Turn a wish for DafkeDD_CLI into a GitHub spec issue and ticket issues (with areas, acceptance criteria and blocking order), after asking every open question first. Use for any feature or change bigger than a few lines, before building.
---

# Plan: from a wish to GitHub issues

The repository is `DafkeDD/DafkeDD_CLI`; issues are made with the GitHub CLI (`gh`). Read `CLAUDE.md` first.

## 1. Understand it (ask first)

- Read the code the wish touches (and `D:\test` or the Pasport design in `templates/project-claude/.claude/design/` when it is about UI) so the
  questions are concrete.
- Ask every open question before writing anything: what the user of the generated project sees, which CLI questions
  change, which variants (login server, linked app, modules, `TENANT_ISOLATION`) it touches, what happens with projects
  made by earlier versions, which texts are needed (four languages). Group them in one round with AskUserQuestion
  (a recommended option first); ask again only about what the answers left open.
- Decisions that are Davey's (design, names on screen, what is free or paid) are asked, never assumed.

## 2. The spec issue

`gh issue create --repo DafkeDD/DafkeDD_CLI --label spec --label type:feature --title "<what>" --body-file <file>` with:

- **Why**: the problem, in the words of the user.
- **What**: the behaviour, per part (CLI questions, frontend, backend, database, docs), with the decisions taken.
- **Out of scope**: what is explicitly not done.
- **Acceptance**: checkable statements ("`npm run verify` passes for app-full", "every text in en/nl/fr/de").
- **Tickets**: a task list that the next step fills in (`- [ ] #12`).

## 3. The ticket issues

One issue per piece that can be built, tested and committed on its own (one commit, one version line), in an order in
which every ticket leaves the CLI working:

- Title: imperative and specific ("Add the files module to the app backend").
- Labels: `type:feature` / `type:bug` / `type:chore`, one or more `area:frontend`, `area:backend`, `area:database`,
  `area:cli`, `area:docs`, and `status:ready` or `status:blocked`.
- Body: `Part of #<spec>`, `Blocked by #<n>` (when it is), what to build, which skills it needs (pasport-design,
  nestjs, postgresql, or `src/` of the CLI), the tests that prove it, the docs to update, acceptance criteria.

Then edit the spec issue so its task list links every ticket, and tell Davey the spec and tickets with their numbers.
Nothing is built in this skill: building is `implement`.
