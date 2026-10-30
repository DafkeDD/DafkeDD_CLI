---
name: postgresql
description: How to design and change the PostgreSQL side of what DafkeDD_CLI generates - migrations, tables, indexes, Row-Level Security, the tenant role, a database per organisation, queries and the db tests. Load it before any new table or column, a query that matters for speed or isolation, or a question about the data model.
---

The database of the generated backends: no ORM, plain SQL through `pg`, migrations in
`src/database/migrations.ts` (login server: `templates/backend-oidc`, app: `templates/backend-app`). Read `CLAUDE.md`
and the existing migrations first.

## The rules

- **Migrations** are applied in order at start-up, each in its own transaction, under an advisory lock, with a checksum.
  A migration that already shipped is **never** changed: add one with the next id. A module that adds a migration (like
  the files module) gets the next free id and must not clash with the user's own.
- **Multi-tenant.** Every table with data of an organisation has `tenant_id uuid NOT NULL`, an index that starts with
  `tenant_id`, Row-Level Security through `isolate('<table>')` and is listed in `TENANT_TABLES` (the db test checks
  that). All its queries run through `DatabaseService.withTenant()` (as the tenant role), and still say
  `WHERE tenant_id = $1`. With `TENANT_ISOLATION=database` the same migrations run in the database of each organisation:
  write them so they work in both.
- **Names.** The users table of the login server is `<database>users`; roles are prefixed with the database name (they
  are shared by the server); snake_case; timestamps `timestamptz` with `DEFAULT now()`.
- **Safety.** Only parameters (`$1`), never SQL built from input; identifiers that must be interpolated (a database
  name) are checked against a strict pattern first. Constraints in the database (`CHECK`, `NOT NULL`, foreign keys where
  they hold), not only in the code.
- **Speed.** An index for every lookup and every list (`tenant_id, created_at DESC`), `LIMIT` on lists, no N+1 queries.
- **Tests.** A db spec (`*.db-spec.ts`) against a real PostgreSQL for every new table and query: isolation between two
  organisations, the tenant role refused across tenants, migrations idempotent. `npm run verify` with `VERIFY_DB_*` runs
  them.

When it is built: stage it and start the checking agents (the `implement` skill); tell the security agent which
migrations and queries to look at.
