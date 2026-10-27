import test from 'node:test'
import assert from 'node:assert/strict'
import {
    APP_PORT,
    appEndpoints,
    ERRORS,
    FILES_ERRORS,
    options,
    packages,
    scripts,
    SCRIPTS,
    tenantRole,
    VALIDATION
} from '../src/backends/app.js'
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

// ---------------------------------------------------------------- modules and the isolation of the organisations

const full = buildFiles(DB, { app: LINK, appOptions: { mail: true, files: true, isolation: 'database' } })

test('without modules the app gets no mail, no files and one database with Row-Level Security', () => {
    assert.ok(!Object.keys(files).some(rel => rel.startsWith('src/files/') || rel.startsWith('src/mail/')))
    assert.ok(!files['src/app.module.ts'].includes('FilesModule'))
    assert.ok(!files['src/app.module.ts'].includes('MailModule'))
    assert.ok(!files['src/setup.ts'].includes('useBodyParser'))
    assert.ok(files['.env'].includes('\nTENANT_ISOLATION=rls\n'))
    assert.ok(!files['.env'].includes('SMTP_HOST') && !files['.env'].includes('FILES_DRIVER'))
    assert.ok(!files['.gitignore'].includes('storage'))
    assert.deepEqual(packages(), { dependencies: [], devDependencies: [] })
    assert.deepEqual(scripts(), SCRIPTS)
    assert.deepEqual(options(), { mail: false, files: false, isolation: 'rls' })
    assert.throws(() => options({ isolation: 'schema' }), /isolation/)
    assert.ok(!appEndpoints().some(endpoint => endpoint.path.startsWith('/files')))
})

test('the mail module: the MailService of the login server, global, with Mailpit and the SMTP settings', () => {
    for (const rel of ['src/mail/mail.service.ts', 'src/mail/mail.service.spec.ts', 'src/mail/mail.module.ts'])
        assert.ok(full[rel], rel)
    assert.match(full['src/mail/mail.module.ts'], /@Global\(\)/)
    assert.match(full['src/mail/mail.service.ts'], /attachments\?: MailAttachment\[\]/)
    assert.match(full['src/app.module.ts'], /import \{ MailModule \} from '\.\/mail\/mail\.module\.js'/)
    assert.match(full['src/app.module.ts'], /\n\s+MailModule,\n/)
    for (const line of ['SMTP_HOST=localhost', 'SMTP_PORT=1025', "MAIL_FROM='Planner <no-reply@example.com>'"])
        assert.ok(full['.env.example'].includes(line), line)
    assert.match(scripts({ mail: true })['mail:dev'], /mailpit/)
    assert.deepEqual(packages({ mail: true }).devDependencies, ['@types/nodemailer@latest'])
})

test('the files module: a FileStore, the table files with Row-Level Security, raw uploads and its errors', () => {
    for (const rel of [
        'src/files/files.controller.ts',
        'src/files/files.service.ts',
        'src/files/files.module.ts',
        'src/files/file-store.ts',
        'src/files/local-file-store.ts',
        'src/files/gcs-file-store.ts',
        'src/files/pg-file-index.ts',
        'src/files/memory-file-index.ts',
        'src/files/files.spec.ts',
        'test/files.e2e-spec.ts',
        'test/files.db-spec.ts'
    ])
        assert.ok(full[rel], rel)
    const migrations = full['src/database/migrations.ts']
    assert.match(migrations, /id: 2,\n\s+name: 'files'/)
    assert.match(migrations, /\$\{isolate\('files'\)\}/)
    assert.match(full['src/database/database.constants.ts'], /TENANT_TABLES = \['notes', 'files'\]/)
    assert.match(
        full['src/setup.ts'],
        /useBodyParser\('raw', \{ type: UPLOAD_TYPES, limit: MAX_FILE_BYTES \+ 1024 \* 1024 \}\)/
    )
    assert.match(full['src/app.module.ts'], /\n\s+FilesModule,\n/)
    assert.ok(full['.gitignore'].split('\n').includes('storage'))
    for (const line of ['FILES_DRIVER=local', 'FILES_DIR=./storage', 'GCS_BUCKET='])
        assert.ok(full['.env'].includes(line), line)
    assert.deepEqual(packages({ files: true }).dependencies, ['@google-cloud/storage@latest'])
    for (const locale of LOCALES) {
        assert.deepEqual(Object.keys(FILES_ERRORS[locale]), Object.keys(FILES_ERRORS.en), locale)
        const errors = JSON.parse(full[`src/i18n/${locale}/errors.json`])
        for (const key of Object.keys(FILES_ERRORS.en)) assert.ok(errors[key], `${locale} ${key}`)
        assert.match(errors.FILE_TOO_LARGE, /\{mb\}/)
    }
    const readme = full['README.md']
    for (const text of [
        '### Files',
        '### Email (SMTP)',
        '### PUT /files/:id',
        '--data-binary @contract.pdf',
        'here **`database`**'
    ])
        assert.ok(readme.includes(text), text)
})

test('a database per organisation: TENANT_ISOLATION, the register in MAIN_MIGRATIONS and its own db test', () => {
    assert.ok(full['.env'].includes('\nTENANT_ISOLATION=database\n'))
    const service = full['src/database/database.service.ts']
    assert.match(service, /config\.get<string>\('TENANT_ISOLATION'\) \|\| 'rls'/)
    assert.match(service, /this\.withLock\('tenant-database:' \+ tenantId/)
    assert.match(service, /CREATE DATABASE "\$\{name\}"/)
    assert.match(full['src/database/migrations.ts'], /export const MAIN_MIGRATIONS[\s\S]+CREATE TABLE tenant_databases/)
    assert.match(
        full['src/database/migrator.ts'],
        /\{ lock = MIGRATION_LOCK, table = 'schema_migrations' \}: MigrateOptions = \{\}/
    )
    // The test of the isolation per database is there either way (the setting can be changed later)
    assert.ok(files['test/tenant-databases.db-spec.ts'])
})
