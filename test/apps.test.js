import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFiles } from '../src/backends/nestjs.js'
import { endpoints } from '../src/backends/docs.js'
import { frontendReadme } from '../src/frontends/docs.js'
import { files as nextFiles, withApi } from '../src/frontends/nextjs.js'
import { APPS_MESSAGES, AUDIT_MESSAGES, oidcFrontendFiles } from '../src/frontends/oidc.js'

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
const LANGUAGES = ['en', 'nl', 'fr', 'de']

test('the backend: apps on /admin for superadmins, migration 9 and the tests', () => {
    for (const rel of [
        'src/oidc/clients/clients.controller.ts',
        'src/oidc/clients/clients.service.ts',
        'src/oidc/clients/clients.dto.ts',
        'test/clients.e2e-spec.ts'
    ])
        assert.ok(backend[rel], rel)
    const controller = backend['src/oidc/clients/clients.controller.ts']
    assert.match(controller, /@Controller\('admin\/clients'\)\s+@Access\('superadmin'\)/)
    const service = backend['src/oidc/clients/clients.service.ts']
    // A secret of 32 random bytes, only its hash stored, never sent back after
    assert.match(service, /randomBytes\(32\)\.toString\('base64url'\)/)
    assert.match(service, /secretHash: secret \? sha256\(secret\) : null/)
    assert.match(service, /const \{ secretHash, \.\.\.rest \} = client/)
    assert.match(service, /assertRedirectUri\(value\)/)
    const migrations = backend['src/database/migrations.ts']
    assert.match(migrations, /id: 9,\s+name: 'clients managed on \/admin'/)
    assert.match(migrations, /ADD COLUMN source text NOT NULL DEFAULT 'file'/)
    const pg = backend['src/oidc/store/pg-oidc.store.ts']
    // The clients file never takes over an app made on /admin; a disabled app logs nobody in
    assert.match(pg, /WHERE oidc_clients\.source = 'file'/)
    assert.match(pg, /WHERE client_id = \$1 AND disabled_at IS NULL/)
    for (const action of ['created', 'updated', 'secret_rotated', 'disabled', 'enabled', 'deleted'])
        assert.match(backend['src/audit/audit.actions.ts'], new RegExp(`'platform\\.client_${action}'`), action)
    const messages = JSON.parse(backend['src/i18n/nl/oidc.json'])
    for (const key of [
        'CLIENT_INVALID_URI',
        'CLIENT_NO_REDIRECT',
        'CLIENT_EXISTS',
        'CLIENT_NOT_FOUND',
        'CLIENT_FROM_FILE',
        'CLIENT_PUBLIC',
        'CLIENT_DISABLE_FIRST'
    ])
        for (const language of LANGUAGES)
            assert.ok(JSON.parse(backend[`src/i18n/${language}/oidc.json`])[key], `${language} ${key}`)
    assert.match(messages.CLIENT_INVALID_URI, /\{uri\}/)
})

test('every route is documented, also in the README', () => {
    const documented = endpoints({ database: DB, oidc: true }).map(e => `${e.method} ${e.path}`)
    for (const route of [
        'GET /admin/clients',
        'POST /admin/clients',
        'PUT /admin/clients/:clientId',
        'PATCH /admin/clients/:clientId',
        'DELETE /admin/clients/:clientId',
        'POST /admin/clients/:clientId/secret'
    ])
        assert.ok(documented.includes(route), route)
    assert.ok(backend['README.md'].includes('superadmins make apps on `/admin`'))
    assert.ok(frontendReadme({ ui: 'none', api: { port: 4000, oidc: true } }).includes('the **apps** that may log in'))
})

test('the frontend: the card "Apps" on /admin, PUT through /api/backend, the texts in four languages', () => {
    assert.match(frontend['src/app/[locale]/admin/page.tsx'], /<Apps \/>/)
    const apps = frontend['src/components/apps.tsx']
    assert.match(apps, /useTranslations\('Apps'\)/)
    assert.match(apps, /admin\/clients\/\$\{app\.clientId\}\/secret/)
    const proxy = frontend['src/app/api/backend/[...path]/route.ts']
    assert.match(proxy, /forward as PUT/)
    const allowed = new RegExp(/const APPS = \/(.+)\/$/m.exec(proxy)[1])
    for (const path of ['admin/clients', 'admin/clients/partner.planner', 'admin/clients/billing-1a2b3c/secret'])
        assert.ok(allowed.test(path), path)
    for (const path of ['admin/clients/..', 'admin/clients/a/../b', 'admin/clients/a/other'])
        assert.ok(!allowed.test(path), path)

    for (const language of LANGUAGES) {
        assert.deepEqual(Object.keys(APPS_MESSAGES[language]).sort(), Object.keys(APPS_MESSAGES.en).sort(), language)
        for (const action of ['created', 'updated', 'secret_rotated', 'disabled', 'enabled', 'deleted'])
            assert.ok(AUDIT_MESSAGES[language].actions['platform_client_' + action], `${language} ${action}`)
        assert.ok(AUDIT_MESSAGES[language].details.firstParty, language)
    }
    const all = withApi({ ...nextFiles }, { port: 4000, oidc: true }, { ui: false })
    assert.deepEqual(JSON.parse(all['messages/fr.json']).Apps, APPS_MESSAGES.fr)
})

