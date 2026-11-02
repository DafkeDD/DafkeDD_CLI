---
name: e2e
description: How to write the automatic browser tests of this project (Playwright test files in frontend/e2e) that run in the CI on every pull request - every page, button, form and table of a change, both themes and the four languages, with accessibility checks and the visual tests of the knowledge base. Load it for every change to a screen, next to the pasport-design skill.
---

The tests that turn what the qa agent checks by hand into tests that run on every pull request.

A linked app has the suite from the start (`frontend/e2e/`: `session.ts`, `tour.spec.ts`, `pages.spec.ts`; every page of
`APP_NAV` in four languages, both themes, 390px and axe): add the specs of a change next to them and use
`e2e/session.ts` to log in. The login server has its own suite too (`session.ts` with an admin, a member and a
superadmin, `tour.spec.ts` with the steps of `src/components/pasport/tour-steps.ts`, `pages.spec.ts` with every page of
the portal and the superadmin panel, and `login.spec.ts`: the login screen, with the answers of the API given by the
test). A site and an API frontend have `pages.spec.ts` (every page of `APP_NAV`, open without a login). The simple
login has one too (`e2e/account.ts`, `login.spec.ts`, `pages.spec.ts`): it starts the built API with its database and
logs in for real with `logIn()` of `e2e/account.ts`, a test account that `e2e/global-teardown.ts` removes after the
run.

## Setup (once, when `frontend/e2e/` does not exist yet)

- In `./frontend`: `npm install --save-dev @playwright/test @axe-core/playwright`, then
  `npx playwright install chromium`.
- `frontend/playwright.config.ts`: tests in `e2e/`, the base URL of the frontend, `webServer` that starts the frontend
  (`npm run build && npm run start`) and the backend when the tests need it; screenshots and traces on failure.
- `"test:e2e": "playwright test"` in `frontend/package.json`. The CI (`.github/workflows/ci.yml`) runs it when
  `@playwright/test` is installed.
- Login: tests that need a session get it from a test helper that mocks the login server's answers or uses a stored
  session (`storageState`); never a real account or a secret in the code (GitHub secrets for anything real).

## The tests

- One spec per page (`e2e/<page>.spec.ts`): it opens the page and uses **every** control the change touches, also with
  wrong input, and checks what the user sees (texts through the translations, not hardcoded English), the request that
  was sent and the answer shown.
- Each page in the four languages and both themes (a loop over the cookies of next-intl and the theme), and at phone
  width.
- `@axe-core/playwright` on every page: no WCAG 2.2 AA violation.
- Stable selectors: roles and labels (`getByRole`, `getByLabel`), never CSS classes: classes change with the design,
  roles and labels are what the user and a screen reader see.
- They must pass locally (`npm run test:e2e`) and be fast: no fixed waits (`waitForTimeout`), only waiting for what the
  user sees.

## Visual tests = the screenshots of the knowledge base

`e2e/screens.spec.ts` makes every screenshot of `docs/kb` and compares them on every pull request, so a change to a
screen that nobody meant fails the CI:

- `playwright.config.ts`: `snapshotPathTemplate: '../docs/kb/screenshots/{arg}{ext}'`, `expect.toHaveScreenshot` with
  `maxDiffPixelRatio: 0.01` and `animations: 'disabled'`, viewport 1280×800.
- For every entry of `docs/kb/pages.json`, every language and both themes:
  `await expect(page).toHaveScreenshot(\`${lang}/${id}-${theme}.png\`)`; and every state the kb agent documents
  (`<id>-<state>-<theme>.png`): open the dialog, submit the form empty, ... in the test, then the screenshot.
- Fixed test data (the `seed` skill) and a fixed clock (`page.clock`), so a screenshot only changes when the screen
  does.
- The screenshots are made on Linux, as in the CI (fonts differ per system): **Actions → Screenshots → Run workflow**
  on the issue branch (`.github/workflows/screenshots.yml`) makes them again and commits them to that branch. Never
  commit screenshots made on Windows or macOS.

When they are written: stage them with the change and start the checking agents (the `implement` skill); tell the
tester which specs you added and how many tests they run.
