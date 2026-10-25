import { ConfigService } from '@nestjs/config'
import pg from 'pg'
import { TENANT_ROLE, USERS_TABLE } from '../src/database/database.constants.js'
import { DatabaseService } from '../src/database/database.service.js'
import { PgBillingStore } from '../src/billing/store/pg-billing.store.js'
import { PgOidcStore } from '../src/oidc/store/pg-oidc.store.js'
import { PgVaultStore } from '../src/vault/pg-vault.store.js'

/**
 * Profiles, billing details, professions, the app catalogue and the eHealth vault against a REAL PostgreSQL (the one
 * from .env): npm run test:db. Uses its own database <DATABASE_NAME>_test_profiles and removes it afterwards.
 */
try {
    process.loadEnvFile()
} catch {
    // no .env file: use the environment as it is
}

const settings = {
    DATABASE_HOST: process.env.DATABASE_HOST ?? 'localhost',
    DATABASE_PORT: process.env.DATABASE_PORT ?? '5432',
    DATABASE_USER: process.env.DATABASE_USER ?? 'postgres',
    DATABASE_PASSWORD: process.env.DATABASE_PASSWORD ?? '',
    DATABASE_NAME: (process.env.DATABASE_NAME ?? 'app') + '_test_profiles'
}

async function admin(sql: string) {
    const client = new pg.Client({
        host: settings.DATABASE_HOST,
        port: Number(settings.DATABASE_PORT),
        user: settings.DATABASE_USER,
        password: settings.DATABASE_PASSWORD,
        database: 'postgres'
    })
    await client.connect()
    try {
        await client.query(sql)
    } finally {
        await client.end()
    }
}

