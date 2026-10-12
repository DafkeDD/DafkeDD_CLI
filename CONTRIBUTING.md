# Contributing

## Workflow

- Work on the `developer` branch. Merging into `main` (which creates a release) is only done on request.
- Documentation (README, this file, code comments) is written in English.
- Format with Prettier (`npm run format`); the settings live in `.prettierrc` and apply to everything in this
  repository.
- Update the README (usage, install commands) and the changelog with every change, and bump `version` in `package.json`
  and `package-lock.json`.

## Tests

Every piece of code needs tests, written together with the code. A push is blocked until **all tests are green**
(pre-push hook locally, GitHub Actions on the server).

```
npm test                 # whole suite
npm test -- --test-name-pattern="repoSteps"   # only matching tests
```

We use the built-in [Node.js test runner](https://nodejs.org/api/test.html) (`node:test`) and `node:assert/strict`, so
there are no extra test dependencies. Test files live in `test/*.test.js` and are picked up automatically.

### How the code is made testable

Nothing in the tests touches the network, GitHub or the real `npm`:

- **Commands** are run through `exec` (default: `run` from `src/runner.js`). Functions such as `nextjs.steps()` and
  `repoSteps()` accept an `exec` parameter, so tests pass a fake that records the commands and simulates what the real
  tools do on disk (for example creating `next.config.ts` like `create-next-app` does).
- **Prompts** (`@inquirer/prompts`) are injected as `prompts` in `askRepo()` and `nextjs.ask()`, and `main()` takes
  `prompts`, `ask`, `registry`, `execute` and `log`.
- **Files** are written to a temporary folder (`fs.mkdtemp`) that is removed after each test.

### What to test

- New step or option: the step titles/order, the commands that are run and where (`cwd` inside `./frontend`, never
  global), and the files that end up on disk.
- New generated file: that it exists in `files` / `uiFiles` and contains what matters.
- Translations: every language has the same keys (`test/nextjs.test.js` checks this for nl, fr, en and de).
- Bug fix: first add a failing regression test, then fix it.
- Docs/hygiene: `test/project.test.js` checks that versions, the changelog, the hooks and the CI workflow stay in sync.

## Git hooks

`npm install` runs `scripts/setup-hooks.mjs`, which sets `core.hooksPath` to `.githooks`. The `pre-push` hook runs
`npm run format:check` and `npm test`. To fix a blocked push: make the tests and the formatting pass and push again.
Skipping the hook with `--no-verify` is possible but the CI will still reject the change.
