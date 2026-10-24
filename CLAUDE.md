# DafkeDD_CLI

A Node ESM CLI (`npx github:DafkeDD/DafkeDD_CLI`) that scaffolds projects, always inside the project and never globally:

- a Next.js frontend in `./frontend`;
- a NestJS backend in `./backend` with PostgreSQL;
- the multi-tenant OpenID Connect login server **Pasport**, or an app linked to an existing Pasport server with a link
  code;
- a central `./docs` project.

The generated code lives in `src/**` (as strings) and in `templates/**` (as files). Read `CONTRIBUTING.md`: it explains
how the code is made testable.

## Rules (always)

- **Tests are mandatory.** Every change gets tests, written together with the code, and a bug fix starts with a failing
  regression test. Nothing is committed or pushed until everything is green.
- **Documentation is mandatory** and always extended:
    - `README.md`: usage plus a changelog line for the new version;
    - `version` bumped in `package.json` and `package-lock.json`;
    - every API endpoint of a generated backend has `@ApiOperation`, an entry in `src/backends/docs.js` (body, example,
      response, errors) and is in the central docs;
    - frontend calls are documented in `src/frontends/docs.js`.

    Documentation and code comments are written in English.

- **Translations**: every text of a generated app exists in en, nl, fr and de, with the same keys. English is the
  default.
