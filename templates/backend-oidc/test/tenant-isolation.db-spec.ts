import { randomBytes, randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import pg from 'pg'
import { TENANT_ROLE, TENANT_TABLES, USERS_TABLE } from '../src/database/database.constants.js'
import { DatabaseService } from '../src/database/database.service.js'
import { runMigrations } from '../src/database/migrator.js'
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
            idHash: randomBytes(16).toString('hex'),
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
        expect(await store.createSession({ ...session, idHash: randomBytes(16).toString('hex') })).toBe(false)
        // An ended session no longer works, but still blocks its login until the cleanup an hour later
        await store.endSession(session.idHash)
        expect(await store.findSession(session.idHash)).toBeNull()
        expect(await store.createSession({ ...session, idHash: randomBytes(16).toString('hex') })).toBe(false)
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

    it('creates the first admin only once', async () => {
        const store = new PgOidcStore(database)
        const admin = {
            email: 'root@example.com',
            name: 'Root',
            passwordHash: 'x',
            tenantName: 'Root',
            tenantSlug: 'root'
        }
        expect(await store.bootstrapAdmin(admin)).toBe(false) // there are users already
        await database.query(`DELETE FROM ${users}`)
        expect(await store.bootstrapAdmin(admin)).toBe(true)
        expect(await store.bootstrapAdmin(admin)).toBe(false)
        const memberships = await store.listMemberships((await store.findUserByEmail('ROOT@example.com'))?.id ?? '')
        expect(memberships).toEqual([expect.objectContaining({ slug: 'root', role: 'admin' })])
        expect((await store.findUserByEmail('root@example.com'))?.isSuperadmin).toBe(true)
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
            idHash: randomBytes(16).toString('hex'),
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
