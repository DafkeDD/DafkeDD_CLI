# DafkeDD_CLI

An interactive CLI that installs a frontend **per project**, into `./frontend`. Everything is installed **locally in the
project**, never globally.

## What does it install?

| Frontend | Contents                                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js  | Next.js (latest) + Tailwind CSS (latest) + next-intl (latest) + react-icons + Prettier, in `./frontend`. Optionally with [DafkeDD UI](https://github.com/DafkeDD/DafkeDD_UI) |

The CLI asks its questions first, then shows **one progress bar** for all steps: create the app, install dependencies,
install next-intl, react-icons and Prettier, fetch and install DafkeDD UI, configure Prettier and run a build check.
Optionally the project is pushed to GitHub as the very last step.

Order of the questions:

1. Which frontend?
2. The frontend options (for Next.js: install DafkeDD UI?).
3. Push to a repo right away? If yes: platform (GitHub only for now), repository name (the CLI checks that the name is
   still free) and private/public.

### DafkeDD UI

The CLI asks whether to install [DafkeDD UI](https://github.com/DafkeDD/DafkeDD_UI):

- **All components**: runs `dafke-ui init` and `dafke-ui add --all` in `./frontend`. The example page then uses the
  theme and components of DafkeDD UI (`ThemeProvider`, `Badge`, `Button` and `Select`).
- **Base only (init)**: only config, tokens and helpers. You add components yourself afterwards. The example page is a
  simple Tailwind version.
- **No**: nothing.

The components end up in `frontend/src/components/ui` (`dafke-ui.json` and `dafke-ui.lock.json` live in `frontend`) and
`ui.css` is loaded from `src/app/globals.css`. The UI repository (branch `developer`) is cloned temporarily with
`git clone` and removed again; nothing is installed globally (no `npm link`). Git is therefore required.

### react-icons

[react-icons](https://react-icons.github.io/react-icons/) is a dependency of `frontend`. Usage:
`import { FaReact } from 'react-icons/fa'` and then `<FaReact />`. Always import from the sub-folder of the icon set
(`react-icons/fa`, `react-icons/lu`, ...) so Next only bundles the icons you use.

### Language and theme

The example has a language dropdown and a theme dropdown (components in `src/components`). With DafkeDD UI they sit in
one floating pill at the bottom of the page, in the plain variant they are simple native selects.

- **Language** (`locale-switcher.tsx`): switches between English, Nederlands, Français and Deutsch without changing the
  URL. The choice is remembered.
- **Theme** (`theme-switcher.tsx`): **Light**, **Dark** or **System** (follows the operating system). The choice is
  stored in `localStorage` and applied before the first paint, so there is no flash.

Four languages are configured: **English (`en`, the default)**, Dutch (`nl`), French (`fr`) and German (`de`). Every
text exists in all four languages (`messages/en.json`, `nl.json`, `fr.json`, `de.json`). The language is not part of the
URL: you browse to `http://localhost:3000/`; the language comes from the user's choice (cookie), otherwise from the
browser language, otherwise it is English. To add a language, extend `src/i18n/routing.ts` and add a matching
`messages/<language>.json` (always translate every text).

The theme is set as `data-theme="light|dark"` on `<html>`. This is the same switch DafkeDD UI uses, and Tailwind's
`dark:` classes follow it too. When the language changes, Next resets the attributes of `<html>`; `theme-script.tsx`
re-applies the stored theme immediately so the theme never jumps back. With DafkeDD UI the dropdowns are the library's
`Select` and the theme uses its `ThemeProvider` (storage key `lui-theme`).

### Prettier

Prettier and `prettier-plugin-tailwindcss` are installed as devDependencies, together with `.prettierrc` (4 spaces, no
semicolons, single quotes, `printWidth` 120, `proseWrap: always`) and `.prettierignore`. The scripts `npm run format`
and `npm run format:check` are added and the project is formatted straight away. The folder `src/components/ui` is
deliberately not formatted, so `dafke-ui update` does not see your files as "modified". `AGENTS.md` and `next-env.d.ts`
are ignored as well, because Next.js rewrites them itself.

## Installation

Requirements: [Node.js](https://nodejs.org) 20 or newer and Git.

### Without installing (recommended)

Go to your project folder and run (this fetches the `developer` branch, the default branch):

```
npx --allow-git=all github:DafkeDD/DafkeDD_CLI
```

> **npm 12 or newer:** npm blocks fetching packages through git by default (`allow-git=none`), which results in the
> error `EALLOWGIT`. That is why `--allow-git=all` is part of the commands below. On npm 11 or older you can leave the
> flag out. To enable it permanently use `npm config set allow-git all`.

### Install once (command `DafkeDD_CLI`)

```
npm install -g --allow-git=all github:DafkeDD/DafkeDD_CLI
```

Afterwards, in any project folder:

```
DafkeDD_CLI
```

Update by running the same install command again.

> This only installs the CLI itself globally. The frontend always goes into `./frontend` of the project.

### Versions

| Goal                                       | Command                                                 |
| ------------------------------------------ | ------------------------------------------------------- |
| Development version (`developer`, default) | `npx --allow-git=all github:DafkeDD/DafkeDD_CLI`        |
| Latest release (`main`)                    | `npx --allow-git=all github:DafkeDD/DafkeDD_CLI#main`   |
| Fixed version                              | `npx --allow-git=all github:DafkeDD/DafkeDD_CLI#v0.2.0` |

If the repository is private you must be logged in to GitHub on that machine (`gh auth login` or an SSH key). You can
also use `git+ssh://git@github.com/DafkeDD/DafkeDD_CLI.git`.

## Usage

1. Go to the folder of your project.
2. Start the CLI (see above).
3. Choose the frontend (only Next.js for now) and answer its questions (such as DafkeDD UI).
4. Last: choose whether to push to a repository right away (platform, name, private/public).
5. Wait until the progress bar is done. If you chose to push, your project (including `./frontend`) is now the first
   commit on GitHub.
6. Start the frontend:

```
cd frontend
npm run dev
```

If `./frontend` already exists, the CLI stops without deleting anything.

### Pushing to GitHub

The CLI runs `git init` in the project folder, makes a first commit, and uses the [GitHub CLI](https://cli.github.com)
(`gh`) to create the repository and push. `gh` must be installed and you must be logged in (`gh auth login`).

## Development

```
git clone https://github.com/DafkeDD/DafkeDD_CLI.git
cd DafkeDD_CLI
npm install
node bin/cli.js
```

`npm install` also activates the git hooks (see below). Optionally use `npm link` to run the `DafkeDD_CLI` command from
your checkout.

| Command                | What it does                                 |
| ---------------------- | -------------------------------------------- |
| `npm test`             | Runs the whole test suite                    |
| `npm run format`       | Formats the repository with Prettier         |
| `npm run format:check` | Checks the formatting without changing files |

### Tests are mandatory

Every piece of code must have tests, and **code cannot be pushed while the tests are not green**:

- A **pre-push git hook** (`.githooks/pre-push`, activated by `npm install`) runs `npm run format:check` and `npm test`
  and blocks the push when something fails.
- **GitHub Actions** (`.github/workflows/ci.yml`) runs the same checks on every push and pull request to `developer` and
  `main`, on Linux and Windows with Node 20 and 22. The release workflow only runs after the tests passed.
- Hooks can be skipped locally (`--no-verify`), so also enable **branch protection** on `developer` and `main` in the
  GitHub settings with the CI checks as _required status checks_.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how the tests are written.

### Structure

```
bin/cli.js               # entry point
src/index.js             # questions and flow
src/progress.js          # one progress bar for all steps
src/runner.js            # runs commands quietly
src/repo.js              # push questions + git / GitHub steps
src/frontends/index.js   # list of available frontends
src/frontends/nextjs.js  # Next.js + Tailwind + next-intl + react-icons + Prettier + DafkeDD UI
test/                    # test suite (node:test)
scripts/                 # test runner and git hook setup
.githooks/               # pre-push hook
```

To add a new frontend: create a file in `src/frontends/` (follow `nextjs.js`), register it in `src/frontends/index.js`
and add tests for it in `test/`.

## Branches and releases

- `developer` is the default branch; this is where you work. Everything goes to `developer` first.
- Merging into `main` is only done on request. A push to `main` automatically creates a new GitHub release
  (`.github/workflows/release.yml`), after the tests passed.
- The version number automatically bumps the patch number. If you want a higher version (for example `0.2.0`), raise
  `version` in `package.json` before pushing to `main`.

Creating a release:

```
git switch main
git merge developer
git push
git switch developer
```

## Changelog

- **0.11.0**: test suite for all code (`npm test`), pre-push hook and CI that block pushes with failing tests, release
  only after green tests; README and documentation in English; fixed a duplicate `ui.css` import in `globals.css` that
  the new tests found.
- **0.10.0**: the CLI asks whether to push right away (only then platform, name and visibility follow) and checks
  whether the repository name already exists; DafkeDD UI comes from the `developer` branch; Prettier (with
  `.prettierrc`) is now also used in this CLI repository.
- **0.9.0**: language and theme selection now sit together in one floating pill at the bottom (opens upwards, also on
  mobile); the header only shows the logo.
- **0.8.1**: order of the questions: frontend (and DafkeDD UI) first, the GitHub questions last.
- **0.8.0**: more modern and cleaner example page with DafkeDD UI (hero, logo, language/theme pills, cards with the
  stack and react-icons); works in light and dark and on mobile.
- **0.7.0**: ask for a repository name, platform (GitHub only) and private/public; the project is pushed to GitHub after
  the installation.
- **0.6.0**: react-icons is installed in the frontend.
- **0.5.0**: four languages (English default, Dutch, French, German), the theme no longer jumps back on a language
  change, and the example uses the theme and components of DafkeDD UI (with "all components"). `AGENTS.md` and
  `next-env.d.ts` are no longer checked by Prettier.
- **0.4.0**: no more locale prefix in the URL (no `/nl`), dropdowns for language and theme (light, dark, system), and
  the Tailwind integration of Next.js is preserved (the `@theme` error in `globals.css` is fixed: `next.config.ts` is
  patched instead of overwritten).
- **0.3.0**: optional installation of DafkeDD UI (question in the CLI), Prettier with its own `.prettierrc` and the
  scripts `format` / `format:check`.
- **0.2.0**: version number at start-up, one progress bar that keeps moving across all steps, no more Node warnings
  (DEP0190) on Windows, `.npmignore` added (no more `gitignore-fallback` warning).
- **0.1.0**: first version, Next.js + Tailwind CSS + next-intl in `./frontend`.
