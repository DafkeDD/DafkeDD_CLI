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

## Documentation

Everything the CLI installs is documented, and the documentation is generated together with the code so it always
matches what was installed:

Everything ends up in **one folder, `./docs`**, with an index (`docs/README.md`). As the last step the CLI gathers the
generated READMEs there and leaves a short pointer README in `./backend` and `./frontend`. Open **`./docs/index.html`**
in a browser for the same documentation as a small website (sidebar, table of contents per document, light/dark mode,
copy buttons, a link to Swagger). It is one self-contained file: no server, no build step and no extra packages in your
project. `./docs` is a small project of its own, started like the others: **`cd docs`**, **`npm run dev`**, then open
**http://localhost:5000** (change the port with `DOCS_PORT`). The CLI lists these commands at the end of its run. The
server is `docs/serve.mjs` (a tiny Node server without dependencies); `npm run docs` in `./backend` or `./frontend`
starts the same server.

- **`./docs/api.md`**: how to start, all npm scripts, every `.env` variable, the language detection and the error
  format, the database (and the users table), the login flow and **every API endpoint** with its body fields, a `curl`
  example, the response and all error codes (with the English message). The tests check that every route of the
  generated controllers is described there.
- **`./docs/frontend.md`**: structure, languages, theme, icons, DafkeDD UI, **how to call the API** (`useApi()` in
  client components, `apiFetch()` on the server, `ApiError`), and the login pages when they were installed.
- **Swagger / OpenAPI** at `http://localhost:4000/docs`: every endpoint has a description and its responses, you can try
  calls from the browser and choose the `Accept-Language`.
- **Code comments** on every generated function that is not obvious.

When you add an endpoint to a generated backend: add `@ApiOperation` (and the response decorators) to the route, add it
to the endpoint list in `src/backends/docs.js`, and add a test for it. When you change this CLI, update this README,
`CONTRIBUTING.md` and the changelog (see [CONTRIBUTING](CONTRIBUTING.md)).

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

### Login

With a database the CLI asks _"Add a login?"_:

- **Own OIDC server (multi-tenant, OpenID Connect)**: the backend becomes an OpenID Connect login server (see below).
- **Simple test login** (only with a frontend): a login, register and profile page with a session cookie.
- **No login**.

### OpenID Connect server (multi-tenant)

The backend becomes an **OpenID Connect provider** (phases 1 and 2 of the plan): other applications let their users log
in here and receive signed tokens. Everything is our own TypeScript code on `node:crypto`: no OIDC, OAuth or JWT
library. The CLI only asks the email address of the **superadmin**; it shows a temporary password **once** at the end.
No organisation is created: the superadmin logs in to the platform (`/admin`) and creates organisations there.

- **Endpoints** (`/oidc/...`): discovery, JWKS, authorize (authorization code flow, **PKCE S256 required**, no implicit
  flow), the login page (four languages, CSRF token, strict Content-Security-Policy, no JavaScript), the organisation
  choice, token and userinfo, plus the RFC 8414 metadata. Every endpoint is in Swagger and in `docs/api.md`.
- **Tokens**: ID token (RS256, 5 minutes) and access token (ES256, `at+jwt`, 10 minutes), with a `tenant` claim (id,
  name and the role of the user in that tenant) and `superadmin: true` for superadmins. Codes work once, within 60
  seconds. A browser session (httpOnly cookie) gives single sign-on; `prompt=login` and `max_age` ask the password
  again.
- **Keys**: generated at the first start, stored with the private part encrypted (AES-256-GCM with `OIDC_MASTER_KEY`,
  generated by the CLI into `.env`), replaced after 90 days, old keys stay in the JWKS for 14 days.
- **Multi-tenant**: one account can belong to several tenants (it chooses one at login, or `tenant_hint` decides). Every
  table with tenant data has PostgreSQL **Row-Level Security**: `DatabaseService.withTenant()` runs queries as a
  separate role (`<database>_tenant`) that only sees the rows of that tenant, even without a `WHERE`.
