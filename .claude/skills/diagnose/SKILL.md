---
name: diagnose
description: Find and fix a bug of DafkeDD_CLI or of a project it generated - reproduce it, write the failing test, find the cause, fix it, check nothing else broke. Use for an error message, a failing build or test, or behaviour that is wrong.
---

# Diagnose: from a symptom to a tested fix

Read `CLAUDE.md` first. Never guess a fix before the cause is shown.

1. **Collect the facts.** The exact error, the command, the CLI version (`package.json`), the answers given to the
   CLI, the platform (Windows, npm version). Ask Davey for what is missing; a screenshot or the output of the failing
   command is enough.
2. **Reproduce it.** Generate the same project (`npm run verify -- --only <variant> --keep`, or the steps of the CLI
   with the same answers) or run the failing test. A bug that cannot be reproduced is not fixed: say what you tried.
3. **Write the failing test** in `test/*.test.js` (or in the template's own specs): it fails for the reason of the
   bug, not for something else.
4. **Find the cause.** Narrow it down: the generated file that is wrong, then the code in `src/` or `templates/` that
   writes it. Check whether the same mistake exists elsewhere (another variant, another language, the other frontend).
5. **Fix it**, the smallest change that removes the cause. The new test passes, `npm test` is green, and for generated
   code `npm run verify` too.
6. **Record it.** A GitHub issue with `type:bug` (when there is none yet: what happened, the cause, the fix), a
   changelog line "Fix: …", then commit and push as in `implement` (all checking agents).
7. **Check where else it lives.** Projects already generated (such as `D:\test` or `D:\KidieFile`) keep the bug: tell
   Davey which file to change there, or offer to do it.
