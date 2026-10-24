import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFiles, LOCALES } from '../src/backends/nestjs.js'
import * as oidc from '../src/backends/oidc.js'
import { endpoints } from '../src/backends/docs.js'
import { files, withApi } from '../src/frontends/nextjs.js'
import { LICENSE_MESSAGES, oidcFrontendFiles } from '../src/frontends/oidc.js'
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

// ---------------------------------------------------------------- backend

test('migration 4: products, subscriptions, trials, seats, free seats, discount codes and payments, with RLS', () => {
    const migrations = backend['src/database/migrations.ts']
    assert.match(migrations, /id: 4,\s+name: 'licences, trials, subscriptions and discount codes'/)
    const tenantTables = [
        'tenant_subscriptions',
        'discount_redemptions',
        'license_grants',
        'license_trials',
        'license_assignments',
        'billing_payments'
    ]
    for (const table of ['license_products', 'discount_codes', ...tenantTables])
        assert.match(migrations, new RegExp(`CREATE TABLE ${table} \\(`), table)
    for (const table of tenantTables) {
        assert.match(migrations, new RegExp(`isolate\\('${table}', 'tenant_id'\\)`), table)
        assert.match(backend['src/database/database.constants.ts'], new RegExp(`'${table}'`), table)
    }
    // Global tables: no tenant, so no RLS
    assert.doesNotMatch(migrations, /isolate\('license_products'/)
    assert.doesNotMatch(migrations, /isolate\('discount_codes'/)
})

test('the billing module, the stores, Mollie and the fake checkout are generated and wired into the app', () => {
    for (const rel of [
        'src/billing/billing.module.ts',
        'src/billing/billing.service.ts',
        'src/billing/billing.config.ts',
        'src/billing/billing.dto.ts',
        'src/billing/license.guard.ts',
        'src/billing/licenses.controller.ts',
        'src/billing/my-licenses.controller.ts',
        'src/billing/billing-admin.controller.ts',
        'src/billing/billing.controller.ts',
        'src/billing/store/billing.store.ts',
        'src/billing/store/memory-billing.store.ts',
        'src/billing/store/pg-billing.store.ts',
        'src/billing/payments/payment-provider.ts',
        'src/billing/payments/mollie.provider.ts',
        'src/billing/payments/fake.provider.ts',
        'src/billing/billing.service.spec.ts',
        'src/billing/payments/mollie.provider.spec.ts',
        'test/billing.e2e-spec.ts'
    ])
        assert.ok(backend[rel], rel)
    assert.match(backend['src/app.module.ts'], /import \{ BillingModule \} from '\.\/billing\/billing\.module\.js'/)
    assert.match(backend['src/app.module.ts'], /BillingModule,/)
    // The e2e tests run without a database
    assert.match(
        backend['test/app.e2e-spec.ts'],
        /overrideProvider\(BILLING_STORE\)\s+\.useValue\(new MemoryBillingStore\(\)\)/
    )
    // The fake checkout never in production; the status always comes from the provider
    assert.match(backend['src/billing/billing.module.ts'], /PAYMENTS=fake is only for development/)
    assert.match(backend['src/billing/billing.controller.ts'], /handlePayment\(id\)/)
    // Seats are counted under a lock, a payment is applied once
    const pg = backend['src/billing/store/pg-billing.store.ts']
    assert.match(pg, /pg_advisory_xact_lock/)
    assert.match(pg, /FOR UPDATE/)
    assert.match(pg, /applying_until IS NULL OR applying_until < now\(\)/)
    const service = backend['src/billing/billing.service.ts']
    // Only the newest checkout activates a purchase; Mollie gets an idempotency key; a renewal gets a week of grace
    assert.match(service, /isCurrentFirst\(subscription, payment\)/)
    assert.match(service, /idempotencyKey: `subscription-\$\{payment\.id\}`/)
    assert.match(service, /const GRACE_MS = 7 \* DAY/)
    // Tenant code cannot change the Mollie customer of its tenant
    assert.match(backend['src/database/migrations.ts'], /GRANT UPDATE \(name\) ON tenants TO/)
})

test('@License(code): a trial or a seat, superadmins always', () => {
    const guard = backend['src/billing/license.guard.ts']
    assert.match(guard, /export const License = /)
    assert.match(guard, /billing\.LICENSE_REQUIRED/)
    const service = backend['src/billing/billing.service.ts']
    assert.match(service, /if \(superadmin\) return \{ access: true as const, via: 'superadmin' as const \}/)
    assert.match(service, /BILLING_TRIAL_DAYS|this\.config\.trialDays/)
    // A year is always cheaper than twelve months
    assert.match(service, /billing\.YEAR_NOT_CHEAPER/)
    // A demo never starts by itself: a member asks it (POST /me/licenses/:productCode/trial), once
    assert.doesNotMatch(service, /onMemberJoined|startTrials/)
    assert.match(service, /async requestDemo\(/)
    assert.match(backend['src/billing/my-licenses.controller.ts'], /@Post\(':productCode\/trial'\)/)
    for (const locale of LOCALES) assert.ok(oidc.BILLING_MESSAGES[locale].DEMO_USED, locale)
})

test('billing texts exist in all four languages, with every key the code uses', () => {
    const keys = Object.keys(oidc.BILLING_MESSAGES.en).sort()
    for (const locale of LOCALES) {
        assert.deepEqual(Object.keys(oidc.BILLING_MESSAGES[locale]).sort(), keys, locale)
        assert.deepEqual(JSON.parse(backend[`src/i18n/${locale}/billing.json`]), oidc.BILLING_MESSAGES[locale])
    }
    const code = Object.entries(backend)
        .filter(([rel]) => rel.startsWith('src/billing/') && !rel.endsWith('.spec.ts'))
        .map(([, content]) => content)
        .join('\n')
    for (const [, key] of code.matchAll(/'billing\.([A-Z_]+)'/g)) assert.ok(keys.includes(key), `billing.${key}`)
})

test('.env: fake payments while developing, Mollie in .env.example, 14 trial days', () => {
    const env = oidc.envLines(ANSWERS, { port: 4000 })
    assert.match(env, /^PAYMENTS=fake$/m)
    assert.match(env, /^MOLLIE_API_KEY=$/m)
    assert.match(env, /^BILLING_TRIAL_DAYS=14$/m)
    assert.match(env, /^# PUBLIC_API_URL=/m)
    assert.match(oidc.envLines(ANSWERS, { port: 4000, example: true }), /^PAYMENTS=mollie$/m)
})

test('every billing route is documented, and the README explains licences, Mollie and discount codes', () => {
    const documented = endpoints({ database: DB, oidc: true }).map(e => `${e.method} ${e.path}`)
    for (const route of [
        'GET /tenants/current/licenses',
        'POST /tenants/current/licenses/subscriptions',
        'GET /me/licenses',
        'POST /billing/webhook',
        'POST /admin/discounts',
        'POST /admin/tenants/:id/grants',
        'POST /admin/tenants/:id/trials'
    ])
        assert.ok(documented.includes(route), route)
    // The fake checkout is for development only: not an API endpoint
    assert.ok(!documented.some(route => route.includes('/billing/fake')))
    const readme = backend['README.md']
    for (const text of [
        '### Licences and payments',
        '@License(',
        'PAYMENTS=mollie',
        'ngrok',
        '100% makes it free',
        '`license_trials`'
    ])
        assert.ok(readme.includes(text), text)
})

// ---------------------------------------------------------------- frontend

test('the frontend has /licenses, the return page and the admin of products and codes', () => {
    for (const rel of [
        'src/app/[locale]/licenses/page.tsx',
        'src/app/[locale]/licenses/return/page.tsx',
        'src/components/licenses.tsx',
        'src/components/billing-admin.tsx'
    ])
        assert.ok(frontend[rel], rel)
    assert.match(frontend['src/app/[locale]/admin/catalog/page.tsx'], /<BillingAdmin \/>/)
    // The own licences, and asking a demo of one product
    assert.match(
        frontend['src/app/api/backend/[...path]/route.ts'],
        /me\\\/licenses\(\?:\\\/\[a-z0-9-\]\+\\\/trial\)\?\$/
    )
    assert.match(frontend['src/app/[locale]/profile/page.tsx'], /<AskDemo code=\{license\.code\} \/>/)
    for (const locale of ['en', 'nl', 'fr', 'de']) assert.ok(LICENSE_MESSAGES[locale].askDemo, locale)
    // The status after the checkout comes from the API, never from the URL
    assert.match(frontend['src/components/licenses.tsx'], /\/sync`/)
})

test('the licence texts are in the messages of every language, and the frontend README lists the pages', () => {
    const all = withApi({ ...files }, { port: 4000, oidc: true }, { ui: false })
    for (const locale of LOCALES)
        assert.deepEqual(JSON.parse(all[`messages/${locale}.json`]).Licenses, LICENSE_MESSAGES[locale])
    const readme = frontendReadme({ api: { port: 4000, oidc: true } })
    for (const page of ['`/licenses`', '`/licenses/return`', '`/me/licenses`']) assert.ok(readme.includes(page), page)
})
