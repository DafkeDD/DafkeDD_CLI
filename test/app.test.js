import test from 'node:test'
import assert from 'node:assert/strict'
import { APP_PORT, appEndpoints, ERRORS, SCRIPTS, tenantRole, VALIDATION } from '../src/backends/app.js'
import { buildFiles, LOCALES } from '../src/backends/nestjs.js'
import { linked } from '../src/backends/linked.js'

const DB = {
    id: 'postgres',
    mode: 'local',
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'secret',
    database: 'planner',
    project: 'shop'
}
const LINK = {
    issuer: 'http://localhost:4000/oidc',
    apiUrl: 'http://localhost:4000',
    accountUrl: 'http://localhost:3000',
    clientId: 'planner',
    clientSecret: null,
    name: 'Planner',
    firstParty: true,
    scopes: ['openid', 'profile', 'email', 'tenant'],
    product: 'planner',
    port: 3001
}
const files = buildFiles(DB, { app: LINK })

test('an app needs a database and is never combined with a login of its own', () => {
    assert.throws(() => buildFiles(null, { app: LINK }), /database/)
    assert.throws(() => buildFiles(DB, { app: LINK, auth: { jwtSecret: 'x' } }), /niet meerdere/)
})

test('the app API runs on 4001 and allows its own frontend only', () => {
    assert.equal(APP_PORT, 4001)
    for (const name of ['.env', '.env.example']) {
        const env = files[name].split('\n')
        for (const line of [
            'PORT=4001',
            'CORS_ORIGIN=http://localhost:3001',
            'OIDC_ISSUER=http://localhost:4000/oidc',
            'OIDC_AUDIENCE=http://localhost:4000',
            'OIDC_CLIENT_IDS=planner',
            'OIDC_PRODUCT=planner',
            'DATABASE_NAME=planner'
        ])
            assert.ok(env.includes(line), `${name}: ${line}`)
    }
    assert.ok(!files['.env.example'].includes('secret'), 'no database password in .env.example')
    assert.match(files['src/main.ts'], /get\('PORT'\) \?\? 4001\)/)
    assert.match(files['src/main.ts'], /\.addBearerAuth\(\)/)
    assert.match(files['src/setup.ts'], /\?\? 'http:\/\/localhost:3001'/)
    assert.match(files['test/app.e2e-spec.ts'], /toBe\('http:\/\/localhost:3001'\)/)
})

test('every route needs a token of the login server, except the public ones', () => {
    assert.match(files['src/app.module.ts'], /PasportModule,\n\s+NotesModule,/)
    assert.match(files['src/pasport/pasport.module.ts'], /provide: APP_GUARD, useClass: PasportGuard/)
    for (const rel of [
        'src/app.controller.ts',
        'src/health/health.controller.ts',
        'src/examples/examples.controller.ts'
    ])
        assert.match(
            files[rel],
            /import \{ Public \} from '\.\.?\/pasport\/access\.js'[\s\S]*@Public\(\)\n@Controller/,
            rel
        )
    assert.ok(!files['src/notes/notes.controller.ts'].includes('@Public()'))
    assert.match(files['src/me/me.controller.ts'], /@Access\('account'\)/)
    assert.match(files['src/notes/notes.controller.ts'], /@Access\('admin'\)/)
    // The guard checks issuer, audience, the kind of token and the app it was issued to
    const guard = files['src/pasport/pasport.guard.ts']
    for (const check of [
        'at+jwt',
        'client_id',
        'errors.NO_ORGANISATION',
        'errors.NO_LICENSE',
        'errors.FORBIDDEN',
        'errors.UNAUTHORIZED'
    ])
        assert.ok(guard.includes(check), check)
    // The defaults are those of the link code (.env wins)
    const config = files['src/pasport/pasport.config.ts']
    for (const value of ["'http://localhost:4000/oidc'", "'http://localhost:4000'", "'planner'"])
        assert.ok(config.includes(value), value)
    assert.match(config, /OIDC_PRODUCT'\) \?\? 'planner'\)/)
    // A free app: no product, no licence check
    assert.match(buildFiles(DB, { app: { ...LINK, product: null } })['src/pasport/pasport.config.ts'], /\?\? ''\)/)
    assert.ok(
        !Object.values(files).some(content => /__(ISSUER|AUDIENCE|CLIENT_ID|PRODUCT|TENANT_ROLE)__/.test(content))
    )
})

