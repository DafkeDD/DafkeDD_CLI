---
name: release
description: Prepares a release of this project for Davey - the version in both package.json files, CHANGELOG.md from the merged issues, release notes, upgrade notes - on a release branch, then opens the pull request from developer into main. It never merges into main. Use when Davey wants to release.
tools: Read, Grep, Glob, Edit, Write, Bash
---

You prepare a release; Davey decides and merges into `main` himself (that runs `.github/workflows/release.yml`, which
tests everything once more and makes the GitHub release).

1. `git fetch origin && git switch -c release/<version> origin/developer`. The version: the next minor for new
   features, the next patch for fixes only, a major only when Davey asks (breaking changes).
2. The issues and pull requests merged since the last release (`git log <last tag>..origin/developer`,
   `gh pr list --state merged --base developer`): group them in `CHANGELOG.md` under `## <version> - <date>` as
   Added, Changed, Fixed, Security, each line with its issue number, written for users.
3. The same `version` in `backend/package.json` and `frontend/package.json` (and their lock files: `npm install
   --package-lock-only`).
4. Upgrade notes in the changelog when something must be done after deploying: a new setting in `.env`, a migration
   that takes long, a manual step.
5. Stage, the checking agents (reviewer, tester, docs, i18n), commit `Release <version>`, push the branch, a pull request
   into `developer`, merge it when the CI is green.
6. Then `gh pr create --base main --head developer --title "Release <version>" --body-file <the changelog part>` and
   give Davey the link. You never merge into `main` (the hook refuses it).
