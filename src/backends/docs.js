/**
 * Documentation that is generated into ./backend (README.md). It lists EVERY endpoint with its request, response and
 * errors, so the documentation always matches what was installed. The tests check that every route of the generated
 * controllers appears here and in Swagger (/docs).
 */

import { endpoints as oidcEndpoints, DEMO_PORT } from './oidc.js'

const fence = '```'
const json = value => JSON.stringify(value, null, 2)

const USER = {
    id: '1fb82908-476c-4460-951a-0fae1f01fcc6',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    createdAt: '2026-10-12T10:03:11.436Z'
}

/**
 * Every endpoint of the generated backend. `errors` are [status, translation key].
 * The same list is used to write the README, and the tests compare it with the controllers.
 */
export const endpoints = ({ database = null, auth = false, oidc = false, port = 4000 } = {}) => [
    {
        method: 'GET',
        path: '/',
        tag: 'app',
        summary: 'Greeting in the language of the request. Shows how the language detection works.',
        // The example request asks for Dutch (Accept-Language: nl), so the response is Dutch too
        response: { status: 200, example: { message: 'Hallo vanuit de API!', language: 'nl' } },
        errors: []
    },
    {
        method: 'GET',
        path: '/health',
        tag: 'health',
        summary: database ? 'Is the API running and does the database answer?' : 'Is the API running?',
        response: { status: 200, example: database ? { status: 'ok', database: 'up' } : { status: 'ok' } },
        errors: database ? [[503, 'errors.DATABASE_UNAVAILABLE']] : []
    },
    {
        method: 'POST',
        path: '/examples',
        tag: 'examples',
        summary: 'Example with validation: invalid input gives a translated 400. Nothing is stored.',
        body: {
            example: { name: 'Ada', email: 'ada@example.com' },
            fields: [
                ['name', 'string', 'required, at least 2 characters'],
                ['email', 'string', 'required, a valid email address']
            ]
        },
        response: { status: 201, example: { id: 1, name: 'Ada', email: 'ada@example.com' } },
        errors: [[400, 'errors.BAD_REQUEST']]
    },
    {
        method: 'GET',
        path: '/examples/:id',
        tag: 'examples',
        summary: 'Example of a translated exception: always answers 404.',
        response: null,
        errors: [[404, 'errors.EXAMPLE_NOT_FOUND']]
    },
    ...(auth
        ? [
              {
                  method: 'POST',
                  path: '/auth/register',
                  tag: 'auth',
                  summary: 'Create an account and log in: the session cookie is set. Rate limited.',
                  body: {
                      example: { name: 'Ada Lovelace', email: 'ada@example.com', password: 'a-long-password' },
                      fields: [
                          ['name', 'string', 'required, at most 100 characters'],
                          ['email', 'string', 'required, a valid email address (at most 254), stored in lower case'],
                          ['password', 'string', 'required, 8 to 128 characters']
                      ]
                  },
                  response: { status: 201, example: USER },
                  errors: [
                      [400, 'errors.BAD_REQUEST'],
                      [409, 'errors.EMAIL_TAKEN'],
                      [429, 'errors.TOO_MANY_REQUESTS']
                  ],
                  cookie: 'sets'
              },
              {
                  method: 'POST',
                  path: '/auth/login',
                  tag: 'auth',
                  summary: 'Log in: the session cookie is set. Rate limited.',
                  body: {
                      example: { email: 'ada@example.com', password: 'a-long-password' },
                      fields: [
                          ['email', 'string', 'required, a valid email address'],
                          ['password', 'string', 'required, at most 128 characters']
                      ]
                  },
                  response: { status: 200, example: USER },
                  errors: [
                      [400, 'errors.BAD_REQUEST'],
                      [401, 'errors.INVALID_CREDENTIALS'],
                      [429, 'errors.TOO_MANY_REQUESTS']
                  ],
                  cookie: 'sets'
              },
              {
                  method: 'POST',
                  path: '/auth/logout',
                  tag: 'auth',
                  summary: 'Log out: the session cookie is cleared.',
                  response: { status: 200, example: { status: 'ok' } },
                  errors: [],
                  cookie: 'clears'
              },
              {
                  method: 'GET',
                  path: '/auth/me',
                  tag: 'auth',
                  summary: 'The logged in user, read from the database. Needs the session cookie.',
                  response: { status: 200, example: USER },
                  errors: [[401, 'errors.UNAUTHORIZED']],
                  cookie: 'needs'
              }
          ]
        : []),
    ...(oidc ? oidcEndpoints({ port }) : [])
]

