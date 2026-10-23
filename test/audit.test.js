import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFiles, LOCALES } from '../src/backends/nestjs.js'
import * as oidc from '../src/backends/oidc.js'
import { endpoints } from '../src/backends/docs.js'
import { files, withApi } from '../src/frontends/nextjs.js'
import { AUDIT_MESSAGES, oidcFrontendFiles } from '../src/frontends/oidc.js'
import { frontendReadme } from '../src/frontends/docs.js'

const DB = {
    id: 'postgres',
    mode: 'docker',
    host: 'localhost',
    port: 5432,
    user: 'app',
    password: 'x',
    database: 'shop',
    project: 'shop'
}
const ANSWERS = {
    adminEmail: 'admin@example.com',
    adminPassword: 'x',
    adminPasswordHash: 'scrypt$1$a$b',
    masterKey: 'ab'.repeat(32)
}
const backend = buildFiles(DB, { oidc: ANSWERS })
const frontend = oidcFrontendFiles({ apiPort: 4000 })

/** The actions of src/audit/audit.actions.ts, as written there. */
const actions = [...backend['src/audit/audit.actions.ts'].matchAll(/'([a-z]+\.[a-z_]+)'/g)].map(match => match[1])

test('migration 5: audit_events, append-only, with Row-Level Security; the tenant role may only read it', () => {
    const migrations = backend['src/database/migrations.ts']
    assert.match(migrations, /id: 5,\s+name: 'audit log'/)
    assert.match(migrations, /CREATE TABLE audit_events \(/)
    assert.match(migrations, /BEFORE UPDATE OR DELETE ON audit_events/)
    assert.match(migrations, /BEFORE TRUNCATE ON audit_events/)
    assert.match(migrations, /current_setting\('app\.audit_purge', true\) = 'on'/)
    assert.match(migrations, /isolate\('audit_events', 'tenant_id'\)/)
    assert.match(migrations, /GRANT SELECT ON audit_events TO/)
    assert.match(backend['src/database/database.constants.ts'], /'audit_events'/)
})

test('the audit module is generated, global, and the e2e tests use the store in memory', () => {
    for (const rel of [
        'src/audit/audit.actions.ts',
        'src/audit/audit.context.ts',
        'src/audit/audit.dto.ts',
        'src/audit/audit.module.ts',
        'src/audit/audit.service.ts',
        'src/audit/audit.service.spec.ts',
        'src/audit/audit.store.ts',
        'src/audit/memory-audit.store.ts',
        'src/audit/pg-audit.store.ts',
        'src/tenants/audit.controller.ts',
        'test/audit.e2e-spec.ts'
    ])
        assert.ok(backend[rel], rel)
    assert.match(backend['src/audit/audit.module.ts'], /@Global\(\)/)
    assert.match(backend['src/oidc/oidc.module.ts'], /imports: \[MailModule, AuditModule\]/)
    // The rate limit of the logins is for other modules too (an endpoint that checks a secret of an app)
    assert.match(backend['src/oidc/oidc.module.ts'], /exports: \[[^\]]*\bLoginLimiter,/)
    assert.match(backend['src/access/access.ts'], /setActor\(user\.id, found\.id\)/)
    assert.match(
        backend['test/app.e2e-spec.ts'],
        /overrideProvider\(AUDIT_STORE\)\s+\.useValue\(new MemoryAuditStore\(\)\)/
    )
    for (const [rel, content] of Object.entries(backend).filter(([rel]) => rel.endsWith('.e2e-spec.ts')))
        if (content.includes('BILLING_STORE')) assert.match(content, /AUDIT_STORE/, rel)
})

test('every action is recorded somewhere, in its category', () => {
    assert.ok(actions.length >= 40)
    const code = Object.entries(backend)
        .filter(
            ([rel]) =>
                rel.startsWith('src/') &&
                rel.endsWith('.ts') &&
                !rel.endsWith('.spec.ts') &&
                !rel.startsWith('src/audit/')
        )
        .map(([, content]) => content)
        .join('\n')
    for (const action of actions) assert.ok(code.includes(`'${action}'`), `${action} is never recorded`)
    for (const [, action] of code.matchAll(/audit\.record\(\s*'([^']+)'/g)) assert.ok(actions.includes(action), action)
})

test('every action has a text in all four languages, and so have the details, reasons and categories', () => {
    for (const locale of LOCALES) {
        const messages = AUDIT_MESSAGES[locale]
        assert.deepEqual(
            Object.keys(messages.actions).sort(),
            actions.map(action => action.replace('.', '_')).sort(),
            locale
        )
        assert.deepEqual(Object.keys(messages.categories), ['login', 'account', 'members', 'platform', 'licences'])
        for (const group of ['details', 'reasons', 'methods'])
            assert.deepEqual(Object.keys(messages[group]).sort(), Object.keys(AUDIT_MESSAGES.en[group]).sort(), locale)
    }
    const all = withApi({ ...files }, { port: 4000, oidc: true }, { ui: false })
    for (const locale of LOCALES)
        assert.deepEqual(JSON.parse(all[`messages/${locale}.json`]).Audit, AUDIT_MESSAGES[locale])
})

test('.env: retention and trusted proxies; documented endpoints and README', () => {
    const env = oidc.envLines(ANSWERS, { port: 4000 })
    assert.match(env, /^AUDIT_RETENTION_DAYS=365$/m)
    assert.match(env, /^TRUST_PROXY=loopback$/m)
    const documented = endpoints({ database: DB, oidc: true }).map(e => `${e.method} ${e.path}`)
    for (const route of ['GET /tenants/current/audit', 'GET /admin/audit', 'GET /me/audit'])
        assert.ok(documented.includes(route), route)
    const readme = backend['README.md']
    for (const text of ['### Audit log', 'append-only', 'TRUST_PROXY', 'AUDIT_RETENTION_DAYS', '`audit_events`'])
        assert.ok(readme.includes(text), text)
})

test('the frontend: /audit, recent activity on /security, and the IP address and browser passed to the API', () => {
    assert.ok(frontend['src/app/[locale]/audit/page.tsx'])
    assert.ok(frontend['src/components/audit.tsx'])
    assert.match(frontend['src/app/[locale]/security/page.tsx'], /<AuditLog scope='me' \/>/)
    assert.match(frontend['src/components/shell/app-shell.tsx'], /account\('\/audit'\)/)
    const route = frontend['src/app/api/backend/[...path]/route.ts']
    assert.match(route, /me\\\/audit\$/)
    assert.match(route, /'X-Forwarded-For': forwardedFor\(request\)/)
    assert.match(route, /'User-Agent': request\.headers\.get\('user-agent'\)/)
    const readme = frontendReadme({ api: { port: 4000, oidc: true } })
    for (const text of ['`/audit`', '`/me/audit`', 'recent activity']) assert.ok(readme.includes(text), text)
})
