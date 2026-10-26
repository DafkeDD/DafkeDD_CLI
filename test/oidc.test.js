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
        'src/tenants/tenants.module.ts',
        'src/tenants/members.controller.ts',
        'src/tenants/platform.controller.ts',
        'src/access/access.ts',
        'src/oidc/account.controller.ts',
        'src/oidc/account.service.ts',
        'src/oidc/account-token.ts',
        'src/oidc/account-token.spec.ts',
        'src/mail/mail.service.ts',
        'src/mail/mail.service.spec.ts',
        'src/mail/mails.ts',
        'src/mail/mails.spec.ts',
        'test/accounts.e2e-spec.ts',
        'src/oidc/totp.ts',
        'src/oidc/totp.spec.ts',
        'src/oidc/mfa.service.ts',
        'src/oidc/mfa.controller.ts',
        'src/tenants/presence.controller.ts',
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
    for (const table of ['tenants', 'tenant_members', 'tenant_invitations', 'oidc_sessions', 'oidc_codes']) {
        assert.ok(sql.includes(`\${isolate('${table}'`), table)
    }
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
    assert.match(sql, /NULLIF\(current_setting\('app\.tenant_id', true\), ''\)::uuid/)
})

test('a running login is an encrypted cookie, not a table; one login creates at most one session', () => {
    const sql = templates['src/database/migrations.ts']
    assert.doesNotMatch(sql, /oidc_interactions/)
    assert.match(sql, /interaction_hash text NOT NULL UNIQUE/)
    const cookie = templates['src/oidc/interaction.ts']
    assert.match(cookie, /sealInteraction/)
    assert.match(cookie, /openInteraction/)
    assert.match(cookie, /deriveKey\(masterKey, 'oidc interaction cookie v1'\)/)
    assert.ok(templates['src/oidc/interaction.spec.ts'], 'unit tests of the login cookie')
    const controller = templates['src/oidc/oidc.controller.ts']
    assert.match(controller, /httpOnly: true/)
    assert.match(controller, /interactionCookiePath\(cookie\.id\)/)
    assert.match(templates['src/oidc/store/pg-oidc.store.ts'], /ON CONFLICT \(interaction_hash\) DO NOTHING/)
})

test('the API docs explain the login cookie and no longer list a table for running logins', () => {
    const docs = files['README.md']
    for (const text of ['### Login cookie', 'oidc_ia_<id>', 'HttpOnly', 'interaction_hash', 'same site']) {
        assert.ok(docs.includes(text), text)
    }
    assert.doesNotMatch(Object.values(files).join('\n'), /oidc_interactions/)
})

test('the superadmin needs no organisation: platform logins and a platform choice', () => {
    const service = templates['src/oidc/oidc.service.ts']
    assert.match(service, /export const PLATFORM = 'platform'/)
    assert.match(service, /user\.isSuperadmin\s*\? this\.finish\(interaction, user, null\)/)
    assert.match(templates['src/database/migrations.ts'], /-- NULL: a platform session/)
    assert.match(templates['src/access/access.ts'], /needed !== 'account' && needed !== 'superadmin'/)
    for (const locale of LOCALES) assert.ok(oidc.MESSAGES[locale].PLATFORM_CHOICE, locale)
})

test('two-step verification is required by default, with our own TOTP and the RFC test vectors', () => {
    assert.match(files['.env'], /^OIDC_MFA=required$/m)
    const totp = templates['src/oidc/totp.ts']
    assert.match(totp, /createHmac\('sha1'/)
    assert.match(templates['src/oidc/totp.spec.ts'], /94287082/)
    assert.match(templates['src/oidc/oidc.config.ts'], /'OIDC_MFA'\) \?\? 'required'/)
    assert.match(templates['src/oidc/oidc.service.ts'], /this\.config\.mfaRequired/)
    assert.match(templates['src/oidc/mfa.service.ts'], /oidc\.MFA_REQUIRED/)
    for (const locale of LOCALES)
        for (const key of ['MFA_TITLE', 'MFA_SETUP_TITLE', 'RECOVERY_TITLE', 'MFA_INVALID_CODE', 'MFA_REQUIRED'])
            assert.ok(oidc.MESSAGES[locale][key], `${locale} ${key}`)
})

test('.env gets the SMTP settings for Mailpit, the app URL and open registration', () => {
    const env = files['.env']
    for (const line of [
        'SMTP_HOST=localhost',
        'SMTP_PORT=1025',
        'SMTP_SECURE=false',
        'OIDC_REGISTRATION=open',
        'APP_URL=http://localhost:3000'
    ])
        assert.match(env, new RegExp('^' + line.replace(/[.]/g, '\\.') + '$', 'm'), line)
    assert.match(env, /^SMTP_USER=$/m)
    assert.match(env, /^SMTP_PASSWORD=$/m)
    assert.match(env, /^MAIL_FROM='.+ <no-reply@example\.com>'$/m)
    assert.equal(oidc.SCRIPTS['mail:dev'].includes('axllent/mailpit'), true)
    for (const locale of LOCALES)
        assert.deepEqual(Object.keys(oidc.MAIL_MESSAGES[locale]), Object.keys(oidc.MAIL_MESSAGES.en))
    assert.ok(files['src/i18n/nl/mail.json'])
})

// ---------------------------------------------------------------- .env