- **Database**: the users table (always `<database>users`), `tenants`, `tenant_members`, `tenant_invitations`,
  `user_identifiers` (linked eIDs) and four `oidc_*` tables (clients, signing keys, sessions, codes), created by
  numbered migrations (checksum, advisory lock) at start. A running login is not a table: it is an encrypted, httpOnly
  cookie per login (10 minutes, no replay).
- **Security**: scrypt passwords, the same error and timing for an unknown email, login rate limit per IP and per email,
  exact redirect URIs (https, http only on localhost), `iss` in every redirect (RFC 9207), client authentication with
  `client_secret_basic`, `client_secret_post` or none (public clients with PKCE), codes and session ids only as hashes.
- **Login in the frontend (port 3000)**: with the Next.js frontend there is no extra page or port. The frontend shows
  the login page of the OIDC server (`/login`, four languages, organisation choice) and logs in through it with PKCE
  (`/api/auth/login`, `/api/auth/callback`): the tokens stay on the server, the session is an encrypted httpOnly cookie
  (`AUTH_SECRET` in `.env.local`). The home page shows "Log in" or who is logged in and in which organisation;
  `/profile` shows the user, the roles and whether the API accepted the access token. A second login needs no password
  (single sign-on). Without a frontend the API shows its own simple HTML login page.
- **Two-step verification (required)**: every account logs in with password **and** a code of an authenticator app
  (TOTP, RFC 6238, own code). The first login shows a QR code and then ten recovery codes; every code works once. A
  superadmin (or `npm run oidc:user -- --email ... --reset-mfa`) resets it when a phone is lost. `OIDC_MFA=required` is
  the default.
- **Belgian eID**: log in and register with the eID card and its PIN (like CSAM and Corilus Passport), with
  [DafkeDD eID](https://github.com/DafkeDD/DafkeDD_EID) (`@dafkedd/eid`, installed from its GitHub release in the
  backend and the frontend). The card signs a nonce of the server; the server checks the signature, the origin, the
  certificate chain up to the Belgian root CAs and OCSP. Counts as two-step verification (`acr: loa4`). Registration
  takes the name from the card and needs no password; existing accounts link their eID on `/security`. Only an HMAC of
  the national register number is stored (`user_identifiers`). Users run the DafkeDD eID program on their PC; during
  development `npm run eid:mock` in `./frontend` starts a virtual card reader (PIN 1234, `OIDC_EID=test`).
- **Roles**: `user` and `admin` per organisation, `superadmin` for the whole platform (admin of every organisation, also
  new ones). The first account is superadmin. `@Access('admin')` / `@Access('superadmin')` protect endpoints; the role
  is checked in the database on every request. An organisation always keeps an admin, the platform a superadmin. A
  superadmin needs no organisation: it logs in to the platform and opens any organisation without a new password.
- **Accounts**: registration (a new organisation, you become its admin), email verification, forgotten password (the
  link works once), and for superadmins every organisation on `/admin`.
- **Management** (`/members`, "Management" in the header): admins invite people by email, see open invitations (send
  again, withdraw), change roles, disable or enable members, remove them, and see who is online and when someone was
  last seen. The links are encrypted tokens: no extra tables. Answers never reveal which addresses have an account.
- **Email**: `nodemailer` over SMTP (`SMTP_*` in `.env`, fill in your own for production). During development
  `npm run mail:dev` starts Mailpit in Docker: every email on http://localhost:8025. Texts in four languages.
- **Users**: `npm run oidc:user -- --email ... --tenant ... --role admin` adds users and organisations (`--superadmin`,
  `--reset-mfa`).
- **Tests**: unit tests (JOSE, PKCE with the RFC 7636 vector, keys, migrations, pages), end-to-end tests of the whole
  flow in memory (`npm run test:e2e`) and `npm run test:db` against the real PostgreSQL (isolation between tenants,
  codes used once, the first admin). Checked with the independent libraries `openid-client` and `jose` as client.
- **Not yet** (next phases): refresh tokens, logout at the OIDC server, revocation, introspection, passkeys, audit log,
  licences and payments.

The TypeScript files of this feature live as real files in `templates/backend-oidc` and `templates/frontend-oidc` (see
Development).

### Simple login and register (test pages)

With a frontend **and** a database you can choose the simple test login. You get a working login, register and profile
page, connected to the backend and the database.