/** A form body as it is sent: a=1&b=2 */
export const formBody = example => new URLSearchParams(example).toString()

const curlFor = (endpoint, { port }) => {
    if (endpoint.curl) return endpoint.curl
    const parts = ['curl']
    if (endpoint.method !== 'GET') parts.push(`-X ${endpoint.method}`)
    if (endpoint.cookie === 'sets' || endpoint.cookie === 'clears') parts.push('-c cookies.txt')
    if (endpoint.cookie === 'needs' || endpoint.cookie === 'clears') parts.push('-b cookies.txt')
    parts.push("-H 'Accept-Language: nl'")
    if (endpoint.bearer) parts.push('-H "Authorization: Bearer $ACCESS_TOKEN"')
    if (endpoint.body && endpoint.form) {
        parts.push("-H 'Content-Type: application/x-www-form-urlencoded'")
        parts.push(`-d '${formBody(endpoint.body.example)}'`)
    } else if (endpoint.body) {
        parts.push("-H 'Content-Type: application/json'")
        parts.push(`-d '${JSON.stringify(endpoint.body.example)}'`)
    }
    parts.push(
        `http://localhost:${port}${endpoint.path.replace(':id', endpoint.path.startsWith('/oidc/') ? 'ID' : '7')}`
    )
    return parts.join(' ')
}

const errorTable = (list, messages) => {
    if (list.length === 0) return ''
    const rows = list.map(([status, key]) => `| ${status} | \`${key}\` | ${messages[key] ?? ''} |`)
    return [
        '**Errors** (the `message` is translated):',
        '',
        '| Status | `error` | Message (English) |',
        '| --- | --- | --- |',
        ...rows,
        ''
    ].join('\n')
}

/**
 * README.md of the generated backend.
 * `translations` is { en: { errors: {...} } } (all error texts of this backend, English is enough for the tables).
 */