- **Design**: every screen follows the **Pasport design**, always. The brand book is
  `templates/project-claude/.claude/design/pasport.md`, the tokens are
  `templates/project-claude/.claude/design/pasport-tokens.json`, and the source is the Claude Design System "Pasport"
  (https://claude.ai/artifact/QD82mLA9dWSEgtpubjgChq). It is built in `templates/frontend-oidc/src/styles/pasport.css`
  and `templates/frontend-oidc/src/components/pasport/` (ported from `D:\test`, the reference), with the shell in
  `templates/frontend-oidc/src/components/shell/`: every generated screen uses those (`AppPage`, `PageHead`,
  `AuthLayout`, `Btn`, ...), never another look, and works at phone width (390px) too.
  `templates/frontend-oidc/scripts/check-design.mjs` checks it in every project (`npm run check:design`, also in the
  CI), and `update` keeps the files of `DESIGN_FILES` (`src/frontends/oidc.js`) in step: a new design file goes in that
  list.
- **Protected by default**: every page of a generated frontend needs a login (`src/proxy.ts` sends it to `/login`); only
  `PUBLIC_PATHS` are open.
- **Prettier everywhere** (`.prettierrc`: 4 spaces, no semicolons, single quotes, width 120). There are no warnings in
  the build, lint or tests of a generated project.
- **Multi-tenant everywhere.**
    - Data of an organisation always goes through `withTenant()`.
    - Every tenant table has a `tenant_id`, Row-Level Security (`isolate()`) and is listed in `TENANT_TABLES`.
    - The users table is `<database>users`.
- **Migrations**: a migration that already shipped is never changed; add a new one.
- **Origin**: never copy code from Corilus (Passport, IAM, IAM manager) or other proprietary sources.
- **Git**: a branch per issue from `developer` (the default branch), merged back with a pull request. A merge to `main`
  creates a release; that is only done by Davey.

## Skills (`.claude/skills/`)

| Skill            | When                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `plan`           | A feature or change bigger than a few lines: ask every open question, then a spec issue and ticket issues     |
| `implement`      | Build one ticket on its branch: the checking agents, commit `closes #n`, pull request, merge into `developer` |
| `diagnose`       | An error, a failing build or test, wrong behaviour: reproduce, failing test, cause, fix                       |
| `handoff`        | A long session or a stop halfway: `.claude/handoff.md` for the next session                                   |
| `port-from-test` | Davey changed a generated project (`D:\test`, `D:\KidieFile`): bring the generic improvements into the CLI    |

## Agents (`.claude/agents/`)

They build and check; only the main session commits and pushes.

| Agent        | Role                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| `frontend`   | Builds every UI of the generated frontends, always in the Pasport design (`pasport.css`, `components/pasport`) |
| `nestjs`     | Builds the generated NestJS backends: endpoints, modules, DTOs, errors, Swagger, their tests and docs          |
| `postgresql` | Builds migrations, tables, Row-Level Security, a database per organisation, queries and db tests               |
| `reviewer`   | Checks the staged change against the ticket and every rule above (read-only)                                   |
| `tester`     | Runs `npm run format:check`, `npm test` and, for generated code, `npm run verify` (read-only)                  |
| `docs`       | Checks that README, changelog, version, API docs and frontend docs are complete (read-only)                    |
| `i18n`       | Checks en, nl, fr and de: same keys, real translations, no hardcoded text (read-only)                          |
| `security`   | Security review of login, tokens, tenants, billing, uploads, the database and the hooks (read-only)            |

## How work is done

1. **Plan** with `plan`: the questions first, then a spec issue and ticket issues on GitHub (`DafkeDD/DafkeDD_CLI`,
   labels from `npm run labels`).
2. **Build** a ticket with `implement`: the frontend, nestjs and postgresql agents (and the main session for `src/`),
   tests first.
3. **Check**: stage the change (`git add`, as a separate command), then start the checking agents in parallel on exactly
   that: `reviewer`, `tester`, `docs`, `i18n`, plus `security` for the sensitive parts. Each one records its approval
   for the staged tree (`node .claude/hooks/approve.mjs <kind>`). After any further change, they all run again.
4. **Commit and merge**: on the branch `issue/<n>-<words>` (made from `developer`), commit
   `<version>: <change> (closes #<n>)`, push the branch, open a pull request into `developer`. When the CI is green,
   merge it with `gh pr merge <n> --squash --delete-branch`. Never into `main` (a release), never forced.

The hooks in `.claude/settings.json` enforce this (`.claude/git-policy.json`: `issue-branches`, merge into `developer`):

- `guard-git.mjs`:
    - blocks a commit that lacks an approval (review, tests, docs, i18n, and security when a staged path touches login,
      tokens, tenants, billing, uploads, the database or the hooks), and a commit that is not on an issue branch;
    - blocks `git commit -a`, and staging and committing in one command;
    - blocks every push except a normal push of an issue branch (or `release/<version>`);
    - allows `gh pr merge` only into `developer`, from an issue branch, with every check green and every approval;
    - blocks `gh release` and `gh repo delete`.
- `format.mjs` runs Prettier on every file that is edited.
- The git hook `.githooks/pre-push` and the CI (`.github/workflows/ci.yml`) run the format check and the tests once
  more.

## Claude Code in the generated projects

- When the CLI asks "Claude Code toevoegen?" and the answer is yes, a project gets `templates/project-claude/` and more:
    - the agents, skills, hooks, design and issue forms;
    - `CLAUDE.md`, `.mcp.json` and the workflows (`ci.yml`, `release.yml`, `codeql.yml`, `screenshots.yml`), made by
      `src/claude.js`.
- There, work happens on a branch per issue (`.claude/git-policy.json`: `issue-branches`, merge into `developer`). An
  agent merges a pull request into `developer` only when the CI is green and every checking agent approved; `main` (a
  release) is for a person.
- The hooks of this repository (`.claude/hooks/`) are copies of `templates/project-claude/.claude/hooks/`: change the
  template, then copy them (`test/claude-hooks.test.js` fails when they differ).
- A change to an agent or a skill of the CLI often belongs in the projects' version too, and the other way round.
- Every file the CLI keeps up to date in a project comes from `managedFiles()` (`src/manifest.js`: Claude Code and
  Google Cloud). Existing projects get a change with `update` (`src/update.js`), which never overwrites a file the user
  changed; `doctor` (`src/doctor.js`) checks a project. A new managed file goes in `projectClaudeFiles()` or
  `cloudFiles()`, never written by a step of its own.

## Checking generated projects

- `npm run verify` generates three variants with the real steps of the CLI, in a temporary folder:
    - `pasport`: the login server;
    - `app`: an app without modules;
    - `app-full`: an app with mail, files and a database per organisation.
- Options:
    - `-- --only app-full` runs one variant;
    - `-- --keep` keeps the projects;
    - `-- --require-db` fails when the database cannot be reached.
- The database comes from `VERIFY_DB_HOST`, `VERIFY_DB_PORT`, `VERIFY_DB_USER` and `VERIFY_DB_PASSWORD`. The user needs
  `CREATEDB`. Without a database, `test:db` is skipped and the tester agent reports that.
- It needs the network (npm, GitHub for DafkeDD UI and the eID package) and takes several minutes.

## Related projects

- `D:\test`: Davey's test project, the source of the Pasport design. Changes made there are ported into the CLI with
  `port-from-test`.
- `C:\Users\Davey\Documents\Claude\Projects\Dafke-UI`: the component library, installed from its `developer` branch.