test('the data of every organisation is kept apart by Row-Level Security, as its own role', () => {
    assert.equal(tenantRole('planner'), 'planner_tenant')
    assert.match(files['src/database/database.constants.ts'], /TENANT_ROLE = 'planner_tenant'/)
    assert.match(files['src/database/database.constants.ts'], /TENANT_TABLES = \['notes'\]/)
    const migrations = files['src/database/migrations.ts']
    assert.match(migrations, /CREATE TABLE notes \(/)
    assert.match(migrations, /ROW LEVEL SECURITY/)
    assert.match(migrations, /\$\{isolate\('notes'\)\}/)
    assert.match(files['src/notes/pg-notes.store.ts'], /withTenant\(/)
    assert.ok(files['test/tenant-isolation.db-spec.ts'])
    assert.ok(files['test/pasport.e2e-spec.ts'])
    assert.ok(files['vitest.config.db.ts'])
    assert.deepEqual(SCRIPTS, {
        'test:db': 'vitest run --config ./vitest.config.db.ts',
        'roles:push': 'node scripts/roles-push.mjs'
    })
})

test('the errors and validation messages of the app exist in all four languages', () => {
    for (const set of [ERRORS, VALIDATION]) {
        assert.deepEqual(Object.keys(set).sort(), [...LOCALES].sort())
        for (const locale of LOCALES) assert.deepEqual(Object.keys(set[locale]), Object.keys(set.en), locale)
    }
    for (const locale of LOCALES) {
        const errors = JSON.parse(files[`src/i18n/${locale}/errors.json`])
        assert.ok(errors.NO_ORGANISATION && errors.NOTE_NOT_FOUND && errors.DATABASE_UNAVAILABLE, locale)
        assert.match(errors.NO_LICENSE, /\{product\}/, locale)
        assert.ok(JSON.parse(files[`src/i18n/${locale}/validation.json`]).MAX_LENGTH, locale)
    }
})

test('the README explains the login through the login server and documents the app endpoints', () => {
    const readme = files['README.md']
    for (const text of [
        '## Login through the login server',
        "@Access('admin')",
        '`planner_tenant`',
        '| `OIDC_CLIENT_IDS` | `planner` |',
        'npm run test:db',
        '### Licences (the product of this app)',
        '| `OIDC_PRODUCT` | `planner` |',
        '`403 errors.NO_LICENSE`',
        'http://localhost:4001/docs',
        'CORS allows `http://localhost:3001`'
    ])
        assert.ok(readme.includes(text), text)
    for (const endpoint of appEndpoints()) {
        assert.ok(readme.includes(`### ${endpoint.method} ${endpoint.path}`), endpoint.path)
        assert.ok(endpoint.bearer, `${endpoint.path} needs the access token`)
    }
    assert.match(readme, /-H "Authorization: Bearer \$ACCESS_TOKEN" http:\/\/localhost:4001\/notes/)
    assert.ok(!readme.includes('## OpenID Connect (login server)'), 'not the login server itself')
})

test('the steps of a linked app are the NestJS steps with the app, and add test:db', async () => {
    const steps = await linked.steps({
        projectDir: '/tmp/does-not-exist-' + Date.now(),
        answers: { link: LINK, database: DB },
        exec: async () => {}
    })
    assert.ok(steps.some(step => step.title === 'NestJS aanmaken'))
    assert.ok(steps.some(step => step.title === 'Databaseverbinding testen'))
    assert.deepEqual(await linked.steps({ projectDir: '/tmp', answers: {} }), [])
})