export function backendReadme({
    database = null,
    auth = false,
    oidc = false,
    tenantRole = null,
    port = 4000,
    origin = 'http://localhost:3000',
    table = null,
    translations
}) {
    const list = endpoints({ database, auth, oidc, port })
    const errorMessages = Object.fromEntries(
        Object.entries(translations.en.errors).map(([key, text]) => [`errors.${key}`, text])
    )

    const sections = list.map(endpoint => {
        const lines = [`### ${endpoint.method} ${endpoint.path}`, '', endpoint.summary, '']
        if (endpoint.cookie === 'sets') lines.push('Sets the `session` cookie (httpOnly, SameSite=Lax).', '')
        if (endpoint.cookie === 'clears') lines.push('Clears the `session` cookie.', '')
        if (endpoint.cookie === 'needs')
            lines.push('Needs the `session` cookie from `/auth/login` or `/auth/register`.', '')
        if (endpoint.query) {
            lines.push(
                '**Query parameters:**',
                '',
                '| Parameter | | Meaning |',
                '| --- | --- | --- |',
                ...endpoint.query.map(([name, need, text]) => `| \`${name}\` | ${need} | ${text} |`),
                ''
            )
        }
        if (endpoint.body) {
            lines.push(
                endpoint.form ? '**Body** (form-encoded, `application/x-www-form-urlencoded`):' : '**Body** (JSON):',
                '',
                '| Field | Type | Rules |',
                '| --- | --- | --- |',
                ...endpoint.body.fields.map(([name, type, rules]) => `| \`${name}\` | ${type} | ${rules} |`),
                ''
            )
        }
        lines.push('**Example:**', '', `${fence}bash`, curlFor(endpoint, { port }), fence, '')
        if (endpoint.response) {
            lines.push(
                `**Response ${endpoint.response.status}:**`,
                '',
                `${fence}json`,
                json(endpoint.response.example),
                fence,
                ''
            )
        }
        const errors = errorTable(endpoint.errors, errorMessages)
        if (errors) lines.push(errors)
        if (endpoint.oauthErrors) {
            lines.push(
                `**OAuth errors** (\`{ "error": "...", "error_description": "..." }\`, or \`?error=\` on the redirect): ${endpoint.oauthErrors.map(code => '`' + code + '`').join(', ')}.`,
                ''
            )
        }
        return lines.join('\n')
    })

    const env = [
        ['PORT', String(port), 'Port of the API'],
        ['CORS_ORIGIN', origin, 'Origins that may call the API from a browser (comma separated)'],
        ...(database
            ? [
                  ['DATABASE_HOST', database.host, 'Database host'],
                  ['DATABASE_PORT', String(database.port), 'Database port'],
                  ['DATABASE_USER', database.user, 'Database user'],
                  ['DATABASE_PASSWORD', '(secret)', 'Database password'],
                  ['DATABASE_NAME', database.database, 'Database name']
              ]
            : []),
        ...(auth
            ? [
                  [
                      'JWT_SECRET',
                      '(generated)',
                      'Secret that signs the session cookie. Keep it private; use another one in production'
                  ],
                  ['AUTH_RATE_LIMIT', '10', 'Maximum login and register attempts per minute per IP address']
              ]
            : []),
        ...(oidc
            ? [
                  [
                      'OIDC_ISSUER',
                      `http://localhost:${port}/oidc`,
                      'Public base URL of the login server (the `iss` of every token)'
                  ],
                  [
                      'OIDC_AUDIENCE',
                      `http://localhost:${port}`,
                      'The `aud` of access tokens: the API that accepts them'
                  ],
                  [
                      'OIDC_MASTER_KEY',
                      '(generated)',
                      'Encrypts the private signing keys in the database. 64 hex characters; keep it secret and backed up'
                  ],
                  ['OIDC_LOGIN_RATE_LIMIT', '10', 'Login attempts per minute, per IP address and per email address'],
                  ['OIDC_BOOTSTRAP_TENANT', '(your answer)', 'Name of the first tenant, created at the first start'],
                  ['OIDC_BOOTSTRAP_ADMIN_EMAIL', '(your answer)', 'Email address of the first admin'],
                  [
                      'OIDC_BOOTSTRAP_ADMIN_PASSWORD_HASH',
                      '(generated)',
                      'scrypt hash of the temporary password the CLI showed once'
                  ],
                  ['OIDC_CLIENTS_FILE', 'config/oidc-clients.json', 'The registered clients (optional)']
              ]
            : [])
    ]

    const scripts = [
        ['npm run start:dev', 'Start the API and restart on changes'],
        ['npm run build', 'Compile to `dist/`'],
        ['npm run start:prod', 'Run the compiled API'],
        ['npm run lint', 'Lint'],
        ['npm test', 'Unit tests'],
        ['npm run test:e2e', 'End-to-end tests (no database needed)'],
        ['npm run format', 'Format with Prettier (`format:check` only checks)'],
        ...(database
            ? [['npm run db:check', 'Test the database connection (creates the database when it does not exist)']]
            : []),
        ...(oidc
            ? [
                  ['npm run test:db', 'Tests against the real PostgreSQL: tenant isolation (RLS) and storage'],
                  ['npm run oidc:user', 'Add a user to a tenant (see "OpenID Connect")'],
                  ['npm run oidc:demo', `A small client to try the login on http://localhost:${DEMO_PORT}`]
              ]
            : []),
        ...(database?.mode === 'docker'
            ? [
                  ['npm run db:up', 'Start PostgreSQL in Docker and wait until it is healthy'],
                  ['npm run db:down', 'Stop it (the data stays in a volume)'],
                  ['npm run db:logs', 'Follow the PostgreSQL logs']
              ]
            : [])
    ]

    return `# Backend (NestJS)

API on **http://localhost:${port}**. Interactive documentation (Swagger / OpenAPI): **http://localhost:${port}/docs**.

> This file is generated by DafkeDD_CLI and lists every endpoint. Keep it up to date when you add or change an endpoint
> (add the route to the controller with \`@ApiOperation\`, then describe it here).

## Start

${fence}bash
${database?.mode === 'docker' ? 'npm run db:up      # PostgreSQL in Docker\n' : ''}npm run start:dev
${fence}

${fence}
${scripts.map(([command, text]) => `${command.padEnd(20)} ${text.replaceAll('`', '')}`).join('\n')}
${fence}

## Configuration (.env)

Copy \`.env.example\` to \`.env\` on a new machine. \`.env\` is in \`.gitignore\`: never commit it.

| Variable | Default | Meaning |
| --- | --- | --- |
${env.map(([name, value, text]) => `| \`${name}\` | \`${value}\` | ${text} |`).join('\n')}

