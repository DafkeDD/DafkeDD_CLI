import { randomBytes, randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import pg from 'pg'
import { TENANT_ROLE, TENANT_TABLES, USERS_TABLE } from '../src/database/database.constants.js'
import { DatabaseService } from '../src/database/database.service.js'
import { runMigrations } from '../src/database/migrator.js'
import { PgAuditStore } from '../src/audit/pg-audit.store.js'
import { PgBillingStore } from '../src/billing/store/pg-billing.store.js'
import { PgOidcStore } from '../src/oidc/store/pg-oidc.store.js'

/**
 * Runs against a REAL PostgreSQL (the one from .env): npm run test:db
 * It creates a separate database <DATABASE_NAME>_test, runs the migrations in it and removes it again afterwards.
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
    DATABASE_NAME: (process.env.DATABASE_NAME ?? 'app') + '_test'
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

describe('tenant isolation and storage (real PostgreSQL)', () => {
    let database: DatabaseService
    const users = '"' + USERS_TABLE + '"'
    const tenant = { a: '', b: '' }
    const user = { ada: '', bob: '' }

    beforeAll(async () => {
        await admin(`DROP DATABASE IF EXISTS "${settings.DATABASE_NAME}" WITH (FORCE)`)
        await admin(`CREATE DATABASE "${settings.DATABASE_NAME}"`)
        database = new DatabaseService(new ConfigService(settings))
        await database.ready()
        const insert = async (text: string, params: unknown[]) =>
            (await database.query<{ id: string }>(text, params)).rows[0]?.id ?? ''
        tenant.a = await insert('INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id', [
            'tenant-a',
            'Tenant A'
        ])
        tenant.b = await insert('INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id', [
            'tenant-b',
            'Tenant B'
        ])
        user.ada = await insert(`INSERT INTO ${users} (email, name, password_hash) VALUES ($1, $2, 'x') RETURNING id`, [
            'ada@example.com',
            'Ada'
        ])
        user.bob = await insert(`INSERT INTO ${users} (email, name, password_hash) VALUES ($1, $2, 'x') RETURNING id`, [
            'bob@example.com',
            'Bob'
        ])
        await database.query(
            'INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, $3), ($4, $5, $6)',
            [tenant.a, user.ada, 'admin', tenant.b, user.bob, 'user']
        )
    })

    afterAll(async () => {
        await database?.onModuleDestroy()
        await admin(`DROP DATABASE IF EXISTS "${settings.DATABASE_NAME}" WITH (FORCE)`)
    })

    it('runs the migrations once (a second run changes nothing)', async () => {
        const pool = new pg.Pool(poolSettings())
        const client = await pool.connect()
        try {
            expect(await runMigrations(client)).toEqual([])
        } finally {
            client.release()
            await pool.end()
        }
    })

    it('has Row-Level Security and a policy on every table with a tenant_id', async () => {
        const { rows } = await database.query<{ table: string; rls: boolean; policies: number }>(
            `SELECT c.relname AS "table", c.relrowsecurity AS rls,
              (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = c.relname) AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND (c.relname = 'tenants' OR EXISTS (
            SELECT 1 FROM information_schema.columns col
             WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id'))`
        )
        expect(rows.map(row => row.table).sort()).toEqual([...TENANT_TABLES].sort())
        for (const row of rows) {
            expect(row.rls, row.table).toBe(true)
            expect(row.policies, row.table).toBeGreaterThan(0)
        }
    })

    it('the tenant role cannot read the OpenID Connect tables or password hashes', async () => {
        for (const statement of [
            'SELECT * FROM oidc_signing_keys',
            'SELECT * FROM oidc_sessions',
            'SELECT * FROM user_passkeys',
            'SELECT * FROM oidc_consents',
            'SELECT * FROM oidc_logout_queue',
            `SELECT password_hash FROM ${users}`
        ]) {
            await expect(database.withTenant(tenant.a, db => db.query(statement))).rejects.toThrow(/permission denied/)
        }
    })

    it('a tenant only sees its own rows, even without a WHERE clause', async () => {
        const store = new PgOidcStore(database)
        expect((await store.listMembers(tenant.a)).map(member => member.email)).toEqual(['ada@example.com'])
        expect((await store.listMembers(tenant.b)).map(member => member.email)).toEqual(['bob@example.com'])
        const tenants = await database.withTenant(tenant.a, db => db.query<{ id: string }>('SELECT id FROM tenants'))
        expect(tenants.rows.map(row => row.id)).toEqual([tenant.a])
        const unknown = await database.withTenant(randomUUID(), db => db.query('SELECT * FROM tenant_members'))
        expect(unknown.rows).toEqual([])
    })

    it('a tenant cannot change or delete rows of another tenant', async () => {
        const store = new PgOidcStore(database)
        expect(await store.setMemberRole(tenant.a, user.bob, 'admin')).toBe('not-found')
        expect(await store.removeMember(tenant.a, user.bob)).toBe('not-found')
        const deleted = await database.withTenant(tenant.a, db =>
            db.query('DELETE FROM tenant_members WHERE user_id = $1', [user.bob])
        )
        expect(deleted.rowCount).toBe(0)
        const renamed = await database.withTenant(tenant.a, db =>
            db.query("UPDATE tenants SET name = 'hacked' WHERE id = $1", [tenant.b])
        )
        expect(renamed.rowCount).toBe(0)
        const { rows } = await database.query<{ role: string }>('SELECT role FROM tenant_members WHERE user_id = $1', [
            user.bob
        ])
        expect(rows[0]?.role).toBe('user')
    })

    it('a tenant cannot insert rows for another tenant', async () => {
        await expect(
            database.withTenant(tenant.a, db =>
                db.query('INSERT INTO tenant_members (tenant_id, user_id) VALUES ($1, $2)', [tenant.b, user.ada])
            )
        ).rejects.toThrow(/row-level security/)
    })

    it('withTenant refuses something that is not a tenant id', async () => {
        await expect(database.withTenant("x' OR 1=1 --", async () => 1)).rejects.toThrow('tenant id')
    })

    it('stores codes that can be used only once, and keeps one active key per algorithm', async () => {
        const store = new PgOidcStore(database)
        await store.upsertClient({
            clientId: 'test',
            name: 'Test',
            type: 'public',
            secretHash: null,
            redirectUris: ['http://localhost/cb'],
            postLogoutRedirectUris: [],
            grantTypes: ['authorization_code'],
            scopes: ['openid'],
            firstParty: true
        })
        const session = {
            id: randomUUID(),
            idHash: randomBytes(16).toString('hex'),
            userAgent: null,
            interactionHash: randomBytes(16).toString('hex'),
            userId: user.ada,
            tenantId: tenant.a,
            authTime: new Date(),
            acr: 'loa1',
            amr: ['pwd'],
            expiresAt: new Date(Date.now() + 60_000)
        }
        expect(await store.createSession(session)).toBe(true)
        expect((await store.findSession(session.idHash))?.tenantId).toBe(tenant.a)
        // One login, one session: a copy of the login cookie cannot create a second one
        expect(
            await store.createSession({ ...session, id: randomUUID(), idHash: randomBytes(16).toString('hex') })
        ).toBe(false)
        // An ended session no longer works, but still blocks its login until the cleanup an hour later
        await store.endSession(session.idHash)
        expect(await store.findSession(session.idHash)).toBeNull()
        expect(
            await store.createSession({ ...session, id: randomUUID(), idHash: randomBytes(16).toString('hex') })
        ).toBe(false)
        const code = {
            codeHash: randomBytes(16).toString('hex'),
            clientId: 'test',
            userId: user.ada,
            tenantId: tenant.a,
            sessionHash: session.idHash,
            redirectUri: 'http://localhost/cb',
            scope: 'openid',
            nonce: null,
            codeChallenge: 'x'.repeat(43),
            authTime: new Date(),
            acr: 'loa1',
            amr: ['pwd'],
            expiresAt: new Date(Date.now() + 60_000)
        }
        await store.createCode(code)
        const [first, second] = await Promise.all([store.consumeCode(code.codeHash), store.consumeCode(code.codeHash)])
        expect([first, second].filter(Boolean)).toHaveLength(1)
        await store.deleteExpired(new Date(Date.now() + 2 * 60 * 60 * 1000))
        expect(await database.query('SELECT 1 FROM oidc_sessions WHERE id_hash = $1', [session.idHash])).toMatchObject({
            rows: []
        })

        const key = (kid: string, createdAt: Date) => ({
            kid,
            alg: 'ES256' as const,
            publicJwk: { kty: 'EC' },
            privateKey: 'v1.x',
            status: 'active' as const,
            createdAt,
            retiredAt: null
        })
        expect(await store.activateKey(key('k1', new Date()), new Date(0))).toBe(true)
        expect(await store.activateKey(key('k2', new Date()), new Date(0))).toBe(false)
        expect(await store.activateKey(key('k3', new Date()), new Date(Date.now() + 1000))).toBe(true)
        const keys = await store.listKeys()
        expect(keys.filter(item => item.status === 'active').map(item => item.kid)).toEqual(['k3'])
    })

    it('creates the superadmin only once, without an organisation', async () => {
        const store = new PgOidcStore(database)
        const admin = { email: 'root@example.com', name: 'Root', passwordHash: 'x' }
        const tenantsBefore = (await store.listTenants()).length
        expect(await store.bootstrapAdmin(admin)).toBe(false) // there are users already
        await database.query(`DELETE FROM ${users}`)
        expect(await store.bootstrapAdmin(admin)).toBe(true)
        expect(await store.bootstrapAdmin(admin)).toBe(false)
        const root = await store.findUserByEmail('ROOT@example.com')
        expect(root?.isSuperadmin).toBe(true)
        expect(await store.listMemberships(root?.id ?? '')).toEqual([])
        expect((await store.listTenants()).length).toBe(tenantsBefore)

        // A platform login of the superadmin: a session and a code without a tenant
        const session = {
            id: randomUUID(),
            idHash: randomBytes(16).toString('hex'),
            userAgent: null,
            interactionHash: randomBytes(16).toString('hex'),
            userId: root?.id ?? '',
            tenantId: null,
            authTime: new Date(),
            acr: 'loa2',
            amr: ['pwd', 'otp', 'mfa'],
            expiresAt: new Date(Date.now() + 60_000)
        }
        expect(await store.createSession(session)).toBe(true)
        expect((await store.findSession(session.idHash))?.tenantId).toBeNull()
        await store.createCode({
            codeHash: randomBytes(16).toString('hex'),
            clientId: 'test',
            userId: root?.id ?? '',
            tenantId: null,
            sessionHash: session.idHash,
            redirectUri: 'http://localhost/cb',
            scope: 'openid',
            nonce: null,
            codeChallenge: 'x'.repeat(43),
            authTime: new Date(),
            acr: 'loa2',
            amr: ['pwd'],
            expiresAt: new Date(Date.now() + 60_000)
        })
        // Never reachable for the tenant role
        await expect(
            database.withTenant(tenant.a, db => db.query('SELECT 1 FROM oidc_codes WHERE tenant_id IS NULL'))
        ).rejects.toThrow(/permission denied/)
    })

    it('registers an account with its own tenant in one go, with a free slug and a unique email address', async () => {
        const store = new PgOidcStore(database)
        const account = { email: 'new@example.com', name: 'New', passwordHash: 'x', emailVerified: false, locale: 'nl' }
        const first = await store.register(account, { name: 'Tenant A', slug: 'tenant-a' })
        expect(first?.tenant.slug).toMatch(/^tenant-a-[0-9a-f]{4}$/)
        expect(first?.user).toMatchObject({ email: 'new@example.com', emailVerified: false, isSuperadmin: false })
        expect(await store.findMemberRole(first?.tenant.id ?? '', first?.user.id ?? '')).toBe('admin')
        const tenantsBefore = (await store.listTenants()).length
        expect(await store.register({ ...account, email: 'NEW@example.com' }, { name: 'X', slug: 'x-x' })).toBeNull()
        expect((await store.listTenants()).length).toBe(tenantsBefore)
        expect(await store.createUser({ ...account, email: 'New@Example.com' })).toBeNull()
    })

    it('links one eID per account and one account per eID, also registering at the same time', async () => {
        const store = new PgOidcStore(database)
        const account = (email: string) => ({
            email,
            name: 'Jan',
            passwordHash: null,
            emailVerified: false,
            locale: 'nl'
        })
        const eid = { type: 'eid' as const, valueHash: 'hash-' + randomUUID() }
        // Two registrations with the same eID at the same time: one account, one tenant
        const tenantsBefore = (await store.listTenants()).length
        const results = await Promise.all([
            store.registerWithIdentifier(account('jan1@example.com'), { name: 'Jan BV', slug: 'jan-bv' }, eid),
            store.registerWithIdentifier(account('jan2@example.com'), { name: 'Jan BV', slug: 'jan-bv' }, eid)
        ])
        const created = results.filter(result => result !== null && typeof result === 'object')
        expect(created).toHaveLength(1)
        expect(results).toContain('identifier-taken')
        expect((await store.listTenants()).length).toBe(tenantsBefore + 1)
        const jan = (await store.findUserByIdentifier('eid', eid.valueHash))!
        expect(jan).toMatchObject({ name: 'Jan', passwordHash: null })
        expect(
            await store.findMemberRole(created[0] && typeof created[0] === 'object' ? created[0].tenant.id : '', jan.id)
        ).toBe('admin')
        // A taken email address (of the registration that won): nothing is created, the eID stays free
        const other = { type: 'eid' as const, valueHash: 'hash-' + randomUUID() }
        expect(
            await store.registerWithIdentifier(account(jan.email.toUpperCase()), { name: 'X', slug: 'x-y' }, other)
        ).toBeNull()
        expect(await store.findUserByIdentifier('eid', other.valueHash)).toBeNull()

        expect(await store.linkIdentifier(user.ada, 'eid', eid.valueHash)).toBe('taken')
        expect(await store.linkIdentifier(jan.id, 'eid', eid.valueHash)).toBe('ok')
        expect(await store.linkIdentifier(jan.id, 'eid', other.valueHash)).toBe('exists')
        // Two links for one account at the same time: only one wins
        const kim = (await store.createUser({ ...account('kim@example.com'), passwordHash: 'x' }))!
        const links = await Promise.all([
            store.linkIdentifier(kim.id, 'eid', 'hash-' + randomUUID()),
            store.linkIdentifier(kim.id, 'eid', 'hash-' + randomUUID())
        ])
        expect([...links].sort()).toEqual(['exists', 'ok'])

        await store.touchIdentifier('eid', eid.valueHash)
        expect((await store.findIdentifier(jan.id, 'eid'))?.lastUsedAt).toBeInstanceOf(Date)
        expect(await store.unlinkIdentifier(jan.id, 'eid')).toBe(true)
        expect(await store.unlinkIdentifier(jan.id, 'eid')).toBe(false)
        expect(await store.findUserByIdentifier('eid', eid.valueHash)).toBeNull()
        // Never readable for the tenant role
        await expect(database.withTenant(tenant.a, db => db.query('SELECT * FROM user_identifiers'))).rejects.toThrow(
            /permission denied/
        )
    })

    it('keeps at least one admin per tenant and one superadmin, also with changes at the same time', async () => {
        const store = new PgOidcStore(database)
        const created = await store.register(
            { email: 'owner@example.com', name: 'Owner', passwordHash: 'x', emailVerified: true, locale: null },
            { name: 'Race', slug: 'race' }
        )
        const tenantId = created?.tenant.id ?? ''
        const owner = created?.user.id ?? ''
        const account = (email: string) => ({
            email,
            name: email,
            passwordHash: 'x',
            emailVerified: true,
            locale: null
        })
        const second = (await store.createUser(account('second@example.com')))?.id ?? ''
        const third = (await store.createUser(account('third@example.com')))?.id ?? ''
        await store.addMember(tenantId, second, 'admin')
        await store.addMember(tenantId, second, 'user') // keeps the higher role
        expect(await store.findMemberRole(tenantId, second)).toBe('admin')
        // Two admins demote each other at the same time: one of both must stay admin
        const results = await Promise.all([
            store.setMemberRole(tenantId, owner, 'user'),
            store.setMemberRole(tenantId, second, 'user')
        ])
        expect(results.sort()).toEqual(['last-admin', 'ok'])
        const admins = (await store.listMembers(tenantId)).filter(member => member.role === 'admin')
        expect(admins).toHaveLength(1)
        expect(await store.removeMember(tenantId, admins[0]?.userId ?? '')).toBe('last-admin')

        // Superadmins: the last one cannot be revoked
        const superadmins = await store.listSuperadmins()
        expect(superadmins.map(item => item.email)).toEqual(['root@example.com'])
        expect(await store.setSuperadmin(superadmins[0]?.id ?? '', false)).toBe('last-admin')
        expect(await store.setSuperadmin(third, true)).toBe('ok')
        const revoked = await Promise.all([
            store.setSuperadmin(third, false),
            store.setSuperadmin(superadmins[0]?.id ?? '', false)
        ])
        expect(revoked.sort()).toEqual(['last-admin', 'ok'])
        expect(await store.listSuperadmins()).toHaveLength(1)
    })

    it('verifies email addresses, changes passwords, suspends tenants and counts members', async () => {
        const store = new PgOidcStore(database)
        const created = await store.register(
            { email: 'later@example.com', name: 'Later', passwordHash: 'old', emailVerified: false, locale: null },
            { name: 'Later Co', slug: 'later-co' }
        )
        const id = created?.user.id ?? ''
        await store.setEmailVerified(id)
        await store.setPassword(id, 'new')
        expect(await store.findUserById(id)).toMatchObject({ emailVerified: true, passwordHash: 'new' })
        const session = {
            id: randomUUID(),
            idHash: randomBytes(16).toString('hex'),
            userAgent: null,
            interactionHash: randomBytes(16).toString('hex'),
            userId: id,
            tenantId: created?.tenant.id ?? '',
            authTime: new Date(),
            acr: 'loa1',
            amr: ['pwd'],
            expiresAt: new Date(Date.now() + 60_000)
        }
        await store.createSession(session)
        await store.endUserSessions(id)
        expect(await store.findSession(session.idHash)).toBeNull()
        expect(await store.setTenantStatus(created?.tenant.id ?? '', 'suspended')).toBe(true)
        expect(await store.listMemberships(id)).toEqual([])
        const listed = (await store.listTenants()).find(item => item.id === created?.tenant.id)
        expect(listed).toMatchObject({ status: 'suspended', members: 1 })
        expect(await store.setTenantStatus(randomUUID(), 'active')).toBe(false)
    })

    it('stores two-step verification, and every code or recovery code works only once (also at the same time)', async () => {
        const store = new PgOidcStore(database)
        const id =
            (
                await store.createUser({
                    email: 'mfa@example.com',
                    name: 'Mfa',
                    passwordHash: 'x',
                    emailVerified: true,
                    locale: null
                })
            )?.id ?? ''
        expect(await store.getMfa(id)).toEqual({ secret: null, enabled: false, lastStep: null, recoveryCodes: [] })
        await store.setMfaSecret(id, 'v1.encrypted')
        expect((await store.findUserById(id))?.mfaEnabled).toBe(false)
        await store.enableMfa(id, ['h1', 'h2'], 1000)
        expect(await store.getMfa(id)).toEqual({
            secret: 'v1.encrypted',
            enabled: true,
            lastStep: 1000,
            recoveryCodes: ['h1', 'h2']
        })
        expect((await store.findUserById(id))?.mfaEnabled).toBe(true)

        const steps = await Promise.all([store.useTotpStep(id, 1001), store.useTotpStep(id, 1001)])
        expect(steps.sort()).toEqual([false, true])
        expect(await store.useTotpStep(id, 1000)).toBe(false)
        const codes = await Promise.all([store.useRecoveryCode(id, 'h1'), store.useRecoveryCode(id, 'h1')])
        expect(codes.sort()).toEqual([false, true])
        expect((await store.getMfa(id))?.recoveryCodes).toEqual(['h2'])

        await store.disableMfa(id)
        expect(await store.getMfa(id)).toEqual({ secret: null, enabled: false, lastStep: null, recoveryCodes: [] })
    })

    it('disables members, keeps an active admin, records who was online and keeps invitations per tenant', async () => {
        const store = new PgOidcStore(database)
        const account = (email: string) => ({
            email,
            name: email,
            passwordHash: 'x',
            emailVerified: true,
            locale: null
        })
        const created = await store.register(account('chief@example.com'), { name: 'Status Co', slug: 'status-co' })
        const tenantId = created?.tenant.id ?? ''
        const chief = created?.user.id ?? ''
        const helper = (await store.createUser(account('helper@example.com')))?.id ?? ''
        await store.addMember(tenantId, helper, 'user')

        expect(await store.setMemberStatus(tenantId, chief, 'disabled')).toBe('last-admin')
        expect(await store.setMemberStatus(tenantId, helper, 'disabled')).toBe('ok')
        expect(await store.findMemberRole(tenantId, helper)).toBeNull()
        expect(await store.findMember(tenantId, helper)).toEqual({ role: 'user', status: 'disabled' })
        expect(await store.listMemberships(helper)).toEqual([])
        // A disabled admin does not count as the active admin
        await store.setMemberRole(tenantId, helper, 'admin')
        expect(await store.setMemberStatus(tenantId, chief, 'disabled')).toBe('last-admin')
        expect(await store.setMemberStatus(tenantId, helper, 'active')).toBe('ok')
        expect(await store.listMemberships(helper)).toHaveLength(1)

        await store.touchMember(tenantId, helper)
        const members = await store.listMembers(tenantId)
        expect(members.find(member => member.userId === helper)?.lastSeenAt).toBeInstanceOf(Date)
        expect(members.find(member => member.userId === chief)?.lastSeenAt).toBeNull()

        const expiresAt = new Date(Date.now() + 60_000)
        const first = await store.saveInvitation({
            tenantId,
            email: 'new@x.com',
            role: 'user',
            invitedBy: chief,
            expiresAt
        })
        const again = await store.saveInvitation({
            tenantId,
            email: 'NEW@x.com',
            role: 'admin',
            invitedBy: chief,
            expiresAt
        })
        expect(again.id).toBe(first.id)
        expect(await store.listInvitations(tenantId)).toEqual([
            expect.objectContaining({ id: first.id, role: 'admin', invitedByName: 'chief@example.com' })
        ])
        // Row-Level Security: another tenant sees nothing of it
        expect(await store.listInvitations(tenant.a)).toEqual([])
        expect(await store.findInvitation(tenant.a, first.id)).toBeNull()
        expect(await store.deleteInvitation(tenant.a, first.id)).toBe(false)
        expect((await store.renewInvitation(tenantId, first.id, new Date(Date.now() + 120_000)))?.id).toBe(first.id)
        expect(await store.deleteInvitation(tenantId, first.id)).toBe(true)
        expect(await store.findInvitation(tenantId, first.id)).toBeNull()
    })

    it('rotates refresh tokens once (also two at the same moment), revokes a family on reuse, and ends sessions', async () => {
        const store = new PgOidcStore(database)
        const owner = (await store.createUser({
            email: 'sessions@example.com',
            name: 'Sessions',
            passwordHash: 'x',
            emailVerified: true,
            locale: null
        }))!
        const newSession = async (userAgent: string | null) => {
            const session = {
                id: randomUUID(),
                idHash: randomBytes(16).toString('hex'),
                interactionHash: randomBytes(16).toString('hex'),
                userId: owner.id,
                tenantId: tenant.a,
                authTime: new Date(),
                acr: 'loa2',
                amr: ['pwd', 'otp', 'mfa'],
                expiresAt: new Date(Date.now() + 60_000),
                userAgent
            }
            expect(await store.createSession(session)).toBe(true)
            return session
        }
        const first = await newSession('Firefox')
        const second = await newSession(null)
        expect((await store.findSessionById(first.id))?.userAgent).toBe('Firefox')
        expect(await store.findSessionById('not-a-uuid')).toBeNull()
        await store.touchSession(first.id)
        const listed = await store.listUserSessions(owner.id)
        expect(listed.map(item => item.id).sort()).toEqual([first.id, second.id].sort())
        expect(listed.find(item => item.id === first.id)).toMatchObject({
            tenantName: 'Tenant A',
            userAgent: 'Firefox'
        })
        expect(listed.find(item => item.id === first.id)?.lastUsedAt).toBeInstanceOf(Date)

        const token = (hash: string) => ({
            tokenHash: hash,
            familyId: randomUUID(),
            sessionId: first.id,
            clientId: 'test',
            userId: owner.id,
            tenantId: tenant.a,
            scope: 'openid',
            expiresAt: first.expiresAt
        })
        const original = token('rt-' + randomUUID())
        await store.createRefreshToken(original)
        const next = (name: string) => ({ tokenHash: name + randomUUID(), scope: 'openid', expiresAt: first.expiresAt })
        // Two uses of the same token at the same moment (one browser, two requests): both get the SAME successor (the
        // service derives it from the token), never two chains
        const successor = next('a-')
        const both = await Promise.all([
            store.rotateRefreshToken(original.tokenHash, successor, 30_000),
            store.rotateRefreshToken(original.tokenHash, successor, 30_000)
        ])
        expect(both.map(result => result.status)).toEqual(['ok', 'ok'])
        expect(new Set(both.map(result => (result.status === 'ok' ? result.token.tokenHash : '')))).toEqual(
            new Set([successor.tokenHash])
        )
        expect((await store.findRefreshToken(original.tokenHash))?.usedAt).toBeInstanceOf(Date)
        // After the grace period it is reuse: the whole family is revoked
        const reused = await store.rotateRefreshToken(original.tokenHash, next('c-'), 0)
        expect(reused.status).toBe('reused')
        for (const result of both)
            if (result.status === 'ok')
                expect((await store.findRefreshToken(result.token.tokenHash))?.revokedAt).toBeInstanceOf(Date)
        expect((await store.rotateRefreshToken(original.tokenHash, next('d-'), 30_000)).status).toBe('invalid')
        expect((await store.rotateRefreshToken('unknown', next('e-'), 30_000)).status).toBe('invalid')

        const other = token('rt-' + randomUUID())
        await store.createRefreshToken(other)
        await store.revokeRefreshFamily(other.familyId)
        expect((await store.rotateRefreshToken(other.tokenHash, next('f-'), 30_000)).status).toBe('invalid')
        // Like the other OpenID Connect tables: Row-Level Security, and never reachable for the tenant role
        await expect(
            database.withTenant(tenant.a, db => db.query('SELECT 1 FROM oidc_refresh_tokens'))
        ).rejects.toThrow(/permission denied/)

        // Ending sessions: one, then every other
        const third = await newSession('Edge')
        expect(await store.endUserSession(owner.id, second.id)).toBe(true)
        expect(await store.endUserSession(owner.id, second.id)).toBe(false)
        expect(await store.endUserSession(randomUUID(), third.id)).toBe(false)
        expect(await store.endOtherUserSessions(owner.id, first.id)).toBe(1)
        expect((await store.listUserSessions(owner.id)).map(item => item.id)).toEqual([first.id])
    })

    it('licences: seats never go over (also at the same moment), codes and payments count once, per tenant', async () => {
        const billing = new PgBillingStore(database)
        const oidc = new PgOidcStore(database)
        const user = async (email: string) =>
            (await oidc.createUser({ email, name: email, passwordHash: 'x', emailVerified: true, locale: null }))!.id
        const [ann, ben, cas] = [await user('ann@lic.com'), await user('ben@lic.com'), await user('cas@lic.com')]
        const product = (await billing.createProduct({
            code: 'planner',
            name: 'Planner',
            description: '',
            priceMonthCents: 900,
            priceYearCents: 9000,
            active: true
        }))!
        expect(await billing.createProduct({ ...product, code: 'planner' })).toBeNull()
        expect(await billing.updateProduct(product.id, { priceYearCents: 8000 })).toMatchObject({
            priceYearCents: 8000
        })

        // Trials: once per user and product
        const ends = new Date(Date.now() + 60_000)
        expect(await billing.startTrial(tenant.a, product.id, ann, ends)).toBe(true)
        expect(await billing.startTrial(tenant.a, product.id, ann, ends)).toBe(false)
        expect(await billing.setTrialEnd(tenant.a, product.id, ann, new Date(Date.now() + 120_000))).toBe(true)

        // Two seats, three people at the same moment: one is refused
        const results = await Promise.all(
            [ann, ben, cas].map(id => billing.assignSeat(tenant.a, product.id, id, ann, 2))
        )
        expect([...results].sort()).toEqual(['full', 'ok', 'ok'])
        expect(await billing.assignSeat(tenant.a, product.id, results[0] === 'ok' ? ann : ben, ann, 2)).toBe('exists')
        expect(await billing.listAssignments(tenant.a)).toHaveLength(2)

        // A discount code: once per tenant, and never more than its maximum (also at the same moment)
        const code = (await billing.createDiscount({
            code: 'TWO-ONLY',
            percentOff: 50,
            amountOffCents: null,
            productId: null,
            duration: 'once',
            durationPeriods: null,
            maxRedemptions: 1,
            expiresAt: null,
            createdBy: ann
        }))!
        const redeemed = await Promise.all([
            billing.redeemDiscount(code.id, tenant.a),
            billing.redeemDiscount(code.id, tenant.b)
        ])
        expect(redeemed.filter(Boolean)).toHaveLength(1)
        expect((await billing.findDiscount(code.id))?.redemptions).toBe(1)

        // A subscription and its payment: paid once, also when the webhook comes twice at once
        const subscription = await billing.saveSubscription({
            tenantId: tenant.a,
            productId: product.id,
            interval: 'year',
            seats: 2,
            status: 'pending',
            providerSubscriptionId: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            discountCodeId: code.id,
            discountPeriodsLeft: 1
        })
        await billing.updateSubscription(subscription.id, {
            status: 'active',
            providerSubscriptionId: 'sub_x',
            seats: 3
        })
        expect(await billing.findSubscriptionByProviderId('sub_x')).toMatchObject({
            seats: 3,
            status: 'active',
            interval: 'year'
        })
        await billing.createPayment({
            id: 'tr_test',
            tenantId: tenant.a,
            subscriptionId: subscription.id,
            kind: 'first',
            seats: 2,
            amountCents: 8000,
            status: 'open',
            periodEnd: null
        })
        // Not paid yet: nothing to claim
        expect(await billing.claimPayment('tr_test')).toBe(false)
        await Promise.all([billing.setPaymentStatus('tr_test', 'paid'), billing.setPaymentStatus('tr_test', 'paid')])
        expect((await billing.lastPayment(subscription.id))?.paidAt).toBeInstanceOf(Date)
        // The webhook and the return page at the same time: one claims it
        const claims = await Promise.all([billing.claimPayment('tr_test'), billing.claimPayment('tr_test')])
        expect(claims.filter(Boolean)).toHaveLength(1)
        // A failure releases it (tried again), applied it is never claimed again
        await billing.releasePayment('tr_test')
        expect(await billing.claimPayment('tr_test')).toBe(true)
        await billing.finishPayment('tr_test')
        expect(await billing.claimPayment('tr_test')).toBe(false)
        expect((await billing.findPayment('tr_test'))?.appliedAt).toBeInstanceOf(Date)
        // A reserved discount code is given back once
        const winner = redeemed[0] ? tenant.a : tenant.b
        expect(await billing.releaseDiscount(code.id, winner)).toBe(true)
        expect(await billing.releaseDiscount(code.id, winner)).toBe(false)
        expect(await billing.hasRedeemed(code.id, winner)).toBe(false)
        expect((await billing.findDiscount(code.id))?.redemptions).toBe(0)

        const grant = await billing.addGrant({
            tenantId: tenant.b,
            productId: product.id,
            seats: 3,
            endsAt: null,
            note: 'x',
            grantedBy: ann
        })
        expect(await billing.deleteGrant(tenant.a, grant.id)).toBe(false)
        expect(await billing.listGrants(tenant.b)).toHaveLength(1)
        await billing.setCustomerId(tenant.a, 'cst_x')
        expect(await billing.getCustomerId(tenant.a)).toBe('cst_x')

        // Row-Level Security: the tenant role sees the licences of its own tenant only, and never the payments
        const seen = await database.withTenant(tenant.b, db => db.query('SELECT * FROM license_assignments'))
        expect(seen.rows).toHaveLength(0)
        const own = await database.withTenant(tenant.a, db => db.query('SELECT * FROM license_assignments'))
        expect(own.rows).toHaveLength(2)
        await expect(database.withTenant(tenant.a, db => db.query('SELECT * FROM billing_payments'))).rejects.toThrow(
            /permission denied/
        )
        // Tenant code may rename its own tenant, never change its Mollie customer or its status
        await database.withTenant(tenant.a, db => db.query("UPDATE tenants SET name = name || ''"))
        await expect(
            database.withTenant(tenant.a, db => db.query("UPDATE tenants SET payment_customer_id = 'cst_evil'"))
        ).rejects.toThrow(/permission denied/)
        await expect(
            database.withTenant(tenant.a, db => db.query("UPDATE tenants SET status = 'active'"))
        ).rejects.toThrow(/permission denied/)
    })

    it('the audit log: append-only, each organisation reads only its own events, old events are purged', async () => {
        const audit = new PgAuditStore(database)
        // Own accounts: earlier tests removed Ada and Bob
        const account = async (email: string, name: string) =>
            (
                await database.query<{ id: string }>(
                    `INSERT INTO ${users} (email, name, password_hash) VALUES ($1, $2, 'x') RETURNING id`,
                    [email, name]
                )
            ).rows[0]?.id ?? ''
        const ada = await account('audit-ada@example.com', 'Ada')
        const bob = await account('audit-bob@example.com', 'Bob')
        const event = (tenantId: string | null, action: string, actorId: string | null = ada) => ({
            tenantId,
            actorId,
            action,
            targetType: 'user' as const,
            targetId: bob,
            details: { role: 'admin', seats: 2, active: true },
            ip: '203.0.113.7',
            userAgent: 'Browser/1'
        })
        await audit.add(event(tenant.a, 'members.role_changed'))
        await audit.add(event(tenant.b, 'members.removed', bob))
        await audit.add(event(null, 'login.failed', null))
        await expect(audit.add(event(tenant.a, 'not an action'))).rejects.toThrow()

        // Organisation A (with Row-Level Security): only its own event, with the names
        const a = await audit.list({ tenantId: tenant.a, limit: 10 })
        expect(a).toHaveLength(1)
        expect(a[0]).toMatchObject({
            action: 'members.role_changed',
            tenant: { id: tenant.a, name: 'Tenant A' },
            actor: { id: ada, name: 'Ada', email: 'audit-ada@example.com' },
            target: { type: 'user', id: bob, label: 'audit-bob@example.com' },
            details: { role: 'admin', seats: 2, active: true },
            ip: '203.0.113.7'
        })
        // The tenant role itself never sees the platform events or another organisation, even without a WHERE
        const seen = await database.withTenant(tenant.a, db => db.query('SELECT action FROM audit_events'))
        expect(seen.rows.map(row => row.action)).toEqual(['members.role_changed'])
        await expect(
            database.withTenant(tenant.a, db =>
                db.query("INSERT INTO audit_events (tenant_id, action) VALUES ($1, 'members.removed')", [tenant.a])
            )
        ).rejects.toThrow(/permission denied/)

        expect((await audit.list({ tenantId: null, limit: 10 })).map(row => row.action)).toEqual(['login.failed'])
        expect(await audit.list({ limit: 10 })).toHaveLength(3)
        // Bob: what he did (in B) and what was done to him (in A, and the failed login on his account)
        expect(await audit.list({ userId: bob, limit: 10 })).toHaveLength(3)
        expect(await audit.list({ actorId: bob, limit: 10 })).toHaveLength(1)
        expect(await audit.list({ categories: ['login'], limit: 10 })).toHaveLength(1)
        const [newest] = await audit.list({ limit: 1 })
        expect(await audit.list({ before: newest?.id, limit: 10 })).toHaveLength(2)

        // Append-only: also the owner of the table cannot change or delete an event
        await expect(database.query("UPDATE audit_events SET action = 'login.logout'")).rejects.toThrow(/append-only/)
        await expect(database.query('DELETE FROM audit_events')).rejects.toThrow(/append-only/)
        await expect(database.query('TRUNCATE audit_events')).rejects.toThrow(/append-only/)
        // Only the purge removes old events
        expect(await audit.purge(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000))).toBe(0)
        expect(await audit.purge(new Date(Date.now() + 1000))).toBe(3)
        expect(await audit.list({ limit: 10 })).toHaveLength(0)
    })

    it('links an account of another OpenID Connect server once, next to the eID', async () => {
        const store = new PgOidcStore(database)
        const account = await store.createUser({
            email: 'external@example.com',
            name: 'External',
            passwordHash: null,
            emailVerified: true,
            locale: null
        })
        const hash = 'external-' + randomUUID()
        expect(await store.linkIdentifier(account!.id, 'external', hash)).toBe('ok')
        expect((await store.findUserByIdentifier('external', hash))?.id).toBe(account!.id)
        // The same subject never for a second account; one per account
        const other = await store.createUser({
            email: 'external2@example.com',
            name: 'Other',
            passwordHash: null,
            emailVerified: true,
            locale: null
        })
        expect(await store.linkIdentifier(other!.id, 'external', hash)).toBe('taken')
        expect(await store.linkIdentifier(account!.id, 'external', 'external-' + randomUUID())).toBe('exists')
        await expect(
            database.query(`INSERT INTO user_identifiers (type, value_hash, user_id) VALUES ('saml', 'x', $1)`, [
                other!.id
            ])
        ).rejects.toThrow(/user_identifiers_type_check/)
    })

    it('stores passkeys: one account per credential, max 20, the counter only goes up (also at the same time)', async () => {
        const store = new PgOidcStore(database)
        const make = (email: string) =>
            store.createUser({ email, name: 'Passkeys', passwordHash: null, emailVerified: true, locale: null })
        const owner = (await make('passkeys@example.com'))!
        const other = (await make('passkeys2@example.com'))!
        const passkey = (credentialId: string, userId = owner.id) => ({
            userId,
            credentialId,
            publicKey: 'MFkw',
            algorithm: -7,
            signCount: 0,
            name: 'Laptop',
            aaguid: '00000000000000000000000000000000',
            backupEligible: false,
            backedUp: false,
            transports: ['usb', 'nfc']
        })
        const first = await store.addPasskey(passkey('credential-1'))
        expect(first).toMatchObject({ userId: owner.id, transports: ['usb', 'nfc'], lastUsedAt: null })
        // The same credential never twice, not even for another account
        expect(await store.addPasskey(passkey('credential-1', other.id))).toBeNull()
        expect((await store.findPasskey('credential-1'))?.userId).toBe(owner.id)

        // The counter: two logins with the same value at the same moment, only one wins
        const results = await Promise.all([
            store.usePasskey(first!.id, 5, false),
            store.usePasskey(first!.id, 5, false)
        ])
        expect(results.filter(Boolean)).toHaveLength(1)
        expect(await store.usePasskey(first!.id, 4, false)).toBe(false)
        expect(await store.usePasskey(first!.id, 6, true)).toBe(true)
        expect(await store.findPasskey('credential-1')).toMatchObject({ signCount: 6, backedUp: true })
        expect((await store.findPasskey('credential-1'))?.lastUsedAt).toBeInstanceOf(Date)

        // Renaming and deleting only the own ones
        expect(await store.renamePasskey(other.id, first!.id, 'Stolen')).toBe(false)
        expect(await store.renamePasskey(owner.id, first!.id, 'Key')).toBe(true)
        expect(await store.deletePasskey(other.id, first!.id)).toBe(false)

        // Max 20 per account, also when added at the same moment
        await Promise.all(Array.from({ length: 24 }, (_, i) => store.addPasskey(passkey('bulk-' + i))))
        expect(await store.listPasskeys(owner.id)).toHaveLength(20)
        expect(await store.deletePasskey(owner.id, first!.id)).toBe(true)
        await expect(
            database.query(
                `INSERT INTO user_passkeys (user_id, credential_id, public_key, algorithm, name) VALUES ($1, 'x', 'y', -999, 'z')`,
                [owner.id]
            )
        ).rejects.toThrow(/user_passkeys_algorithm_check/)
    })

    it('applications: consent per account, revoking it stops their refresh tokens, and ended sessions queue logout tokens', async () => {
        const store = new PgOidcStore(database)
        const client = (clientId: string, backchannelLogoutUri: string | null) => ({
            clientId,
            name: 'App ' + clientId,
            type: 'public' as const,
            secretHash: null,
            redirectUris: ['https://' + clientId + '.example.com/cb'],
            postLogoutRedirectUris: [],
            grantTypes: ['authorization_code', 'refresh_token'],
            scopes: ['openid', 'email'],
            firstParty: false,
            backchannelLogoutUri,
            backchannelLogoutSessionRequired: true
        })
        await store.upsertClient(client('partner', 'https://partner.example.com/backchannel'))
        await store.upsertClient(client('quiet', null))
        expect(await store.findClient('partner')).toMatchObject({
            backchannelLogoutUri: 'https://partner.example.com/backchannel',
            backchannelLogoutSessionRequired: true
        })
        const owner = (await store.createUser({
            email: 'consent@example.com',
            name: 'Consent',
            passwordHash: 'x',
            emailVerified: true,
            locale: null
        }))!

        // Consent: the scopes add up, per account and application
        expect(await store.findConsent(owner.id, 'partner')).toBeNull()
        await store.saveConsent(owner.id, 'partner', ['openid', 'email'])
        await store.saveConsent(owner.id, 'partner', ['openid', 'profile'])
        expect((await store.findConsent(owner.id, 'partner'))?.scopes).toEqual(['email', 'openid', 'profile'])
        expect((await store.listConsents(owner.id)).map(item => item.clientName)).toEqual(['App partner'])
        await store.saveConsent(owner.id, 'partner', ['tenant'], tenant.a)
        await store.saveConsent(owner.id, 'partner', ['tenant'], tenant.a)
        expect((await store.findConsent(owner.id, 'partner'))?.tenantIds).toEqual([tenant.a])
        // A consent screen answers once, also from two processes at the same moment
        const hash = randomBytes(16).toString('hex')
        const answers = await Promise.all([
            store.useInteraction(hash, new Date(Date.now() + 60_000)),
            store.useInteraction(hash, new Date(Date.now() + 60_000))
        ])
        expect(answers.filter(Boolean)).toHaveLength(1)

        const session = {
            id: randomUUID(),
            idHash: randomBytes(16).toString('hex'),
            interactionHash: randomBytes(16).toString('hex'),
            userId: owner.id,
            tenantId: null,
            authTime: new Date(),
            acr: 'loa2',
            amr: ['pwd', 'otp', 'mfa'],
            expiresAt: new Date(Date.now() + 60_000),
            userAgent: null
        }
        expect(await store.createSession(session)).toBe(true)
        await store.createRefreshToken({
            tokenHash: randomBytes(16).toString('hex'),
            familyId: randomUUID(),
            sessionId: session.id,
            clientId: 'partner',
            userId: owner.id,
            tenantId: null,
            scope: 'openid email',
            expiresAt: new Date(Date.now() + 60_000)
        })
        // Revoked: gone, and its refresh tokens stop in the same transaction
        expect(await store.deleteConsent(owner.id, 'partner')).toBe(true)
        expect(await store.deleteConsent(owner.id, 'partner')).toBe(false)
        const { rows } = await database.query<{ revoked: boolean }>(
            `SELECT revoked_at IS NOT NULL AS revoked FROM oidc_refresh_tokens WHERE client_id = 'partner' AND user_id = $1`,
            [owner.id]
        )
        expect(rows.map(row => row.revoked)).toEqual([true])

        // Both applications got a code in the session; only the one with a back-channel URI is told about its end
        await store.addSessionClient(session.id, 'partner')
        await store.addSessionClient(session.id, 'partner')
        await store.addSessionClient(session.id, 'quiet')
        await store.endSession(session.idHash)
        await store.endSession(session.idHash)
        // Two processes at the same moment: each job once
        const [a, b] = await Promise.all([store.claimLogouts(10, 5), store.claimLogouts(10, 5)])
        const jobs = [...a, ...b]
        expect(jobs).toHaveLength(1)
        expect(jobs[0]).toMatchObject({ sessionId: session.id, userId: owner.id, clientId: 'partner', attempts: 1 })
        // Not due again at once (the next try is later), and gone once delivered
        expect(await store.claimLogouts(10, 5)).toEqual([])
        await store.finishLogout(jobs[0]!.id)
        const left = await database.query('SELECT 1 FROM oidc_logout_queue WHERE session_id = $1', [session.id])
        expect(left.rows).toHaveLength(0)

        // A session that simply runs out: nothing to tell
        const quiet = {
            ...session,
            id: randomUUID(),
            idHash: randomBytes(16).toString('hex'),
            interactionHash: randomBytes(16).toString('hex')
        }
        await store.createSession({ ...quiet, expiresAt: new Date(Date.now() - 1000) })
        await store.addSessionClient(quiet.id, 'partner')
        await database.query(`UPDATE oidc_sessions SET expires_at = expires_at - interval '1 minute' WHERE id = $1`, [
            quiet.id
        ])
        const none = await database.query('SELECT 1 FROM oidc_logout_queue WHERE session_id = $1', [quiet.id])
        expect(none.rows).toHaveLength(0)
    })

    it('apps made on /admin: the clients file never takes them over; disabled they log nobody in; removed with everything', async () => {
        const store = new PgOidcStore(database)
        const owner = (await store.createUser({
            email: 'apps@example.com',
            name: 'Apps',
            passwordHash: 'x',
            emailVerified: true,
            locale: null
        }))!
        const app = {
            clientId: 'made.here',
            name: 'Made here',
            type: 'confidential' as const,
            secretHash: 'a'.repeat(64),
            redirectUris: ['https://made.example.com/cb'],
            postLogoutRedirectUris: [],
            grantTypes: ['authorization_code', 'refresh_token'],
            scopes: ['openid', 'email'],
            firstParty: false,
            backchannelLogoutUri: null
        }
        expect(await store.createClient(app, owner.id)).toBe(true)
        expect(await store.createClient(app, owner.id)).toBe(false)
        expect(await store.upsertClient({ ...app, name: 'From the file' })).toBe(false)
        expect(await store.findClientSummary('made.here')).toMatchObject({
            name: 'Made here',
            source: 'admin',
            disabled: false,
            consents: 0
        })
        expect(await store.updateClient('made.here', { name: 'Renamed', scopes: ['openid'] })).toBe(true)
        expect(await store.setClientSecret('made.here', 'b'.repeat(64))).toBe(true)
        expect((await store.findClient('made.here'))?.secretHash).toBe('b'.repeat(64))
        await store.saveConsent(owner.id, 'made.here', ['openid'])
        expect((await store.listClients()).find(item => item.clientId === 'made.here')).toMatchObject({
            name: 'Renamed',
            consents: 1
        })

        // A file client: never changed, disabled or removed from /admin
        await store.upsertClient({ ...app, clientId: 'from.file', secretHash: null, type: 'public' })
        expect(await store.updateClient('from.file', { name: 'x' })).toBe(false)
        expect(await store.setClientDisabled('from.file', true)).toBe(false)
        expect(await store.deleteClient('from.file')).toBe(false)

        // Disabled: not found for logins, its refresh tokens revoked
        const session = {
            id: randomUUID(),
            idHash: randomBytes(16).toString('hex'),
            interactionHash: randomBytes(16).toString('hex'),
            userId: owner.id,
            tenantId: null,
            authTime: new Date(),
            acr: 'loa2',
            amr: ['pwd'],
            expiresAt: new Date(Date.now() + 60_000),
            userAgent: null
        }
        await store.createSession(session)
        const tokenHash = randomBytes(16).toString('hex')
        await store.createRefreshToken({
            tokenHash,
            familyId: randomUUID(),
            sessionId: session.id,
            clientId: 'made.here',
            userId: owner.id,
            tenantId: null,
            scope: 'openid',
            expiresAt: new Date(Date.now() + 60_000)
        })
        expect(await store.setClientDisabled('made.here', true)).toBe(true)
        expect(await store.findClient('made.here')).toBeNull()
        expect((await store.findClientSummary('made.here'))?.disabled).toBe(true)
        expect((await store.findRefreshToken(tokenHash))?.revokedAt).toBeInstanceOf(Date)
        expect(await store.setClientDisabled('made.here', false)).toBe(true)
        expect(await store.findClient('made.here')).not.toBeNull()

        // Removed: its tokens and consents go along
        expect(await store.deleteClient('made.here')).toBe(true)
        expect(await store.findRefreshToken(tokenHash)).toBeNull()
        expect(await store.findConsent(owner.id, 'made.here')).toBeNull()
        expect(await store.deleteClient('made.here')).toBe(false)
    })

    it('the tenant role exists and owns nothing', async () => {
        const { rows } = await database.query<{ owned: number }>(
            `SELECT count(*)::int AS owned FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = $1`,
            [TENANT_ROLE]
        )
        expect(rows[0]?.owned).toBe(0)
    })
})

function poolSettings() {
    return {
        host: settings.DATABASE_HOST,
        port: Number(settings.DATABASE_PORT),
        user: settings.DATABASE_USER,
        password: settings.DATABASE_PASSWORD,
        database: settings.DATABASE_NAME
    }
}
