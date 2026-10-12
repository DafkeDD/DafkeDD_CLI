/**
 * Documentation that is generated into ./backend (README.md). It lists EVERY endpoint with its request, response and
 * errors, so the documentation always matches what was installed. The tests check that every route of the generated
 * controllers appears here and in Swagger (/docs).
 */

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
export const endpoints = ({ database = null, auth = false } = {}) => [
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
        : [])
]

const curlFor = (endpoint, { port }) => {
    const parts = ['curl']
    if (endpoint.method !== 'GET') parts.push(`-X ${endpoint.method}`)
    if (endpoint.cookie === 'sets' || endpoint.cookie === 'clears') parts.push('-c cookies.txt')
    if (endpoint.cookie === 'needs' || endpoint.cookie === 'clears') parts.push('-b cookies.txt')
    parts.push("-H 'Accept-Language: nl'")
    if (endpoint.body) {
        parts.push("-H 'Content-Type: application/json'")
        parts.push(`-d '${JSON.stringify(endpoint.body.example)}'`)
    }
    parts.push(`http://localhost:${port}${endpoint.path.replace(':id', '7')}`)
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
    port = 4000,
    origin = 'http://localhost:3000',
    table = null,
    translations
}) {
    const list = endpoints({ database, auth })
    const errorMessages = Object.fromEntries(
        Object.entries(translations.en.errors).map(([key, text]) => [`errors.${key}`, text])
    )

    const sections = list.map(endpoint => {
        const lines = [`### ${endpoint.method} ${endpoint.path}`, '', endpoint.summary, '']
        if (endpoint.cookie === 'sets') lines.push('Sets the `session` cookie (httpOnly, SameSite=Lax).', '')
        if (endpoint.cookie === 'clears') lines.push('Clears the `session` cookie.', '')
        if (endpoint.cookie === 'needs')
            lines.push('Needs the `session` cookie from `/auth/login` or `/auth/register`.', '')
        if (endpoint.body) {
            lines.push(
                '**Body** (JSON):',
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
## Endpoints

CORS allows ${'`' + origin + '`'} (change \`CORS_ORIGIN\`). Examples use \`-H 'Accept-Language: nl'\`; leave it out for English.

${sections.join('\n')}
## Tests

Unit tests (\`npm test\`) and end-to-end tests (\`npm run test:e2e\`) never need a database${auth ? ' (the users table is replaced by an in-memory fake)' : ''}.
Add a test for every endpoint you add, and for every translated error in all four languages.
`
}
