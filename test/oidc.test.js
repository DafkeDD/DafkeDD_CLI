import test from 'node:test'
import assert from 'node:assert/strict'
import { scrypt } from 'node:crypto'
import { promisify } from 'node:util'
import { buildFiles, nestjs, LOCALES } from '../src/backends/nestjs.js'
import * as oidc from '../src/backends/oidc.js'

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

const ANSWERS = {
    tenantName: "Acme's Café",
    adminEmail: 'admin@example.com',
    adminPassword: 'TempPassword123',
    adminPasswordHash: 'scrypt$32768$aa$bb',
    masterKey: 'cd'.repeat(32)
}

const files = buildFiles(DB, { oidc: ANSWERS })
const templates = oidc.oidcFiles({ usersTable: 'shopusers', database: 'shop', port: 4000 })

// ---------------------------------------------------------------- templates

test('every template is copied with all placeholders filled in', () => {
    assert.ok(Object.keys(templates).length > 25)
    for (const [rel, content] of Object.entries(templates)) {
        assert.ok(!/__[A-Z_]+__/.test(content), `${rel} still has a placeholder`)
        assert.equal(files[rel], content, `${rel} is part of the backend`)
    }
    assert.match(templates['src/database/database.constants.ts'], /USERS_TABLE = 'shopusers'/)
    assert.match(templates['src/database/database.constants.ts'], /TENANT_ROLE = 'shop_tenant'/)
    assert.match(templates['src/oidc/oidc.config.ts'], /http:\/\/localhost:4000\/oidc/)
})

test('the backend gets the OIDC server, its tests, scripts and the multi-tenant example', () => {
    for (const rel of [
        'src/oidc/oidc.module.ts',
        'src/oidc/oidc.controller.ts',
        'src/oidc/well-known.controller.ts',
        'src/oidc/oidc.service.ts',
        'src/oidc/jose.ts',
        'src/oidc/keys.service.ts',
        'src/oidc/store/pg-oidc.store.ts',
        'src/oidc/store/memory-oidc.store.ts',
        'src/database/migrations.ts',
        'src/database/migrator.ts',
        'src/tenants/tenant-members.service.ts',
        'config/oidc-clients.json',
        'scripts/oidc-user.mjs',
        'test/oidc.e2e-spec.ts',
        'test/tenant-isolation.db-spec.ts',
        'vitest.config.db.ts',
        'src/oidc/jose.spec.ts',
        'src/oidc/crypto.spec.ts',
        'src/oidc/keys.service.spec.ts',
        'src/database/migrations.spec.ts'
    ]) {
        assert.ok(files[rel], rel)
    }
})

test('the OIDC code uses no JWT or OIDC library: only node:crypto', () => {
    for (const [rel, content] of Object.entries(templates).filter(([rel]) => rel.endsWith('.ts'))) {
        const imports = [...content.matchAll(/from '([^']+)'/g)].map(match => match[1])
        for (const library of ['jsonwebtoken', 'jose', 'openid-client', 'oidc-provider', 'passport', '@nestjs/jwt']) {
            assert.ok(!imports.includes(library), `${rel} imports ${library}`)
        }
    }
})

test('PKCE is required, the implicit flow is not offered and redirect URIs must match exactly', () => {
    const service = templates['src/oidc/oidc.service.ts']
    assert.match(service, /code_challenge is required \(PKCE\)/)
    assert.match(service, /code_challenge_method must be S256/)
    assert.match(service, /response_types_supported: \['code'\]/)
    assert.ok(!service.includes("'implicit'"))
    assert.match(service, /client\.redirectUris\.includes\(redirectUri\)/)
})

test('the main e2e spec gets an in-memory OIDC store and a test master key', () => {
    const e2e = files['test/app.e2e-spec.ts']
    assert.match(e2e, /overrideProvider\(OIDC_STORE\)/)
    assert.match(e2e, /new MemoryOidcStore\(\)/)
    assert.match(e2e, /OIDC_MASTER_KEY/)
})

test('the app module, setup and translations are wired for the OIDC server', () => {
    assert.match(files['src/app.module.ts'], /OidcModule,/)
    assert.match(files['src/app.module.ts'], /TenantsModule,/)
    assert.match(files['src/setup.ts'], /app\.use\(cookieParser\(\)\)/)
    const keys = Object.keys(oidc.MESSAGES.en).sort()
    for (const locale of LOCALES) {
        const messages = JSON.parse(files[`src/i18n/${locale}/oidc.json`])
        assert.deepEqual(Object.keys(messages).sort(), keys, locale)
        for (const [key, text] of Object.entries(messages)) assert.ok(text.trim(), `${locale} ${key}`)
    }
    assert.ok(files['test/oidc.e2e-spec.ts'].includes(JSON.stringify(oidc.MESSAGES)))
})

test('the e2e spec checks the login page in all four languages', () => {
    assert.match(files['test/oidc.e2e-spec.ts'], /it\.each\(Object\.entries\(MESSAGES\)\)/)
    assert.deepEqual(Object.keys(oidc.MESSAGES).sort(), [...LOCALES].sort())
})

test('every table with tenant data has Row-Level Security in the migration', () => {
    const sql = templates['src/database/migrations.ts']
    for (const table of ['tenants', 'tenant_members', 'oidc_sessions', 'oidc_codes']) {
        assert.ok(sql.includes(`\${isolate('${table}'`), table)
    }
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
    assert.match(sql, /NULLIF\(current_setting\('app\.tenant_id', true\), ''\)::uuid/)
})

// ---------------------------------------------------------------- .env

