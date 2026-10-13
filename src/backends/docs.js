/**
 * Documentation that is generated into ./backend (README.md). It lists EVERY endpoint with its request, response and
 * errors, so the documentation always matches what was installed. The tests check that every route of the generated
 * controllers appears here and in Swagger (/docs).
 */

import { endpoints as oidcEndpoints } from './oidc.js'

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
    // A confidential client authenticates with client_secret_basic
    if (endpoint.basic) parts.push(`-u ${endpoint.basic}:$CLIENT_SECRET`)
    if (endpoint.body && endpoint.form) {
        parts.push("-H 'Content-Type: application/x-www-form-urlencoded'")
        parts.push(`-d '${formBody(endpoint.body.example)}'`)
    } else if (endpoint.body) {
        parts.push("-H 'Content-Type: application/json'")
        parts.push(`-d '${JSON.stringify(endpoint.body.example)}'`)
    }
    parts.push(
        `http://localhost:${port}${endpoint.pathExample ?? endpoint.path.replace(':id', endpoint.path.startsWith('/oidc/') ? 'ID' : '7')}`
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
    // Every namespace of the translations: errors.NOT_FOUND, oidc.INVALID_LINK, ...
    const errorMessages = Object.fromEntries(
        Object.entries(translations.en).flatMap(([namespace, texts]) =>
            Object.entries(texts).map(([key, text]) => [`${namespace}.${key}`, text])
        )
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
        // A second way to call the same endpoint (for example the refresh_token grant of /oidc/token)
        for (const variant of endpoint.variants ?? []) {
            lines.push(
                `**${variant.title}** (form-encoded):`,
                '',
                '| Field | Type | Rules |',
                '| --- | --- | --- |',
                ...variant.body.fields.map(([name, type, rules]) => `| \`${name}\` | ${type} | ${rules} |`),
                '',
                `${fence}bash`,
                curlFor({ ...endpoint, body: variant.body }, { port }),
                fence,
                ''
            )
        }
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
                  [
                      'OIDC_BOOTSTRAP_ADMIN_EMAIL',
                      '(your answer)',
                      'Email address of the superadmin, created at the first start'
                  ],
                  [
                      'OIDC_BOOTSTRAP_ADMIN_PASSWORD_HASH',
                      '(generated)',
                      'scrypt hash of the temporary password the CLI showed once'
                  ],
                  ['OIDC_LOGIN_UI_URL', '(empty)', 'Login page of the frontend; empty means the HTML page of the API'],
                  ['OIDC_CLIENTS_FILE', 'config/oidc-clients.json', 'The registered clients (optional)'],
                  [
                      'OIDC_MFA',
                      'required',
                      'Two-step verification (authenticator app) for every account; `optional` only for tests and demos'
                  ],
                  [
                      'OIDC_REGISTRATION',
                      'open',
                      '`open`: anyone can create an account (with a new organisation, password or eID); `eid`: only with the eID; `closed`: only by invitation'
                  ],
                  [
                      'OIDC_EID',
                      'test',
                      'Login with the Belgian eID: `off`, `on` (real cards, Belgian root CAs, OCSP) or `test` (also the virtual card of `npm run eid:mock`; refused in production)'
                  ],
                  [
                      'OIDC_EID_ORIGIN',
                      '(origin of APP_URL)',
                      'The website that asks for the PIN (the bridge signs its origin); only when it is not APP_URL'
                  ],
                  ['APP_URL', origin, 'The frontend: the links in emails open its pages'],
                  ['APP_NAME', '(project name)', 'Name of the application in emails'],
                  ['SMTP_HOST', 'localhost', 'Mail server; empty prints the mails in the console (development only)'],
                  ['SMTP_PORT', '1025', 'Port of the mail server (1025 is Mailpit; usually 587 or 465 in production)'],
                  ['SMTP_SECURE', 'false', '`true` for TLS from the start (port 465)'],
                  ['SMTP_USER', '(empty)', 'Login of the mail server, when it needs one'],
                  ['SMTP_PASSWORD', '(empty)', 'Password of the mail server'],
                  ['MAIL_FROM', '(project) <no-reply@example.com>', 'Sender of every email']
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
                  ['npm run mail:dev', 'Start Mailpit in Docker: every email at http://localhost:8025']
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

1. Start Mailpit (\`npm run mail:dev\`, needs Docker) and the API (\`npm run start:dev\`). The first start creates the
   tables, the signing keys, the clients of \`config/oidc-clients.json\` and the **superadmin** (the email and temporary
   password the CLI showed). There is no organisation yet: the superadmin needs none.
2. With the Next.js frontend: start it (\`npm run dev\` in \`./frontend\`) and open **http://localhost:3000**. "Log in" goes
   through this server and comes back to the frontend; \`/profile\` shows the user, the tenant and what the API answered.
   The login page itself is the page \`/login\` of the frontend (\`OIDC_LOGIN_UI_URL\`), which talks to the JSON variant of
   \`/oidc/interaction/...\`. Without a frontend the API shows its own HTML login page.
3. Log in as superadmin: the first login asks you to set up **two-step verification** (scan the QR code with an
   authenticator app). Without organisations you land on the platform (\`/admin\`): create the first organisation there,
   with the email of its admin, who gets an invitation.
   Create an account on **http://localhost:3000/register**: the email with the confirmation link arrives in Mailpit
   (**http://localhost:8025**). Invite colleagues on \`/members\`; as superadmin, manage every organisation on \`/admin\`.
4. Or add users from the command line: \`npm run oidc:user -- --email ada@example.com --name "Ada" --tenant acme --role
   admin\` (creates the tenant when it does not exist; prints a random password once, or use \`--password\`; add
   \`--superadmin\` for a platform administrator; \`--email ... --reset-mfa\` resets two-step verification).
5. Log in with the **Belgian eID**: start the virtual card reader with \`npm run eid:mock\` in \`./frontend\` (PIN
   \`1234\`), then choose "Register" > "With eID" or "Log in with eID" (see "Belgian eID" below).

### How a login works (authorization code flow with PKCE)

1. The client sends the browser to \`/oidc/authorize\` with \`client_id\`, an exact registered \`redirect_uri\`,
   \`scope=openid ...\`, \`state\`, \`nonce\` and a PKCE \`code_challenge\` (S256, **required for every client**).
2. The server keeps the request in an encrypted login cookie (10 minutes, see below) and sends the browser to the login
   page: \`/login?interaction=<id>\` of the frontend when \`OIDC_LOGIN_UI_URL\` is set, otherwise its own page
   \`/oidc/interaction/<id>\`, in the language of the browser (or \`ui_locales\`). Email and password are checked
   (scrypt), or the **Belgian eID** with its PIN (no second step needed, see below); attempts are limited per IP and per
   email. Then the **second step**: the 6-digit code of the authenticator
   app (or a recovery code). An account without two-step verification sets it up right there (QR code), before it gets
   a session.
3. Only an account with a verified email address can log in (said only after the right password, so it reveals
   nothing). A user that belongs to several tenants chooses one (or \`tenant_hint\` decides); a superadmin can choose
   every active tenant. Users without an active tenant cannot log in.
4. The browser gets the \`oidc_session\` cookie (httpOnly, SameSite=Lax, Path=/oidc, 12 hours) and is sent back to the
   client with \`code\`, \`state\` and \`iss\`. A next login of the same browser skips the password, unless the client
   asks \`prompt=login\` or \`max_age\`.
5. The client exchanges the code (once, within 60 seconds) at \`/oidc/token\` with its \`code_verifier\`, and gets:

| Token | Format | Lifetime | Contents |
| --- | --- | --- | --- |
| ID token | JWT, RS256, \`aud\` = client | 5 minutes | \`sub\`, \`auth_time\`, \`nonce\`, \`acr\` (\`loa2\` password and code, \`loa4\` eID), \`amr\`, \`sid\`, \`at_hash\`, \`tenant\`, \`superadmin\` |
| Access token | JWT, ES256, \`typ: at+jwt\` (RFC 9068), \`aud\` = \`OIDC_AUDIENCE\` | 10 minutes, and stops when its session ends | \`sub\`, \`client_id\`, \`scope\`, \`sid\`, \`tenant\`, \`superadmin\` |
| Refresh token | Random (only its sha256 is stored) | As long as its session (at most 12 hours), one use | Only for clients with the \`refresh_token\` grant (see "Sessions, refresh tokens and logout") |

The \`tenant\` claim is \`{ "id": "...", "name": "Acme", "role": "admin" }\`: the tenant the user chose, with the role
of the user there (\`user\` or \`admin\`). \`superadmin: true\` is only present for superadmins. Verify tokens with the
keys of \`/oidc/jwks\`, check \`iss\`, \`aud\` and \`exp\`, and take the tenant only from a verified token, never from a
header or the URL.

### Sessions, refresh tokens and logout

A **session** is one browser that logged in (\`oidc_sessions\`, 12 hours). Every token carries it as \`sid\`, and the
API checks on every request that it is still active: ending a session stops its tokens **at once**, not only when they
expire.

| What | How |
| --- | --- |
| Refresh token | Clients with \`"grantTypes": ["authorization_code", "refresh_token"]\` in \`config/oidc-clients.json\` (the frontend) get one with the code. \`POST /oidc/token\` with \`grant_type=refresh_token\` gives a new access token, ID token **and refresh token**: the old one is used up (rotation). The account, the organisation and the role are checked again at every refresh. |
| Reuse | The next refresh token is derived from the current one (HMAC): a used refresh token that comes back within 30 seconds (two requests of the same browser at the same moment) gets the **same** successor, never a second chain. Later it counts as stolen: its whole family is revoked and the session ends. A code that is exchanged twice revokes the refresh tokens of its first exchange. |
| Log out | \`GET /oidc/logout\` (\`end_session_endpoint\`) with \`id_token_hint\` and a registered \`post_logout_redirect_uri\` ends the session of the browser and goes back to the client. Without a hint, or with an ID token of another login (its \`sid\` differs), the page "Log out?" asks first (a CSRF token bound to the session cookie). The frontend revokes its refresh token (\`POST /oidc/revoke\`) and then sends the browser there. |
| Your sessions | \`GET /me/sessions\` lists where the account is logged in (browser, organisation, how, when); \`DELETE /me/sessions/<id>\` ends one, \`DELETE /me/sessions\` all others. The frontend shows them on \`/security\`. |
| Revocation | \`POST /oidc/revoke\` (RFC 7009): a refresh token with its family. Access tokens are not revoked one by one: they live 10 minutes and stop with their session. |
| Introspection | \`POST /oidc/introspect\` (RFC 7662) for **confidential** clients (another backend that receives our access tokens): \`{ active, sub, scope, tenant, ... }\`, or \`{ active: false }\` for an expired token or an ended session. |

- A password reset, a superadmin resetting two-step verification, or an admin disabling a member ends the sessions of
  that account (in that organisation), and with them every token.
- Turning on two-step verification on \`/security\` ends every **other** session of the account.
- Switching organisation (\`tenant_hint\`) keeps the same session; \`/me/sessions\` shows the organisation it logged in
  to. The organisation of every token is checked again at every API call and every refresh.

### Roles: user, admin, superadmin

| Level | Stored in | May |
| --- | --- | --- |
| \`user\` | \`tenant_members.role\` | Use the application in the tenants they belong to |
| \`admin\` | \`tenant_members.role\` | Everything in **their own** tenant: invite people (and see, resend or withdraw open invitations), change roles, disable or enable members, remove members, see who is online |
| \`superadmin\` | \`is_superadmin\` on the account | Admin of **every** tenant (also new ones, without a membership row), or logged in without one (platform); create and suspend tenants; grant superadmin |

- **Disabled** members (\`tenant_members.status\`) stay members but cannot log in to that tenant or use its API; their
  sessions in that tenant end at once. An admin enables them again with one click.
- **Who is online**: every API request (and the heartbeat \`POST /me/heartbeat\` the frontend sends every minute while a
  page is open) writes \`tenant_members.last_seen_at\`, at most once a minute. A member is online after activity in the
  last 2 minutes; the members list also shows "last seen".
- **Open invitations** live in \`tenant_invitations\` (Row-Level Security per tenant) until they are accepted, withdrawn or
  expire: admins see them, send them again (a new link, 7 more days) or withdraw them (the link stops working).
- The first account (the one the CLI created) is superadmin, **without an organisation**: it logs in to the platform
  (a token without a \`tenant\` claim, \`superadmin: true\`), creates organisations on \`/admin\` and opens any of them
  with \`tenant_hint\` (no new password or code: the session proves who it is). With organisations its login offers
  "Platform management" next to them (\`tenant: "platform"\` in the choice, or \`tenant_hint=platform\`). A platform
  token only reaches \`@Access('superadmin')\` and \`@Access('account')\` (the own two-step verification) routes. Registration never makes a superadmin: only
  \`npm run oidc:user -- ... --superadmin\` or another superadmin (\`POST /admin/superadmins\`).
- A tenant always keeps at least one admin, and the platform at least one superadmin (checked under a database lock, so
  two changes at the same moment cannot both remove the last one).
- Protect your own endpoints with \`@Access()\` (any member), \`@Access('admin')\` or \`@Access('superadmin')\` from
  \`src/access/access.ts\`, and read the caller with \`@Auth() auth: AuthContext\` (\`userId\`, \`tenantId\`, \`role\`,
  \`superadmin\`). The guard checks the access token, and reads the role and the superadmin flag **from the database on
  every request**: a role taken away works at once, not only when the token expires. A suspended tenant has no access.

${fence}ts
@Controller('invoices')
@Access('admin')
export class InvoicesController {
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.invoices.list(auth.tenantId) // with DatabaseService.withTenant(auth.tenantId, ...)
  }
}
${fence}

### Two-step verification (required)

Every account logs in with its password **and** a code of an authenticator app (Google Authenticator, Microsoft
Authenticator, 1Password, ...): TOTP, RFC 6238, our own code on \`node:crypto\` (\`src/oidc/totp.ts\`, tested with the
official test vectors of RFC 4226 and RFC 6238). \`OIDC_MFA=required\` is the default; \`optional\` exists only for tests
and demos.

| Moment | What happens |
| --- | --- |
| First login | After the password the login page shows a **QR code** (and the key to type in by hand). The first code turns it on; then **ten recovery codes** are shown once, and only then the session starts. |
| Every next login | Password, then the 6-digit code (\`/oidc/interaction/<id>/mfa\`). A code works **once** (also two requests at the same moment); one step of clock drift (30 seconds) is accepted. |
| Phone not at hand | A recovery code (\`k7qm-2xpd\`) instead of the code; each works once. New ones: \`POST /me/mfa/recovery-codes\` or the page \`/security\` of the frontend. |
| Phone and codes lost | A superadmin resets it (\`DELETE /admin/users/<id>/mfa\`, or \`npm run oidc:user -- --email ... --reset-mfa\`); the account sets it up again at its next login. |

- The secret is stored encrypted (AES-256-GCM, key derived from \`OIDC_MASTER_KEY\`, bound to the account); recovery codes
  only as hashes. Attempts are rate limited per account.
- Tokens after two-step verification have \`acr: "loa2"\` and \`amr: ["pwd", "otp", "mfa"]\` (\`["pwd", "mfa"]\` with a
  recovery code). A browser session from before two-step verification was required does not count: it logs in again.
- Turning on ends the other sessions of the account; with \`required\` it can never be turned off
  (\`POST /me/mfa/disable\` answers 403 \`oidc.MFA_REQUIRED\`).

### Belgian eID (card reader and PIN)

Log in and register with the Belgian eID, like the federal login (CSAM) and Corilus Passport: the card and its PIN are
two factors, so an eID login needs no password and no authenticator code. It uses the **DafkeDD eID** library
(\`@dafkedd/eid\`, installed from https://github.com/DafkeDD/DafkeDD_EID) and the DafkeDD eID program (the *bridge*) on
the PC of the user, which talks to the card reader on http://127.0.0.1:47820.

| Step | What happens |
| --- | --- |
| 1. Nonce | The login page asks \`POST /oidc/interaction/<id>/eid/challenge\`: 32 random bytes, kept in the login cookie (registration and linking get an encrypted challenge of 5 minutes instead). |
| 2. PIN | The user types the PIN on the page; the bridge gives it to the card, which signs the nonce and the **origin of the page** (Web eID format). The PIN never reaches the server. |
| 3. Check | \`POST /oidc/interaction/<id>/eid\` with the token. \`src/oidc/eid.service.ts\` checks the signature, the origin (\`APP_URL\`), the nonce (once), the certificate chain up to the Belgian root CAs and the **OCSP** status (fail closed: no answer = no login). |
| 4. Account | The national register number of the certificate is turned into an **HMAC-SHA256** (key derived from \`OIDC_MASTER_KEY\`) and looked up in \`user_identifiers\`. The number itself is never stored. |
| 5. Login | As after password and code: organisation choice, session, tokens with \`acr: "loa4"\` and \`amr: ["sc", "pin", "mfa"]\`. |

| Flow | How |
| --- | --- |
| Register with eID | \`POST /oidc/account/eid/challenge\`, then \`POST /oidc/account/register-eid\` with the token, an email address and an organisation. The **name comes from the card**; there is no password. The email address must still be verified. One eID, one account (409 \`oidc.EID_ALREADY_LINKED\`). |
| Link to an existing account | On \`/security\` of the frontend (\`/me/eid/challenge\` and \`POST /me/eid\`): from then on the account logs in with password **or** eID. |
| Unlink | \`DELETE /me/eid\`; not when the account has no password (its eID is its only login: choose a password first with "forgot password"). |
| Password later | "Forgot password" works for an eID account too; then it can log in both ways (the password login asks the authenticator code as usual). |

- \`OIDC_EID=test\` (development, in \`.env\`) also trusts the test certificates of the virtual card
  (\`npm run eid:mock\` in the frontend: \`dafke-eid --mock --auth-origin http://localhost:3000\`, PIN 1234) and skips
  OCSP. The API refuses to start with \`test\` and \`NODE_ENV=production\`: use \`on\` there.
- **Users** install the DafkeDD eID program once (https://github.com/DafkeDD/DafkeDD_EID/releases/latest, Windows setup
  and macOS). It only lets websites ask a PIN that are in its list: install it with
  \`dafke-eid install --auth-origin https://app.example.com\` (or build the setup with your origin built in). The login
  page shows what is missing: the program, a card reader or the card.
- The hash in \`user_identifiers\` depends on \`OIDC_MASTER_KEY\`: another key means every eID has to be linked again.
  The national register number is personal data with legal rules for its use in Belgium: check with your DPO that
  your application may use it as a login key.

### Accounts: registration, email verification, forgotten password, invitations

| Flow | How |
| --- | --- |
| Registration | \`POST /oidc/account/register\` creates the account, a new tenant (the organisation name) and makes the account its admin. A verification email follows. \`OIDC_REGISTRATION=closed\` turns registration off (then people only join by invitation). |
| Email verification | The link (24 hours) opens \`/verify-email?token=...\` of the frontend, which calls \`POST /oidc/account/verify-email\`. Without a verified address an account cannot log in; the login page offers to send the email again. |
| Forgotten password | \`POST /oidc/account/forgot-password\` mails a link (1 hour) to \`/reset-password?token=...\`. The link works **once** (it holds a fingerprint of the old password hash), and every session of the account ends. |
| Invitations | An admin invites by email (\`POST /tenants/current/invitations\`, 7 days). \`/invite?token=...\` joins an existing account, or creates one with a name and password (already verified). The link stops working when the inviter is no longer admin or the tenant is suspended. |

- Registration, "forgot password" and "send again" always answer the same (202 \`check-email\`), so nobody can find out
  which email addresses have an account. Registering an address that has an account mails its owner instead.
- The links hold an **encrypted token** (AES-256-GCM, key derived from \`OIDC_MASTER_KEY\`, bound to its kind, with an
  expiry): there is no table for them.
- Rate limited per IP and per email address (\`OIDC_LOGIN_RATE_LIMIT\` per minute).
- Passwords: 12 to 128 characters, stored as a scrypt hash.

### Email (SMTP)

\`src/mail/mail.service.ts\` sends with \`nodemailer\` over SMTP (\`SMTP_*\` and \`MAIL_FROM\` in \`.env\`). The texts are in
\`src/i18n/<language>/mail.json\` (plain text and simple HTML, in the language of the user).

- **Development**: \`npm run mail:dev\` starts Mailpit in Docker; every email shows up on **http://localhost:8025** (the
  default \`.env\` sends to it on port 1025). Without Docker, leave \`SMTP_HOST\` empty: the emails (with their links) are
  printed in the console of the API.
- **Production**: fill in the SMTP server of your mail provider (for example port 587 with \`SMTP_SECURE=false\`, or 465
  with \`true\`), and a \`MAIL_FROM\` address of a domain that is set up for it (SPF, DKIM). A mail that cannot be sent is
  logged as an error, never with its contents.

### Login cookie (no table for running logins)

A running login (from \`/oidc/authorize\` until the code goes back to the client) is not stored in the database. It lives
in a cookie \`oidc_ia_<id>\`, one per login:

| Property | Value | Why |
| --- | --- | --- |
| Encryption | AES-256-GCM, with a key derived from \`OIDC_MASTER_KEY\` (HKDF, not the key of the signing keys) | Nobody can read or change it; the \`<id>\` is bound to it, so it never works for another login |
| Attributes | \`HttpOnly\`, \`SameSite=Lax\`, \`Secure\` in production, \`Path=/oidc/interaction/<id>\` | JavaScript cannot read it; only the requests of this login get it |
| Lifetime | 10 minutes, removed after the login | An old link says "expired" |
| One per login | The name contains the \`<id>\` | Logins in several tabs at once do not get in each other's way |
| No replay | \`oidc_sessions.interaction_hash\` is unique | A copy of the cookie cannot log in a second time; an ended session keeps its row for an hour |
| Size | About 0.7 KB, at most about 3 KB (limits on \`state\`, \`nonce\`, \`login_hint\`) | A request that would not fit (over 3800 characters) gets \`error=invalid_request\` |

**Production**: the frontend and the API must be on the same site (for example \`app.example.com\` and
\`auth.example.com\`): browsers do not send cookies from another site (\`app.example.com\` and \`api.other.com\`). This
was already so for the \`oidc_session\` cookie (single sign-on).

### Clients

\`config/oidc-clients.json\` lists the applications that may use the login (applied at every start):

| Field | Meaning |
| --- | --- |
| \`clientId\` | Name of the client (letters, digits, \`.\`, \`_\`, \`-\`) |
| \`type\` | \`public\` (browser and mobile apps: no secret, PKCE) or \`confidential\` (a server with a secret) |
| \`secretEnv\` | Confidential only: the \`.env\` variable with its secret (at least 32 characters); never in the file |
| \`redirectUris\` | Exact addresses the browser may be sent back to (https; http only on localhost) |
| \`postLogoutRedirectUris\` | Exact addresses the browser may go to after logging out (\`post_logout_redirect_uri\`) |
| \`grantTypes\` | \`authorization_code\` (default), and \`refresh_token\` to get refresh tokens |
| \`scopes\` | Scopes the client may ask for: \`openid\`, \`profile\`, \`email\`, \`tenant\` |
| \`firstParty\` | Your own application (no consent screen) |

### Keys

One RS256 key signs ID tokens (required by OpenID Connect), one ES256 key signs access tokens. They are created at the
first start, stored in \`oidc_signing_keys\` with the private part encrypted (AES-256-GCM with \`OIDC_MASTER_KEY\`),
replaced after 90 days and kept in the JWKS for 14 more days. **Keep a backup of \`OIDC_MASTER_KEY\`**: without it the
stored keys cannot be used (new keys are then created and existing tokens stop working).

### Not in this version yet

Passkeys, a consent screen for external clients, back-channel logout to other clients, an audit log and licences follow
in the next phases.

## Multi-tenant (Row-Level Security)

Every table with customer data has a \`tenant_id\` and a PostgreSQL **Row-Level Security** policy. Run tenant code with
\`DatabaseService.withTenant(tenantId, ...)\`: it runs the queries in one transaction as the role
**\`${tenantRole}\`** (that owns nothing) with \`app.tenant_id\` set, so PostgreSQL itself only shows, changes and
inserts rows of that tenant, also when a query forgets \`WHERE tenant_id = ...\`:

${fence}ts
// No WHERE tenant_id: Row-Level Security filters (see listMembers in src/oidc/store/pg-oidc.store.ts)
const members = await this.database.withTenant(tenantId, (db) =>
  db.query('SELECT user_id, role FROM tenant_members ORDER BY created_at'),
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
| users table (database name + \`users\`) | Accounts: email (unique, case-insensitive), verified or not, name, scrypt hash (empty for an eID-only account), status, \`is_superadmin\`, two-step verification (encrypted secret, last used step, hashed recovery codes) | no: one account can be in several tenants |
| \`tenants\` | Organisations: \`slug\`, name, status (\`active\` or \`suspended\`) | yes |
| \`tenant_members\` | Which user is in which tenant: role (\`user\` or \`admin\`), status (\`active\` or \`disabled\`), last seen | yes |
| \`tenant_invitations\` | Open invitations (email, role, who invited, expiry) | yes |
| \`user_identifiers\` | Linked eIDs: an HMAC of the national register number per account (one eID per account, one account per eID), linked and last used | no |
| \`oidc_clients\` | Registered clients (from \`config/oidc-clients.json\`) | no |
| \`oidc_signing_keys\` | Signing keys (private part encrypted) | no |
| \`oidc_sessions\` | Browser sessions: a public id (\`sid\`), the hash of the cookie and of the login that created it, the browser (User-Agent) and when it was last used; no tenant for a platform login | yes |
| \`oidc_codes\` | Authorization codes (hash, once, 60 seconds) | yes |
| \`oidc_refresh_tokens\` | Refresh tokens (hash), their family, session, client and organisation; used and revoked | yes |
| \`schema_migrations\` | Which migration ran, with a checksum | no |

Migrations run automatically at start, under an advisory lock (several instances can start at once). Never change a
migration that already ran: add a new one.
`
}
