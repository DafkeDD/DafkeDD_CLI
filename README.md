# DafkeDD_CLI

An interactive CLI that installs a frontend into `./frontend` and a backend into `./backend`, **per project**.
Everything is installed **locally in the project**, never globally.

## What does it install?

| Frontend | Contents                                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js  | Next.js (latest) + Tailwind CSS (latest) + next-intl (latest) + react-icons + Prettier, in `./frontend`. Optionally with [DafkeDD UI](https://github.com/DafkeDD/DafkeDD_UI) |

| Backend | Contents                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NestJS  | NestJS (latest) + nestjs-i18n + validation + Swagger + `.env` config + Prettier, in `./backend`. Translated server errors, health endpoint, CORS and tests |

The CLI asks its questions first, then shows **one progress bar** for all steps: create the app, install dependencies,
install next-intl, react-icons and Prettier, fetch and install DafkeDD UI, configure Prettier and run a build check.
Optionally the project is pushed to GitHub as the very last step.

Order of the questions:

1. Which frontend (or none)? Then the frontend options (for Next.js: install DafkeDD UI?).
2. Which backend (or none)? Currently only NestJS. Then the backend options: which database (PostgreSQL or none), Docker
   or local, and the connection details (see [Database](#database-postgresql)).
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
3. Choose the frontend (only Next.js for now, or none) and answer its questions (such as DafkeDD UI).
4. Choose the backend (only NestJS for now, or none) and answer its questions (database, port, user, password, ...).
5. Last: choose whether to push to a repository right away (platform, name, private/public).
6. Wait until the progress bar is done. If you chose to push, your project (including `./frontend` and `./backend`) is
   now the first commit on GitHub.
7. Start the database (Docker only), the backend and the frontend:

```
cd backend
npm run db:up        # only when you chose PostgreSQL in Docker
npm run start:dev

cd frontend          # in a second terminal
npm run dev
```

If `./frontend` or `./backend` already exists, the CLI stops without deleting anything.

## Backend (NestJS)

Installed in `./backend` (port **4000**). No ORM: if you choose a database you write your own queries with the plain
driver.

- **i18n for server errors** ([nestjs-i18n](https://nestjs-i18n.com)): English (default), Dutch, French and German in
  `src/i18n/<lang>/{common,errors,validation}.json`. The language is detected in this order: `?lang=` query, `x-lang`
  header, `Accept-Language` header, then English. Regional variants such as `nl-BE` fall back to `nl`.
- **Translated errors**: throw `new AppException('errors.NOT_FOUND', 404)` and the response is
  `{ statusCode, error, message, path, timestamp }` with `message` in the user's language. Unknown exceptions and
  validation errors (class-validator) use the same shape and are translated too.
- **Swagger / OpenAPI** at `http://localhost:4000/docs`.
- **Health endpoint** at `/health`.
- **CORS** for the frontend, configured through `.env` (`PORT=4000`, `CORS_ORIGIN=http://localhost:3000`; see
  `.env.example`).
- **Prettier** with the same `.prettierrc` (`npm run format`, `npm run format:check`).
- **Tests** (unit and e2e, 17+ e2e tests) and a verification run (build, lint, tests) at the end of the install.

When a frontend is installed too, the frontend is connected to the backend (see
[Connection with the backend](#connection-with-the-backend)).

### Database (PostgreSQL)

The CLI asks which database you want (PostgreSQL for now, or none). No ORM: the backend uses the plain
[`pg`](https://node-postgres.com) driver and you write your own queries. For PostgreSQL the CLI asks:

1. **Docker or local?**
2. **Host** (local only; with Docker it is always `localhost`).
3. **Port** (default `5432`; with Docker this is the port on your machine, so you can pick another one if 5432 is
   taken).
4. **User** (default `postgres`), **password** (hidden while typing, required) and **database name** (default: the name
   of your project folder).

What you get in `./backend`:

- `.env` with `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD` and `DATABASE_NAME`. `.env` is in
  `.gitignore`; `.env.example` is committed and holds `change-me` instead of your password.
- `src/database/`: a global `DatabaseModule` and `DatabaseService` (connection pool; `query()` and `ping()`), plus a
  unit test. Inject `DatabaseService` anywhere and call `this.database.query('SELECT ...', [params])`.
- `GET /health` returns `{ "status": "ok", "database": "up" }`, or a **translated 503** (`errors.DATABASE_UNAVAILABLE`)
  when the database does not answer.
- `npm run db:check` tests the connection with the settings from `.env` and **creates the database if it does not exist
  yet** (the user needs the `CREATEDB` right; the default `postgres` user has it). With Docker the database is created
  by the container.
- **Docker only:** a `docker-compose.yml` (PostgreSQL 17, data in a named volume, health check) that reads everything
  from `.env`, and the scripts `npm run db:up` (start and wait until healthy), `npm run db:down` and `npm run db:logs`.
  Docker has to be installed and running; the CLI does not start it for you.
- **Local only:** as the last step the CLI runs `db:check`, which also creates your database. If PostgreSQL is not
  reachable (yet) the install still finishes and the CLI tells you at the end; fix `./backend/.env` or start the
  database and run `npm run db:check`.

The generated tests never need a database: the e2e tests replace `DatabaseService` by a fake.

### Connection with the backend

When you install a frontend **and** a backend, the frontend is connected to the API:

- `src/lib/api.ts` (`apiFetch`, `ApiError`) and `src/lib/use-api.ts` (`useApi()` for client components) call the API on
  `http://localhost:4000` (override with `NEXT_PUBLIC_API_URL`) and send the selected language as `Accept-Language`, so
  server errors come back in the language the user picked in the frontend.
- The example page shows a **backend status card** (`src/components/api-status.tsx`, translated in four languages): is
  the API reachable, the message the API answered with and the language it answered in (change the language in the pill
  and the answer changes too), and, with a database, whether the database is connected. When the database is down the
  card shows the translated error message of the server.
- CORS is already configured in the backend for `http://localhost:3000`.

Start both: `cd backend && npm run start:dev` and, in another terminal, `cd frontend && npm run dev`.

Note: opening `http://localhost:4000` directly in a browser uses the language of your _browser_ (`Accept-Language`). Add
`?lang=en` to the URL to choose a language yourself.

The generated NestJS 12 starter needs **npm 11 or newer** (npm 10 fails to install it).

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

- **0.13.4**: the spacing in the backend status card now works with DafkeDD UI (flex gap instead of margins, because the
  UI stylesheet resets heading margins).
- **0.13.3**: more spacing in the backend status card (below its title and between the rows).
- **0.13.2**: `.gitattributes` forces LF line endings, which fixes the failing format check of the CI on Windows.
- **0.13.1**: for a local PostgreSQL the CLI now creates the database when it does not exist yet.
- **0.13.0**: new database question (PostgreSQL, in Docker or local) with port, user, password and database name;
  `docker-compose.yml`, `.env`, `pg` driver (no ORM), database health check with translated errors and a connection test
  for local databases; the frontend is connected to the backend with an API status card on the example page that shows
  the language the API answered in and the database state.
- **0.12.0**: new backend question: NestJS in `./backend` with nestjs-i18n (translated server errors in nl, fr, en, de),
  validation, Swagger, health endpoint, CORS, `.env` config, Prettier and tests; the frontend sends its language to the
  backend; frontend and backend can be skipped.
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