## Languages and errors

Every text the server sends back is translated (**en** default, **nl**, **fr**, **de**; files in
\`src/i18n/<language>/*.json\`, every language has the same keys). The language is chosen per request, in this order:

1. \`?lang=nl\` in the URL
2. the \`x-lang: nl\` header
3. the \`Accept-Language\` header (what a browser sends; \`nl-BE\` becomes \`nl\`)
4. otherwise English

Every error has the same shape. \`error\` is the translation key (stable, use it in code), \`message\` is the text in the
language of the request (show it to the user):

${fence}json
{
  "statusCode": 404,
  "error": "errors.EXAMPLE_NOT_FOUND",
  "message": "Voorbeeld 7 werd niet gevonden",
  "path": "/examples/7",
  "timestamp": "2026-10-12T10:03:11.436Z"
}
${fence}

Validation errors (400) have the same shape; \`message\` is then a list of translated texts, one per problem.

To add an error: add the key to \`errors.json\` in **all four** languages and throw
\`new AppException('errors.YOUR_KEY', HttpStatus.CONFLICT, { placeholder: 'value' })\`.
${
    database
        ? `
## Database (PostgreSQL)

No ORM: \`DatabaseService\` (\`src/database\`) wraps the plain [\`pg\`](https://node-postgres.com) driver. Inject it and
write your own SQL with parameters:

${fence}ts
const { rows } = await this.database.query('SELECT * FROM things WHERE id = $1', [id]);
${fence}

Never put user input in the SQL text, always use \`$1, $2, ...\`.${
              table
                  ? `

### Users table

ONE table, named after the database followed by \`users\`: **\`${table}\`**. The API creates it (and a unique index on
\`lower(email)\`) the first time it starts, or on first use when the database was down at startup.

| Column | Type | Meaning |
| --- | --- | --- |
| \`id\` | uuid | Primary key, generated by PostgreSQL |
| \`name\` | text | Display name |
| \`email\` | text | Unique, case-insensitive |
| \`password_hash\` | text | \`scrypt$<cost>$<salt>$<hash>\`, never the password |
| \`created_at\` | timestamptz | Set on insert |`
                  : ''
          }
`
        : ''
}${
        auth
            ? `
## Login

1. \`POST /auth/register\` or \`POST /auth/login\` answer with the user and set a \`session\` cookie (a signed JWT, valid for 7
   days). The cookie is **httpOnly** (scripts cannot read it) and **SameSite=Lax**, and **Secure** when
   \`NODE_ENV=production\`.
2. The browser sends the cookie along automatically (in \`fetch\`: \`credentials: 'include'\`). \`GET /auth/me\` returns the user.
3. \`POST /auth/logout\` clears the cookie.

Passwords are hashed with scrypt (random salt per password). Login and register are limited to \`AUTH_RATE_LIMIT\`
attempts per minute per IP address. An unknown email address gives the same error, and takes as long, as a wrong
password.

To protect your own endpoint: \`@UseGuards(AuthGuard)\` and read \`request.userId\` (see \`GET /auth/me\`).

For production: HTTPS, a long random \`JWT_SECRET\`, your real \`CORS_ORIGIN\`, the frontend and the API on the same site
(for example \`app.example.com\` and \`api.example.com\`) and, behind a reverse proxy, Express's \`trust proxy\`.
`
            : ''
    }