test('.env gets the generated master key and admin; .env.example only placeholders', () => {
    assert.ok(files['.env'].includes(`OIDC_MASTER_KEY=${ANSWERS.masterKey}`))
    assert.ok(files['.env'].includes('OIDC_BOOTSTRAP_ADMIN_EMAIL=admin@example.com'))
    assert.ok(files['.env'].includes(`OIDC_BOOTSTRAP_ADMIN_PASSWORD_HASH='${ANSWERS.adminPasswordHash}'`))
    assert.ok(files['.env'].includes("OIDC_BOOTSTRAP_TENANT='Acmes Café'"), 'quotes in the name cannot break .env')
    for (const secret of [ANSWERS.masterKey, ANSWERS.adminPasswordHash, ANSWERS.adminPassword]) {
        assert.ok(!files['.env.example'].includes(secret))
    }
    assert.ok(!files['.env'].includes(ANSWERS.adminPassword), 'the password itself is never stored')
})

// ---------------------------------------------------------------- the questions

test('ask: tenant name and admin email, a random temporary password and its scrypt hash, a random master key', async () => {
    const asked = []
    const prompts = {
        input: async config => {
            asked.push(config)
            return config.message.includes('E-mail') ? '  Admin@Example.COM ' : ' Acme '
        }
    }
    const answers = await oidc.ask({ projectDir: '/projects/acme', prompts })
    assert.equal(answers.tenantName, 'Acme')
    assert.equal(answers.adminEmail, 'admin@example.com')
    assert.equal(asked[0].default, 'acme')
    assert.equal(asked[1].validate('nope'), 'Geef een geldig e-mailadres op')
    assert.equal(asked[1].validate('ada@example.com'), true)
    assert.match(answers.masterKey, /^[0-9a-f]{64}$/)
    assert.ok(answers.adminPassword.length >= 16)
    const [scheme, cost, salt, hash] = answers.adminPasswordHash.split('$')
    assert.equal(scheme, 'scrypt')
    assert.equal(cost, '32768')
    const key = await promisify(scrypt)(answers.adminPassword, Buffer.from(salt, 'hex'), 64, {
        N: 32768,
        r: 8,
        p: 1,
        maxmem: 128 * 32768 * 8 * 2
    })
    assert.equal(key.toString('hex'), hash, 'the backend can verify the hash the CLI made')
})

test('nestjs.ask with "OIDC server" asks the OIDC questions and returns them', async () => {
    const prompts = {
        select: async config => (config.message.includes('database') ? 'postgres' : 'oidc'),
        input: async config => (config.message.includes('E-mail') ? 'boss@example.com' : 'Shop')
    }
    const registry = {
        postgres: { id: 'postgres', label: 'PostgreSQL', description: 'x', ask: async () => ({ ...DB }) }
    }
    const result = await nestjs.ask({ hasFrontend: true, prompts, registry })
    assert.equal(result.auth, false)
    assert.equal(result.oidc.adminEmail, 'boss@example.com')
    assert.equal(result.oidc.tenantName, 'Shop')
    assert.equal(result.oidc.loginUi, true, 'with a frontend the login page lives there')
})

test('buildFiles refuses the OIDC server without a database, or together with the simple login', () => {
    assert.throws(() => buildFiles(null, { oidc: ANSWERS }))
    assert.throws(() => buildFiles(DB, { oidc: ANSWERS, auth: { jwtSecret: 'x' } }))
})

test('the tenant role name fits PostgreSQL (database names are at most 50 characters)', () => {
    assert.equal(oidc.tenantRole('shop'), 'shop_tenant')
    assert.ok(oidc.tenantRole('x'.repeat(50)).length <= 63)
})

// ---------------------------------------------------------------- install flow and summary

test('steps: installs cookie-parser, adds the OIDC scripts and passes the answers on', async () => {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oidc-'))
    const calls = []
    const exec = async (cmd, args, { cwd } = {}) => {
        calls.push([cmd, ...args].join(' '))
        if (args.includes('new')) {
            const root = path.join(cwd, 'backend')
            await fs.mkdir(path.join(root, 'src'), { recursive: true })
            await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { build: 'nest build' } }))
            await fs.writeFile(path.join(root, 'nest-cli.json'), '{}')
        }
    }
    const steps = await nestjs.steps({ projectDir, exec, answers: { database: DB, auth: false, oidc: ANSWERS } })
    assert.ok(steps.some(step => step.title.includes('OIDC')))
    for (const step of steps) await step.run()
    assert.ok(calls.some(line => line.includes('cookie-parser')))
    const pkg = JSON.parse(await fs.readFile(path.join(projectDir, 'backend/package.json'), 'utf8'))
    for (const [name, command] of Object.entries(oidc.SCRIPTS)) assert.equal(pkg.scripts[name], command)
    assert.ok((await fs.readFile(path.join(projectDir, 'backend/.env'), 'utf8')).includes(ANSWERS.masterKey))
    assert.ok(await fs.stat(path.join(projectDir, 'backend/src/oidc/oidc.module.ts')))
    await fs.rm(projectDir, { recursive: true, force: true })
})

test('the summary shows the tenant, the admin and the temporary password once; next shows how to try it', () => {
    const answers = { database: DB, auth: false, oidc: ANSWERS }
    const summary = nestjs
        .summary(answers)
        .map(line => line.text)
        .join('\n')
    assert.ok(summary.includes(ANSWERS.adminEmail))
    assert.ok(summary.includes(ANSWERS.adminPassword))
    assert.ok(summary.includes(ANSWERS.tenantName))
    const next = nestjs.next(answers).join('\n')
    assert.match(next, /oidc\/\.well-known\/openid-configuration/)
    assert.match(next, /npm run oidc:user/)
})