describe('profiles, billing details, professions, catalogue and vault (real PostgreSQL)', () => {
    let database: DatabaseService
    let store: PgOidcStore
    let billing: PgBillingStore
    let vault: PgVaultStore

    beforeAll(async () => {
        await admin(`DROP DATABASE IF EXISTS "${settings.DATABASE_NAME}" WITH (FORCE)`)
        await admin(`CREATE DATABASE "${settings.DATABASE_NAME}"`)
        database = new DatabaseService(new ConfigService(settings))
        await database.ready()
        store = new PgOidcStore(database)
        billing = new PgBillingStore(database)
        vault = new PgVaultStore(database)
    })

    afterAll(async () => {
        await database?.onModuleDestroy()
        await admin(`DROP DATABASE IF EXISTS "${settings.DATABASE_NAME}" WITH (FORCE)`)
    })

    it('stores the profile, a pending email address and what the eID told', async () => {
        const created = await store.register(
            {
                email: 'ada@example.com',
                name: 'Ada Lovelace',
                passwordHash: 'x',
                emailVerified: false,
                locale: 'nl',
                firstName: 'Ada',
                lastName: 'Lovelace',
                phone: '+32 470 12 34 56'
            },
            { name: 'Praktijk', slug: 'praktijk' }
        )
        const id = created?.user.id ?? ''
        expect(await store.findProfile(id)).toEqual({
            firstName: 'Ada',
            lastName: 'Lovelace',
            phone: '+32 470 12 34 56',
            pendingEmail: null,
            rrnEncrypted: null,
            address: null
        })
        await store.updateProfile(id, { firstName: 'Augusta', name: 'Augusta Lovelace', phone: null, locale: 'fr' })
        expect(await store.findProfile(id)).toMatchObject({ firstName: 'Augusta', lastName: 'Lovelace', phone: null })
        expect(await store.findUserById(id)).toMatchObject({ name: 'Augusta Lovelace', locale: 'fr' })

        await store.setEidDetails(id, { rrnEncrypted: 'v1.x.y.z', address: 'Kerkstraat 1' })
        await store.setEidDetails(id, { rrnEncrypted: 'v1.a.b.c', address: null })
        expect(await store.findProfile(id)).toMatchObject({ rrnEncrypted: 'v1.a.b.c', address: 'Kerkstraat 1' })
        await store.setEidDetails(id, { rrnEncrypted: null, address: null })
        expect(await store.findProfile(id)).toMatchObject({ rrnEncrypted: null, address: null })

        await store.createUser({
            email: 'bob@example.com',
            name: 'Bob',
            passwordHash: 'x',
            emailVerified: true,
            locale: null
        })
        await store.setPendingEmail(id, 'new@example.com')
        expect((await store.findProfile(id))?.pendingEmail).toBe('new@example.com')
        expect(await store.changeEmail(id, 'BOB@example.com')).toBe(false)
        expect(await store.changeEmail(id, 'new@example.com')).toBe(true)
        expect(await store.findUserById(id)).toMatchObject({ email: 'new@example.com', emailVerified: true })
        expect((await store.findProfile(id))?.pendingEmail).toBeNull()
        // The tenant role still cannot read the national register number
        const rows = await database.query(
            `SELECT column_name FROM information_schema.column_privileges
              WHERE table_name = $1 AND grantee = $2`,
            [USERS_TABLE, TENANT_ROLE]
        )
        expect(rows.rows.map(row => (row as { column_name: string }).column_name)).not.toContain('rrn_enc')
    })

    it('keeps billing details, plan and city of tenants, and summarises them with their contact', async () => {
        const tenant = await store.createTenant('Globex', 'globex')
        expect(await store.findTenantDetails(tenant.id)).toEqual({
            company: null,
            vat: null,
            billingAddress: null,
            billingEmail: null,
            city: null,
            plan: 'Starter',
            contactName: null
        })
        expect(
            await store.updateTenant(tenant.id, {
                company: 'Globex BV',
                vat: 'BE0123',
                plan: 'Pro',
                contactName: 'Jan'
            })
        ).toBe(true)
        expect(await store.updateTenant('00000000-0000-4000-8000-000000000000', { city: 'Gent' })).toBe(false)
        let summary = await store.findTenantSummary(tenant.id)
        expect(summary).toMatchObject({ name: 'Globex', company: 'Globex BV', plan: 'Pro', members: 0, contact: null })

        await store.saveInvitation({
            tenantId: tenant.id,
            email: 'boss@globex.com',
            role: 'admin',
            invitedBy: null,
            apps: [],
            expiresAt: new Date(Date.now() + 60_000)
        })
        summary = await store.findTenantSummary(tenant.id)
        expect(summary).toMatchObject({ invitations: 1, contact: { name: 'Jan', email: 'boss@globex.com' } })

        const boss = await store.createUser({
            email: 'boss@globex.com',
            name: 'The Boss',
            passwordHash: 'x',
            emailVerified: true,
            locale: null
        })
        await store.addMember(tenant.id, boss?.id ?? '', 'admin')
        expect((await store.listTenantSummaries()).find(item => item.id === tenant.id)).toMatchObject({
            members: 1,
            contact: { name: 'The Boss', email: 'boss@globex.com' }
        })
    })

    it('sets the profession of a member with Row-Level Security', async () => {
        const tenant = await store.createTenant('Kliniek', 'kliniek')
        const other = await store.createTenant('Other', 'other')
        const doc = await store.createUser({
            email: 'doc@example.com',
            name: 'Doc',
            passwordHash: 'x',
            emailVerified: true,
            locale: null
        })
        await store.addMember(tenant.id, doc?.id ?? '', 'admin')
        expect((await store.findMember(tenant.id, doc?.id ?? ''))?.profession).toBe('staff')
        // Another tenant cannot change it
        expect(await store.setMemberProfession(other.id, doc?.id ?? '', 'doctor')).toBe(false)
        expect(await store.setMemberProfession(tenant.id, doc?.id ?? '', 'doctor')).toBe(true)
        expect((await store.listMembers(tenant.id))[0]?.profession).toBe('doctor')
        await expect(database.query('UPDATE tenant_members SET profession = $1', ['nurse'])).rejects.toThrow(/check/)
    })

    it('stores the catalogue fields of products and the environment of subscriptions', async () => {
        const product = await billing.createProduct({
            code: 'agenda',
            name: 'Online Agenda',
            description: 'Long text',
            priceMonthCents: 1800,
            priceYearCents: 18000,
            active: true,
            icon: 'calendar',
            features: ['Online boeken', 'Herinneringen'],
            color: '#2563eb',
            launchUrl: 'https://{slug}.example.com'
        })
        expect(product).toMatchObject({
            icon: 'calendar',
            category: '',
            short: '',
            features: ['Online boeken', 'Herinneringen'],
            color: '#2563eb',
            requiresVault: false,
            demoEnabled: true,
            launchUrl: 'https://{slug}.example.com',
            sort: 0
        })
        const updated = await billing.updateProduct(product?.id ?? '', {
            features: ['Eén'],
            requiresVault: true,
            demoEnabled: false,
            sort: 5,
            short: 'Kort'
        })
        expect(updated).toMatchObject({
            features: ['Eén'],
            requiresVault: true,
            demoEnabled: false,
            sort: 5,
            short: 'Kort'
        })
        expect(await billing.findProduct(product?.id ?? '')).toMatchObject({ demoEnabled: false })
        const withoutDemo = await billing.createProduct({
            code: 'nodemo',
            name: 'Zonder demo',
            description: '',
            priceMonthCents: 100,
            priceYearCents: 1000,
            active: true,
            demoEnabled: false
        })
        expect(withoutDemo).toMatchObject({ code: 'nodemo', demoEnabled: false })

        const tenant = await store.createTenant('Shop', 'shop')
        const subscription = await billing.saveSubscription({
            tenantId: tenant.id,
            productId: product?.id ?? '',
            interval: 'month',
            seats: 1,
            status: 'active',
            providerSubscriptionId: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            discountCodeId: null,
            discountPeriodsLeft: null
        })
        await database.query(
            "UPDATE tenant_subscriptions SET environment_name = 'Praktijk', region = 'eu-west-1' WHERE id = $1",
            [subscription.id]
        )
        expect(await billing.listEnvironments(tenant.id)).toEqual([
            { productId: product?.id, name: 'Praktijk', region: 'eu-west-1', since: expect.any(Date) }
        ])
        const all = await billing.listAllOwnership()
        expect(all.subscriptions.map(item => item.id)).toContain(subscription.id)
    })

    it('stores the eHealth certificate of an account (one per account)', async () => {
        const user = await store.createUser({
            email: 'vault@example.com',
            name: 'Vault',
            passwordHash: 'x',
            emailVerified: true,
            locale: null
        })
        const userId = user?.id ?? ''
        const empty = { thumbprint: null, subject: null, issuer: null, serial: null, validUntil: null }
        await vault.save({
            userId,
            filename: 'a.p12',
            sizeBytes: 3,
            p12Encrypted: Buffer.from('one'),
            passwordEncrypted: null,
            ...empty
        })
        await vault.save({
            userId,
            filename: 'b.p12',
            sizeBytes: 3,
            p12Encrypted: Buffer.from('two'),
            passwordEncrypted: null,
            ...empty
        })
        expect(await vault.find(userId)).toMatchObject({ filename: 'b.p12', p12Encrypted: Buffer.from('two') })
        const until = new Date('2028-01-01T00:00:00Z')
        expect(
            await vault.setPassword(userId, Buffer.from('pw'), { ...empty, thumbprint: 'AA:BB', validUntil: until })
        ).toBe(true)
        expect(await vault.find(userId)).toMatchObject({
            passwordEncrypted: Buffer.from('pw'),
            thumbprint: 'AA:BB',
            validUntil: until
        })
        expect(await vault.delete(userId)).toBe(true)
        expect(await vault.find(userId)).toBeNull()
        expect(await vault.setPassword(userId, Buffer.from('pw'), empty)).toBe(false)
    })
})
