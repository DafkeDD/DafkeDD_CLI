---
name: postgresql
description: How to design and change the database of ./backend - migrations, tables, indexes, Row-Level Security, the tenant role, a database per organisation, queries and the db tests. Load it before any new table or column, a query that matters for speed or isolation, or a question about the data model.
---

The database of this project: plain SQL through `pg`, no ORM, migrations in `backend/src/database/migrations.ts`. Read
`CLAUDE.md` and the existing migrations first.

## The rules

- **Migrations** run in order at start-up, each in its own transaction, under an advisory lock, with a checksum. A
  migration that ran somewhere is **never** changed: add one with the next id.
- **Multi-tenant**: every table with data of an organisation has `tenant_id uuid NOT NULL`, an index starting with
  `tenant_id`, Row-Level Security through `isolate('<table>')` (in an app; it is exported from `migrations.ts`, the
  column defaults to `tenant_id`; on the login server it is local to `migrations.ts` and takes two arguments,
  `isolate('<table>', 'tenant_id')`) and is listed in `TENANT_TABLES` (`backend/src/database/database.constants.ts`;
  the db test checks it). Its queries run through `DatabaseService.withTenant()` and still say `WHERE tenant_id = $1`.
  With `TENANT_ISOLATION=database` the same migrations run in the database of every organisation: write them so they
  work in both.
- **Safety**: only parameters (`$1`), never SQL built from input; constraints in the database (`CHECK`, `NOT NULL`,
  foreign keys where they hold).
- **Speed**: an index for every lookup and list, `LIMIT` on lists, no N+1 queries.
- **Tests**: a db spec for every new table and query, against a real PostgreSQL (`npm run test:db` in `./backend`):
  isolation between two organisations, the tenant role refused across tenants, migrations idempotent.
- **Test data**: a new table gets its rows in the seed in the same change (the `seed` skill).

The PostgreSQL MCP (read-only) shows the real schema, the policies and the plans (`EXPLAIN`) of the database of
`backend/.env`; use it to check your migrations after `npm run start:dev` ran them, never to change data.

When it is built: stage it and start the checking agents (the `implement` skill); tell the security and the privacy
agent which migrations and queries you added and what to look at.