**Database.** ONE table, always named after your database followed by `users` (database `shop` gives the table
`shopusers`; the CLI shows the name in the question). There is no example or test table. The API creates the table
(`CREATE TABLE IF NOT EXISTS`, plus a unique index on the lower-case email) the first time it starts, or on first use
when the database is down at startup. Columns: `id` (uuid), `name`, `email`, `password_hash`, `created_at`. Requires
PostgreSQL 13 or newer (`gen_random_uuid()`).

**Backend** (`./backend/src/users` and `./backend/src/auth`), plain SQL with parameters, no ORM:

- `POST /auth/register` (also logs you in), `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`.
- Passwords are hashed with **scrypt** (built into Node: random salt, parameters stored in the hash, constant-time
  comparison). The hash never leaves the API.
- The session is a signed **JWT in an httpOnly, SameSite=Lax cookie** (7 days, `Secure` as soon as
  `NODE_ENV=production`), so scripts in the browser cannot read it.
- Login and register are **rate limited** per IP (`AUTH_RATE_LIMIT`, default 10 per minute, answered with a translated
  429). An unknown email takes as long as a wrong password and gives the same error.
- Input is validated: name up to 100, email up to 254, password 8 to 128 characters, unknown fields are refused. All
  errors are translated (nl, fr, en, de).
- `JWT_SECRET` is generated by the CLI (48 random bytes) and written to `.env` only; `.env.example` has a placeholder.
- Extra packages: `@nestjs/jwt`, `cookie-parser` and `@nestjs/throttler`.
- Tests: hashing, the users service (SQL and parameters) and the whole flow with an in-memory fake (register, duplicate
  email in four languages, login, wrong password, `me`, forged cookie, logout, rate limit).

**Frontend** (`./frontend`): `/login`, `/register` and `/profile` (shows your name, email and member-since date from the
database and a log out button; anonymous visitors are sent to the login page). The home page gets links ("Log in" and
"Register", or "Signed in as ..."). All texts exist in four languages, and error messages come from the API in the
selected language.

