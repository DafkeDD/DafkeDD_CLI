---
name: nestjs
description: How to build and change the NestJS API in ./backend - controllers, services, DTOs, guards, modules, translated errors, Swagger - with its unit, e2e and db tests and its docs. Load it before any change to an endpoint, a backend module or server-side behaviour.
---

The API of this project (`./backend`, NestJS). Read `CLAUDE.md` first, then the module next to the one you change (in a
linked app for example `backend/src/notes`) and follow its structure exactly. Some rules below only apply to the parts
this project has (the login server, a linked app, a database): skip what does not exist.

## The rules

- **Structure**: a module per feature (`*.module.ts`, `*.controller.ts`, `*.service.ts`, `*.dto.ts`); storage behind an
  interface with a PostgreSQL and an in-memory implementation, so the e2e tests need no database. ESM imports end in
  `.js`.
- **Input**: every body and query is a DTO with class-validator decorators and
  `i18nValidationMessage('validation.<KEY>')` messages; ids through `ParseUUIDPipe`.
- **Errors**: `throw new AppException('errors.<KEY>', HttpStatus.<STATUS>, args)`, the key in
  `backend/src/i18n/{en,nl,fr,de}/errors.json` with real translations (the `translator` skill).
- **Access**: every route says who may call it (in a linked app `@Public()`, `@Access(...)`, `@Roles(...)`; on the login
  server its guards); the organisation comes from the session or the access token (`@CurrentCaller()` in a linked app),
  never from the request; its data always through `withTenant()` when the project has organisations.
- **Swagger and docs**: `@ApiOperation` and the response decorators on every route; the endpoint (body, example,
  response, errors) in `docs/api.md` (the README of the backend only points to `docs/`).
- **Tests**: unit specs next to the code, an e2e spec over HTTP (`test/*.e2e-spec.ts`, supertest, in-memory stores, the
  test keys of `test/token.ts` in a linked app), a db spec (`test/*.db-spec.ts`) for every query (the `postgresql`
  skill).
- No warnings in `npm run build`, `npm run lint` or the tests; Prettier formats every file you edit.

When it is built: stage it and start the checking agents (the `implement` skill); tell the reviewer and the security
agent which files changed, which tests you added and what to look at.