${oidc ? oidcSection({ port, tenantRole }) : ''}## Endpoints

CORS allows ${'`' + origin + '`'} (change \`CORS_ORIGIN\`). Examples use \`-H 'Accept-Language: nl'\`; leave it out for English.

${sections.join('\n')}
## Tests

Unit tests (\`npm test\`) and end-to-end tests (\`npm run test:e2e\`) never need a database${auth ? ' (the users table is replaced by an in-memory fake)' : ''}${oidc ? ' (the OpenID Connect data is kept in memory)' : ''}.${oidc ? '\n`npm run test:db` runs the Row-Level Security and storage tests against the real PostgreSQL from `.env`: it creates a\nseparate `<DATABASE_NAME>_test` database and removes it afterwards.' : ''}
Add a test for every endpoint you add, and for every translated error in all four languages.
`
}

/** The README section about the OpenID Connect server and multi-tenancy. */
function oidcSection({ port, tenantRole }) {
    return `
## OpenID Connect (login server)

This backend is also an **OpenID Connect provider**: other applications (your frontend, a mobile app, another server)
let their users log in here and receive signed tokens. Discovery:
**http://localhost:${port}/oidc/.well-known/openid-configuration**. Every client library that speaks OpenID Connect
finds all endpoints there.

### Try it

1. Start the API (\`npm run start:dev\`). The first start creates the tables, the signing keys, the clients of
   \`config/oidc-clients.json\` and the first tenant with its admin (the email and temporary password the CLI showed).
2. \`npm run oidc:demo\` and open **http://localhost:${DEMO_PORT}**: a small client (\`scripts/oidc-demo.mjs\`, no
   dependencies) redirects you to the login page, exchanges the code and shows the verified ID token and the userinfo.
3. Add users: \`npm run oidc:user -- --email ada@example.com --name "Ada" --tenant acme --roles admin\` (creates the tenant
   when it does not exist; prints a random password once, or use \`--password\`).

### How a login works (authorization code flow with PKCE)

1. The client sends the browser to \`/oidc/authorize\` with \`client_id\`, an exact registered \`redirect_uri\`,
   \`scope=openid ...\`, \`state\`, \`nonce\` and a PKCE \`code_challenge\` (S256, **required for every client**).
2. The server stores the request (10 minutes) and shows the login page \`/oidc/interaction/<id>\` in the language of the
   browser (or \`ui_locales\`). Email and password are checked (scrypt); attempts are limited per IP and per email.
3. A user that belongs to several tenants chooses one (or \`tenant_hint\` decides). Users without an active tenant cannot
   log in.
4. The browser gets the \`oidc_session\` cookie (httpOnly, SameSite=Lax, Path=/oidc, 12 hours) and is sent back to the
   client with \`code\`, \`state\` and \`iss\`. A next login of the same browser skips the password, unless the client
   asks \`prompt=login\` or \`max_age\`.
5. The client exchanges the code (once, within 60 seconds) at \`/oidc/token\` with its \`code_verifier\`, and gets:

| Token | Format | Lifetime | Contents |
| --- | --- | --- | --- |
| ID token | JWT, RS256, \`aud\` = client | 5 minutes | \`sub\`, \`auth_time\`, \`nonce\`, \`acr\` (\`loa1\`), \`amr\` (\`pwd\`), \`sid\`, \`at_hash\`, \`tenant\` |
| Access token | JWT, ES256, \`typ: at+jwt\` (RFC 9068), \`aud\` = \`OIDC_AUDIENCE\` | 10 minutes | \`sub\`, \`client_id\`, \`scope\`, \`tenant\` |

The \`tenant\` claim is \`{ "id": "...", "name": "Acme", "roles": ["admin"] }\`: the tenant the user chose, with the roles
of the user in that tenant. Verify tokens with the keys of \`/oidc/jwks\`, check \`iss\`, \`aud\` and \`exp\`, and take
the tenant only from a verified token, never from a header or the URL.

### Clients

\`config/oidc-clients.json\` lists the applications that may use the login (applied at every start):

| Field | Meaning |
| --- | --- |
| \`clientId\` | Name of the client (letters, digits, \`.\`, \`_\`, \`-\`) |
| \`type\` | \`public\` (browser and mobile apps: no secret, PKCE) or \`confidential\` (a server with a secret) |
| \`secretEnv\` | Confidential only: the \`.env\` variable with its secret (at least 32 characters); never in the file |
| \`redirectUris\` | Exact addresses the browser may be sent back to (https; http only on localhost) |
| \`scopes\` | Scopes the client may ask for: \`openid\`, \`profile\`, \`email\`, \`tenant\` |
| \`firstParty\` | Your own application (no consent screen) |

### Keys

One RS256 key signs ID tokens (required by OpenID Connect), one ES256 key signs access tokens. They are created at the
first start, stored in \`oidc_signing_keys\` with the private part encrypted (AES-256-GCM with \`OIDC_MASTER_KEY\`),
replaced after 90 days and kept in the JWKS for 14 more days. **Keep a backup of \`OIDC_MASTER_KEY\`**: without it the
stored keys cannot be used (new keys are then created and existing tokens stop working).

### Not in this version yet

Refresh tokens, logout, token revocation and introspection, MFA, a consent screen for external clients, and an admin
API and UI follow in the next phases. Tokens are short-lived until then: a client logs in again (without a password,
thanks to the session) when its access token expired.

## Multi-tenant (Row-Level Security)

Every table with customer data has a \`tenant_id\` and a PostgreSQL **Row-Level Security** policy. Run tenant code with
\`DatabaseService.withTenant(tenantId, ...)\`: it runs the queries in one transaction as the role
**\`${tenantRole}\`** (that owns nothing) with \`app.tenant_id\` set, so PostgreSQL itself only shows, changes and
inserts rows of that tenant, also when a query forgets \`WHERE tenant_id = ...\`:

${fence}ts
// No WHERE tenant_id: Row-Level Security filters (see src/tenants/tenant-members.service.ts)
const members = await this.database.withTenant(tenantId, (db) =>
  db.query('SELECT user_id, roles FROM tenant_members ORDER BY created_at'),
);
${fence}

- Take \`tenantId\` from the verified access token (\`tenant.id\`), never from user input.
- A new table with customer data gets \`tenant_id uuid NOT NULL REFERENCES tenants (id)\`, \`ENABLE ROW LEVEL SECURITY\`,
  the \`tenant_isolation\` policy and \`GRANT\`s for \`${tenantRole}\` in a new migration (\`src/database/migrations.ts\`), and
  its name in \`TENANT_TABLES\`. The tests fail when you forget one of these.
- \`DatabaseService.query()\` runs as the owner of the tables and sees everything: use it only for platform code
  (login, migrations).

### Tables

| Table | Contents | Tenant (RLS) |
| --- | --- | --- |
| users table (database name + \`users\`) | Accounts: email (unique, case-insensitive), name, scrypt hash, status | no: one account can be in several tenants |
| \`tenants\` | Organisations: \`slug\`, name, status (\`active\` or \`suspended\`) | yes |
| \`tenant_members\` | Which user is in which tenant, with roles | yes |
| \`oidc_clients\` | Registered clients (from \`config/oidc-clients.json\`) | no |
| \`oidc_signing_keys\` | Signing keys (private part encrypted) | no |
| \`oidc_interactions\` | Running logins (10 minutes) | no |
| \`oidc_sessions\` | Browser sessions (hash of the cookie) | yes |
| \`oidc_codes\` | Authorization codes (hash, once, 60 seconds) | yes |
| \`schema_migrations\` | Which migration ran, with a checksum | no |

Migrations run automatically at start, under an advisory lock (several instances can start at once). Never change a
migration that already ran: add a new one.
`
}
