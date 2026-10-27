# DafkeDD_CLI

An interactive CLI that installs a frontend into `./frontend` and a backend into `./backend`, **per project**.
Everything is installed **locally in the project**, never globally.

## What does it install?

| Frontend | Contents                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js  | Next.js (latest) + Tailwind CSS (latest) + next-intl (latest) + [DafkeDD UI](https://github.com/DafkeDD/DafkeDD_UI) in the Pasport design + Prettier, in `./frontend` |

| Backend | Contents                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NestJS  | NestJS (latest) + nestjs-i18n + validation + Swagger + `.env` config + Prettier, in `./backend`. Translated server errors, health endpoint, CORS and tests |

The CLI asks its questions first, then shows **one progress bar** for all steps: create the app, install dependencies,
install next-intl, the fonts of the design and Prettier, fetch and install DafkeDD UI, configure Prettier and run a
build check. Optionally the project is pushed to GitHub as the very last step.

Order of the questions:

1. Which frontend (or none)? Next.js has no questions of its own: every project gets DafkeDD UI and the Pasport design.
2. Which backend (or none)? Currently only NestJS. Then the backend options: which database (PostgreSQL or none), Docker
   or local, and the connection details (see [Database](#database-postgresql)).
3. Push to a repo right away? If yes: platform (GitHub only for now), repository name (the CLI checks that the name is
   still free) and private/public.

### DafkeDD UI and the Pasport design

**Every project the CLI makes is in the Pasport design**, the design of the login server: a site without a backend, a
frontend with an API, the simple login and the OpenID Connect login alike. The CLI always runs `dafke-ui init` and
`dafke-ui add --all` in `./frontend` (there is no question for it any more) and adds:

- `src/styles/pasport.css` and `src/components/pasport` (the tokens, classes and components of the design, its own
  icons; no react-icons), the fonts Hanken Grotesk and JetBrains Mono, and the root layout that loads them;
- the shell (icon rail, topbar with the search, light or dark, the language and the user menu): every page is in
  `<AppPage>` (`src/components/shell/app-shell.tsx`), the pages of the rail are in `src/lib/nav.ts` (`APP_NAV`);
- a home page in the shell (the stack, the status card of the API, the account card with the simple login);
- with the simple login: `/login` and `/register` in the login screen of the design (`AuthLayout`), `/profile` in the
  shell, and the account in the topbar (`src/components/shell/account.ts`);
- `npm run check:design` (`scripts/check-design.mjs`, also in the CI): every page in the shell or the login screen, no
  other component library, icon set or CSS framework, colours only through the tokens.

The login server and the apps linked to it have their own pages on top of that (the portal, the superadmin panel).

The components end up in `frontend/src/components/ui` (`dafke-ui.json` and `dafke-ui.lock.json` live in `frontend`) and
`ui.css` is loaded from `src/app/globals.css`. The UI repository (branch `developer`) is cloned temporarily with
`git clone` and removed again; nothing is installed globally (no `npm link`). Git is therefore required.

### Language and theme

The language and the theme are in the topbar of the shell (with a login: the language in the user menu).

- **Language**: switches between English, Nederlands, Français and Deutsch without changing the URL. The choice is
  remembered.
- **Theme**: light or dark, stored in `localStorage` and applied before the first paint, so there is no flash.

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
5. Choose whether the project gets **Claude Code** (agents, skills, hooks and GitHub pipelines; see below).
6. Choose whether the project is made ready for **Google Cloud** (Terraform, Dockerfiles and a button on GitHub to start
   and stop it; see below).
7. Last: choose whether to push to a repository right away (platform, name, private/public).
8. Wait until the progress bar is done. If you chose to push, your project (including `./frontend` and `./backend`) is
   now the first commit on GitHub.
9. Start the database (Docker only), the backend and the frontend:

```
cd backend
npm run db:up        # only when you chose PostgreSQL in Docker
npm run start:dev

cd frontend          # in a second terminal
npm run dev
```

If `./frontend` or `./backend` already exists, the CLI stops without deleting anything.

### The same project again: `--answers`

Every run keeps its answers in **`.dafkedd-answers.json`** in the project (not committed: it is in `.gitignore`). Start
the CLI in a new folder with that file to make the same project again without typing everything:

```
npx --allow-git=all github:DafkeDD/DafkeDD_CLI --answers ../shop/.dafkedd-answers.json
```

Every question the file answers is shown with "(antwoordbestand)"; a question it does not have, or whose answer no
longer fits (a link code that was used, a choice that is gone), is asked as usual. **Passwords are never kept**: they
are always asked. The file is JSON (`{ "version", "answers": [{ "question", "answer" }] }`), so you can also write or
change one yourself, for example for every new customer app.

### An existing project: `update` and `doctor`

In the folder of a project made with the CLI:

```
npx --allow-git=all github:DafkeDD/DafkeDD_CLI update
npx --allow-git=all github:DafkeDD/DafkeDD_CLI doctor
```

- **`update`** brings the files the CLI manages up to this version: the agents, skills, hooks, `CLAUDE.md`, the
  pipelines, `.mcp.json` and, with Google Cloud, Terraform, the workflows and the Dockerfiles. The manifest
  `.dafkedd.json` (committed) remembers the version, what the project is made of and a hash of every such file:
    - a file that is still as the CLI wrote it is replaced;
    - a file you changed is never overwritten: the new version lands next to it as `<file>.dafkedd-new` (ignored by
      git), to compare with `git diff --no-index <file> <file>.dafkedd-new`;
    - a missing file, and missing pages of the knowledge base, are added; a file the CLI no longer makes is reported,
      not deleted.

    A frontend without the OpenID Connect login (a site, an API, the simple login) gets the Pasport design this way too.
    One made before 0.50.0 also gets, once, what a new project has: its home page in the shell, `APP_NAV`, the account
    in the topbar and the login pages (new ones written, yours untouched with the new version next to them as
    `.dafkedd-new`), DafkeDD UI, the fonts and `npm run check:design`; the old language and theme dropdowns are
    reported, not deleted.

    A project of a CLI before 0.46.0 has no manifest: `update` reads what it is made of from its folders and `.env`
    files, shows that and asks to confirm; then every file that differs gets a `.dafkedd-new` version. Commit the result
    on an issue branch.

- **`doctor`** checks what the project needs: Node.js, git, the GitHub CLI (logged in), the dependencies, `backend/.env`
  and the database, the hooks and `.mcp.json` with what its servers need (Chrome for Playwright, `uv` or Docker for
  PostgreSQL), `gcloud` with Google Cloud, the labels of the issues and the protection of `developer` and `main` on
  GitHub, and whether the project is behind this version of the CLI. Every problem comes with the command that fixes it.

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
5. Only when that **database already exists** (a project of earlier with the same name): local, when it has tables;
   Docker, when the volume of the project is there. Its data would stay, also the superadmin and the passwords of then,
   so the CLI asks: **another name** (local), **empty it and start again** (`DROP DATABASE`, or the Docker volume and
   its containers removed during the install) or **keep it**.

What you get in `./backend`:

- `.env` with `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME` and
  `DATABASE_MAX_CONNECTIONS` (the most connections of the API at the same time, default 20; on Google Cloud every
  instance gets its share of `db_max_connections` in Terraform). `.env` is in `.gitignore`; `.env.example` is committed
  and holds `change-me` instead of your password.
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
- **Log in through your existing Pasport OIDC server (link code)** (only with a frontend): the project becomes an app of
  that server (see below), with the database you just chose. One account for all your apps: email, passkey, eID and
  two-step through the server.
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
  certificate chain up to the Belgian root CAs and OCSP. The eID is the first factor only: the code of the authenticator
  app always follows. Registration takes the name from the card and a chosen password; existing accounts link their eID
  on `/security`. Only an HMAC of the national register number is stored (`user_identifiers`). Users run the DafkeDD eID
  program on their PC; during development `npm run eid:mock` in `./frontend` starts a virtual card reader (PIN 1234,
  `OIDC_EID=test`).
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
- **Sessions and logout**: refresh tokens for the frontend (bound to the session, rotated at every use, a stolen copy
  ends the session), real logout (`end_session_endpoint`: the frontend logs out of the login server too), revocation
  (RFC 7009) and introspection (RFC 7662). Every token carries its session (`sid`): ending a session stops its tokens at
  once. `/security` shows where you are logged in and ends one or all other sessions.
- **Licences and payments (Mollie)**: products are sold per organisation, per product and per user (seat), per month or
  per year (always cheaper). A member asks a 14-day demo once ("Ask a demo" on `/profile`; nothing starts by itself);
  admins buy seats on `/licenses`, give them to members and take them back. Superadmins manage products, make discount
  codes (a percentage or an amount, once, for some periods or forever; 100% is free), give free seats and extend trials.
  `@License('planner')` protects an endpoint. `PAYMENTS=fake` (the default `.env`) has its own checkout page for
  development; `PAYMENTS=mollie` with a `test_...` key uses the real checkout of Mollie.
- **Audit log**: who did what, when, in which organisation, from which IP address and browser: logins (also failed
  ones), accounts, members, the platform and licences. Append-only in PostgreSQL (a trigger refuses changes), kept
  `AUDIT_RETENTION_DAYS` (365) days. Admins read their organisation on `/audit`, superadmins the whole platform, every
  account its own recent activity on `/security`.
- **Log in with another OpenID Connect server** (Microsoft Entra ID, Keycloak, Google, ...): the CLI asks whether that
  is wanted (no / next to the password / only that), which server (Google, Microsoft for every organisation or only
  yours, or another with its issuer), the client id and secret, and the text of the button. Google and Microsoft are
  always in `.env` and `.env.example`, ready to fill in (an empty client id: off). The login page shows "Log in with
  <name>"; that server proves who someone is (PKCE, state, nonce, its ID token checked with its JWKS), and accounts,
  organisations, roles, licences and the audit log stay here. A verified email address joins an existing account;
  two-step verification there counts when it says so. **Several at once** (Google and Microsoft): after the first the
  CLI asks "Nog een server toevoegen?"; they are `OIDC_EXTERNAL_*` and `OIDC_EXTERNAL_2_*` to `OIDC_EXTERNAL_9_*` in
  `.env`, a button each, and an account can be linked to each of them.
- **Passkeys**: every account adds passkeys on `/security` (fingerprint, face or PIN of the device, synced passkeys or a
  security key) and logs in with "Log in with a passkey": no password, and it counts as two-step verification
  (`acr: loa2`). Our own WebAuthn code (CBOR, COSE keys ES256, RS256 and EdDSA, signature counter), no attestation.
  `OIDC_PASSKEYS=off` turns them off.
- **Applications of others**: clients with `"firstParty": false` in `config/oidc-clients.json` show a **consent screen**
  ("Allow Partner Planner?", with what it gets per scope) and remember the answer per account; `/security` lists them
  and takes access back (their refresh tokens stop at once). **Back-channel logout** (OpenID Connect Back-Channel Logout
  1.0): when a session ends, every client that was used in it and has a `backchannelLogoutUri` gets a signed logout
  token, with retries; the frontend is one of them and logs the browser out too.
- **Apps on /admin**: superadmins make, change, disable and remove apps (OpenID Connect clients) in the frontend instead
  of editing `config/oidc-clients.json`: redirect URIs, scopes, refresh tokens, own app or of others, back-channel
  logout URI, and for a confidential app a secret that is shown once (only its hash is stored). The apps of the file
  stay read-only there.
- **An app for an existing login server**: choose Next.js, NestJS, a database and at _"Add a login?"_ **"Inloggen via je
  bestaande Pasport OIDC-server (koppelcode)"**. The CLI asks the address of that API, the port of the app's frontend
  (3001) and a one-time link code that a superadmin makes on `/admin` → Apps → "Koppelcode"; the app's own database is
  the one chosen before the login question (Docker or local). It adds the addresses of the new frontend to that app and
  writes `.env.local`: the frontend logs in there with single sign-on, is logged out with back-channel logout, and links
  to the account pages of that server. The app gets its **own NestJS API** in `./backend` (port 4001) with its own
  database: it has no users of its own, accepts only the access tokens of that login server for this app
  (`PasportGuard`: signature with its keys, `iss`, `aud`, `typ`, `client_id`), takes the organisation from the token,
  and keeps its data per organisation with Row-Level Security. The example is `notes` (`GET/POST /notes`,
  `DELETE /notes/:id` for the beheerder), shown on the home page of the frontend through `/api/app/...` (the token is
  added on the server). See "Login through the login server" in `docs/api.md`. The CLI also asks:
    - **modules**: **Mail** (`MailService` with SMTP, Mailpit during development, `npm run mail:dev`) and **Files**
      (`/files`: images and PDFs per organisation, raw uploads, in `./storage` or a Google Cloud Storage bucket);
    - nothing about how the data of the organisations is kept apart: every organisation gets a **database of its own**
      for the app (`<name>_t_<organisation id>`, made and migrated the first time it is used; the database user needs
      `CREATEDB`). One database with Row-Level Security is still possible: `TENANT_ISOLATION=rls` in `.env`. Every page
      of the linked frontend is protected: without a login it goes to the login server and comes back.
- **Apps are products**: on `/admin` → Apps a superadmin picks the product an app sells; every user then needs a licence
  of it in their organisation (a trial first, then a seat bought per month or per year). The tokens of the app say so
  (`license` claim) and the API of an app made with the CLI checks it (`OIDC_PRODUCT`).
- **Roles per app**: the developer of an app defines its roles (`config/app-roles.json`, sent with the link code or
  `npm run roles:push`); the beheerders give them to their members on `/members`; the tokens of the app carry them
  (`roles`) and its API checks them with `@Roles(...)`.
- **Invitations with apps**: a beheerder who invites someone ticks the apps, the roles in each app and "Give a licence";
  the email names the apps, accepting gives the roles and a free seat, and the invitation page offers "Open <app>".
- **One design everywhere (Pasport)**: the frontend of the login server and every linked frontend get the same login
  screens and the same shell, on the desktop and on the phone, built in `src/styles/pasport.css` (the tokens and every
  class of the design) and `src/components/pasport` (`Btn`, `Field`, `Input`, `Badge`, `Avatar`, `Modal`, `PageHead`,
  `AuthLayout`, toasts, ...):
    - the login screen, one for everybody: the teal panel with the eID card, the tabs eID and email, the steps of the
      eID, the six boxes of the code, the language and theme at the bottom right;
    - the shell: an icon rail (collapsible; a drawer on a phone) with the app's own pages (`src/lib/nav.ts`), the
      organisation (its admins) and the platform (superadmins); a topbar with the search for a page (⌘K), light or dark
      and the user menu (profile, security, language, log out); the superadmin panel (`/admin`, `/admin/catalog`,
      `/admin/apps`, `/admin/audit`) in the same shell with the dark mark;
    - every page starts with a `PageHead`.

    A linked app has no login or registration form: `/login` goes straight to the login screen of the server, where
    users register. Pages use `<AppPage>` (`src/components/shell`); see "Design (Pasport)" in `docs/frontend.md`. The
    agents of Claude Code (`frontend`, `qa`, `reviewer`) are told that this is the design to follow, at 1440 and 390
    pixels wide.

- **Protected by default**: every page needs a login. `src/proxy.ts` sends a browser without a session to `/login` and
  back to the page afterwards; only `PUBLIC_PATHS` (login, registration, password, email and invitation pages) are open.

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

### Claude Code in the project

When you answer yes to "Claude Code toevoegen?", the project gets everything Claude Code needs to work on it the same
way this CLI is built: nothing has to be installed.

| In the project                                                       | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                                          | The rules (tests, docs, four languages, the Pasport design, multi-tenant for the login server and the linked apps) and what the project is made of: its parts, the login server, the modules, `TENANT_ISOLATION`, the MCP servers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `.claude/agents/`                                                    | Building: `frontend` (always the Pasport design), `nestjs`, `postgresql`, `translator` (the four languages), `e2e` (Playwright browser tests that run in the CI), `kb` (the knowledge base). Checking (read-only): `reviewer`, `tester`, `docs`, `i18n`, `security`, `qa` (clicks through every control in a real browser and checks the rows in the database), `a11y` (WCAG 2.2 AA), `privacy` (GDPR), `performance`. Around it: `seed` (test data, test accounts with two-step verification), `support` (a user's message to an answer and an issue), `architect` (ADRs in `docs/adr`), and with Google Cloud `infra`, `observability` (logs, alerts, budget) and `backup` (the monthly restore test). Upkeep: `dependencies` (Dependabot pull requests), `release` (prepares the pull request into `main`) |
| `docs/kb/`                                                           | The **knowledge base** for the users of the app (also without Claude Code): a page per page of the app in en, nl, fr and de, with what it is for, where it is and who sees it, the tables of every control and message, and the screenshots in light and dark (`docs/kb/screenshots/`). The `kb` agent fills it and keeps it up to date                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `docs/adr/`                                                          | The architecture decisions (ADRs): a README, a template and the first decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `.github/dependabot.yml`, `CHANGELOG.md`                             | Weekly update pull requests into `developer` (handled by the `dependencies` agent), and the changelog the `release` agent writes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `.mcp.json`                                                          | The MCP servers the project can use: **Playwright** with a frontend (`@playwright/mcp`, a real browser; it uses Chrome, or `npx playwright install chromium`) and **PostgreSQL** with a database (Postgres MCP Pro through `.claude/scripts/postgres-mcp.mjs`: the database of `backend/.env`, read-only unless `POSTGRES_MCP_ACCESS=unrestricted`; needs `uv` or Docker), enabled in `.claude/settings.json`. The password stays in `backend/.env`                                                                                                                                                                                                                                                                                                                                                           |
| `.claude/skills/`                                                    | `plan` (questions, then a spec and ticket issues on GitHub), `implement` (an issue on its own branch up to the merge), `diagnose`, `handoff`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `.claude/hooks/`, `.claude/settings.json`, `.claude/git-policy.json` | The rules of git, enforced (below), and Prettier after every edit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `.claude/design/`                                                    | The Pasport design: brand book and tokens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `.claude/scripts/setup-labels.mjs`                                   | The labels of the issues (`spec`, `type:*`, `area:*`, `status:*`). Next to it `protect-branches.mjs`: `developer` and `main` protected on GitHub (the CI checks required, only through a pull request, no force-push or delete; an admin can still push) and private vulnerability reporting on. The CLI runs both after creating the GitHub repository (a private repository needs GitHub Pro or Team for branch protection), else run them once                                                                                                                                                                                                                                                                                                                                                             |
| `.github/ISSUE_TEMPLATE/`                                            | Forms for a feature and a bug; `pull_request_template.md` with the checklist (tests, docs, four languages, Pasport design, knowledge base, approvals); `CODEOWNERS` with your GitHub account (asked for every pull request); `SECURITY.md` (how to report a vulnerability)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `.github/workflows/ci.yml`                                           | On every pull request to `developer` and `main` and every push to `developer` (`release.yml` runs it for `main`): the backend (format, lint, build, unit, e2e, and the database tests against PostgreSQL 17), the frontend (format, lint, build, **Lighthouse** on the pages without login: accessibility at least 0.95, best practices 0.9, performance 0.8, `frontend/lighthouserc.json`; and the Playwright tests with axe and the **visual tests** once installed) and **security** (gitleaks over the code and the history with `.gitleaks.toml`, `npm audit` for high and critical)                                                                                                                                                                                                                     |
| `.github/workflows/release.yml`                                      | On every push to `main` except the first one of the repository: the CI once more, then a GitHub release `v<version>` (the version of `backend/package.json`, or the frontend; the next patch when that tag exists)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `.github/workflows/codeql.yml`                                       | CodeQL code scanning (security queries) on pull requests and weekly: public repositories, or private ones with GitHub Advanced Security (variable `CODEQL=on`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `.github/workflows/screenshots.yml`                                  | Actions → Screenshots on an issue branch: the screenshots of `docs/kb` made again on Linux by `frontend/e2e/screens.spec.ts` and committed; the CI compares them on every pull request (the visual tests)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `.dafkedd.json`                                                      | The manifest for `update` (also without Claude Code, with Google Cloud)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**How work flows** (a branch per issue):

1. `plan` makes the issues.
2. `implement` makes the branch `issue/<number>-<words>` from `developer`, and builds it with the agents.
3. The checking agents approve exactly what is staged; then it is committed (`closes #<number>`) and pushed.
4. A pull request goes into `developer`.
5. When the CI is green, an agent merges it (`gh pr merge <number> --squash --delete-branch`).
6. **Only a person merges `developer` into `main`**, which makes the release.

The hook `guard-git.mjs` enforces this:

- a commit only on an issue branch (or `release/<version>`), with every approval for the staged tree (`qa` too for a
  change to `frontend/src`, `frontend/messages`, a controller or the database; `a11y` for the frontend; `privacy` for
  the database);
- a push only of issue branches, never forced or deleting;
- `gh pr merge` only into `developer`, from an issue branch, a release branch or Dependabot, with every check green and
  every approval for its last commit;
- `gh release` and `gh repo delete` never.

When the project is pushed, the CLI also pushes `developer` and makes it the default branch, so `closes #n` closes the
issue at the merge. Protect `developer` and `main` on GitHub (Settings → Branches) with the CI checks as required
checks.

### Google Cloud (Terraform)

When you answer yes to "Klaar zetten voor Google Cloud?", the project gets:

| In the project                              | What                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infra/terraform/`                          | Cloud Run for the frontend and the backend (scale to zero), Cloud SQL PostgreSQL 17 (stopped with `down`), Secret Manager (the database password, the session secret, `OIDC_MASTER_KEY` of a login server, and your own secrets), Artifact Registry, a private bucket for the files module, own domains (optional). Everything in `europe-west1`                                                                        |
| `backend/Dockerfile`, `frontend/Dockerfile` | Small images (`npm ci`, build, `npm prune --omit=dev`, `USER node`, port 8080)                                                                                                                                                                                                                                                                                                                                          |
| `.github/workflows/cloud.yml`               | **The button** (Actions → Cloud → Run workflow): `plan`, `deploy` (a backup of a running database, build and start, a smoke test, and back to the previous images when the new ones do not answer), `up` (start with the last images), `down` (remove Cloud Run and stop Cloud SQL; the data, images and secrets stay). **Every night at 01:00 UTC** it runs `down` by itself (the variable `AUTO_DOWN=off` stops that) |
| `infra/bootstrap.sh`                        | Run once: the bucket of the Terraform state, a service account for the workflow, Workload Identity Federation (no keys), the GitHub variables                                                                                                                                                                                                                                                                           |
| `infra/terraform/monitoring.tf`             | Uptime checks and alerts (down, errors in the logs) by e-mail (`ALERT_EMAIL`), only while the app runs, and a budget alert at 50%, 90% and 100% (`BILLING_ACCOUNT`, `monthly_budget`)                                                                                                                                                                                                                                   |
| `.github/workflows/backup-check.yml`        | Monthly: are there recent backups of Cloud SQL, then an issue for the restore test (the `backup` agent)                                                                                                                                                                                                                                                                                                                 |
| `.github/workflows/preview.yml`             | **A preview per pull request**: the label `preview` on a pull request into `developer` starts a copy of the app of that branch (its own services, database and Terraform state), posts its address on the pull request and removes it all when the pull request is closed or the label removed                                                                                                                          |
| `infra/README.md`                           | How to set it up, the costs, own domains                                                                                                                                                                                                                                                                                                                                                                                |

Only a person starts it (the button, or the label `preview`); the only thing that runs on its own is the nightly `down`,
and Cloud Run costs nothing while nobody uses the app. A login across `*.run.app` addresses needs own domains
(`FRONTEND_DOMAIN`, `BACKEND_DOMAIN`), because the browser treats every `run.app` service as a site of its own. The
`infra` agent of Claude Code owns this setup.

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

| Command                | What it does                                                      |
| ---------------------- | ----------------------------------------------------------------- |
| `npm test`             | Runs the whole test suite                                         |
| `npm run format`       | Formats the repository with Prettier                              |
| `npm run format:check` | Checks the formatting without changing files                      |
| `npm run verify`       | Generates real projects with the CLI and checks them (see below)  |
| `npm run labels`       | Creates the GitHub labels the Claude Code skills use (needs `gh`) |

### Tests are mandatory

Every piece of code must have tests, and **code cannot be pushed while the tests are not green**:

- A **pre-push git hook** (`.githooks/pre-push`, activated by `npm install`) runs `npm run format:check` and `npm test`
  and blocks the push when something fails.
- **GitHub Actions** (`.github/workflows/ci.yml`) runs the same checks on every push and pull request to `developer` and
  `main`, on Linux and Windows with Node 22, 24 and 26, and the CLI starts (`--help`, `--version`). The release workflow
  only runs after the tests passed.
- Hooks can be skipped locally (`--no-verify`), so also enable **branch protection** on `developer` and `main` in the
  GitHub settings with the CI checks as _required status checks_.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how the tests are written.

### Checking generated projects (`npm run verify`)

`npm test` checks the generated files; `npm run verify` checks that they really work. It generates three projects with
the real steps of the CLI (no questions) in a temporary folder:

- `pasport`: the login server;
- `app`: an app without modules;
- `app-full`: an app with mail, files and a database per organisation.

Each one gets the build, lint, unit and e2e tests the CLI runs itself, plus TypeScript, Prettier and, with a database,
`npm run test:db`. The database comes from `VERIFY_DB_HOST`, `VERIFY_DB_PORT`, `VERIFY_DB_USER` and `VERIFY_DB_PASSWORD`
(default `localhost:5432`, `postgres`/`postgres`; the user needs `CREATEDB`). Options:

- `-- --only app-full` runs one variant;
- `-- --keep` keeps the projects;
- `-- --require-db` fails instead of skipping the database tests.

It needs the network and takes several minutes.

### Working with Claude Code

Everything Claude Code needs is in this repository; nothing has to be installed.

- **`CLAUDE.md`**: the rules of this repository (tests, docs, four languages, the Pasport design, multi-tenant) and the
  workflow.
- **`templates/project-claude/.claude/design/`**: the Pasport design every frontend follows. `pasport.md` is the brand
  book and `pasport-tokens.json` the tokens, copied from the Claude Design System "Pasport", which is synced from
  DafkeDD_UI.

**Skills (`.claude/skills/`)**

| Skill            | What it does                                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan`           | Asks every open question, then makes a spec issue and ticket issues on GitHub (areas, acceptance criteria, blocking order)                                                                         |
| `implement`      | Builds one ticket on its own branch: tests first, the building agents, then the checking agents, a commit `<version>: … (closes #n)`, a pull request into `developer`, merged when the CI is green |
| `diagnose`       | From an error to a tested fix: reproduce, failing test, cause, fix, a `type:bug` issue                                                                                                             |
| `handoff`        | Writes `.claude/handoff.md` (not committed) so a new session can continue                                                                                                                          |
| `port-from-test` | Compares a project that was changed by hand (`D:\test`, `D:\KidieFile`) with what the CLI generates now, and brings the generic improvements into the CLI                                          |

**Agents (`.claude/agents/`)**

| Agent        | Role                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `frontend`   | Builds the UI of the generated frontends, always in the Pasport design with the Dafke UI components   |
| `nestjs`     | Builds the generated NestJS backends: endpoints, modules, DTOs, errors, Swagger, their tests and docs |
| `postgresql` | Builds migrations, tables, Row-Level Security, a database per organisation, queries and db tests      |
| `reviewer`   | Checks the staged change against the ticket and the rules (read-only)                                 |
| `tester`     | Runs `npm run format:check`, `npm test` and, for generated code, `npm run verify` (read-only)         |
| `docs`       | Checks README, changelog, version, API docs and frontend docs (read-only)                             |
| `i18n`       | Checks en, nl, fr and de: the same keys, real translations, no hardcoded text (read-only)             |
| `security`   | Security review of login, tokens, tenants, billing, uploads, the database and the hooks (read-only)   |

The checking agents record their approval for exactly the staged tree with `.claude/hooks/approve.mjs`. The approvals
are kept in `.git/claude-approvals` and are never committed.

**Hooks (`.claude/settings.json`)**

- `guard-git.mjs` runs before every shell command:
    - a `git commit` needs the approvals of review, tests, docs and i18n, plus security when a staged path touches
      login, tokens, tenants, billing, uploads, the database or the hooks;
    - a commit only on the branch of an issue (`issue/<n>-<words>`), made from `developer`;
    - `git push` only of an issue branch (or `release/<version>`), never forced and never deleting;
    - `gh pr merge` only into `developer`, from an issue branch, when every check of the CI is green and every approval
      is there for the last commit;
    - `gh release` and a merge into `main` are refused: a release is done by a person.
- `format.mjs` runs Prettier on a file after every edit.

So Claude works on a branch per issue, opens a pull request into `developer` and merges it itself when the CI is green,
but only after checks by agents that did not build the change. The pre-push hook and the CI check everything once more.
Protect `developer` and `main` on GitHub with the CI as a required check.

**GitHub.** The skills work with the issues of `DafkeDD/DafkeDD_CLI` through the GitHub CLI (`gh auth login` once).

- `npm run labels` creates their labels: `spec`, `type:*`, `area:*`, `status:*`.
- `.github/ISSUE_TEMPLATE/` has a form for a feature and one for a bug.
- `developer` is the default branch, so a commit with `closes #n` closes its ticket when it is pushed.

### Structure

```
bin/cli.js               # entry point
src/index.js             # questions and flow
src/progress.js          # one progress bar for all steps
src/runner.js            # runs commands quietly
src/repo.js              # push questions + git / GitHub steps
src/frontends/index.js   # list of available frontends
src/frontends/nextjs.js  # Next.js + Tailwind + next-intl + Prettier + DafkeDD UI in the Pasport design
src/backends/nestjs.js   # NestJS backend (+ database, login)
src/backends/oidc.js     # own OpenID Connect server: questions, .env, docs, copies templates/backend-oidc
src/backends/docs.js     # generated backend documentation (every endpoint)
src/backends/linked.js   # an app for an existing login server: link code, own database, delegates to nestjs.js
src/backends/app.js      # the API of such an app: errors, .env, endpoints, copies templates/backend-app
src/eid.js               # DafkeDD eID: the release that is installed and the virtual card reader script
templates/backend-oidc/  # TypeScript of the OIDC server, copied into ./backend (placeholders like __USERS_TABLE__)
templates/backend-app/   # TypeScript of an app's API (Pasport tokens, notes per tenant), copied into ./backend
templates/frontend-oidc/ # login page, login routes and profile of the frontend (OIDC), copied into ./frontend
templates/frontend-oidc-linked/ # the files of a linked app's frontend that differ (home with notes, /api/app)
templates/project-claude/ # Claude Code for a generated project: agents, skills, hooks, design, issue forms
src/claude.js            # the question, CLAUDE.md and the CI/release/CodeQL/Screenshots workflows of a generated project
src/manifest.js          # .dafkedd.json of a generated project (what it is, a hash per managed file)
src/update.js            # DafkeDD_CLI update: an existing project to this version, never over your changes
src/doctor.js            # DafkeDD_CLI doctor: are the tools, MCP servers, database and GitHub settings there?
src/kb.js                # the knowledge base of a generated project (docs/kb, four languages)
src/cloud.js             # Google Cloud of a generated project: Terraform, Dockerfiles, the Cloud and Preview workflows
src/frontends/oidc.js    # texts and .env.local of the frontend login, copies templates/frontend-oidc
test/                    # test suite (node:test)
scripts/                 # test runner, git hook setup and npm run verify
.githooks/               # pre-push hook
.claude/                 # agents and hooks for Claude Code (see "Working with Claude Code")
CLAUDE.md                # the rules of this repository for Claude Code
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

- **0.53.4**: no licence, no app; the databases of the organisations named after them.
    - An app that sells a product only lets in an account with a licence of it in its organisation (a demo, a seat, a
      superadmin). Without one the login stops on a screen of the login server: "Ask a demo" (when its demo is on and
      the member never had one, then straight into the app), "Ask your administrator", "To my apps" and "Try again".
      Also with single sign-on; `prompt=none` gives `access_denied`. Before, the account got into the app and only its
      data was refused.
    - With a database per organisation, a new one is named after the organisation: `<app>_<slug>`
      (`dafkedd_kids_de_linde`) instead of `<app>_t_<id>`. When that name is taken the start of the id is added. The
      register `tenant_databases` keeps the name, so databases made before keep theirs and a new slug changes nothing.
      The `tenant` claim of the tokens now also has the `slug`.
- **0.53.3**: Google and Microsoft ready to fill in.
    - `.env` and `.env.example` of the login server always have Google (`OIDC_EXTERNAL_*`) and Microsoft
      (`OIDC_EXTERNAL_2_*`) with their issuer and name, and what to register there; an empty client id keeps them off. A
      server chosen in the CLI comes first.
    - The CLI asks "Welke server?": Google, Microsoft (every organisation), Microsoft (only yours, with the directory
      id) or another (its issuer). The question for the client id shows the redirect URI to register.
- **0.53.2**: the eID is required for the accounts of Google and Microsoft too.
    - With `OIDC_EID_REQUIRED` on, an account that logs in with Google, Microsoft or another OpenID Connect server must
      read its eID once as well, also with `OIDC_EXTERNAL_ONLY=true` (before, that setting turned the eID off
      completely). The eID is then no way to log in, but it can be read to link it.
- **0.53.1**: logging in with Google and Microsoft.
    - Microsoft Entra ID for every organisation:
      `OIDC_EXTERNAL_ISSUER=https://login.microsoftonline.com/organizations/v2.0` works (its discovery says
      `{tenantid}`; the ID token must carry the issuer of the organisation in its `tid`).
    - Microsoft sends no `email_verified`: its optional claim `xms_edov` (the organisation verified the domain) now
      counts as a verified address, so the first login with Microsoft is no longer refused.
    - The docs and `.env` explain step by step what to register in the Google Cloud console and in Microsoft Entra (the
      redirect URI `/oidc/external/callback`, the client id and secret, the optional claims).
- **0.53.0**: after logging in, my apps; the vault only for doctors; the eID asked for clearly; `demo:clear`.
    - A login at the portal itself now lands on **My apps** (`/apps`, first in the rail): the apps the user may open (an
      own licence or a running demo), to click through in the same tab. Without any it says what to do: discover apps,
      or for the admin the licences. A login from an app still goes straight back to that app.
    - The eHealth vault is only for doctors: the rail, the dashboard and `/me/vault` (and the vault for the apps) no
      longer let in a superadmin who is not a doctor in the organisation.
    - An invitation on a login server with the eID: a new account always reads its eID ("Continue without eID" is gone).
    - An account that has not read its eID yet gets a clear message right after logging in, at the top of the portal and
      of every linked app, with a button "Read my eID" ("Later" hides it for the session).
    - A linked app sends the account to the security page of the login server to read its eID with `?app=<client id>`;
      afterwards a button (or, when the eID is required, the eID screen itself) brings it back to that app.
      `GET /me/eid/back?client=` gives the name and the address of the app: only registered apps, no open redirect.
    - `npm run demo:clear` in the backend of the login server removes all demo data again (the same as
      `npm run demo:data -- --remove`).
- **0.52.0**: the secretariat uses the eHealth certificate of the right doctor.
    - Every doctor keeps an own certificate on `/vault` of the login server. New there: "Who may use my certificate",
      where the doctor ticks the colleagues of the organisation (the secretariat) who may use it in the apps, and can
      take it away at any time. Only for that organisation, only while the doctor is an active doctor there. Stored in
      `vault_delegates` (migration 23), recorded as `account.vault_delegates_changed`.
    - The login server: `GET`/`PUT /me/vault/colleagues` for the doctor; `POST /vault/doctors` for an app (the doctors
      the logged in account may use); `POST /vault/credentials` takes an optional `doctorId`. The fetch is in the audit
      log of the doctor with `onBehalfOf`.
    - The API of a linked app: `PasportVault.credentials(token, doctorId?)` and `PasportVault.doctors(token)`,
      `GET /vault/doctors` and `GET /vault?doctor=<id>`.
    - Fixed: the drop zone of the vault page did not highlight while dragging, and the thumbprint was not monospaced (a
      missing space in the class name).
- **0.51.1**: a linked app shows only its own pages, and reaches the eHealth vault through its API.
    - The rail of a linked app has only the pages of the app (`APP_NAV`); the portal of the login server (dashboard,
      apps, users, invoices, vault, support, the superadmin panel) is no longer repeated in every app. Profile,
      security, language and log out stay in the user menu.
    - The API of a linked app gets `PasportVault` (`src/pasport/pasport-vault.service.ts`): the eHealth certificate of
      the logged in doctor from the vault of the login server (`POST /vault/credentials`, server to server, with
      `OIDC_CLIENT_SECRET` in `backend/.env`), and `GET /vault` with what the certificate is (never the file). The vault
      itself stays only on the login server.
    - The CI of the CLI also runs on Node 26 (Linux and Windows).
- **0.51.0**: clearer licences, the database of earlier, several external logins, an answers file and `update` for every
  frontend.
    - A linked app without a licence says so with what to do: "Ask a demo" (new tokens at once, `POST /api/auth/renew`),
      the apps of the portal and, for the admin, the users of the organisation. During a demo it shows how many days are
      left. A licence without a role says that too, instead of an error of the API.
    - Users (`/users`) on the login server: under the roles of an app "these roles only apply with a licence or a
      running demo" when the member has no licence for it.
    - The database of earlier: when the chosen database already has tables (local) or the Docker volume of the project
      exists, the CLI asks: another name, empty it and start again, or keep it (its data and passwords stay).
    - Google Cloud: `DATABASE_MAX_CONNECTIONS` per instance (`db_max_connections` in Terraform, default 20 for
      db-f1-micro): an app with a database per organisation shares it between the database of the app and the
      organisations used most recently, so it never asks Cloud SQL for more connections than it allows.
    - `update` gives every frontend the Pasport design: a site, an API or the simple login made before 0.50.0 gets its
      home page in the shell, the rail, the account and the login pages (next to yours as `.dafkedd-new`), DafkeDD UI,
      the fonts and `npm run check:design`.
    - Several other OpenID Connect servers at once (Google and Microsoft): `OIDC_EXTERNAL_2_*` to `OIDC_EXTERNAL_9_*`, a
      button each on the login page, an account linked to each (migration 22).
    - `--answers <file>`: the same project again with the answers of `.dafkedd-answers.json` (every run writes it,
      without passwords); what it misses is asked.
    - The CI of the CLI runs on Linux and Windows with Node 22 and 24 and checks that the CLI starts; Node 22 or later
      is needed (20 is no longer supported).
- **0.50.1**: an app for a login server always gets a database per organisation, and its roles need a licence.
    - Every question once: the separate backend choice "App voor een bestaande DafkeDD OIDC-server (koppelcode)" is
      gone, the login question of NestJS leads to the same app ("Inloggen via je bestaande Pasport OIDC-server").
    - The roles of an app (`roles` in its tokens) come with a licence when the app sells a product: a seat, a running
      demo or a superadmin; without one the claim is empty. A member has roles per organisation and per app, several at
      once (the default roles of the app until an admin gives others on /users).
    - The question "Hoe wordt de data van de organisaties gescheiden?" is gone (its arrow keys did not work either):
      every organisation gets its own database for the app (`TENANT_ISOLATION=database`). Row-Level Security in one
      database stays possible with `TENANT_ISOLATION=rls` in `.env`.
    - The superadmin of the CLI could not log in ("onjuist") when the demo data was added during the install. The API
      only made the superadmin in an empty users table, and the demo accounts came first. It now makes it at the start
      while there is no superadmin and no account with that address. `npm run verify` checks it after the demo data of
      the install.
- **0.50.0**: every project of the CLI is in the Pasport design.
    - A frontend without the OpenID Connect login (a site, a frontend with an API, the simple login) gets the same
      design as the login server: DafkeDD UI with all its components (no question any more), `pasport.css`, the
      components and icons of `src/components/pasport`, the fonts, the shell (`<AppPage>`, the rail in `APP_NAV`) and
      `npm run check:design`, also in the CI. react-icons and the language and theme dropdowns are gone; the language
      and the theme are in the topbar.
    - The simple login: `/login` and `/register` in the login screen of the design, `/profile` in the shell, the account
      in the topbar with the profile, the language and log out in its menu, and an account card on the home page.
    - `Shell` (`src/components/pasport/shell.tsx`) is the same in every project; the bell, the status and the
      out-of-office reply of the login server are in `PortalShell` (`portal-shell.tsx`). `AuthLayout` can hide the eID
      card (`eid={false}`).
    - NestJS asks _"Add a login?"_ with a new choice: _"Log in through your existing Pasport OIDC server (link code)"_.
      The project becomes an app of that server (eID, passkeys and two-step through the server), with the database that
      was already chosen; before, that was only the separate backend choice.
    - The theme button of the login screen sits at the top right; at the bottom left it covered the footer of the teal
      panel.
    - `npm run verify` has a new variant `plain`: an API with the simple login and a database.
- **0.49.0**: demo data, the invoices on Google Cloud and the vault in linked apps.
    - `npm run demo:data` in the backend of the login server (development only): two organisations with doctors and
      staff, four apps in the catalogue, a subscription with seats, a trial, a free grant, invoices (one open), support
      tickets (answered, closed with a rating) and a discount code. Running it again changes nothing; `-- --remove`
      takes it away. The CLI asks it too ("Demodata toevoegen?", no by default) and shows the password of the demo
      accounts once.
    - Google Cloud: the VAT (`BILLING_VAT_PERCENT`) and who sends the invoices (`INVOICE_SELLER_*`) as Terraform
      variables, set from the GitHub variables `VAT_PERCENT` and `INVOICE_SELLER_*` by the workflow.
    - A linked app shows the eHealth vault of the login server in its sidebar for doctors, and its sidebar follows the
      portal (dashboard, apps, users, invoices, support).
- **0.48.0**: the login server is the whole Pasport portal of the reference project, with everything the CLI had.
    - The customer portal (`src/app/[locale]/(portal)`, `CustomerShell`): dashboard, "Discover apps" (the app catalogue,
      a demo per app), the purchase wizard (seats, monthly or yearly, a discount code, the checkout), the eHealth vault
      for doctors, users (invite with apps, roles and licences, profession, status), invoices (VAT, FAC numbers, PDF,
      pay the open ones), support tickets (images, rating the help), profile, security, activity, and a tour of the
      portal.
    - The superadmin panel (`src/app/[locale]/admin/(panel)`, `AdminShell`): statistics, tenants (overview and detail:
      members, invitations, apps, licences, billing, "Open"), every user, the tickets of the support team (claim,
      internal notes with @mentions), the app catalogue with the connection of each app (link code, secret, roles),
      discount codes, activity and ratings. `/members`, `/licenses` and `/admin/apps` (older links) go to the new pages.
    - The shell (`src/components/pasport/shell.tsx`) of the login server and of every linked app: badges in the rail,
      the bell with toasts and a chime for tickets, the own status and the out-of-office reply in the user menu (like
      Teams and Outlook), and still the search for a page, the language, external links and the eID screen.
    - The backend: tickets (`/tenants/current/tickets`, `/admin/tickets`), invoices, the app catalogue, the vault
      (`/me/vault`, `POST /vault/credentials` for apps), statistics, status and out-of-office, profession, the tenant
      detail for superadmins; migrations 14 to 21 (the CLI's 1 to 13 stay as they were). Every new route is documented.
    - The vault reads PKCS#12 files with `node:crypto` (`src/vault/pkcs12.ts`: AES, 3DES and the RC2 of older Windows
      and Java files), so no library with an open advisory runs in production (`node-forge` only makes the certificates
      of the tests); image uploads of the tickets get a larger JSON body (3 MB), every other route keeps 100 kB.
    - The texts of the portal in `messages/<language>.json` → `Portal` (`useT` of `src/components/pasport/i18n.ts`),
      German in the du-form; the design check accepts a page in a route group whose layout draws the shell.
    - Security and the own profile, as in the reference project:
        - Change the password on `/security` (`POST /me/password`; the first one for an account that only had its eID),
          every other session ends.
        - The own profile on `/profile` (`GET`/`PATCH /me/profile`): first and last name, phone, language, a new email
          address after confirming the link sent to it, the billing details of the organisation
          (`/tenants/current/billing`, its admins change them) and what the eID says (national register number and
          address, encrypted, only for the account itself).
        - The superadmin panel has its own `/admin/profile` and `/admin/security`.
        - `OIDC_EID_REQUIRED=on` (default off): every account must link its eID; registering only with the eID, a new
          account of an invitation reads it first (`POST /oidc/account/invitation/eid`), and the frontend shows the eID
          screen until it is linked. Registration asks the phone (optional) and the language.
        - A superadmin who creates an organisation with their own email is its admin at once (no invitation to
          themselves), so the next login offers the organisation.
        - Expired logins are cleaned up every hour; a login at another OpenID Connect server needs a verified email
          address; the link codes of an app stop when the app is changed.
- **0.47.1**: the Pasport design stays the design of every project.
    - `update` also keeps the Pasport design of the frontend in step (login server and linked apps): `pasport.css`, the
      components of `src/components/pasport`, the shell, the layout, the protected routes (`src/proxy.ts`) and the proxy
      to the API; a file you changed gets the new version next to it (`<file>.dafkedd-new`). Missing texts of the design
      are added to `messages/*.json`, yours stay.
    - `npm run check:design` in every OIDC frontend, also in the CI (`frontend/scripts/check-design.mjs`): every page in
      `AppPage`, or in the login screen when it is public; no other component library, icon set or CSS framework; no
      colours written in a page. The agents run it, the reviewer checks that it is not weakened.
    - No react-icons in an OIDC frontend any more: the status card on the home page uses the icons of the design.
- **0.47.0**: the frontend in the real Pasport design, like the reference project.
    - The shell: icon rail (collapsible, a drawer on the phone), topbar with the search for a page, theme and the user
      menu (profile, security, language, log out); the superadmin panel split into `/admin`, `/admin/catalog`,
      `/admin/apps` and `/admin/audit`.
    - The login screens: login with tabs for eID and email, the eID steps, two-step verification with six boxes,
      registration in steps, invitations, password and email screens; `/admin/login` in the dark superadmin style.
    - `src/styles/pasport.css` and `src/components/pasport` in every OIDC frontend (also linked apps); page headers
      (`PageHead`) on every page; the profile and security pages in the cards of the design.
    - Every page protected by default (`src/proxy.ts`, `PUBLIC_PATHS`), back to the page after the login.
    - The login screen says "Log in to <app>" only for another app (`clientId` in `GET /oidc/interaction/:id`).
    - The agents, `CLAUDE.md` and `.claude/design/pasport.md` of a project: this is the design to follow, on the phone
      too.
    - On the phone: the closed drawer casts no shadow, rows with buttons (members, licences, organisations) wrap under
      the name, the profile header wraps its badge.
    - The notifications bell in the topbar, like the reference: `src/notifications` in the backend
      (`GET /me/notifications`, read one or all; superadmins hear of new organisations, admins of invitations and new
      members; other code calls `NotificationsService`), polled every 30 seconds by the frontend, also in linked apps.
    - The backend pins `multer` to `^2.5.0` (npm `overrides`) for a denial-of-service advisory in older versions.
- **0.46.3**: `protect-branches.mjs` no longer reports private vulnerability reporting as failed for a private
  repository (GitHub only has it for public ones).
- **0.46.2**: `doctor` says "niet beschermd" for a branch without protection, and for a private repository that GitHub
  Free cannot protect it (make it public or use GitHub Pro or Team).
- **0.46.1**: the summary of the CLI says whether the labels and the protection of the branches worked on GitHub (a
  private repository on GitHub Free cannot protect its branches), and no longer asks to run them by hand when the CLI
  made the repository.
- **0.46.0**: keeping projects up to date, and more checks on GitHub.
    - `update`: an existing project gets the agents, hooks, pipelines and Terraform of this version, without overwriting
      what you changed (`.dafkedd.json`, `<file>.dafkedd-new`); older projects without a manifest too.
    - `doctor`: is everything there (tools, MCP servers, database, labels, branch protection, version)?
    - GitHub: `developer` and `main` protected (required checks, pull requests only), private vulnerability reporting,
      `CODEOWNERS`, a pull request template and `SECURITY.md`.
    - CI: gitleaks and `npm audit`, CodeQL, Lighthouse on the pages without login, visual tests that are the screenshots
      of the knowledge base (made on Linux by the Screenshots workflow).
    - Google Cloud: the nightly `down`, a preview per pull request (label `preview`), and a deploy with a backup first,
      a smoke test after and the previous images back when it fails.
    - Two examples in the API docs of the login server no longer look like real secrets (gitleaks).
- **0.45.0**: the last pieces around the agents, and the CLI itself works on a branch per issue.
    - New agents in a generated project:
        - `seed`: test data and test accounts, also with two-step verification, for qa, kb, e2e and performance;
        - `support`: a message of a user becomes an answer and a reproducible issue;
        - `architect`: decisions that are hard to undo, as ADRs in `docs/adr`;
        - `observability`: logs, errors, alerts and the budget;
        - `backup`: the monthly restore test.
    - Google Cloud:
        - `infra/terraform/monitoring.tf`: uptime checks, alerts on downtime and errors by e-mail, a budget alert;
        - `.github/workflows/backup-check.yml`: monthly, the backups, then an issue for the restore test.
    - This repository works like the projects it makes:
        - a branch per issue (`issue/<n>-<words>`) and a pull request into `developer`;
        - Claude merges it when the CI is green and every agent approved;
        - `main` stays Davey's.
    - Checked by an independent review, then fixed:
        - the git hook reads a command like a shell does (quotes, `$( )`), refuses `git commit -a`/`-i`/`-o`/paths, a
          push that deletes a branch (`:branch`, `--delete`) or pushes tags, and asks the approvals for every file of
          the branch;
        - `.mcp.json` only has the servers the project can use (Playwright with a frontend, PostgreSQL with a database);
        - the CI runs on a push to `developer` (the release runs it for `main`), `test:db` only when it exists, and the
          first push of a repository is no release;
        - Terraform: the `JWT_SECRET` of a project with the simple login, the APIs before the service accounts and the
          budget, `plan` shows the running app, no backend address without a backend;
        - the CLI makes the labels of the issues after creating the GitHub repository;
        - the Prettier hook runs Prettier with node itself (folders with spaces on Windows);
        - the knowledge base README without Claude Code says how to keep it up to date by hand.
- **0.44.0**: Google Cloud for every project (the CLI asks).
    - Terraform in `infra/terraform`:
        - Cloud Run for the frontend and the backend, scaling to zero;
        - Cloud SQL PostgreSQL 17, which can be stopped;
        - Secret Manager, Artifact Registry, a bucket for the files module, and own domains.
    - Dockerfiles for both parts.
    - The workflow `Cloud`, a button on GitHub with `plan`, `deploy`, `up` and `down`. `down` removes Cloud Run and
      stops the database to save costs, and keeps the data.
    - `infra/bootstrap.sh` for the one-time setup with Workload Identity Federation.
    - The agent `infra`.
- **0.43.0**: more agents and a knowledge base for every project.
    - **Knowledge base** (`docs/kb`), from the first commit, for every project with a frontend:
        - a page per page of the app in en, nl, fr and de, with its purpose, where it is and who sees it;
        - the tables for every control and message;
        - the screenshots in light and dark.

        The `kb` agent fills it with the Playwright MCP and keeps it up to date; the `docs` agent refuses a change to a
        screen without it.

    - New agents in a generated project:
        - `kb`;
        - `e2e`: Playwright browser tests in `frontend/e2e`, run by the CI;
        - `a11y`: WCAG 2.2 AA, required for the frontend;
        - `privacy`: GDPR, required for the database;
        - `performance`;
        - `dependencies`: with `.github/dependabot.yml`, weekly into `developer`;
        - `release`: prepares the pull request into `main` with `CHANGELOG.md`;
        - `translator`.
    - The hook allows `release/<version>` branches and merges Dependabot pull requests into `developer` when the CI is
      green.
- **0.42.0**: development with Claude Code, without anything to install.
    - `CLAUDE.md` with the rules and the workflow of this repository, and the Pasport design in
      `templates/project-claude/.claude/design/`.
    - Skills in `.claude/skills/`: `plan` (spec and tickets as GitHub issues), `implement` (a ticket from the issue to
      `developer`), `diagnose`, `handoff` and `port-from-test`.
    - Agents in `.claude/agents/`.
        - They build: `frontend` (always the Pasport design), `nestjs` and `postgresql`.
        - They check: `reviewer`, `tester`, `docs`, `i18n` and `security`.
    - Hooks:
        - a commit needs the approvals of the checking agents for exactly the staged tree (security only for the
          sensitive parts);
        - a push only goes to `developer`;
        - `gh pr merge` and `gh release` are refused;
        - Prettier runs after every edit.
    - GitHub: issue forms for a feature and a bug, and `npm run labels` for the labels.
    - **Claude Code in a generated project** (the CLI asks):
        - `CLAUDE.md` for that project;
        - the agents, skills and hooks;
        - the Pasport design;
        - issue forms;
        - a CI workflow (backend with PostgreSQL, frontend) and a release workflow (a merge into `main`).
        - the Playwright and PostgreSQL (read-only) MCP servers, and the agent `qa`, which tests every button, form and
          table in a real browser and checks the database.

        Work happens on a branch per issue. An agent may merge it into `developer` when the CI is green and every
        checking agent approved; `main` and releases stay with a person. When pushed, `developer` becomes the default
        branch.

    - `npm run verify` generates the login server, an app and an app with every module with the real steps of the CLI,
      and checks them (build, lint, unit, e2e and database tests, TypeScript, Prettier).
    - Fix: DafkeDD eID could not be installed when npm printed a warning before its answer to
      `npm config get allow-remote` (for example about the Node.js version): `.npmrc` was not written and npm 12 refused
      the package.
- **0.41.0**: more for the app of an existing login server.
    - The CLI asks which modules the API of the app gets: **Mail** (`src/mail`, the `MailService` of the login server,
      now also with attachments) and **Files** (`src/files`: `GET/PUT/DELETE /files/:id`, `GET /files`; the type read
      from the bytes, at most 8 MB, `ETag`, a folder or Google Cloud Storage via `FILES_DRIVER`), with their texts in
      en, nl, fr and de, tests (unit, e2e, real PostgreSQL) and docs.
    - The CLI asks how the data of the organisations is kept apart: one database with Row-Level Security, or a
      **database per organisation** (`TENANT_ISOLATION=database`). `DatabaseService.withTenant()` is the same either
      way; the database of an organisation is made, registered (`tenant_databases`) and migrated the first time it is
      used.
    - `DatabaseService.withLock(key, fn)` (an advisory lock), and `runMigrations()` takes its own lock key and table.
    - Every page of a linked frontend is protected: without a session it starts a login that comes back to the same page
      (no endless loop when cookies are blocked).
    - The login server exports `LoginLimiter` (the rate limit of the logins) for endpoints of your own.
- **0.40.0**: fixes found in a real linked app.
    - The session cookies of the frontend are named after its client id (`<client id>_session`, `<client id>_oidc`
      instead of `app_session`): browsers share cookies between all ports of localhost, so the portal of the login
      server and a linked app threw each other's session away. Everyone logs in once more after the update.
    - `/api/app` of a linked frontend passes bodies and answers as bytes (uploads, images, PDFs) with their
      `Content-Type` and `Accept`, and passes `If-None-Match`/`ETag` (304), `Cache-Control` and `Content-Disposition`
      on.
    - A body the parser refuses is answered instead of logged as a crash: too large is a translated 413
      (`errors.PAYLOAD_TOO_LARGE`), invalid JSON a 400.
    - Every backend gets the validation texts of the usual class-validator decorators in en, nl, fr and de (`IS_UUID`,
      `IS_INT`, `IS_NUMBER`, `IS_BOOLEAN`, `IS_DATE`, `IS_ARRAY`, `IS_OBJECT`, `IS_IN`, `MIN`, `MAX`, `MATCHES`,
      `ARRAY_MAX_SIZE`, `MAX_LENGTH`); before, only the login server had most of them.
- **0.39.2**: fix: the frontend of a linked app did not build (`Can't resolve '@/components/ask-demo'`): the "Ask a
  demo" button of the profile page is now part of the linked frontend too. A new test checks that every file the
  generated frontend imports is generated as well.
- **0.39.1**: longer link codes. The login server now makes link codes of 24 characters
  (`K7QM-2XPD-9HRT-W4NB-C8ZF-3VJE`, 120 random bits instead of 60); `POST /oidc/link` and `POST /oidc/link/roles` accept
  up to 48 characters, and the short codes of 12 characters of older servers keep working. The CLI accepts both when
  linking an app (it refused the long codes of a login server that made them already).
- **0.39.0**: two-step verification after the eID, a password for every account, and no automatic demos. The Belgian eID
  (card and PIN) is the first factor only: the code of the authenticator app (or its setup at the first login) always
  follows, like after a password (`amr: ["sc", "pin", "otp", "mfa"]`, `acr: loa2`; `loa4` is gone, also from discovery).
  Registering with the eID needs a chosen password (`password` of `POST /oidc/account/register-eid`); the "your eID
  counts as two-step verification" notice on `/security` is gone. A demo (trial) never starts by itself (not at
  registration, invitation or the first login to an app): a member asks it once with
  `POST /me/licenses/:productCode/trial` ("Ask a demo" on `/profile`, 409 `billing.DEMO_USED`), or an admin starts it.
  New texts `billing.DEMO_USED` and `Licenses.askDemo` (en, nl, fr, de).
- **0.38.0**: invitations with apps. An admin who invites someone (`POST /tenants/current/invitations`) can add `apps`:
  per app the roles the new member gets (`null`: the default roles) and `seat` (one of the free seats of the product the
  app sells). `GET /tenants/current/apps` now lists every app made on `/admin` (also without roles) with `url` and
  `product`. The email names the apps (`mail.INVITE_APPS`); `GET /oidc/account/invitation` shows them with their roles;
  accepting gives the roles (audit `members.app_roles_changed`, reason `invitation`) and the seat (`seat: false` when
  none was free: the trial runs anyway), and answers the apps with their address. Kept in `tenant_invitations.apps`
  (migration 13). New error `oidc.INVITATION_APP_UNKNOWN`. On `/members` the invitation form has "Access to apps"
  (`src/components/invite-apps.tsx`) and the open invitations show their apps; `/invite` shows the apps and, once
  accepted, "Open <app>". The audit log now also shows the app, apps and roles of an event. Texts in en, nl, fr and de.
- **0.37.0**: roles per app. The developer of an app defines its roles (`config/app-roles.json` of an app made with the
  CLI: key, a name in en, nl, fr and de, default); the login server learns them with the link code and with
  `npm run roles:push -- --code <link code>` (`POST /oidc/link/roles`), or `"roles"` in the clients file (migration 12).
  The admins (beheerders) of an organisation give them on `/members` ("Roles per app", `/tenants/current/apps/...`,
  table `app_role_assignments` with Row-Level Security); members without roles given there have the default roles. The
  tokens of the app carry `roles`; its API checks them with `@Roles('editor')` (403 `errors.ROLE_REQUIRED`, `/me` shows
  them), and the notes card only shows its form with the role editor. New errors `oidc.APP_NOT_FOUND`,
  `oidc.ROLE_UNKNOWN`, `oidc.ROLES_INVALID`, audit `members.app_roles_changed` and `platform.client_roles_pushed`, texts
  `AppRoles` and `Notes.readOnly` (en, nl, fr, de).
- **0.36.0**: an app is a product. On `/admin` → Apps a superadmin chooses the product (licence) an app sells (one
  product per app; `"product"` in the clients file; migration 11). The access tokens of that app carry
  `license: { product, status, ends_at }` (`trial`, `seat`, `superadmin` or `none`), worked out at every login and
  refresh; a member who never had a trial of the product gets one at the first login to the app. New errors
  `oidc.CLIENT_UNKNOWN_PRODUCT` and `oidc.CLIENT_PRODUCT_TAKEN`; `POST /oidc/link` answers `client.product`. An app made
  with the CLI gets `OIDC_PRODUCT`: its API refuses member and admin routes without a licence (403 `errors.NO_LICENSE`,
  `/me` shows the licence), and its home page shows the licence (`AppLicense` namespace, en, nl, fr, de) with a link to
  the licences of the organisation for the beheerder.
- **0.35.0**: an app linked to a login server gets its own backend. The backend choice is now "App voor een bestaande
  DafkeDD OIDC-server (koppelcode)" and installs `./backend` (NestJS, port 4001, `docs/api.md`) with its own PostgreSQL
  database on the server of the login server (asked after the link code, no Docker question). The API checks the access
  tokens of the login server on every route (`src/pasport`: a global guard, keys from its JWKS,
  `@Access('public' | 'account' | 'member' | 'admin')`, `@CurrentCaller()`), with `GET /me` and the example `notes` per
  organisation (`src/notes`, migrations, Row-Level Security as `<database>_tenant`, `npm run test:db`). New errors
  `NO_ORGANISATION`, `NOTE_NOT_FOUND` and validation `MAX_LENGTH` (en, nl, fr, de). The frontend calls its own API
  through `/api/app/...` and the API of the login server through `/api/backend/...` (`NEXT_PUBLIC_PASPORT_API_URL`,
  `src/lib/pasport.ts`); its home page shows the notes card (`Notes` namespace) and the status card of its own API.
  `postgres.ask` takes `shared` for a database on an existing server.
- **0.34.0**: one design everywhere (Pasport, built with DafkeDD UI). The frontend of the login server and every linked
  frontend get the same login screen and shell: `src/components/shell` (`AppPage`: sidebar, topbar with language, light
  or dark and the user menu; `AuthPage`: the login screen with the teal panel; `StartLogin`), `src/lib/nav.ts`
  (`APP_NAV`, the app's own pages) and `src/lib/brand.ts` (`BRAND`, `APP_NAME` of a linked app). The login screen says
  which app asks ("Log in to Planner") and shows eID, passkey and the other server first. With the OIDC login DafkeDD UI
  is always installed (all components); ESLint skips `src/components/ui` like Prettier; Hanken Grotesk and JetBrains
  Mono with `next/font`. A linked frontend's `/login` starts the login at once (registering only on the login server).
  Every colour comes from the DafkeDD UI tokens (light and dark); `header-nav.tsx` and the theme dropdown are gone (the
  shell replaces them). New texts: the `Shell` and `Nav` namespaces and `Oidc.loginTitleApp`, `orEmail`, `eidHint`,
  `passkeyHint` (en, nl, fr, de).
- **0.33.0**: link a new frontend to an existing DafkeDD login server with a link code. New backend choice "Bestaande
  DafkeDD OIDC-server (koppelcode)" (no backend folder): asks the address of the API, the port of the new frontend and
  the code, and calls `POST /oidc/link`, which uses the code once, adds the addresses of the new frontend to the app and
  answers its settings (a confidential app gets a new secret). The frontend gets only the login, session and profile
  pages, links to the account pages of the server (`OIDC_ACCOUNT_URL`), runs on its own port, and supports confidential
  apps (`OIDC_CLIENT_SECRET`). On the server: "Koppelcode" on `/admin` → Apps
  (`POST /admin/clients/:clientId/link-code`, 15 minutes, once, only its sha256 stored), migration 10
  (`oidc_link_codes`), audit `platform.client_link_code` and `platform.client_linked`. New apps on `/admin` have every
  scope ticked by default (also `tenant`).
- **0.32.1**: the test folders of the templates (`templates/backend-oidc/test`: the e2e and database tests and the
  virtual passkey device) are in the package again. `.npmignore` left out every folder called `test`, so a new backend
  missed `test/virtual-authenticator.ts` and `npm test` failed. Now only the tests of the CLI itself stay out, and a
  test checks that every template file is packed.
- **0.32.0**: apps on `/admin`. `GET/POST /admin/clients`, `PUT/PATCH/DELETE /admin/clients/:clientId` and
  `POST /admin/clients/:clientId/secret` (superadmins): make an app (public or confidential, a client id of your choice
  or made from the name), change it, a new secret (32 random bytes, shown once, only its sha256 stored), disable it (its
  refresh tokens and codes stop at once; its access tokens no longer reach the API) and remove it once disabled.
  Migration 9: `source`, `disabled_at` and `created_by` on `oidc_clients`; the clients file never overwrites an app made
  on `/admin`. Audit log: `platform.client_*`. The card "Apps" on `/admin` with the texts in four languages.
- **0.31.0**: applications of others and back-channel logout. Clients with `"firstParty": false` get a consent screen
  after the login (HTML page of the API and the login page of the frontend; `POST /oidc/interaction/:id/consent`), with
  `prompt=consent`, more scopes than before and `consent_required` for `prompt=none`. `GET /me/consents` and
  `DELETE /me/consents/:clientId` (revokes the refresh tokens of that application), "Applications with access" on
  `/security`. Back-channel logout: `backchannelLogoutUri` per client, logout tokens (`typ: logout+jwt`, `sid`, the
  logout event) queued by a trigger whenever a session ends and delivered with retries (`OIDC_BACKCHANNEL_INTERVAL`);
  the frontend receives them on `/api/auth/backchannel-logout`. Migration 8: `oidc_consents`, `oidc_session_clients`,
  `oidc_logout_queue`. Audit log: `account.consent_granted`, `account.consent_revoked`, `login.backchannel_failed`.
- **0.30.0**: passkeys (WebAuthn). `/security` adds, renames and removes passkeys (`GET/POST /me/passkeys`,
  `POST /me/passkeys/options`, `PATCH/DELETE /me/passkeys/:id`); the login page has "Log in with a passkey"
  (`POST /oidc/interaction/:id/passkey/challenge` and `/passkey`), which counts as two-step verification (amr
  `pop user mfa`, acr loa2). Our own strict CBOR decoder and WebAuthn checks on `node:crypto` (challenge used once,
  origin, domain, user verification, user handle, signature counter against cloned keys). Migration 7: `user_passkeys`.
  `OIDC_PASSKEYS`, `OIDC_PASSKEY_RP_ID` and `OIDC_PASSKEY_ORIGINS` in `.env`. Audit log: `account.passkey_added`,
  `account.passkey_removed` and logins with method passkey. Tests with a virtual authenticator.
- **0.29.0**: log in with another OpenID Connect server (federation). New CLI question; `OIDC_EXTERNAL_*` in `.env`;
  `POST /oidc/interaction/:id/external`, `GET /oidc/external/callback` and `POST /oidc/interaction/:id/resume`. Our own
  client code (discovery, PKCE, state, nonce, client_secret_basic) and ID token check (RS/PS/ES 256-512 with its JWKS,
  issuer, audience, azp, expiry, nonce). Accounts are linked by an HMAC of issuer and subject (migration 6), or by a
  verified email address at the first login. `OIDC_EXTERNAL_ONLY` (no password, eID or registration here) and
  `OIDC_EXTERNAL_MFA` (external, trust, local). Login page of the frontend and of the API with "Log in with <name>".
- **0.28.1**: a superadmin who is logged in to the platform (without an organisation) and opens `/members` or
  `/licenses` goes to the platform page (`/admin`) to open an organisation there, instead of getting an error message.
- **0.28.0**: audit log. Every login (also failed ones), account change, member change, platform change and licence
  change is recorded with who, about whom, the organisation, the details, the IP address and the browser
  (`AuditService`, global). Migration 5: `audit_events`, append-only (a trigger refuses UPDATE, DELETE and TRUNCATE),
  Row-Level Security, purged after `AUDIT_RETENTION_DAYS`. `GET /tenants/current/audit` (admins), `GET /admin/audit`
  (superadmins, also failed logins) and `GET /me/audit`; `/audit` in the frontend and "Recent activity" on `/security`.
  The frontend passes the IP address and browser of the user to the API (`X-Forwarded-For`, trusted from `TRUST_PROXY`).
- **0.27.1**: works with npm 12. npm 12 refuses packages from a URL (`allow-remote=none`): when it does, the backend and
  the frontend get a `.npmrc` with `allow-remote=root` (only the packages in their own package.json, like DafkeDD eID),
  so the installation and every `npm install` after it work. npm 12 also skips install scripts and warns about each one:
  `allowScripts` in package.json denies the ones that are not needed (their binaries come with the package), so there
  are no warnings.
- **0.27.0**: licences and payments. Products per organisation, per product and per user (seats), per month or per year
  (a year must be cheaper), with Mollie (first payment, mandate, subscription; more seats prorated, fewer at once,
  cancel at the end of the period, webhook and a status check from the return page) or a fake checkout for development.
  A 14-day trial for every new member (`BILLING_TRIAL_DAYS`), extendable by a superadmin. Superadmins manage products,
  discount codes (percentage or amount, once, repeating or forever, 100% is free) and free seats. `@License(code)`
  guard, `/me/licenses`, `/licenses` and `/licenses/return` in the frontend, products and codes on `/admin`. Migration
  4: products, subscriptions, trials, seats, free seats, discount codes and payments, with RLS.
- **0.26.0**: sessions and tokens. Refresh tokens (rotation, reuse detection with a grace of 30 seconds, bound to the
  session; the frontend renews its access token in `src/proxy.ts` and stays logged in for 12 hours), RP-initiated logout
  (`/oidc/logout`, with a "Log out?" page when no `id_token_hint` is sent), revocation (`/oidc/revoke`), introspection
  (`/oidc/introspect`, confidential clients), `sid` in every token and a session check on every API call, and
  `/me/sessions` (list, end one, log out everywhere else) on `/security`. Migration 3: `oidc_refresh_tokens` and a
  public id, browser and last use per session. Clients get `grantTypes`.

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
