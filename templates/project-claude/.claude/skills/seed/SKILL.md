---
name: seed
description: Make and keep the test data of this project - organisations, users with each role, realistic amounts of rows, and test accounts that log in automatically (also with two-step verification) - for the qa, kb and performance agents, the e2e tests and local development. Use it as /seed when a test needs data or an account, after a migration, or when the data no longer fits the app.
---

# Seed: the test data of this project

The test data of this project. The qa, kb and performance agents, the browser tests (the `e2e` skill) and Davey need it:
realistic, the same every time, and never real people.

On the login server `backend/scripts/demo-data.mjs` already exists (`npm run demo:data` adds demo organisations, users,
apps, invoices and tickets, `npm run demo:clear` takes them away again): build on it and keep it working rather than
writing a second script. In an app you create the seed script described below.

## What it keeps

- `backend/scripts/seed.mjs` and `"seed": "node scripts/seed.mjs"` in `backend/package.json`: fills the database of
  `backend/.env` with test data, idempotent (running it twice gives the same result), refusing to run when
  `NODE_ENV=production` or the host is not local (`localhost`, `127.0.0.1`, a Docker name), unless `SEED_FORCE=1`. It
  writes through the same SQL and `withTenant()` as the app, so Row-Level Security and the constraints hold.
- **Organisations**: at least two (A and B, to test the isolation), with fixed ids (uuids written in the script).
- **People per organisation**: an admin, a member with each role of `config/app-roles.json`, a member without a licence
  (to see the "no licence" screens), a disabled member when the app shows them.
- **Amounts**: enough rows to fill every list and its pages (`--size small|large`: tens for screenshots, tens of
  thousands for the performance agent), with realistic names, dates and texts in the four languages (no "test123").
  Never real personal data: invented names, `@example.com`, national numbers that cannot exist.
- **Test accounts** that can log in automatically, in `backend/.env.test` / `frontend/.env.test` (never committed, in
  `.gitignore`): e-mail, password and, for two-step verification, the TOTP secret of the authenticator app (only for
  these test accounts), so a test computes the code itself (`otpauth` or the RFC 6238 algorithm). On a login server of
  others (a linked app) the accounts are made there by Davey; ask for them and write only where they live.
- **Files and images** for the files module: a few small JPEG, PNG and PDF files in `backend/scripts/seed-files/`.

## How to work

- Read the migrations and `TENANT_TABLES` first: the seed follows the schema, and a new table gets its data in the same
  change.
- Check the result with the PostgreSQL MCP (read-only): every organisation has its rows, nothing crosses them.
- Document in `docs/api.md` (the README of the backend only points to `docs/`): `npm run seed` (or `demo:data`), the
  accounts (without passwords: where they are), the options.

When it is built: stage it and start the checking agents (the `implement` skill). Say what the seed now makes and how
others use it.