test('.env gets the generated master key and admin; .env.example only placeholders', () => {
    assert.ok(files['.env'].includes(`OIDC_MASTER_KEY=${ANSWERS.masterKey}`))
    assert.ok(files['.env'].includes('OIDC_BOOTSTRAP_ADMIN_EMAIL=admin@example.com'))
    assert.ok(files['.env'].includes(`OIDC_BOOTSTRAP_ADMIN_PASSWORD_HASH='${ANSWERS.adminPasswordHash}'`))
    assert.ok(!files['.env'].includes('OIDC_BOOTSTRAP_TENANT'), 'the superadmin needs no organisation')
    for (const secret of [ANSWERS.masterKey, ANSWERS.adminPasswordHash, ANSWERS.adminPassword]) {
        assert.ok(!files['.env.example'].includes(secret))
    }
    assert.ok(!files['.env'].includes(ANSWERS.adminPassword), 'the password itself is never stored')
})

// ---------------------------------------------------------------- the questions

test('ask: only the superadmin email (no organisation), a random temporary password and its hash, a master key', async () => {
    const asked = []
    const prompts = {
        input: async config => {
            asked.push(config)
            return '  Admin@Example.COM '
        },
        // No other OpenID Connect server
        select: async () => 'no',
        // No demo data (the default)
        confirm: async config => {
            asked.push(config)
            return config.default
        }
    }
    const answers = await oidc.ask({ projectDir: '/projects/acme', prompts })
    assert.equal(asked.length, 2, 'the email and the demo data')
    assert.deepEqual(answers.externals, [])
    assert.match(asked[1].message, /Demodata/)
    assert.equal(answers.demo, null)
    assert.match(asked[0].message, /superadmin/)
    assert.equal(answers.tenantName, undefined)
    assert.equal(answers.adminEmail, 'admin@example.com')
    assert.equal(answers.appName, 'acme')
    assert.equal(asked[0].validate('nope'), 'Geef een geldig e-mailadres op')
    assert.equal(asked[0].validate('ada@example.com'), true)
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
        input: async config => (config.message.includes('E-mail') ? 'boss@example.com' : 'Shop'),
        confirm: async () => true
    }
    const registry = {
        postgres: { id: 'postgres', label: 'PostgreSQL', description: 'x', ask: async () => ({ ...DB }) }
    }
    const result = await nestjs.ask({ hasFrontend: true, prompts, registry })
    assert.equal(result.auth, false)
    assert.equal(result.oidc.adminEmail, 'boss@example.com')
    assert.equal(result.oidc.loginUi, true, 'with a frontend the login page lives there')
    // Demo data asked: a password for the demo accounts, shown once
    assert.ok(result.oidc.demo.password.length >= 16)
})

test('demo data: npm run demo:data (added once, --remove), a step only when asked and the database is local', async () => {
    const script = files['scripts/demo-data.mjs']
    assert.ok(!script.includes('__USERS_TABLE__'), 'the users table is filled in')
    assert.match(script, /NODE_ENV === 'production'/)
    assert.match(script, /remove: \{ type: 'boolean', default: false \}/)
    assert.match(script, /The demo data is there already/)
    assert.match(script, /@demo\.example\.com|DOMAIN = 'demo\.example\.com'/)
    assert.equal(oidc.SCRIPTS['demo:data'], 'node scripts/demo-data.mjs')
    const titles = async answers =>
        (await nestjs.steps({ projectDir: '/tmp/x', exec: async () => {}, answers })).map(step => step.title)
    const local = { ...DB, mode: 'local' }
    assert.ok(
        (await titles({ database: local, oidc: { ...ANSWERS, demo: { password: 'p' } } })).includes(
            'Demodata toevoegen'
        )
    )
    assert.ok(!(await titles({ database: local, oidc: ANSWERS })).includes('Demodata toevoegen'))
    // The summary: the accounts and the password once, or how to add it later
    const summary = demo => nestjs.summary({ database: { ...local, connection: 'ok' }, oidc: { ...ANSWERS, demo } })
    assert.ok(
        summary({ password: 'pw-1', added: true }).some(line => line.text.includes('an.peeters@demo.example.com'))
    )
    assert.ok(summary({ password: 'pw-2' }).some(line => line.text.includes('npm run demo:data -- --password pw-2')))
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

test('the summary shows the superadmin and the temporary password once; next shows how to try it', () => {
    const answers = { database: DB, auth: false, oidc: ANSWERS }
    const summary = nestjs
        .summary(answers)
        .map(line => line.text)
        .join('\n')
    assert.ok(summary.includes(ANSWERS.adminEmail))
    assert.ok(summary.includes(ANSWERS.adminPassword))
    assert.match(summary, /superadmin/)
    assert.match(summary, /\/admin/)
    const next = nestjs.next(answers).join('\n')
    assert.match(next, /oidc\/\.well-known\/openid-configuration/)
    assert.match(next, /npm run oidc:user/)
})

test('the vault reads PKCS#12 with node:crypto; node-forge is only for the tests; uploads get a larger body', () => {
    const reader = files['src/vault/pkcs12.ts']
    assert.ok(!reader.includes('node-forge'), 'no library with an open advisory in production')
    assert.match(reader, /from 'node:crypto'/)
    assert.ok(files['src/vault/pkcs12.spec.ts'].includes('RC2 and 3DES (legacy)'))
    assert.ok(!oidc.PACKAGES.dependencies.some(name => name.startsWith('node-forge')))
    assert.ok(oidc.PACKAGES.devDependencies.some(name => name.startsWith('node-forge')))
    for (const rel of Object.keys(files).filter(rel => rel.startsWith('src/') && !rel.endsWith('.spec.ts')))
        assert.ok(!files[rel].includes("from 'node-forge'"), rel)
    assert.match(files['src/setup.ts'], /json\(\{ limit: '3mb' \}\)/)
    assert.match(files['src/app.module.ts'], /SupportModule,\s+StatsModule/)
})
