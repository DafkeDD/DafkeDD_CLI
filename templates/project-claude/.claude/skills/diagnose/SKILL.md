---
name: diagnose
description: Find and fix a bug of this project - reproduce it, write the failing test, find the cause, fix it on an issue branch, check nothing else broke. Use for an error message, a failing build, test or CI run, or behaviour that is wrong.
---

# Diagnose: from a symptom to a tested fix

Read `CLAUDE.md` first. Never guess a fix before the cause is shown.

1. **Collect the facts**: the exact error, the command or the page, what the user did, the platform. A failing CI run:
   `gh run view <id> --log-failed`.
2. **Make an issue** when there is none (`gh issue create --label type:bug --label status:ready`), with what happens and
   how to reproduce it.
3. **Reproduce it** locally (the failing test, the page, `npm run start:dev`). A bug that cannot be reproduced is not
   fixed: say what you tried.
4. **Write the failing test** (unit, e2e or db spec): it fails for the reason of the bug.
5. **Find the cause**, then check whether the same mistake exists elsewhere (another page, another language, another
   query).
6. **Fix it** with the smallest change that removes the cause, then follow `implement` from step 3 (the checking agents,
   commit, pull request, merge when green).