For production: use HTTPS, set a long random `JWT_SECRET` and your real `CORS_ORIGIN`, and serve the frontend and the
API from the same site (for example `app.example.com` and `api.example.com`) so the `SameSite=Lax` cookie is sent.
Behind a reverse proxy enable Express's `trust proxy`, otherwise the rate limit sees the proxy's IP address.

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
src/backends/nestjs.js   # NestJS backend (+ database, login)
src/backends/oidc.js     # own OpenID Connect server: questions, .env, docs, copies templates/backend-oidc
src/backends/docs.js     # generated backend documentation (every endpoint)
src/eid.js               # DafkeDD eID: the release that is installed and the virtual card reader script
templates/backend-oidc/  # TypeScript of the OIDC server, copied into ./backend (placeholders like __USERS_TABLE__)
templates/frontend-oidc/ # login page, login routes and profile of the frontend (OIDC), copied into ./frontend
src/frontends/oidc.js    # texts and .env.local of the frontend login, copies templates/frontend-oidc
test/                    # test suite (node:test)
scripts/                 # test runner and git hook setup
.githooks/               # pre-push hook
```

To add a new frontend: create a file in `src/frontends/` (follow `nextjs.js`), register it in `src/frontends/index.js`
and add tests for it in `test/`.

Large generated features live as real files in `templates/` (they are formatted by Prettier like the rest of the
repository). The CLI copies them and fills in placeholders such as `__USERS_TABLE__`, `__TENANT_ROLE__` and `__PORT__`;
`test/oidc.test.js` checks that no placeholder is left. Their own tests (`*.spec.ts`, `*.e2e-spec.ts`, `*.db-spec.ts`)
run in the generated project.

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

- **0.25.0**: log in and register with the Belgian eID through [DafkeDD eID](https://github.com/DafkeDD/DafkeDD_EID)
  (installed from its GitHub release): "Log in with eID" on the login page (card + PIN, `acr: loa4`, no authenticator
  code needed), registration with the eID (name from the card, no password), linking and unlinking on `/security`,
  `OIDC_EID` (`off`, `on`, `test`) and `OIDC_REGISTRATION=eid`. Migration 2: `user_identifiers` (HMAC of the national
  register number) and an optional password. The page tells the user when the eID program, the card reader or the card
  is missing; `npm run eid:mock` gives a virtual card reader for development. Endpoints, tests (virtual card, real
  PostgreSQL) and docs.

- **0.24.0**: the superadmin needs no organisation: the CLI no longer asks for one, the first login goes to the platform
  (`/admin`, a token without a tenant), and with organisations the choice offers "Platform management". "Open" on the
  platform page switches organisation with the same session (no new password or code; also `tenant_hint`).
- **0.23.0**: management for admins: disable and enable members (no login, no API, sessions end at once), who is online
  and "last seen" (heartbeat from the frontend), open invitations in `tenant_invitations` (send again, withdraw), and a
  "Management" / "Platform" / "Profile" navigation in the header.
- **0.22.0**: phase 2 of the own OIDC server. **Two-step verification is required** for every account (TOTP with a QR
  code, own RFC 6238 code, recovery codes, every code once, set up at the first login, reset by a superadmin). Roles
  `user`, `admin` (of an organisation) and `superadmin` (of the platform; the first account). Registration with a new
  organisation, email verification, forgotten password, invitations, members page (`/members`) and platform page
  (`/admin`), security page (`/security`). Email over SMTP with `nodemailer`, Mailpit for development
  (`npm run mail:dev`), SMTP settings in `.env` to fill in. Links in emails are encrypted tokens (no tables). Checked
  with unit, end-to-end and real-PostgreSQL tests and a full browser run.
- **0.21.0**: one table fewer: the table `oidc_interactions` is gone. A running login now lives in an encrypted cookie
  `oidc_ia_<id>` (AES-256-GCM, key derived from `OIDC_MASTER_KEY`, httpOnly, SameSite=Lax, only for
  `/oidc/interaction/<id>`, 10 minutes), one per login so several tabs work. A copy of the cookie cannot log in twice
  (`oidc_sessions.interaction_hash` is unique). New unit, end-to-end and database tests; documented in `docs/api.md`.
- **0.20.0**: the login of the own OIDC server moves into the frontend on port 3000: login page (`/login`) and
  organisation choice in the frontend (JSON variant of the interaction endpoints, `OIDC_LOGIN_UI_URL`), login with PKCE
  through route handlers, encrypted session cookie, profile page, "Log in" / "Signed in as" on the home page. The demo
  client on port 4400 is gone. Checked in a real browser (Next.js 16, PostgreSQL 18), including single sign-on.
- **0.19.0**: phase 1 of the own OpenID Connect server: the login question now offers an own OIDC server (multi-tenant,
  PostgreSQL Row-Level Security, migrations, encrypted signing keys, discovery, JWKS, authorize with mandatory PKCE,
  login page in four languages, organisation choice, token, userinfo, demo client and user script), with unit,
  end-to-end and real-database tests and full documentation. Its TypeScript lives in `templates/backend-oidc`.
- **0.18.0**: the documentation is a project of its own: `cd docs`, `npm run dev` serves the website on
  http://localhost:5000 (`docs/serve.mjs`, no dependencies). The CLI shows "Documentatie geïnstalleerd in ./docs" and
  the commands at the end of its run. `npm run docs` also works in `./backend` and `./frontend`.
- **0.17.0**: `./docs/index.html`: the documentation as a self-contained website (markdown rendered by `marked`, a
  dependency of the CLI only; nothing extra in the generated project).
- **0.16.0**: one central documentation folder `./docs` (index, `api.md`, `frontend.md`) instead of READMEs spread over
  `./backend` and `./frontend`; those now only point to it.
- **0.15.0**: documentation for everything that is generated: `./backend/README.md` with every API endpoint (body,
  `curl` example, response, errors), Swagger descriptions on every route, `./frontend/README.md` with how to call the
  API; tests check that every route is documented.
- **0.14.0**: optional test login/register pages: a users table named `<database>users` (one table, created by the API),
  scrypt password hashing, JWT in an httpOnly cookie, rate limiting, translated errors, and login, register and profile
  pages in the frontend, with tests.
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
