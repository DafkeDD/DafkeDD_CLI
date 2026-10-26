/**
 * Documentation that is generated into ./backend (README.md). It lists EVERY endpoint with its request, response and
 * errors, so the documentation always matches what was installed. The tests check that every route of the generated
 * controllers appears here and in Swagger (/docs).
 */

import { appEndpoints } from './app.js'
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
export const endpoints = ({
    database = null,
    auth = false,
    oidc = false,
    app = null,
    appOptions,
    port = 4000
} = {}) => [
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
    ...(oidc ? oidcEndpoints({ port }) : []),
    ...(app ? appEndpoints(appOptions) : [])
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
    app = null,
    appOptions,
    tenantRole = null,
    port = 4000,
    origin = 'http://localhost:3000',
    table = null,
    translations
}) {
    const list = endpoints({ database, auth, oidc, app, appOptions, port })
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
                  ['DATABASE_NAME', database.database, 'Database name'],
                  [
                      'DATABASE_MAX_CONNECTIONS',
                      '20',
                      'The most connections of this API to PostgreSQL at the same time (on Google Cloud per instance)'
                  ]
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
                      'OIDC_EID_REQUIRED',
                      'off',
                      '`on`: every account must have its eID linked (registering only with the eID, a new account of an invitation reads it first, the API answers 403 `oidc.EID_REQUIRED` to an account without one except the routes to link it; superadmins never need one)'
                  ],
                  [
                      'OIDC_EID_ORIGIN',
                      '(origin of APP_URL)',
                      'The website that asks for the PIN (the bridge signs its origin); only when it is not APP_URL'
                  ],
                  [
                      'OIDC_PASSKEYS',
                      'on',
                      'Passkeys (WebAuthn: fingerprint, face or PIN, or a security key) on the login page and on /security; `off` hides them'
                  ],
                  [
                      'OIDC_PASSKEY_RP_ID',
                      '(host name of APP_URL)',
                      'The domain the passkeys belong to; a parent domain (example.com) lets subdomains use them too. Changing it later makes every passkey useless'
                  ],
                  [
                      'OIDC_PASSKEY_ORIGINS',
                      '(origin of APP_URL)',
                      'The websites that may use the passkeys (comma separated), e.g. the login page of the frontend'
                  ],
                  [
                      'OIDC_BACKCHANNEL_INTERVAL',
                      '5',
                      'Seconds between deliveries of back-channel logout tokens to the clients; `0` turns delivery off'
                  ],
                  [
                      'OIDC_EXTERNAL_ISSUER',
                      '(empty)',
                      'Another OpenID Connect server to log in with (Entra ID, Keycloak, Google, ...); empty: off'
                  ],
                  ['OIDC_EXTERNAL_CLIENT_ID', '(empty)', 'Our client id at that server'],
                  ['OIDC_EXTERNAL_CLIENT_SECRET', '(empty)', 'Our secret there; empty: a public client (PKCE)'],
                  ['OIDC_EXTERNAL_NAME', '(its host name)', 'The button: "Log in with <name>"'],
                  ['OIDC_EXTERNAL_ONLY', 'false', '`true`: only that server (no password, eID or registration here)'],
                  [
                      'OIDC_EXTERNAL_MFA',
                      'external',
                      'Two-step verification there counts: `external` when its token says so (amr mfa), `trust` always, `local` never'
                  ],
                  [
                      'OIDC_EXTERNAL_LINK_EMAIL',
                      'true',
                      'A first login with a verified email address joins the account with that address'
                  ],
                  ['APP_URL', origin, 'The frontend: the links in emails open its pages'],
                  ['APP_NAME', '(project name)', 'Name of the application in emails'],
                  ['SMTP_HOST', 'localhost', 'Mail server; empty prints the mails in the console (development only)'],
                  ['SMTP_PORT', '1025', 'Port of the mail server (1025 is Mailpit; usually 587 or 465 in production)'],
                  ['SMTP_SECURE', 'false', '`true` for TLS from the start (port 465)'],
                  ['SMTP_USER', '(empty)', 'Login of the mail server, when it needs one'],
                  ['SMTP_PASSWORD', '(empty)', 'Password of the mail server'],
                  ['MAIL_FROM', '(project) <no-reply@example.com>', 'Sender of every email'],
                  [
                      'PAYMENTS',
                      'fake',
                      'Buying licences: `mollie`, `fake` (a checkout page of the API, refused in production) or `off`'
                  ],
                  [
                      'MOLLIE_API_KEY',
                      '(empty)',
                      'API key of Mollie (`test_...` while testing, `live_...` in production)'
                  ],
                  ['BILLING_TRIAL_DAYS', '14', 'Days of a demo a member asks (a superadmin can extend one trial)'],
                  [
                      'PUBLIC_API_URL',
                      '(origin of OIDC_ISSUER)',
                      'Public address of the API: Mollie calls `/billing/webhook` there (not on localhost)'
                  ],
                  [
                      'AUDIT_RETENTION_DAYS',
                      '365',
                      'Days an event of the audit log is kept (purged daily; `0` keeps all)'
                  ],
                  [
                      'TRUST_PROXY',
                      'loopback',
                      'Proxies that may tell the IP address of the user (`X-Forwarded-For`): `loopback`, `false`, a number or addresses'
                  ]
              ]
            : []),
        ...(app
            ? [
                  [
                      'OIDC_ISSUER',
                      app.issuer,
                      'The login server (Pasport): the `iss` of its tokens; its keys are read there'
                  ],
                  ['OIDC_AUDIENCE', app.apiUrl, 'The `aud` of its access tokens: the API of the login server'],
                  [
                      'OIDC_CLIENT_IDS',
                      app.clientId,
                      'The apps whose access tokens are accepted (comma separated): the frontend of this app'
                  ],
                  [
                      'OIDC_PRODUCT',
                      app.product ?? '(empty)',
                      'The product (licence code on the login server) this app sells: members need a trial or a seat of it; empty: a free app'
                  ]
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
                  [
                      'npm run demo:data',
                      'Demo organisations, users, apps, invoices and tickets (development; -- --remove)'
                  ],
                  ['npm run mail:dev', 'Start Mailpit in Docker: every email at http://localhost:8025']
              ]
            : []),
        ...(app
            ? [
                  ['npm run test:db', 'Tests against the real PostgreSQL: tenant isolation (RLS) of the notes'],
                  ['npm run roles:push', 'Send config/app-roles.json to the login server (-- --code <link code>)']
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
${oidc ? oidcSection({ port, tenantRole }) : ''}${app ? appSection({ app, tenantRole, choice: appOptions }) : ''}## Endpoints

CORS allows ${'`' + origin + '`'} (change \`CORS_ORIGIN\`). Examples use \`-H 'Accept-Language: nl'\`; leave it out for English.

${sections.join('\n')}
## Tests

Unit tests (\`npm test\`) and end-to-end tests (\`npm run test:e2e\`) never need a database${auth ? ' (the users table is replaced by an in-memory fake)' : ''}${oidc ? ' (the OpenID Connect data is kept in memory)' : ''}${app ? ' (the notes are kept in memory, the keys of the login server are a test key)' : ''}.${oidc || app ? '\n`npm run test:db` runs the Row-Level Security and storage tests against the real PostgreSQL from `.env`: it creates a\nseparate `<DATABASE_NAME>_test` database and removes it afterwards.' : ''}
Add a test for every endpoint you add, and for every translated error in all four languages.
`
}

/** The README section of an app linked to a login server: its access tokens, the access levels and the tenants. */
function appSection({ app, tenantRole, choice = {} }) {
    const isolation = choice.isolation ?? 'rls'
    return `
## Login through the login server

This API has **no users or organisations of its own**: they live on the login server (Pasport) at
**${app.issuer}**, where people register, log in and are invited. The frontend of this app logs in there and sends the
**access token** along (\`Authorization: Bearer ...\`, added on the server by \`/api/app\` of the frontend). Every
request is checked by \`PasportGuard\` (\`src/pasport\`), a global guard:

1. the signature (ES256) with the public keys of the login server (\`jwks_uri\` of its discovery, cached 10 minutes;
   an unknown key id fetches them again, at most every 30 seconds);
2. \`typ\` is \`at+jwt\` (an ID token is refused), \`iss\` is \`OIDC_ISSUER\`, \`aud\` is \`OIDC_AUDIENCE\`, it has not expired;
3. \`client_id\` is one of \`OIDC_CLIENT_IDS\`: a token of another app of the same login server opens nothing here.

Nothing is looked up: who calls comes from the token (\`@CurrentCaller()\`: \`sub\`, \`tenant { id, name, role }\`,
\`superadmin\`, \`sid\`). Every route says who may call it, with \`@Access(...)\` (\`src/pasport/access.ts\`):

| Level | Who |
| --- | --- |
| \`@Public()\` | everyone, without a token (\`/\`, \`/health\`, \`/examples\`, \`/docs\`) |
| \`@Access('account')\` | any valid token, also without an organisation (\`/me\`) |
| \`@Access('member')\` | the default: a valid token **with** an organisation (and a licence, see below) |
| \`@Access('admin')\` | the beheerder (admin) of that organisation, or a superadmin (and a licence) |

A missing or wrong token gives \`401 errors.UNAUTHORIZED\`, a token without organisation \`403 errors.NO_ORGANISATION\`, no
licence \`403 errors.NO_LICENSE\`, a member on an admin route \`403 errors.FORBIDDEN\` (translated, like every error).

### Licences (the product of this app)

One app is one product on the login server: a superadmin chooses it on \`/admin\` → Apps ("Product"), and every user
needs a licence of it in their organisation, bought per month or per year (\`/licenses\` on the login server). The
access tokens of this app then carry the claim \`license: { product, status, ends_at }\`, worked out by the login server
at every login and every refresh (so at most 10 minutes old):

| \`status\` | Meaning |
| --- | --- |
| \`trial\` | the trial of the user runs, until \`ends_at\` (seconds): a demo the user asked (on the profile page of the login server) or an admin started; a login never starts one |
| \`seat\` | the user has one of the (paid or free) seats of the organisation |
| \`superadmin\` | a superadmin of the login server: always |
| \`none\` | no licence: the beheerder gives a seat on \`/licenses\`, or buys more |

With \`OIDC_PRODUCT\` set${app.product ? ` (here \`${app.product}\`)` : ''}, \`member\` and \`admin\` routes need a licence of that product (a claim of
another product, or none, is refused); \`account\` routes such as \`GET /me\` do not, so the frontend can tell the user what
to do. \`@CurrentCaller()\` has it as \`license: { product, status, endsAt }\` (\`null\` without a claim). Leave
\`OIDC_PRODUCT\` empty for a free app.

### Roles

The roles of this app are defined in **\`config/app-roles.json\`** (a key for the code, a name in en, nl, fr and de, and
\`default\` for the roles a member has until the beheerder gives others). The login server learned them with the link
code; after a change, make a new link code on \`/admin\` → Apps and run \`npm run roles:push -- --code <code>\`. The
beheerders of each organisation give the roles on \`/members\` of the login server; the access token carries them
(\`roles\`), \`@CurrentCaller()\` has them as \`roles\` (\`null\` when the token has none).

Protect a route with **\`@Roles('editor')\`** (\`src/pasport/access.ts\`, one of the given roles is enough, superadmins always
pass): otherwise 403 \`errors.ROLE_REQUIRED\`. The example: \`GET /notes\` needs \`editor\` or \`viewer\`, \`POST /notes\`
needs \`editor\`, and \`DELETE /notes/:id\` the beheerder of the organisation (\`@Access('admin')\`).

### Data per organisation (multi-tenant)

\`DatabaseService.withTenant(tenantId, fn)\` runs \`fn\` in a transaction as the role **\`${tenantRole}\`** with
\`app.tenant_id\` set: PostgreSQL **Row-Level Security** only shows and accepts the rows of that organisation, also when
a query forgets its \`WHERE\`. Every table with data of an organisation has a \`tenant_id\` column (the \`tenant.id\`
of the token). The tables are made by the migrations in \`src/database/migrations.ts\` (a new migration gets the next
number; add a new table to \`TENANT_TABLES\` so the tests check its isolation).

Where that data lives is \`TENANT_ISOLATION\` in \`.env\` (here **\`${isolation}\`**); the code is the same either way:

| \`TENANT_ISOLATION\` | Where |
| --- | --- |
| \`rls\` | one database (\`DATABASE_NAME\`, on the same PostgreSQL server as the login server): \`MIGRATIONS\` run in it at the first start |
| \`database\` | a database **per organisation**, \`<DATABASE_NAME>_t_<organisation id>\`, made the first time it is used (under an advisory lock, so two instances never make it twice) and migrated with \`MIGRATIONS\`; after an update the new migrations run the first time the organisation is used again. Row-Level Security stays on inside it. The database of the app itself only keeps the register \`tenant_databases\` (\`MAIN_MIGRATIONS\`). The user of \`DATABASE_USER\` needs \`CREATEDB\`; \`DATABASE_NAME\` has at most 28 characters; a database is never removed automatically |

\`DatabaseService.withLock(key, fn)\` runs \`fn\` while holding a PostgreSQL advisory lock: one instance of the API (or one
request) at a time, for example for a monthly job. \`runMigrations(db, migrations, { lock, table })\` takes its own lock key
and migrations table.

The example is \`notes\` (\`src/notes\`): everyone of the organisation reads and adds notes, only its beheerder removes
them. Copy it for your own data.
${choice.files ? filesSection() : ''}${choice.mail ? mailSection() : ''}`
}

/** The README section of the files module of an app (src/files). */
const filesSection = () => `
### Files

\`src/files\` keeps images and PDFs per organisation (\`/files\`, see the endpoints). The description of a file is in the
table \`files\` (Row-Level Security), the bytes are in a **FileStore** chosen with \`FILES_DRIVER\`:

| \`FILES_DRIVER\` | Where |
| --- | --- |
| \`local\` (default) | the folder \`FILES_DIR\` (\`./storage\`, not in git): \`<organisation id>/<file id>\` |
| \`gcs\` | a private Google Cloud Storage bucket \`GCS_BUCKET\` (in an EU region), objects \`<GCS_PREFIX><organisation id>/<file id>\`. The login is the one of the environment (the service account of the server, or \`gcloud auth application-default login\`), so no key is kept in \`.env\` |

An upload is the **raw file as the body** of \`PUT /files/:id\` (the id a uuid chosen by the app, so a retry is harmless),
at most 8 MB (\`MAX_FILE_BYTES\`). The type is read from the first bytes (JPEG, PNG, WebP, PDF; never SVG or HTML, which
can carry scripts), and a download is sent with \`X-Content-Type-Options: nosniff\`, a sandboxing
\`Content-Security-Policy\` and an \`ETag\`. Use \`FilesService\` (exported by \`FilesModule\`) to attach files to your
own data. Another store: implement \`FileStore\` (\`src/files/file-store.ts\`) and add it to \`createFileStore\`.
`

/** The README section of the mail module of an app (src/mail). */
const mailSection = () => `
### Email (SMTP)

\`MailService\` (\`src/mail\`, a global module: inject it anywhere) sends with \`nodemailer\` over SMTP (\`SMTP_*\` and
\`MAIL_FROM\` in \`.env\`): \`await mail.send({ to, subject, text, html, attachments })\` answers \`false\` instead of
throwing when the mail could not be sent. During development **Mailpit** catches every mail: \`npm run mail:dev\`
(Docker), then **http://localhost:8025**. Without \`SMTP_HOST\` the mail is printed in the console during development;
in production it is not sent and its contents are never logged.
`

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
   (**http://localhost:8025**). Invite colleagues on \`/users\`; as superadmin, manage every organisation on \`/admin\`.
4. Or add users from the command line: \`npm run oidc:user -- --email ada@example.com --name "Ada" --tenant acme --role
   admin\` (creates the tenant when it does not exist; prints a random password once, or use \`--password\`; add
   \`--superadmin\` for a platform administrator; \`--email ... --reset-mfa\` resets two-step verification).
   **Demo data** to try the portal with (development only, never with \`NODE_ENV=production\`): \`npm run demo:data\`
   adds two organisations with doctors and staff (\`an.peeters@demo.example.com\` is admin and doctor), four apps in the
   catalogue, a subscription with seats, a trial, a free grant, invoices (one open), support tickets (answered, closed
   with a rating) and the discount code \`DEMO20\`; every demo account gets the same password (\`--password\`, otherwise
   a random one printed once). Running it again changes nothing; \`npm run demo:data -- --remove\` takes it away. The CLI
   asks it too ("Demodata toevoegen?").
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
| ID token | JWT, RS256, \`aud\` = client | 5 minutes | \`sub\`, \`auth_time\`, \`nonce\`, \`acr\` (\`loa2\`: password or eID, and the code of the authenticator app, or a passkey), \`amr\`, \`sid\`, \`at_hash\`, \`tenant\`, \`superadmin\` |
| Access token | JWT, ES256, \`typ: at+jwt\` (RFC 9068), \`aud\` = \`OIDC_AUDIENCE\` | 10 minutes, and stops when its session ends | \`sub\`, \`client_id\`, \`scope\`, \`sid\`, \`tenant\`, \`superadmin\`, \`license\` (an app that sells a product, see "Apps are products"), \`roles\` (an app with roles, see "Roles per app") |
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
- **The own account**: \`GET\`/\`PATCH /me/profile\` (first and last name, phone, language; a new email address
  changes only after the link sent to it is opened, \`pendingEmail\` until then) and \`POST /me/password\` (with the
  current password, or the first one for an eID-only account; every other session ends). The billing details of the
  organisation: \`GET\`/\`PATCH /tenants/current/billing\` (its admins change them).
- **Who is online**: every API request (and the heartbeat \`POST /me/heartbeat\` the frontend sends every minute while a
  page is open) writes \`tenant_members.last_seen_at\`, at most once a minute. A member is online after activity in the
  last 2 minutes; the members list also shows "last seen".
- **Status and out-of-office**: like Microsoft Teams, every account chooses its status in the menu of its avatar
  (\`PUT /me/status\`: \`available\`, \`busy\`, \`dnd\`, \`brb\`, \`away\` or \`offline\` to appear offline). The members
  lists show \`presence\`: the chosen status while the member is online, \`away\` instead of \`available\` when the page
  was not used for 5 minutes (the heartbeat sends \`idle\`), \`offline\` otherwise, and \`ooo\` while its out-of-office
  reply is on (\`PUT /me/out-of-office\`, like Outlook: from, until, an internal message for colleagues and an external
  one for customers). The support team sees the internal message when it mentions or assigns a colleague, customers see
  the external one on the tickets that colleague handles.
- **Profession**: a member is \`staff\` (the default) or \`doctor\` (\`PATCH /tenants/current/members/:userId/profession\`,
  by its admins or a superadmin). Only a doctor may use the eHealth vault and the apps that need it.
- **Any organisation** for superadmins: \`/admin/tenants/:id/members\` and \`/admin/tenants/:id/invitations\` do what
  \`/tenants/current/...\` does for its own admins (with \`eidLinked\` per member); a tenant has a plan, a city, a
  contact and stays \`provisioning\` until its first admin joined.
- **Notifications** (the bell in the topbar, \`src/notifications\`): the superadmins hear of a new organisation, the
  other admins of an organisation of an invitation and of a new member (followed through the audit log); the admins of
  an invoice and of a contract that ends soon; the account that made a ticket of an answer, and the support team of new
  tickets and replies. Other code
  injects \`NotificationsService\` and calls \`toUser\`, \`toTenantAdmins\` or \`toPlatform\` with a kind of
  \`NOTIFICATION_KINDS\` (its texts are in the \`Notifications\` messages of the frontend). The frontend reads
  \`GET /me/notifications\` every 30 seconds; notifications are kept 90 days.
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

Log in and register with the Belgian eID, like the federal login (CSAM) and Corilus Passport. The card and its PIN are
only the **first factor**: two-step verification always means the code of the **authenticator app**, also after an
eID login (\`OIDC_MFA=required\`: set up at the first login). The eID is never a second factor. It uses the **DafkeDD eID** library
(\`@dafkedd/eid\`, installed from https://github.com/DafkeDD/DafkeDD_EID) and the DafkeDD eID program (the *bridge*) on
the PC of the user, which talks to the card reader on http://127.0.0.1:47820.

| Step | What happens |
| --- | --- |
| 1. Nonce | The login page asks \`POST /oidc/interaction/<id>/eid/challenge\`: 32 random bytes, kept in the login cookie (registration and linking get an encrypted challenge of 5 minutes instead). |
| 2. PIN | The user types the PIN on the page; the bridge gives it to the card, which signs the nonce and the **origin of the page** (Web eID format). The PIN never reaches the server. |
| 3. Check | \`POST /oidc/interaction/<id>/eid\` with the token. \`src/oidc/eid.service.ts\` checks the signature, the origin (\`APP_URL\`), the nonce (once), the certificate chain up to the Belgian root CAs and the **OCSP** status (fail closed: no answer = no login). |
| 4. Account | The national register number of the certificate is turned into an **HMAC-SHA256** (key derived from \`OIDC_MASTER_KEY\`) and looked up in \`user_identifiers\`. The number itself is never stored. |
| 5. Login | As after the password: the **code of the authenticator app** (or its setup with a QR code at the first login), then organisation choice, session, tokens with \`acr: "loa2"\` and \`amr: ["sc", "pin", "otp", "mfa"]\`. |

| Flow | How |
| --- | --- |
| Register with eID | \`POST /oidc/account/eid/challenge\`, then \`POST /oidc/account/register-eid\` with the token, an email address and an organisation. The **name comes from the card**, the person chooses a **password** (every account has one). The email address must still be verified. One eID, one account (409 \`oidc.EID_ALREADY_LINKED\`). |
| Link to an existing account | On \`/security\` of the frontend (\`/me/eid/challenge\` and \`POST /me/eid\`): from then on the account logs in with password **or** eID. |
| Unlink | \`DELETE /me/eid\`; not when the account has no password (its eID is its only login: choose a password first on \`/security\`), and not with \`OIDC_EID_REQUIRED=on\`. |
| Password later | On \`/security\` (\`POST /me/password\`, no current password needed when there is none yet) or with "forgot password"; then the account can log in both ways (the password login asks the authenticator code as usual). |
| Invitation | A new account reads its eID first when the server has eID login (\`POST /oidc/account/invitation/eid\`: the name comes from the card), required with \`OIDC_EID_REQUIRED=on\`; then it chooses a password. |
| Every account | \`OIDC_EID_REQUIRED=on\`: an account without an eID only reaches the routes to link it (\`@EidOptional()\`: \`/me/eid\`, the profile, the sessions, the notifications); the frontend shows the eID screen instead of the page until it is linked. |

- \`OIDC_EID=test\` (development, in \`.env\`) also trusts the test certificates of the virtual card
  (\`npm run eid:mock\` in the frontend: \`dafke-eid --mock --auth-origin http://localhost:3000\`, PIN 1234) and skips
  OCSP. The API refuses to start with \`test\` and \`NODE_ENV=production\`: use \`on\` there.
- **Users** install the DafkeDD eID program once (https://github.com/DafkeDD/DafkeDD_EID/releases/latest, Windows setup
  and macOS). It only lets websites ask a PIN that are in its list: install it with
  \`dafke-eid install --auth-origin https://app.example.com\` (or build the setup with your origin built in). The login
  page shows what is missing: the program, a card reader or the card.
- The hash in \`user_identifiers\` depends on \`OIDC_MASTER_KEY\`: another key means every eID has to be linked again.
  The national register number is personal data with legal rules for its use in Belgium: check with your DPO that
  your application may use it as a login key. It is also kept encrypted (\`rrn_enc\`, a key derived from
  \`OIDC_MASTER_KEY\`) with the address of the card, and only shown to the account itself (\`GET /me/profile\`);
  unlinking the eID forgets both.

### Another OpenID Connect server (Entra ID, Keycloak, Google, ...)

The login page can also show **"Log in with <name>"**: the person logs in at another OpenID Connect server (your
company login), and comes back here. That server only proves **who** it is: the account, its organisations and roles,
licences, sessions, two-step verification and the audit log stay in this server, so everything else works the same.

1. Register a client (an "app registration") at that server with this **redirect URI**:
   \`http://localhost:${port}/oidc/external/callback\` (in production the public address of the API, \`OIDC_ISSUER\` +
   \`/external/callback\`). Scopes \`openid profile email\`.
2. Fill in \`OIDC_EXTERNAL_ISSUER\` (exactly the \`issuer\` of its \`/.well-known/openid-configuration\`, for example
   \`https://login.microsoftonline.com/<tenant-id>/v2.0\` or \`https://keycloak.example.com/realms/<realm>\`),
   \`OIDC_EXTERNAL_CLIENT_ID\`, and \`OIDC_EXTERNAL_CLIENT_SECRET\` for a confidential client (empty: a public client,
   PKCE only). \`OIDC_EXTERNAL_ONLY=true\` leaves only that button (no password, no eID, no registration here).
3. **Several servers at once** (Google and Microsoft, for example): the same settings with a number,
   \`OIDC_EXTERNAL_2_ISSUER\`, \`OIDC_EXTERNAL_2_CLIENT_ID\`, \`OIDC_EXTERNAL_2_CLIENT_SECRET\`, \`OIDC_EXTERNAL_2_NAME\`,
   \`OIDC_EXTERNAL_2_MFA\` (up to \`OIDC_EXTERNAL_9_*\`). The login page shows a button for each; the form sends
   \`provider\` (its number, 1 for \`OIDC_EXTERNAL_*\`). An account can be linked to each of them
   (\`user_identifiers\` types \`external\`, \`external_2\`, ...; migration 22). \`OIDC_EXTERNAL_ONLY\` is for all of them.

| Step | What happens |
| --- | --- |
| Start | \`POST /oidc/interaction/:id/external\`: to the authorization endpoint of that server with PKCE (S256), \`state\` and \`nonce\`. The running login waits in an encrypted cookie \`oidc_ext_<...>\` named after its state (only sent to the callback, 10 minutes; logins in several tabs do not get in each other's way). |
| Callback | \`GET /oidc/external/callback\`: the state must match, the code is exchanged (client_secret_basic, or the client id for a public client) and the **ID token is checked with the keys of that server** (its JWKS: RS256/384/512, PS256/384/512, ES256/384/512; never \`none\` or HMAC), its issuer, audience (and \`azp\`), expiry and nonce. Only https (http to this computer outside production), no redirects. Our own code, no library. |
| Account | The account linked to that person (an HMAC of issuer and \`sub\` in \`user_identifiers\`, type \`external\`). At the first login: the account with the same email address, **only when that server says it is verified and it is verified here too** (\`OIDC_EXTERNAL_LINK_EMAIL\`), or else a new account (no password). An address that server did not verify is refused (\`oidc.EXTERNAL_EMAIL_UNVERIFIED\`). |
| Two-step verification | \`OIDC_EXTERNAL_MFA=external\` (default): counts when the ID token says \`amr\` contains \`mfa\`; otherwise our own code follows (and its setup when \`OIDC_MFA=required\`). \`trust\`: that server always requires it. \`local\`: always our own code. **The login that links an existing account always asks our own code** (when it has one, or \`OIDC_MFA=required\`): control over an email address at the other server alone never takes over an account. |
| Organisation | As with a password: the only one, the choice, or "you are not a member": a new person joins through an invitation (the invitation joins the account with that email address). |

- The login page of the frontend continues after the callback: \`GET /oidc/interaction/:id\` answers \`pending: true\`,
  then \`POST /oidc/interaction/:id/resume\` gives the next step. Errors come back as \`/login?interaction=...&error=EXTERNAL_FAILED\`.
- The audit log shows \`account.external_linked\`, \`account.registered\` (method external) and logins with method
  \`fed\` (federation). Why a login there failed is logged as a warning (never tokens).
- Logging out here does not log out at that server (its own session stays).

### Passkeys

Every account can add **passkeys** on \`/security\`: the fingerprint, face or PIN of a laptop or phone (Windows Hello,
Touch ID, Android, iCloud Keychain, Google Password Manager) or a security key (YubiKey). The login page then shows
**"Log in with a passkey"**: no email address, no password, and no code of the authenticator app, because a passkey
with user verification is already two factors (something you have and something you know or are), like the eID.
\`OIDC_PASSKEYS=off\` turns them off; with \`OIDC_EXTERNAL_ONLY=true\` they are off as well.

| Step | What happens |
| --- | --- |
| Add (\`/security\`) | \`POST /me/passkeys/options\`: the options for \`navigator.credentials.create()\` (a discoverable credential, user verification required, ES256, RS256 or EdDSA, attestation \`none\`: we never learn which device it is) and a token with the challenge, encrypted for this account (5 minutes). \`POST /me/passkeys\` checks the answer: the challenge, the origin (\`OIDC_PASSKEY_ORIGINS\`), the hash of the domain (\`OIDC_PASSKEY_RP_ID\`), user presence and verification, and the public key (COSE: EC P-256, RSA of at least 2048 bits, Ed25519). Max 20 per account. |
| Log in | \`POST /oidc/interaction/:id/passkey/challenge\`: a random challenge, kept in the login cookie. The device shows its passkeys for this site; \`POST /oidc/interaction/:id/passkey\` checks the signature with the stored public key, the challenge (once), origin, domain, user verification, the user handle (the account id) and the **signature counter** (a device that counts must count up: a lower value means a cloned key, refused). Then on to the organisation choice, as after a password. |
| Account | \`amr\` \`pop user mfa\` and \`acr\` \`loa2\` in the tokens; the audit log shows "passkey" as method, \`account.passkey_added\` and \`account.passkey_removed\`. Failed logins are logged with method \`passkey\`. |

- Our own code on \`node:crypto\` (a strict CBOR decoder and the checks of WebAuthn level 2), no library.
- Table \`user_passkeys\` (migration 7): per passkey the credential id (unique over all accounts), the public key
  (SPKI), algorithm, signature counter, name, whether it is synced, transports, added and last used. No secrets: a
  stolen database cannot log in.
- A passkey belongs to its domain: in production \`APP_URL\` must be the https address of the frontend, and when the
  domain changes every passkey stops working (the accounts keep their password or eID). Keep \`OIDC_PASSKEY_RP_ID\`
  fixed, for example the parent domain.
- Removing a passkey here does not remove it from the device (the device may still offer it; the login then says it is
  unknown). The last passkey of an account without a password, eID or other server cannot be removed.

### Accounts: registration, email verification, forgotten password, invitations

| Flow | How |
| --- | --- |
| Registration | \`POST /oidc/account/register\` creates the account, a new tenant (the organisation name) and makes the account its admin. A verification email follows. \`OIDC_REGISTRATION=closed\` turns registration off (then people only join by invitation). |
| Email verification | The link (24 hours) opens \`/verify-email?token=...\` of the frontend, which calls \`POST /oidc/account/verify-email\`. Without a verified address an account cannot log in; the login page offers to send the email again. |
| Forgotten password | \`POST /oidc/account/forgot-password\` mails a link (1 hour) to \`/reset-password?token=...\`. The link works **once** (it holds a fingerprint of the old password hash), and every session of the account ends. |
| Invitations | An admin invites by email (\`POST /tenants/current/invitations\`, 7 days). \`/invite?token=...\` joins an existing account, or creates one with a name and password (already verified). The link stops working when the inviter is no longer admin or the tenant is suspended. The admin can add **apps** to the invitation (see "Invitations with apps"). |

- Registration, "forgot password" and "send again" always answer the same (202 \`check-email\`), so nobody can find out
  which email addresses have an account. Registering an address that has an account mails its owner instead.
- The links hold an **encrypted token** (AES-256-GCM, key derived from \`OIDC_MASTER_KEY\`, bound to its kind, with an
  expiry): there is no table for them.
- Rate limited per IP and per email address (\`OIDC_LOGIN_RATE_LIMIT\` per minute). \`OidcModule\` exports this
  \`LoginLimiter\`: an endpoint of your own that checks a secret (of an app, a code) uses it the same way
  (\`limiter.allow(['ip:' + ip, 'client:' + clientId])\`, false → 429 \`errors.TOO_MANY_REQUESTS\`).
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

Apps come from two places. \`config/oidc-clients.json\` lists the applications that may use the login (applied at every
start; on \`/admin\` they are read-only), and **superadmins make apps on \`/admin\`** of the frontend (\`/admin/clients\`,
stored with \`source: admin\`): the same fields, a client id of their choice (or made from the name), and for a
confidential app a **secret of 32 random bytes that is shown once** (only its sha256 is stored; "New secret" stops the
old one at once). An app made there can be changed, disabled (nobody logs in with it, its refresh tokens and codes stop
at once, its access tokens no longer reach the API) and, once disabled, removed with its codes, refresh tokens and
consents. The clients file never overwrites an app made on \`/admin\` with the same id (a warning in the log). Every
change is in the audit log (\`platform.client_*\`).

**Link a new project to an app with a link code**: on \`/admin\` → Apps, "Link code" makes a one-time code of 24
characters (\`K7QM-2XPD-9HRT-W4NB-C8ZF-3VJE\`, 120 random bits, valid 15 minutes; the short codes of 12 characters of
older servers still work, only its sha256 is stored; a new code stops the
previous one). In DafkeDD_CLI choose the frontend Next.js and the backend **"App for an existing DafkeDD OIDC server
(link code)"**, give the address of this API and the code: the CLI calls \`POST /oidc/link\` (no login, rate limited), which
uses the code once, adds the addresses of the new frontend to the app (redirect URI, after logout, and the back-channel
logout URI when the app has none) and answers the issuer, the client id and the address of this frontend (for the
account pages). A confidential app gets a new secret in that answer (the old one stops). The new frontend logs in here
with single sign-on and is logged out with back-channel logout. Mark the app as "our own application" when that
frontend may call this API as the user. Audit log: \`platform.client_link_code\` and \`platform.client_linked\`.

The fields (in the file, and on \`/admin\`):

| Field | Meaning |
| --- | --- |
| \`clientId\` | Name of the client (letters, digits, \`.\`, \`_\`, \`-\`) |
| \`type\` | \`public\` (browser and mobile apps: no secret, PKCE) or \`confidential\` (a server with a secret) |
| \`secretEnv\` | Confidential only: the \`.env\` variable with its secret (at least 32 characters); never in the file |
| \`redirectUris\` | Exact addresses the browser may be sent back to (https; http only on localhost) |
| \`postLogoutRedirectUris\` | Exact addresses the browser may go to after logging out (\`post_logout_redirect_uri\`) |
| \`grantTypes\` | \`authorization_code\` (default), and \`refresh_token\` to get refresh tokens |
| \`scopes\` | Scopes the client may ask for: \`openid\`, \`profile\`, \`email\`, \`tenant\` |
| \`firstParty\` | \`true\`: your own application (no consent screen). \`false\` (default): an application of others, which asks the user once which data it may have |
| \`backchannelLogoutUri\` | Optional: where the server POSTs a logout token when a session with this client ends (https; http only on localhost) |
| \`backchannelLogoutSessionRequired\` | Optional, \`true\` when the client needs \`sid\` in the logout token (it is always there) |
| \`product\` | Optional: the product (licence code of \`/licenses\`) this app sells; see "Apps are products" |
| \`roles\` | Optional: the roles of the app (\`key\`, \`names\`, \`default\`); see "Roles per app" |

### Apps are products (one licence per user per app)

An app can **sell a product**: on \`/admin\` → Apps a superadmin picks one of the products of \`/licenses\` ("Product
(licence)"; \`"product": "planner"\` in the clients file). One product belongs to one app (409
\`oidc.CLIENT_PRODUCT_TAKEN\`), and it must exist (400 \`oidc.CLIENT_UNKNOWN_PRODUCT\`). Organisations buy it per month
or per year, per user, like every product (see "Licences").

The access tokens of that app (and its ID token, with the \`tenant\` scope) then carry the licence of the user in the
organisation of the login, worked out at every login and every refresh:

${fence}json
"license": { "product": "planner", "status": "trial", "ends_at": 1793692800 }
${fence}

| \`status\` | Meaning |
| --- | --- |
| \`trial\` | the trial runs, until \`ends_at\` (seconds): only when the member asked a demo (\`POST /me/licenses/:productCode/trial\`) or an admin started one; a login never starts one |
| \`seat\` | one of the paid or free seats of the organisation |
| \`superadmin\` | a superadmin: always |
| \`none\` | no licence (the trial ended, no seat): the API of the app refuses its data with 403 |

The login itself is not refused: the app shows the user what to do (the beheerder gives a seat or buys more on
\`/licenses\`). An app made with the CLI ("App for an existing DafkeDD OIDC server") learns the product with the link
code and checks it in its own API (\`OIDC_PRODUCT\`). The link answer has it as \`client.product\`.

### Roles per app

The **developer** of an app decides which roles it has (\`config/app-roles.json\` of an app made with the CLI): a key
for the code, a name in en, nl, fr and de, and whether it is a default role:

${fence}json
[
  { "key": "editor", "names": { "en": "Editor", "nl": "Bewerker", "fr": "Éditeur", "de": "Bearbeiter" }, "default": true },
  { "key": "viewer", "names": { "en": "Viewer", "nl": "Lezer", "fr": "Lecteur", "de": "Leser" }, "default": false }
]
${fence}

The login server learns them with the link code (\`POST /oidc/link\` with \`roles\`), and again with
\`npm run roles:push -- --code <link code>\` in the backend of the app (\`POST /oidc/link/roles\`) after a change; or
\`"roles"\` in the clients file. At most 20 roles; a wrong list gives 400 \`oidc.ROLES_INVALID\` with the reason.

The **admins (beheerders)** of an organisation give the roles to their members on \`/members\` ("Roles per app",
\`/tenants/current/apps/...\`). A member they never gave roles has the **default roles**; an empty list is no role at
all. The tokens of the app carry the roles of the user in the organisation of the login (\`"roles": ["editor"]\`),
worked out at every login and refresh, so a change reaches the app within 10 minutes. Roles an app no longer defines
are left out. These roles are separate from the role in the organisation (\`tenant.role\`: \`user\` or \`admin\`) and
from \`superadmin\`: an app can look at all three. Changes are in the audit log (\`members.app_roles_changed\`,
\`platform.client_roles_pushed\`); the table \`app_role_assignments\` has Row-Level Security.

### Invitations with apps

An admin who invites someone can choose the **apps** the invitation gives access to (\`apps\` of
\`POST /tenants/current/invitations\`; on \`/members\` a checkbox per app). Per app: the **roles** the new member gets
(\`null\`: the default roles of the app) and, for an app that sells a product, a **seat** (one of the free seats of
the organisation). The apps are every app made on \`/admin\` and every app with roles (\`GET /tenants/current/apps\`);
an app that is not one of them gives 400 \`oidc.INVITATION_APP_UNKNOWN\`, a role the app does not have 400
\`oidc.ROLE_UNKNOWN\`.

- The email names the apps ("You get access to Planner"); the invitation page shows them with their roles and whether a
  licence comes with it.
- Accepting gives the roles (recorded as given by the inviter, \`members.app_roles_changed\` with reason
  \`invitation\`) and the seat (\`licences.seat_assigned\`). No free seat left: the member still joins without a
  licence (the admin gives one later, or the member asks a demo); the answer says \`seat: false\`.
- The answer of \`POST /oidc/account/invitation/accept\` lists the apps with their address (\`url\`: the first
  address after logout of the app, or the site of its callback), so the page offers "Open Planner".
- The apps are kept with the invitation (\`tenant_invitations.apps\`, migration 13); sending it again keeps them, a
  new invitation for the same address replaces them. An app removed in the meantime is left out.

### Applications of others: consent screen and back-channel logout

An application of another company (a partner, an app of a customer) gets its own entry in
\`config/oidc-clients.json\` with \`"firstParty": false\`:

${fence}json
{
    "clientId": "partner.app",
    "name": "Partner Planner",
    "type": "confidential",
    "secretEnv": "OIDC_CLIENT_PARTNER_SECRET",
    "redirectUris": ["https://planner.partner.com/callback"],
    "postLogoutRedirectUris": ["https://planner.partner.com"],
    "backchannelLogoutUri": "https://planner.partner.com/backchannel-logout",
    "grantTypes": ["authorization_code", "refresh_token"],
    "scopes": ["openid", "profile", "email"],
    "firstParty": false
}
${fence}

| What | How |
| --- | --- |
| Consent screen | After the login (or at once with single sign-on) the page **"Allow Partner Planner?"** shows the account and what the application gets per scope (\`openid\`: an id, \`profile\`: name and language, \`email\`, \`tenant\`: organisation and role). "Allow" remembers it (\`oidc_consents\`, per account and application) and sends the code; "Do not allow" sends \`error=access_denied\`. It asks again for more scopes than before or with \`prompt=consent\`; \`prompt=none\` without consent gives \`error=consent_required\`. With the \`tenant\` scope the consent counts per organisation: another organisation (\`tenant_hint\`) asks again. The screen answers once (\`oidc_used_interactions\`). The login page of the frontend shows the same step (\`status: "consent"\`). |
| What it gets | Its ID token and \`/oidc/userinfo\` with the allowed scopes; the organisation (and \`superadmin\`) only with the \`tenant\` scope. **Not our own API**: \`@Access(...)\` endpoints (\`/me\`, \`/tenants\`, \`/admin\`) answer 403 to a token of an application that is not \`firstParty\`. |
| Take it back | \`/security\` of the frontend lists the applications with access (\`GET /me/consents\`); "Take back" (\`DELETE /me/consents/:clientId\`) revokes every refresh token of that application for the account at once, and the next login asks again. |
| Back-channel logout | OpenID Connect Back-Channel Logout 1.0. Every client that got a code in a session is remembered (\`oidc_session_clients\`). When that session **ends** (logout, ended on \`/security\`, password reset, two-step verification reset, member disabled or removed, a stolen refresh token) a trigger queues a job (\`oidc_logout_queue\`) for every such client with a \`backchannelLogoutUri\`, whatever code ended it. \`BackchannelService\` POSTs \`logout_token=<JWT>\` (form-encoded, every \`OIDC_BACKCHANNEL_INTERVAL\` seconds): signed with the RS256 key of the ID tokens, \`typ: logout+jwt\`, \`iss\`, \`aud\` (the client), \`iat\`, \`exp\` (2 minutes), \`jti\`, \`sub\`, \`sid\` and the event \`http://schemas.openid.net/event/backchannel-logout\`, never a nonce. A session that simply runs out (12 hours) sends nothing. |
| Retries | A client that does not answer 2xx within 5 seconds (or redirects) is tried again after 30 seconds, 2, 8 and 32 minutes; after 5 tries it is given up (warning in the log, \`login.backchannel_failed\` in the audit log). With several API processes each token goes out once (\`FOR UPDATE SKIP LOCKED\`). |

The frontend is a client too: \`backchannelLogoutUri\` \`http://localhost:3000/api/auth/backchannel-logout\`. A
browser that is logged in there is logged out at its next request when its session ended elsewhere.

What the client does with a logout token: check the signature with \`/oidc/jwks\`, \`typ\` \`logout+jwt\`, \`iss\`,
\`aud\`, \`iat\`, the event, no \`nonce\`, and that the \`jti\` is new; then end its own session with that \`sid\`
and answer \`200\`.

### Keys

One RS256 key signs ID tokens (required by OpenID Connect), one ES256 key signs access tokens. They are created at the
first start, stored in \`oidc_signing_keys\` with the private part encrypted (AES-256-GCM with \`OIDC_MASTER_KEY\`),
replaced after 90 days and kept in the JWKS for 14 more days. **Keep a backup of \`OIDC_MASTER_KEY\`**: without it the
stored keys cannot be used (new keys are then created and existing tokens stop working).

### Licences and payments

Products are sold **per organisation, per product and per user** (a seat), per month or per year (a year is always
cheaper than twelve months). A user can ask a **free demo of 14 days** (\`BILLING_TRIAL_DAYS\`) of a product, once
(\`POST /me/licenses/:productCode/trial\`, "Ask a demo" on \`/profile\`); nothing starts by itself (not at
registration, eID registration, invitation or the first login to an app). After the demo the user needs a seat; an admin buys seats and gives them to members (and takes them back to give them to someone else)
on \`/licenses\` of the frontend.

| Who | Can |
| --- | --- |
| Superadmin | Products and prices, and how they look in the app catalogue (\`/admin/products\`; removing one also removes its app), discount codes (\`/admin/discounts\`), **free seats** for one organisation (\`/admin/tenants/:id/grants\`), **extend or start a trial** (\`/admin/tenants/:id/trials\`, also when the demo of the product is off) and **end one** (\`DELETE /admin/tenants/:id/trials/:productCode/:userId\`). Always has access to every product. |
| Admin of an organisation | Buy seats (\`POST /tenants/current/licenses/subscriptions\`), more or fewer seats, cancel, give and take back seats, take a seat for themselves (\`POST /tenants/current/licenses/:productCode/seat\`), start the trial of a member, the billing details (\`/tenants/current/billing\`) and the invoices (\`/tenants/current/invoices\`: pay the open ones, download the PDF) |
| Every user | \`GET /me/licenses\`: which products may I use, through a trial or a seat; the app catalogue (\`GET /tenants/current/catalog\`); \`POST /me/licenses/:productCode/trial\`: ask a demo, once per product (409 \`billing.DEMO_USED\`) |

**Protect an endpoint** with \`@License('<product code>')\` (\`src/billing/license.guard.ts\`): it logs in like
\`@Access('user')\` and answers 403 \`billing.LICENSE_REQUIRED\` without a running trial or a seat. The module of the
controller imports \`BillingModule\`:

${fence}ts
@Controller('planner')
export class PlannerController {
  @Get('week')
  @License('planner')
  week(@Auth() auth: AuthContext) { ... }
}
${fence}

When there are fewer seats than assigned members (fewer seats bought, free seats ended), the members that got a seat
first keep access.

**The app catalogue** (\`GET /tenants/current/catalog\`, every member): every product that is sold, with its icon,
category, short text, features and colour (set by a superadmin on \`/admin/products\`), sorted by \`sort\` and name.
Per product it says whether the organisation has it (\`owned\`), whether I may use it (\`access\`), whether I can still
ask a demo, the seats in use, where it opens (\`launchUrl\`, \`{slug}\` becomes the slug of the organisation) and where
it runs (the practice name and region chosen in the purchase wizard). A product with \`requiresVault\` needs a doctor
with an eHealth certificate (see "eHealth vault").

**Demo per product** (\`demoEnabled\`, default on): only then can an admin start one for a member and can a member start
their own (409 \`billing.DEMO_USED\` once it was used, \`billing.DEMO_DISABLED\` when the demo is off). Turning it off
does not end the trials that are running; a superadmin can always give or end one (an ended trial counts as used).

**VAT and invoices.** Prices are without VAT: \`BILLING_VAT_PERCENT\` (21) is added to every payment, and the quote
shows it (\`vatPercent\`, \`firstVatCents\`, \`firstTotalCents\`, \`renewalTotalCents\`). Every purchase, extra seats
and renewal issues an invoice \`FAC-<year>-<number>\` (numbered per year without gaps, \`invoice_numbers\`), with the
billing details of the organisation copied onto it: \`open\` until it is paid, \`paid\`, \`free\` (a 100% discount
code) or \`void\` (not shown). Admins list them (\`GET /tenants/current/invoices\`), pay every open one with one
checkout (\`POST /tenants/current/invoices/pay\`: renewals that failed, checkouts that were not finished) and download
the PDF (\`GET /tenants/current/invoices/:id/pdf\`, A4 in the language of the request, our own PDF code, no library).
The seller on the PDF comes from \`INVOICE_SELLER_NAME\` (in \`.env\`), and the commented \`INVOICE_SELLER_ADDRESS\`
(lines separated by \`|\`), \`INVOICE_SELLER_VAT\`, \`INVOICE_SELLER_EMAIL\` and \`INVOICE_SELLER_IBAN\` there; fill them
in before the first real invoice.

**Payments (Mollie).** \`PAYMENTS=mollie\` with \`MOLLIE_API_KEY\` (a \`test_...\` key from the Mollie dashboard while
testing). Buying is a first payment through the checkout of Mollie (it saves the mandate); after it the API creates a
Mollie subscription that charges every month or year. More seats: a payment for the rest of the period, and the
renewals cost more. Fewer seats: at once, no refund. Cancel: no more renewals, the seats stay until the end of the paid
period. A renewal by direct debit (SEPA) takes a few days: the seats stay valid for **7 days** after the period while
it is on its way (the seats cannot be changed meanwhile: 409 \`billing.RENEWAL_PENDING\`). A failed renewal makes the
subscription \`past_due\` (the seats stop at the end of the period).

- Mollie calls \`POST /billing/webhook\` with only the payment id: the API always fetches the status from Mollie, and a
  paid payment is applied once (also when the webhook and the return page come at the same time). When applying fails
  (Mollie or the database is down) the webhook answers 500 and Mollie tries again; the subscription at Mollie is
  created with an idempotency key, so a retry never makes a second one. Mollie cannot call **localhost**: the return page
  of the frontend (\`/licenses/return\`) asks the status itself (\`POST .../subscriptions/:id/sync\`), so buying works
  locally. To test renewals locally, set \`PUBLIC_API_URL\` to a tunnel (for example \`ngrok http ${port}\`).
- Only the newest checkout of a purchase can activate it, and a payment for more seats only counts in the period it
  was priced for. Such a late payment buys nothing and is logged as a warning ("refund it"): refund it in the Mollie
  dashboard. Refunds and chargebacks are not handled automatically either.
- \`PAYMENTS=fake\` (the default \`.env\`): a checkout page of the API itself (\`/billing/fake/:id\`, "Pay" or "Cancel"),
  without Mollie. The API refuses to start with \`fake\` and \`NODE_ENV=production\`.
- \`PAYMENTS=off\`: nothing can be bought (503 \`billing.PAYMENTS_DISABLED\`); trials and free seats still work.

**Discount codes** (superadmin): a percentage or an amount, for one product or all, for the first payment
(\`once\`), a number of periods (\`repeating\`) or \`forever\`, with a maximum number of organisations and an end date.
Each organisation uses a code once; the code is reserved at the checkout and given back when that is not paid. **100% makes it free**: the seats are active at once, without a payment, for the
periods of the code. Leave the code empty to get a random one (\`K7QM-2XPD\`).

- No account gets a trial automatically: the member asks a demo (\`/profile\`), or an admin starts it on
  \`/licenses\` (\`POST /tenants/current/licenses/:productCode/trials/:userId\`).
- Tests: the e2e tests run without a database, so override \`BILLING_STORE\` with \`MemoryBillingStore\` (like
  \`test/billing.e2e-spec.ts\`).

### Audit log

Every important change is recorded in \`audit_events\`: **who** (the account, or nobody for a payment that came in or a
failed login), **what** (\`login.succeeded\`, \`members.role_changed\`, \`licences.subscription_activated\`, ...),
**about whom or what**, **in which organisation**, the details, **when**, the **IP address** and the **browser**.

| Category | Events |
| --- | --- |
| \`login\` | Logged in (how: password and code, eID), failed login (unknown email, wrong password, not verified, too many attempts, eID not linked), wrong two-step code, logged out, session ended, logged out everywhere else, copied refresh token blocked |
| \`account\` | Registered (with a new organisation), email verified, new password, two-step verification on, off, new recovery codes, reset by a superadmin, eID linked or unlinked, profile changed, new email address asked and confirmed, eHealth certificate uploaded, its password saved, removed, fetched by an app |
| \`members\` | Invited, invitation sent again or withdrawn, joined, role changed, profession changed, disabled, enabled, removed |
| \`platform\` | Organisation created, changed, suspended or reactivated, superadmin granted or taken away |
| \`licences\` | Products, discount codes, free seats, trials (started, extended, ended), seats given or taken back, purchase started, paid, more or fewer seats, renewed, renewal not paid, canceled, a late payment to refund, billing details changed |
| \`invoices\` | Invoice issued, paid or voided, payment of the open invoices started |
| \`support\` | Ticket created, answered, claimed, closed, reopened, rated, internal note added |

| Who | Reads |
| --- | --- |
| Admin of an organisation | \`GET /tenants/current/audit\` (\`/audit\` in the frontend): the events of the organisation, read with Row-Level Security |
| Superadmin | \`GET /admin/audit\` (\`/audit?scope=platform\`): everything, also the events without an organisation (failed logins, accounts, platform) |
| Every account | \`GET /me/audit\` ("Recent activity" on \`/security\`): what it did, and what happened to it (also failed logins with its email address) |

Record your own events with \`AuditService\` (global, inject it anywhere); add the action to
\`src/audit/audit.actions.ts\` and its text to the frontend (\`Audit.actions\` in \`messages/*.json\`, four languages):

${fence}ts
await this.audit.record('licences.seat_assigned', {
  target: { type: 'user', id: userId },
  details: { product: 'planner' },
})
${fence}

- The account, the organisation, the IP address and the browser come from the request (\`src/audit/audit.context.ts\`).
  Never put a password, token, code or card number in \`details\` (short values only; texts are cut at 200 characters).
- Writing the log never fails the request: an error is logged (\`AuditLog\`).
- **Append-only**: a trigger refuses every \`UPDATE\`, \`DELETE\` and \`TRUNCATE\` of \`audit_events\`, also by the
  owner. Only the daily purge (events older than \`AUDIT_RETENTION_DAYS\`, 365) deletes, in its own transaction.
- **IP address**: the frontend calls the API for the browser (\`/api/backend\`) and passes the IP address and browser of
  the user (\`X-Forwarded-For\`, \`User-Agent\`). The API believes \`X-Forwarded-For\` only from \`TRUST_PROXY\`
  (default \`loopback\`: the frontend and a proxy on the same server). On separate servers, set the address of the
  frontend or the proxy (\`TRUST_PROXY=10.0.0.5\`). In production, put the frontend behind a proxy that adds the real
  address (nginx: \`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\`): Next.js itself passes on an
  \`X-Forwarded-For\` that a browser sends, so without such a proxy a user could write another IP address into the log
  of what they do through the frontend.
- IP addresses and email addresses are personal data: keep the retention as short as your rules allow, and mention the
  log in your privacy statement.
- Tests: override \`AUDIT_STORE\` with \`MemoryAuditStore\` in e2e tests (like \`BILLING_STORE\`).

### Support tickets

Members ask the support team (the superadmins) a question in a ticket: about an app or in general
(\`/tenants/current/tickets\`, Row-Level Security: only the own organisation). The support team sees every ticket
(\`/admin/tickets\`, filtered on status, on who handles it and a search text), takes it (\`claim\`), answers, closes and
reopens it, opens one itself for an organisation (after a phone call), and keeps **internal notes** that the
organisation never sees, mentioning colleagues (\`GET /admin/support-team\`). A ticket is \`TIC-<number>\` (from 1001)
with a status (\`open\`: waits for support, \`in_progress\`, \`answered\`: waits for the customer, \`closed\`) and a
priority (\`normal\`, \`high\`). The customer can reopen a closed ticket and **rate** it (1 to 5, with an optional
comment; rating again overwrites it). Tickets send no emails, only notifications: the customer when support answers,
the superadmins online for a new ticket (once one claims it, the notification disappears for the others).

- **Messages are rich text**: a small Markdown subset (\`**bold**\`, \`_italic_\`, \`~~strike~~\`, inline code between backticks, links,
  \`- \` and \`1. \` lists, paragraphs), at most 20 000 characters. Notifications and \`lastMessage\` in the lists get the
  text without markup (\`plainText()\` in \`src/support/rich-text.ts\`).
- **Images**: first upload (\`POST .../tickets/attachments\`, JSON with the file in base64: PNG, JPEG, GIF or WebP,
  detected from the first bytes, at most 2 MiB; these two routes accept a body of up to 3 MB), then refer to the returned
  id in the message as \`![name](att:<id>)\`. Every image must belong to the organisation of the ticket (400
  \`support.ATTACHMENT_UNKNOWN\`). Images are served inline with their own type, \`nosniff\` and a private cache, and need
  the access token like every route.
- Tables: \`tickets\`, \`ticket_messages\` and \`ticket_attachments\` (Row-Level Security), \`ticket_notes\` (support only:
  the tenant role has no access).

### eHealth vault (doctors)

A doctor keeps the **eHealth certificate** (PKCS#12, \`.p12\` or \`.pfx\`, at most 64 KiB) on \`/me/vault\`, so the apps
that call eHealth for that doctor do not each need a copy. Only a member with profession \`doctor\` (set by an admin)
in the organisation of the token, or a superadmin, may use it (403 \`oidc.VAULT_NOT_ALLOWED\`). The file and its password
are stored **encrypted** in \`user_vault\` (AES-256-GCM, a key derived from \`OIDC_MASTER_KEY\`, bound to the account):
upload it (\`PUT /me/vault\`), set its password (\`PUT /me/vault/password\`, checked by opening the file), remove it
(\`DELETE /me/vault\`). The API only shows what the certificate says (subject, issuer, serial, thumbprint, valid until),
never the file or the password.

An app gets them with **\`POST /vault/credentials\`**, server to server: Basic authentication with its client id and
secret (a confidential app that sells a product with \`requiresVault\`), and the access token of the doctor issued to that
same app in the body. The doctor must be an active doctor with a licence for the product. The answer is never cached;
keep the file and the password in memory only and do not log them. Every fetch is in the audit log
(\`account.vault_retrieved\`, never the password).

### Statistics (superadmin)

\`GET /admin/stats\` (\`?range=6m\`, \`year\` or \`all\`) gives the dashboard of the platform: organisations, active
users (seen in the last 30 days), apps bought and the revenue of the month (paid invoices, without VAT) as KPI tiles
with the change from the month before and the last 8 months, revenue and new organisations per month, the 4 apps with
the most environments (the rest is \`other\`) and how often each discount code was used.

### Not in this version yet

Passkeys, a consent screen for external clients and back-channel logout to other clients follow in the next phases.

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
| \`tenants\` | Organisations: \`slug\`, name, status (\`active\` or \`suspended\`), plan, city, contact name, billing details | yes |
| \`tenant_members\` | Which user is in which tenant: role (\`user\` or \`admin\`), status (\`active\` or \`disabled\`), profession (\`doctor\` or \`staff\`), last seen | yes |
| \`tenant_invitations\` | Open invitations (email, role, who invited, expiry) | yes |
| \`user_identifiers\` | Linked eIDs: an HMAC of the national register number per account (one eID per account, one account per eID), linked and last used | no |
| \`user_passkeys\` | Passkeys: the credential id (unique), public key (SPKI), COSE algorithm, signature counter, name, synced or not, transports, added and last used; no secrets | no |
| \`oidc_clients\` | Registered clients (from \`config/oidc-clients.json\` and /admin), with their back-channel logout URI and the product they sell | no |
| \`oidc_consents\` | What an account allowed an application of others: the scopes (with \`tenant\`: the organisations), when, until revoked | no |
| \`oidc_link_codes\` | One-time link codes of \`/admin\` (sha256, the app, who made it, 15 minutes, used or not) | no |
| \`oidc_used_interactions\` | Consent screens answered already (until their login expires): a copy of the login cookie cannot answer twice | no |
| \`oidc_session_clients\` | Which clients got a code in which session (they hear about its end) | no |
| \`oidc_logout_queue\` | Logout tokens still to deliver (back-channel logout), with the number of tries and the next try; filled by a trigger on \`oidc_sessions\` | no |
| \`oidc_signing_keys\` | Signing keys (private part encrypted) | no |
| \`oidc_sessions\` | Browser sessions: a public id (\`sid\`), the hash of the cookie and of the login that created it, the browser (User-Agent) and when it was last used; no tenant for a platform login | yes |
| \`oidc_codes\` | Authorization codes (hash, once, 60 seconds) | yes |
| \`oidc_refresh_tokens\` | Refresh tokens (hash), their family, session, client and organisation; used and revoked | yes |
| \`license_products\` | Products for sale: fixed code, name, price per seat per month and per year, how they look in the app catalogue, demo on or off, needs the vault | no |
| \`tenant_subscriptions\` | Bought seats of an organisation per product: month or year, paid until, the Mollie subscription, discount | yes |
| \`license_trials\` | The trial of a user per product (once), until when | yes |
| \`license_assignments\` | Who has a seat, given by whom | yes |
| \`license_grants\` | Free seats from a superadmin, until when | yes |
| \`discount_codes\` | Discount codes: percentage or amount, duration, how often used | no |
| \`discount_redemptions\` | Which organisation used which code (once each) | yes |
| \`billing_payments\` | Payments at Mollie (id, what for, status); a paid one is applied once | yes |
| \`invoice_numbers\`, \`invoices\` | The last invoice number per year; the invoices (\`FAC-<year>-<number>\`, amounts with and without VAT, the billing details as issued, status) | \`invoices\`: yes |
| \`user_vault\` | The eHealth certificate of an account and its password, both encrypted, and what the certificate says | no |
| \`tickets\`, \`ticket_messages\`, \`ticket_attachments\` | Support tickets, their conversation and their images | yes |
| \`ticket_notes\` | The internal notes of the support team (with mentions) | no: support only |
| \`audit_events\` | The audit log: who, what, about whom, organisation, details, IP address, browser, when (append-only) | yes (\`NULL\`: platform and accounts) |
| \`schema_migrations\` | Which migration ran, with a checksum | no |

Migrations run automatically at start, under an advisory lock (several instances can start at once). Never change a
migration that already ran: add a new one.
`
}
