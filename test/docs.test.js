import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { buildFiles, TRANSLATIONS, LOCALES, PORT } from '../src/backends/nestjs.js'
import { endpoints, backendReadme, formBody } from '../src/backends/docs.js'
import { frontendReadme } from '../src/frontends/docs.js'

const DB = {
    id: 'postgres',
    mode: 'docker',
    host: 'localhost',
    port: 5432,
    user: 'app',
    password: 'secret',
    database: 'shop',
    project: 'shop'
}

const OIDC = {
    adminEmail: 'admin@example.com',
    adminPassword: 'TempPassword123',
    adminPasswordHash: 'scrypt$32768$aa$bb',
    masterKey: 'ab'.repeat(32)
}

const VARIANTS = {
    'no database': { database: null, auth: null, oidc: null },
    database: { database: DB, auth: null, oidc: null },
    'database + login': { database: DB, auth: { jwtSecret: 'x' }, oidc: null },
    'database + OIDC server': { database: DB, auth: null, oidc: OIDC }
}

const filesOf = ({ database, auth, oidc }) => buildFiles(database, { auth, oidc })
const optionsOf = ({ database, auth, oidc }) => ({ database, auth: Boolean(auth), oidc: Boolean(oidc) })

/** Every route that the generated controllers define, as "METHOD /path". */
function routesOf(files) {
    const routes = []
    for (const [rel, content] of Object.entries(files)) {
        if (!rel.endsWith('.controller.ts')) continue
        const prefix = content.match(/@Controller\('([^']*)'\)/)?.[1] ?? ''
        // @ApiExcludeEndpoint(): only for development (the fake checkout), not part of the API
        for (const [, method, sub, excluded] of content.matchAll(
            /@(Get|Post|Put|Patch|Delete)\((?:'([^']*)')?\)(\s*@ApiExcludeEndpoint\(\))?/g
        )) {
            if (excluded) continue
            const parts = [prefix, sub ?? ''].filter(Boolean)
            routes.push({ rel, key: `${method.toUpperCase()} /${parts.join('/')}` })
        }
    }
    return routes
}

// ---------------------------------------------------------------- every endpoint is documented