test('an app is a product: migration 11, the licence claim in its tokens, the product on /admin', () => {
    assert.match(backend['src/database/migrations.ts'], /id: 11,\s+name: 'an app is a product'/)
    assert.match(backend['src/database/migrations.ts'], /ADD COLUMN product text/)
    assert.match(backend['src/oidc/store/pg-oidc.store.ts'], /product = EXCLUDED\.product/)
    // The billing module answers for the OpenID Connect part (no circular module dependency)
    assert.match(backend['src/oidc/app-licenses.ts'], /export class AppLicenses/)
    assert.match(backend['src/billing/billing.service.ts'], /this\.appLicenses\.register\(/)
    assert.match(backend['src/billing/billing.service.ts'], /reason: 'first login to the app'/)
    const tokens = backend['src/oidc/tokens.service.ts']
    assert.match(tokens, /license: await this\.licenses\.claim\(/)
    assert.match(tokens, /\.\.\.superadmin,\s+\.\.\.license,\s+\.\.\.roles\s+\}/)
    const service = backend['src/oidc/clients/clients.service.ts']
    for (const key of ['oidc.CLIENT_UNKNOWN_PRODUCT', 'oidc.CLIENT_PRODUCT_TAKEN', 'product: client.product ?? null'])
        assert.ok(service.includes(key), key)
    for (const locale of LANGUAGES) {
        const oidc = JSON.parse(backend[`src/i18n/${locale}/oidc.json`])
        assert.match(oidc.CLIENT_UNKNOWN_PRODUCT, /\{product\}/, locale)
        assert.match(oidc.CLIENT_PRODUCT_TAKEN, /\{app\}/, locale)
        for (const key of ['product', 'productNone', 'productHint', 'sells'])
            assert.ok(APPS_MESSAGES[locale][key], `${locale} ${key}`)
    }
    assert.match(frontend['src/components/apps.tsx'], /backend\('admin\/products'\)/)
    assert.match(frontend['src/components/apps.tsx'], /<select name='product'/)
    // Documented: the field, the errors, the claim
    const create = endpoints({ database: DB, oidc: true }).find(e => e.method === 'POST' && e.path === '/admin/clients')
    assert.ok(create.body.fields.some(([name]) => name === 'product'))
    assert.ok(create.errors.some(([, key]) => key === 'oidc.CLIENT_PRODUCT_TAKEN'))
    const readme = backend['README.md']
    for (const text of ['### Apps are products (one licence per user per app)', '"license": { "product": "planner"'])
        assert.ok(readme.includes(text), text)
    assert.ok(backend['test/clients.e2e-spec.ts'].includes('its tokens carry the licence of the user'))
})

test('roles per app: migration 12, the roles claim, /members for the admins, roles:push in the app', async () => {
    const { buildFiles: build } = await import('../src/backends/nestjs.js')
    const { DEFAULT_ROLES } = await import('../src/backends/app.js')
    const { APP_ROLES_MESSAGES } = await import('../src/frontends/oidc.js')
    assert.match(backend['src/database/migrations.ts'], /id: 12,\s+name: 'roles per app'/)
    assert.match(backend['src/database/migrations.ts'], /CREATE TABLE app_role_assignments/)
    assert.match(backend['src/database/database.constants.ts'], /'app_role_assignments'/)
    assert.match(backend['src/oidc/tokens.service.ts'], /roles: await this\.appRoles\.claim\(/)
    assert.match(backend['src/oidc/app-roles.ts'], /export function effectiveRoles/)
    assert.match(
        backend['src/tenants/app-roles.controller.ts'],
        /@Controller\('tenants\/current\/apps'\)\s+@Access\('admin'\)/
    )
    assert.match(backend['src/oidc/clients/link.controller.ts'], /@Post\('roles'\)/)
    for (const locale of LANGUAGES) {
        const oidc = JSON.parse(backend[`src/i18n/${locale}/oidc.json`])
        for (const key of ['APP_NOT_FOUND', 'ROLE_UNKNOWN', 'ROLES_INVALID']) assert.ok(oidc[key], `${locale} ${key}`)
        assert.deepEqual(Object.keys(APP_ROLES_MESSAGES[locale]), Object.keys(APP_ROLES_MESSAGES.en), locale)
    }
    // The members page of the login server, through /api/backend (client ids may have dots)
    assert.match(frontend['src/app/[locale]/members/page.tsx'], /<AppRoles \/>/)
    assert.match(frontend['src/app/api/backend/[...path]/route.ts'], /!APP_ROLES\.test\(path\)/)
    // The app: config/app-roles.json, @Roles, the push script
    const LINK = {
        issuer: 'http://localhost:4000/oidc',
        apiUrl: 'http://localhost:4000',
        clientId: 'planner',
        port: 3001
    }
    const app = build({ ...DB, mode: 'local' }, { app: LINK })
    assert.deepEqual(JSON.parse(app['config/app-roles.json']), DEFAULT_ROLES)
    assert.ok(DEFAULT_ROLES.some(role => role.default))
    assert.match(app['src/notes/notes.controller.ts'], /@Roles\('editor', 'viewer'\)/)
    assert.match(app['src/notes/notes.controller.ts'], /@Roles\('editor'\)/)
    assert.match(app['scripts/roles-push.mjs'], /\/link\/roles/)
    assert.ok(app['README.md'].includes('### Roles'))
    assert.ok(backend['README.md'].includes('### Roles per app'))
    assert.ok(backend['test/clients.e2e-spec.ts'].includes('roles per app: the developer sends them'))
})
