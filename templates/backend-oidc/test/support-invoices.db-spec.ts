import { ConfigService } from '@nestjs/config'
import pg from 'pg'
import { USERS_TABLE } from '../src/database/database.constants.js'
import { DatabaseService } from '../src/database/database.service.js'
import { PgInvoicesStore } from '../src/billing/invoices/pg-invoices.store.js'
import { PgBillingStore } from '../src/billing/store/pg-billing.store.js'
import { PgNotificationsStore } from '../src/notifications/pg-notifications.store.js'
import { PgStatsStore } from '../src/stats/pg-stats.store.js'
import { PgTicketsStore } from '../src/support/pg-tickets.store.js'

/**
 * Support tickets, invoices, notifications and statistics against a REAL PostgreSQL: npm run test:db
 * Like tenant-isolation.db-spec.ts it uses its own <DATABASE_NAME>_test database and removes it afterwards.
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

describe('support tickets, invoices, notifications and statistics (real PostgreSQL)', () => {
    let database: DatabaseService
    const users = '"' + USERS_TABLE + '"'
    const tenant = { a: '', b: '' }
    const user = { ada: '', bob: '', root: '' }

    beforeAll(async () => {
        await admin(`DROP DATABASE IF EXISTS "${settings.DATABASE_NAME}" WITH (FORCE)`)
        await admin(`CREATE DATABASE "${settings.DATABASE_NAME}"`)
        database = new DatabaseService(new ConfigService(settings))
        await database.ready()
        const insert = async (text: string, params: unknown[]) =>
            (await database.query<{ id: string }>(text, params)).rows[0]?.id ?? ''
        tenant.a = await insert('INSERT INTO tenants (slug, name, company) VALUES ($1, $2, $3) RETURNING id', [
            'tenant-a',
            'Tenant A',
            'A BV'
        ])
        tenant.b = await insert('INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id', [
            'tenant-b',
            'Tenant B'
        ])
        for (const name of ['ada', 'bob', 'root'] as const)
            user[name] = await insert(
                `INSERT INTO ${users} (email, name, password_hash, is_superadmin) VALUES ($1, $2, 'x', $3) RETURNING id`,
                [name + '@example.com', name, name === 'root']
            )
        await database.query(
            'INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, $3), ($4, $5, $6)',
            [tenant.a, user.ada, 'admin', tenant.b, user.bob, 'admin']
        )
    })

    afterAll(async () => {
        await database?.onModuleDestroy()
        await admin(`DROP DATABASE IF EXISTS "${settings.DATABASE_NAME}" WITH (FORCE)`)
    })

    it('tickets: numbered from 1001, each organisation sees and changes only its own, notes for support only', async () => {
        const tickets = new PgTicketsStore(database)
        const billing = new PgBillingStore(database)
        await billing.createProduct({
            code: 'agenda',
            name: 'Agenda',
            description: '',
            priceMonthCents: 1000,
            priceYearCents: 10000,
            active: true
        })
        const id = await tickets.create(
            {
                tenantId: tenant.a,
                createdBy: user.ada,
                subject: 'Agenda empty',
                appCode: 'agenda',
                status: 'open',
                priority: 'normal',
                assigneeId: null
            },
            { authorId: user.ada, role: 'customer', body: 'Help' }
        )
        const other = await tickets.create(
            {
                tenantId: tenant.b,
                createdBy: user.bob,
                subject: 'Printing 100%_done',
                appCode: null,
                status: 'open',
                priority: 'high',
                assigneeId: null
            },
            { authorId: user.bob, role: 'customer', body: 'Paper' }
        )
        expect(await tickets.find(tenant.a, id)).toMatchObject({
            number: 1001,
            tenantName: 'Tenant A',
            createdBy: { id: user.ada, name: 'ada' },
            appName: 'Agenda',
            lastMessage: { role: 'customer', text: 'Help' }
        })
        expect(await tickets.find(tenant.b, id)).toBeNull()
        expect((await tickets.list(tenant.a)).map(item => item.id)).toEqual([id])
        expect(await tickets.messages(tenant.b, id)).toEqual([])
        // A member writes and closes; never in another organisation
        expect(
            await tickets.addMessage(
                tenant.b,
                id,
                { authorId: user.bob, role: 'customer', body: 'x' },
                { status: 'open' }
            )
        ).toBe(false)
        expect(
            await tickets.addMessage(
                tenant.a,
                id,
                { authorId: user.ada, role: 'customer', body: 'More' },
                { status: 'open' }
            )
        ).toBe(true)
        expect(await tickets.update(tenant.b, id, { status: 'closed' })).toBe(false)
        // The organisation can only change the status
        await expect(tickets.update(tenant.a, id, { assigneeId: user.ada })).rejects.toThrow(/permission denied/)
        // ... and the rating (1 to 5), of its own tickets only
        expect(await tickets.find(tenant.a, id)).toMatchObject({ rating: null })
        expect(await tickets.rate(tenant.a, id, { score: 4, comment: 'Thanks' })).toBe(true)
        expect(await tickets.rate(tenant.b, id, { score: 1, comment: null })).toBe(false)
        expect((await tickets.find(tenant.a, id))?.rating).toMatchObject({ score: 4, comment: 'Thanks' })
        expect((await tickets.list(null)).find(item => item.id === id)?.rating?.ratedAt).toBeInstanceOf(Date)
        await expect(tickets.rate(tenant.a, id, { score: 6, comment: null })).rejects.toThrow(/check constraint/)
        // The support team: assign, answer, filter, search and notes
        expect(await tickets.update(null, id, { assigneeId: user.root, status: 'in_progress' })).toBe(true)
        expect(
            await tickets.addMessage(
                null,
                id,
                { authorId: user.root, role: 'support', body: 'On it' },
                { status: 'answered' }
            )
        ).toBe(true)
        expect((await tickets.messages(null, id)).map(item => [item.role, item.body])).toEqual([
            ['customer', 'Help'],
            ['customer', 'More'],
            ['support', 'On it']
        ])
        expect((await tickets.list(null, { assigneeId: user.root })).map(item => item.id)).toEqual([id])
        expect((await tickets.list(null, { unassigned: true })).map(item => item.id)).toEqual([other])
        expect((await tickets.list(null, { q: 'TIC-1002' })).map(item => item.id)).toEqual([other])
        expect((await tickets.list(null, { q: '100%_' })).map(item => item.id)).toEqual([other])
        expect((await tickets.list(null, { q: 'tenant a' })).map(item => item.id)).toEqual([id])
        expect((await tickets.list(null, { status: 'answered' })).map(item => item.id)).toEqual([id])
        await tickets.addNote(id, user.root, 'Internal', [user.root])
        expect(await tickets.notes(id)).toMatchObject([
            { body: 'Internal', author: { id: user.root }, mentions: [{ id: user.root, name: 'root' }] }
        ])
        // The tenant role has no access to the notes at all
        await expect(database.withTenant(tenant.a, db => db.query('SELECT * FROM ticket_notes'))).rejects.toThrow(
            /permission denied/
        )
    })

    it('ticket images: bytes kept as they are, each organisation reads and adds only its own', async () => {
        const tickets = new PgTicketsStore(database)
        const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from([0, 1, 2, 255])])
        const image = {
            tenantId: tenant.a,
            uploadedBy: user.ada,
            filename: 'shot.png',
            contentType: 'image/png' as const
        }
        const id = await tickets.addAttachment(tenant.a, { ...image, data: png })
        const found = await tickets.findAttachment(tenant.a, id)
        expect(found).toMatchObject({
            id,
            tenantId: tenant.a,
            filename: 'shot.png',
            contentType: 'image/png',
            size: 12
        })
        expect(found?.data.equals(png)).toBe(true)
        expect(await tickets.findAttachment(tenant.b, id)).toBeNull()
        expect((await tickets.findAttachment(null, id))?.size).toBe(12)
        // Which ids exist, per organisation (the support team asks for any organisation)
        const unknown = '0b6f2f61-0000-4000-8000-000000000000'
        expect(await tickets.attachmentsExist(tenant.a, tenant.a, [id, unknown])).toEqual([id])
        expect(await tickets.attachmentsExist(tenant.b, tenant.b, [id])).toEqual([])
        expect(await tickets.attachmentsExist(null, tenant.b, [id])).toEqual([])
        expect(await tickets.attachmentsExist(null, tenant.a, [id])).toEqual([id])
        expect(await tickets.attachmentsExist(tenant.a, tenant.a, [])).toEqual([])
        // Never for another organisation (Row-Level Security), never another type
        await expect(tickets.addAttachment(tenant.b, { ...image, data: png })).rejects.toThrow(/row-level security/)
        await expect(
            tickets.addAttachment(null, { ...image, contentType: 'image/svg+xml' as 'image/png', data: png })
        ).rejects.toThrow(/check constraint/)
        expect(await tickets.addAttachment(null, { ...image, tenantId: tenant.b, data: png })).toMatch(
            /^[0-9a-f-]{36}$/
        )
        // Members cannot change or remove an image
        await expect(
            database.withTenant(tenant.a, db => db.query('DELETE FROM ticket_attachments WHERE id = $1', [id]))
        ).rejects.toThrow(/permission denied/)
    })

    it('invoices: numbered per year without gaps, once per payment, read per organisation', async () => {
        const billing = new PgBillingStore(database)
        const invoices = new PgInvoicesStore(database)
        const product = (await billing.findProductByCode('agenda'))!
        const subscription = await billing.saveSubscription({
            tenantId: tenant.a,
            productId: product.id,
            interval: 'month',
            seats: 2,
            status: 'pending',
            providerSubscriptionId: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            discountCodeId: null,
            discountPeriodsLeft: null,
            environmentName: 'Praktijk A',
            region: 'eu-west-1'
        })
        expect(subscription).toMatchObject({ environmentName: 'Praktijk A', region: 'eu-west-1' })
        const payment = (id: string, kind: 'first' | 'invoices' = 'first') =>
            billing.createPayment({
                id,
                tenantId: tenant.a,
                subscriptionId: kind === 'invoices' ? null : subscription.id,
                kind,
                seats: kind === 'invoices' ? 0 : 2,
                amountCents: 2420,
                status: 'open',
                periodEnd: null
            })
        await payment('tr_db1')
        await payment('tr_db2')
        await payment('tr_all', 'invoices')
        const issue = (paymentId: string | null) =>
            invoices.create({
                tenantId: tenant.a,
                paymentId,
                subscriptionId: subscription.id,
                productCode: 'agenda',
                productName: 'Agenda',
                description: paymentId ? 'subscription' : 'free',
                period: 'month',
                seats: 2,
                vatPercent: 21,
                amountCents: paymentId ? 2000 : 0,
                vatCents: paymentId ? 420 : 0,
                totalCents: paymentId ? 2420 : 0,
                status: paymentId ? 'open' : 'free',
                checkoutUrl: paymentId ? 'https://pay/' + paymentId : null
            })
        const year = new Date().getUTCFullYear()
        const [one, twice, two] = await Promise.all([issue('tr_db1'), issue('tr_db1'), issue('tr_db2')])
        const created = [one, twice, two].filter(item => item !== null)
        expect(created).toHaveLength(2)
        expect(created.map(item => item.number).sort()).toEqual([`FAC-${year}-0001`, `FAC-${year}-0002`])
        // The number of the failed one was given back
        expect((await issue(null))?.number).toBe(`FAC-${year}-0003`)
        expect(created[0]).toMatchObject({ tenantName: 'Tenant A', company: 'A BV', vat: null })
        expect(await invoices.list(tenant.a)).toHaveLength(3)
        expect(await invoices.list(tenant.b)).toEqual([])
        expect(await invoices.find(tenant.b, created[0]!.id)).toBeNull()

        const open = await invoices.listOpen(tenant.a)
        expect(open).toHaveLength(2)
        await invoices.settle(
            open.map(item => item.id),
            'tr_all',
            'https://pay/all'
        )
        expect((await invoices.listSettledBy('tr_all')).map(item => item.checkoutUrl)).toEqual([
            'https://pay/all',
            'https://pay/all'
        ])
        expect(await invoices.markVoid([open[1]!.id])).toHaveLength(1)
        expect(await invoices.listOpenPurchase(subscription.id)).toHaveLength(1)
        expect(await invoices.markPaid(open[0]!.id)).toMatchObject({ status: 'paid', checkoutUrl: null })
        expect(await invoices.markPaid(open[0]!.id)).toBeNull()
        expect((await invoices.findByPayment('tr_db2'))?.status).toBe('void')
        expect((await invoices.markPaid(open[1]!.id))?.paidAt).toBeInstanceOf(Date)
    })

    it('notifications: per account and scope, read once, computed ones by key', async () => {
        const store = new PgNotificationsStore(database)
        await store.add([
            {
                userId: user.ada,
                tenantId: tenant.a,
                kind: 'invoice.created',
                params: { number: 'F' },
                nav: { screen: 'invoices' }
            },
            {
                userId: user.root,
                tenantId: null,
                kind: 'tenant.created',
                params: { name: 'B' },
                nav: { screen: 'admin-tenants' }
            },
            {
                userId: user.root,
                tenantId: tenant.a,
                kind: 'ticket.reply',
                params: {},
                nav: { screen: 'ticket', id: 'x' }
            }
        ])
        expect((await store.list(user.ada, [tenant.a], 40)).map(item => item.kind)).toEqual(['invoice.created'])
        expect((await store.list(user.root, [null], 40)).map(item => item.kind)).toEqual(['tenant.created'])
        expect(await store.list(user.root, [tenant.b, null], 40)).toHaveLength(1)
        expect(await store.list(user.root, [tenant.a, null], 40)).toHaveLength(2)
        const [mine] = await store.list(user.ada, [tenant.a], 40)
        expect(await store.markRead(user.root, mine!.id)).toBe(false)
        expect(await store.markRead(user.ada, mine!.id)).toBe(true)
        await store.markAllRead(user.root, [null])
        expect((await store.list(user.root, [tenant.a, null], 40)).map(item => item.readAt !== null)).toEqual(
            expect.arrayContaining([true, false])
        )
        await store.addReads(user.ada, ['contract:x:2026-01-01', 'contract:x:2026-01-01'])
        expect([...(await store.readKeys(user.ada, ['contract:x:2026-01-01', 'other']))]).toEqual([
            'contract:x:2026-01-01'
        ])
    })

    it('statistics read everything of the platform', async () => {
        const data = await new PgStatsStore(database).load()
        expect(data.tenants).toHaveLength(2)
        expect(data.members).toHaveLength(2)
        expect(data.subscriptions).toHaveLength(1)
        expect(data.payments).toHaveLength(2)
        expect(data.products).toMatchObject([{ code: 'agenda', name: 'Agenda', color: null }])
    })
})