for (const [name, variant] of Object.entries(VARIANTS)) {
    test(`(${name}) every route of the controllers is documented, and every documented route exists`, () => {
        const routes = routesOf(filesOf(variant)).map(r => r.key)
        const documented = endpoints(optionsOf(variant)).map(e => `${e.method} ${e.path}`)
        assert.deepEqual([...routes].sort(), [...documented].sort())
    })

    test(`(${name}) every route has a Swagger description (@ApiOperation) and is in the README`, () => {
        const files = filesOf(variant)
        for (const [rel, content] of Object.entries(files).filter(([r]) => r.endsWith('.controller.ts'))) {
            const routeCount =
                (content.match(/@(Get|Post|Put|Patch|Delete)\(/g) ?? []).length -
                (content.match(/@ApiExcludeEndpoint\(/g) ?? []).length
            const described = (content.match(/@ApiOperation\(/g) ?? []).length
            assert.equal(described, routeCount, `${rel}: every route needs @ApiOperation`)
            assert.match(content, /@ApiTags\(/, rel)
        }
        const readme = files['README.md']
        for (const route of routesOf(files))
            assert.ok(readme.includes(`### ${route.key}`), `README documents ${route.key}`)
    })

    test(`(${name}) the README shows body, example, response and errors of each endpoint`, () => {
        const readme = filesOf(variant)['README.md']
        for (const endpoint of endpoints(optionsOf(variant))) {
            const start = readme.indexOf(`### ${endpoint.method} ${endpoint.path}\n`)
            const next = readme.indexOf('\n### ', start + 1)
            const section = readme.slice(start, next === -1 ? undefined : next)
            assert.ok(endpoint.summary.length > 10)
            assert.ok(section.includes(endpoint.summary), `${endpoint.path}: summary`)
            assert.match(section, /curl /, `${endpoint.path}: curl example`)
            assert.ok(section.includes(`http://localhost:${PORT}`), `${endpoint.path}: full URL`)
            if (endpoint.body) {
                assert.match(section, /\*\*Body\*\*/, `${endpoint.path}: body table`)
                for (const [field] of endpoint.body.fields)
                    assert.ok(section.includes(`\`${field}\``), `${endpoint.path}: ${field}`)
                const example = endpoint.form ? formBody(endpoint.body.example) : JSON.stringify(endpoint.body.example)
                assert.ok(section.includes(example), `${endpoint.path}: body example`)
            }
            if (endpoint.response)
                assert.ok(section.includes(`**Response ${endpoint.response.status}:**`), `${endpoint.path}: response`)
            for (const [status, key] of endpoint.errors)
                assert.ok(section.includes(`| ${status} | \`${key}\``), `${endpoint.path}: ${status} ${key}`)
        }
    })

    test(`(${name}) every documented error key exists in all four languages`, () => {
        const files = filesOf(variant)
        for (const endpoint of endpoints(optionsOf(variant))) {
            for (const [, key] of endpoint.errors) {
                const [namespace, name] = key.split('.')
                for (const locale of LOCALES) {
                    const texts = JSON.parse(files[`src/i18n/${locale}/${namespace}.json`])
                    assert.ok(texts[name]?.trim(), `${locale} ${key}`)
                }
            }
        }
    })
}

test('documented request examples fill in all documented fields', () => {
    for (const endpoint of [
        ...endpoints({ database: DB, auth: true }),
        ...endpoints({ database: DB, oidc: true })
    ].filter(e => e.body)) {
        assert.deepEqual(
            Object.keys(endpoint.body.example).sort(),
            endpoint.body.fields.map(f => f[0]).sort(),
            endpoint.path
        )
    }
})

// ---------------------------------------------------------------- what else the backend README explains

test('the backend README explains start, scripts, .env, languages and the error format', () => {
    const readme = filesOf(VARIANTS['database + login'])['README.md']
    for (const text of [
        '# Backend (NestJS)',
        `http://localhost:${PORT}/docs`,
        'npm run db:up',
        'npm run db:check',
        'DATABASE_PASSWORD',
        'JWT_SECRET',
        'AUTH_RATE_LIMIT',
        '?lang=nl',
        'x-lang',
        'Accept-Language',
        '"statusCode"',
        'AppException',
        '## Endpoints',
        '## Tests'
    ]) {
        assert.ok(readme.includes(text), text)
    }
})

test('the README never contains the database password or the JWT secret', () => {
    const files = buildFiles({ ...DB, password: 'Sup3rSecretPw' }, { auth: { jwtSecret: 'TopSecretJwtValue' } })
    assert.ok(!files['README.md'].includes('Sup3rSecretPw'))
    assert.ok(!files['README.md'].includes('TopSecretJwtValue'))
})

test('the README only mentions features that were installed', () => {
    const plain = filesOf(VARIANTS['no database'])['README.md']
    for (const text of ['DATABASE_', 'db:check', '/auth/', 'JWT_SECRET', 'Users table'])
        assert.ok(!plain.includes(text), text)
    const local = buildFiles({ ...DB, mode: 'local' }, { auth: null })['README.md']
    assert.ok(local.includes('db:check'))
    assert.ok(!local.includes('db:up'), 'no Docker scripts for a local database')
    const noLogin = filesOf(VARIANTS.database)['README.md']
    assert.ok(!noLogin.includes('/auth/'))
})

test('the users table and its columns are documented under its real name', () => {
    const readme = filesOf(VARIANTS['database + login'])['README.md']
    assert.match(readme, /\*\*`shopusers`\*\*/)
    for (const column of ['id', 'name', 'email', 'password_hash', 'created_at'])
        assert.ok(readme.includes(`| \`${column}\` |`), column)
})

test('backendReadme can be used on its own with only English translations', () => {
    const readme = backendReadme({ translations: { en: { errors: TRANSLATIONS.en.errors } } })
    assert.match(readme, /### GET \/health/)
})

test('Swagger knows about the cookie when login is installed', () => {
    assert.match(filesOf(VARIANTS['database + login'])['src/main.ts'], /addCookieAuth\('session'\)/)
    assert.ok(!filesOf(VARIANTS.database)['src/main.ts'].includes('addCookieAuth'))
})

// ---------------------------------------------------------------- frontend README

test('the frontend README explains structure, languages, theme and icons', () => {
    const readme = frontendReadme({ ui: 'none', api: null })
    for (const text of [
        '# Frontend (Next.js)',
        'npm run dev',
        'messages/<language>.json',
        '@/i18n/navigation',
        'data-theme',
        'react-icons/lu'
    ]) {
        assert.ok(readme.includes(text), text)
    }
    assert.ok(!readme.includes('useApi'), 'no API section without a backend')
})

test('the frontend README documents calling the API when a backend is installed', () => {
    const readme = frontendReadme({ ui: 'all', api: { port: 4000, auth: false } })
    for (const text of [
        '## Calling the API',
        'useApi()',
        'apiFetch',
        'ApiError',
        'Accept-Language',
        'NEXT_PUBLIC_API_URL',
        'http://localhost:4000',
        'getLocale'
    ]) {
        assert.ok(readme.includes(text), text)
    }
    assert.ok(readme.includes('## DafkeDD UI'))
    assert.ok(!readme.includes('## Login pages'))
})

test('the frontend README documents the login pages only when they were installed', () => {
    const readme = frontendReadme({ ui: 'none', api: { port: 4000, auth: true } })
    for (const text of ['## Login pages', '/login', '/register', '/profile', 'GET /auth/me', 'httpOnly'])
        assert.ok(readme.includes(text), text)
})

test('the README of the frontend mentions every language it was generated with', () => {
    const readme = frontendReadme({ locales: ['en', 'nl'], api: null })
    assert.ok(readme.includes('`en`, `nl`'))
})

// ---------------------------------------------------------------- documentation rule of this repository

const read = rel => fs.readFile(new URL(`../${rel}`, import.meta.url), 'utf8')

test('the README of this repository documents the generated documentation', async () => {
    const readme = await read('README.md')
    assert.match(readme, /## Documentation/)
    assert.match(readme, /Swagger/)
})

test('CONTRIBUTING makes documentation mandatory for every step and every API call', async () => {
    const contributing = await read('CONTRIBUTING.md')
    assert.match(contributing, /Documentation is mandatory/)
    assert.match(contributing, /every API call/i)
})

// ---------------------------------------------------------------- OpenID Connect documentation

test('the README of an OIDC backend explains the login server, multi-tenancy and every OIDC setting', () => {
    const readme = filesOf(VARIANTS['database + OIDC server'])['README.md']
    for (const text of [
        '## OpenID Connect (login server)',
        '/oidc/.well-known/openid-configuration',
        'OIDC_LOGIN_UI_URL',
        'npm run oidc:user',
        'npm run test:db',
        'PKCE',
        'config/oidc-clients.json',
        'OIDC_MASTER_KEY',
        'OIDC_ISSUER',
        'OIDC_AUDIENCE',
        'OIDC_BOOTSTRAP_ADMIN_EMAIL',
        '## Multi-tenant (Row-Level Security)',
        'withTenant',
        'shop_tenant',
        'TENANT_TABLES',
        '**OAuth errors**',
        '**Query parameters:**',
        'application/x-www-form-urlencoded'
    ]) {
        assert.ok(readme.includes(text), text)
    }
})

test('the README never contains the OIDC master key, the admin password or its hash', () => {
    const readme = filesOf(VARIANTS['database + OIDC server'])['README.md']
    for (const secret of [OIDC.masterKey, OIDC.adminPassword, OIDC.adminPasswordHash])
        assert.ok(!readme.includes(secret))
})

test('only an OIDC backend documents the OIDC server', () => {
    for (const name of ['no database', 'database', 'database + login']) {
        const readme = filesOf(VARIANTS[name])['README.md']
        assert.ok(!readme.includes('/oidc/'), name)
        assert.ok(!readme.includes('OIDC_'), name)
    }
})
