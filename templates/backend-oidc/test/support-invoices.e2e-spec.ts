import { randomBytes } from 'node:crypto'
import { INestApplication, Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { AUDIT_STORE } from '../src/audit/audit.store.js'
import { MemoryAuditStore } from '../src/audit/memory-audit.store.js'
import { INVOICES_STORE } from '../src/billing/invoices/invoices.store.js'
import { MemoryInvoicesStore } from '../src/billing/invoices/memory-invoices.store.js'
import { FakeProvider } from '../src/billing/payments/fake.provider.js'
import { PAYMENT_PROVIDER } from '../src/billing/payments/payment-provider.js'
import { BILLING_STORE } from '../src/billing/store/billing.store.js'
import { MemoryBillingStore } from '../src/billing/store/memory-billing.store.js'
import { DatabaseService } from '../src/database/database.service.js'
import type { Mail } from '../src/mail/mail.service.js'
import { MailService } from '../src/mail/mail.service.js'
import { MemoryNotificationsStore } from '../src/notifications/memory-notifications.store.js'
import { NOTIFICATIONS_STORE } from '../src/notifications/notifications.store.js'
import { pkceChallenge } from '../src/oidc/crypto.js'
import { LoginLimiter } from '../src/oidc/login-limiter.js'
import { hashPassword } from '../src/oidc/password.js'
import { MemoryOidcStore } from '../src/oidc/store/memory-oidc.store.js'
import { OIDC_STORE } from '../src/oidc/store/oidc.store.js'
import { configureApp } from '../src/setup.js'
import { MemoryStatsStore } from '../src/stats/memory-stats.store.js'
import { STATS_STORE } from '../src/stats/stats.store.js'
import { MemoryTicketsStore } from '../src/support/memory-tickets.store.js'
import { TICKETS_STORE } from '../src/support/tickets.store.js'

process.env.OIDC_MASTER_KEY ??= randomBytes(32).toString('hex')
process.env.OIDC_LOGIN_RATE_LIMIT = '1000'
process.env.OIDC_LOGIN_UI_URL = ''
process.env.OIDC_MFA = 'optional'
// The accounts of these tests have no eID (the tests of OIDC_EID_REQUIRED are in eid.e2e-spec.ts)
process.env.OIDC_EID_REQUIRED = 'off'
process.env.APP_URL = 'http://localhost:3000'
process.env.PAYMENTS = 'fake'

const REDIRECT = 'http://localhost:3000/api/auth/callback'
const PASSWORD = 'correct-horse-battery'
const DAY = 24 * 60 * 60 * 1000

describe('Support tickets, invoices, the purchase wizard, notifications and statistics (e2e)', () => {
    let app: INestApplication<App>
    let fake: FakeProvider
    const store = new MemoryOidcStore()
    const billing = new MemoryBillingStore()
    const audit = new MemoryAuditStore(store)
    const notifications = new MemoryNotificationsStore()
    const tickets = new MemoryTicketsStore({
        findUserById: id => store.findUserById(id),
        findTenant: id => store.findTenant(id),
        findProductByCode: code => billing.findProductByCode(code)
    })
    const invoices = new MemoryInvoicesStore(async tenantId => {
        const tenant = await store.findTenant(tenantId)
        return tenant
            ? { tenantName: tenant.name, company: null, vat: null, billingAddress: null, billingEmail: null }
            : null
    })
    const stats = new MemoryStatsStore()
    const outbox: Mail[] = []
    const http = () => request(app.getHttpServer())
    const ids = { acme: '', globex: '', alice: '', bob: '', carol: '', root: '' }
    const tokens = { alice: '', bob: '', carol: '', root: '' }

    beforeAll(async () => {
        const passwordHash = await hashPassword(PASSWORD)
        const acme = store.addTenant('acme', 'Acme')
        const globex = store.addTenant('globex', 'Globex')
        const alice = store.addUser({ email: 'alice@example.com', name: 'Alice', passwordHash })
        const bob = store.addUser({ email: 'bob@example.com', name: 'Bob', passwordHash, locale: 'nl' })
        const carol = store.addUser({ email: 'carol@example.com', name: 'Carol', passwordHash })
        const root = store.addUser({ email: 'root@example.com', name: 'Root', passwordHash, isSuperadmin: true })
        store.addMembership(acme.id, alice.id, 'admin')
        store.addMembership(acme.id, bob.id, 'user')
        store.addMembership(globex.id, carol.id, 'admin')
        Object.assign(ids, {
            acme: acme.id,
            globex: globex.id,
            alice: alice.id,
            bob: bob.id,
            carol: carol.id,
            root: root.id
        })

        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(DatabaseService)
            .useValue({ ping: vi.fn().mockResolvedValue(true), query: vi.fn().mockResolvedValue({ rows: [] }) })
            .overrideProvider(OIDC_STORE)
            .useValue(store)
            .overrideProvider(BILLING_STORE)
            .useValue(billing)
            .overrideProvider(AUDIT_STORE)
            .useValue(audit)
            .overrideProvider(NOTIFICATIONS_STORE)
            .useValue(notifications)
            .overrideProvider(TICKETS_STORE)
            .useValue(tickets)
            .overrideProvider(INVOICES_STORE)
            .useValue(invoices)
            .overrideProvider(STATS_STORE)
            .useValue(stats)
            .overrideProvider(MailService)
            .useValue({
                send: async (mail: Mail) => {
                    outbox.push(mail)
                    return true
                }
            })
            .compile()
        app = moduleRef.createNestApplication()
        configureApp(app)
        await app.init()
        fake = app.get<FakeProvider>(PAYMENT_PROVIDER)
        for (const name of ['alice', 'bob', 'carol', 'root'] as const)
            tokens[name] = await accessToken(`${name}@example.com`, name === 'carol' ? 'globex' : 'acme')
        for (const [code, name] of [
            ['planner', 'Planner'],
            ['agenda', 'Agenda']
        ])
            await http()
                .post('/admin/products')
                .set(bearer(tokens.root))
                .send({ code, name, priceMonthCents: 1000, priceYearCents: 10000 })
                .expect(201)
    })

    afterAll(async () => {
        await app.close()
    })

    beforeEach(() => {
        app.get(LoginLimiter).clear()
    })

    const bearer = (token: string) => ({ Authorization: 'Bearer ' + token })
    const cookieOf = (response: request.Response, name: string) =>
        ((response.headers['set-cookie'] as unknown as string[] | undefined) ?? [])
            .find(c => c.startsWith(name))
            ?.split(';')[0] ?? ''

    async function accessToken(email: string, tenant: string) {
        const verifier = randomBytes(32).toString('base64url')
        const query = new URLSearchParams({
            client_id: 'frontend',
            redirect_uri: REDIRECT,
            response_type: 'code',
            scope: 'openid profile email tenant',
            code_challenge: pkceChallenge(verifier),
            code_challenge_method: 'S256',
            tenant_hint: tenant
        })
        const start = await http()
            .get('/oidc/authorize?' + query.toString())
            .expect(303)
        const location = new URL(start.headers.location as string)
        const cookie = cookieOf(start, 'oidc_ia_')
        const page = await http().get(location.pathname).set('Cookie', cookie)
        const csrf = /name="csrf" value="([^"]+)"/.exec(page.text)?.[1] ?? ''
        const done = await http()
            .post(location.pathname + '/login')
            .set('Cookie', cookie)
            .type('form')
            .send({ csrf, email, password: PASSWORD })
            .expect(303)
        const code = new URL(done.headers.location as string).searchParams.get('code') ?? ''
        const response = await http()
            .post('/oidc/token')
            .type('form')
            .send({
                grant_type: 'authorization_code',
                code,
                redirect_uri: REDIRECT,
                client_id: 'frontend',
                code_verifier: verifier
            })
            .expect(200)
        return response.body.access_token as string
    }

    /** Pays (or cancels) a checkout of the fake provider like a customer: returns where the browser goes back to. */
    async function checkout(url: string, action: 'pay' | 'cancel' = 'pay') {
        const path = new URL(url).pathname
        await http().get(path).expect(200)
        const done = await http().post(path).type('form').send({ action }).expect(303)
        return done.headers.location as string
    }

    const mine = async (who: keyof typeof tokens) =>
        (await http().get('/me/notifications').set(bearer(tokens[who])).expect(200)).body as {
            id: string
            kind: string
            params: Record<string, unknown>
            nav: { screen: string; id?: string }
            read: boolean
        }[]

    describe('support tickets', () => {
        let ticketId = ''

        it('a member asks a question; the online support team gets a notification, nobody an email', async () => {
            // Root is online (a heartbeat); the notification only goes to superadmins that are online
            await http().post('/me/heartbeat').set(bearer(tokens.root)).expect(204)
            outbox.length = 0
            const created = await http()
                .post('/tenants/current/tickets')
                .set(bearer(tokens.bob))
                .send({ subject: 'My agenda is empty', appCode: 'agenda', text: 'All appointments are gone.' })
                .expect(201)
            ticketId = created.body.id as string
            expect(created.body).toMatchObject({
                number: 'TIC-1001',
                tenant: { id: ids.acme, name: 'Acme' },
                customer: { id: ids.bob, name: 'Bob' },
                app: 'Agenda',
                appCode: 'agenda',
                status: 'open',
                priority: 'normal',
                assignee: null,
                messages: [{ role: 'customer', text: 'All appointments are gone.', from: { id: ids.bob } }]
            })
            expect(outbox).toHaveLength(0)
            expect((await mine('root')).find(item => item.kind === 'ticket.created')).toMatchObject({
                params: { number: 'TIC-1001', tenant: 'Acme', subject: 'My agenda is empty' },
                nav: { screen: 'admin-ticket', id: ticketId },
                read: false
            })
            const list = await http().get('/tenants/current/tickets').set(bearer(tokens.alice)).expect(200)
            expect(list.body).toMatchObject([{ id: ticketId, lastMessage: { role: 'customer' } }])
            expect(list.body[0]).not.toHaveProperty('messages')
            const general = await http()
                .post('/tenants/current/tickets')
                .set(bearer(tokens.bob))
                .send({ subject: 'General question', appCode: null, text: 'Hello' })
                .expect(201)
            expect(general.body).toMatchObject({ number: 'TIC-1002', app: null, appCode: null })
            const unknown = await http()
                .post('/tenants/current/tickets')
                .set(bearer(tokens.bob))
                .send({ subject: 'Other', appCode: 'nothing', text: 'x' })
                .expect(404)
            expect(unknown.body.error).toBe('support.APP_NOT_FOUND')
        })

        it('another organisation never sees it; members never reach the support routes', async () => {
            const other = await http().get(`/tenants/current/tickets/${ticketId}`).set(bearer(tokens.carol)).expect(404)
            expect(other.body.error).toBe('support.TICKET_NOT_FOUND')
            expect((await http().get('/tenants/current/tickets').set(bearer(tokens.carol)).expect(200)).body).toEqual(
                []
            )
            await http().get('/admin/tickets').set(bearer(tokens.alice)).expect(403)
            await http()
                .post(`/tenants/current/tickets/${ticketId}/messages`)
                .set(bearer(tokens.carol))
                .send({ text: 'x' })
                .expect(404)
        })

        it('support claims, answers (the customer gets a notification, no email), notes, closes and reopens', async () => {
            const filtered = await http()
                .get('/admin/tickets?assignee=none&q=agenda')
                .set(bearer(tokens.root))
                .expect(200)
            expect(filtered.body.map((item: { id: string }) => item.id)).toEqual([ticketId])
            await http().get('/admin/tickets?status=nope').set(bearer(tokens.root)).expect(400)
            const claimed = await http().post(`/admin/tickets/${ticketId}/claim`).set(bearer(tokens.root)).expect(200)
            expect(claimed.body).toMatchObject({ status: 'in_progress', assignee: { id: ids.root }, notes: [] })
            outbox.length = 0
            const answered = await http()
                .post(`/admin/tickets/${ticketId}/messages`)
                .set(bearer(tokens.root))
                .send({ text: 'We restored them from the backup.' })
                .expect(201)
            expect(answered.body.status).toBe('answered')
            expect(outbox).toHaveLength(0)
            const reply = (await mine('bob')).find(item => item.kind === 'ticket.reply')
            expect(reply).toMatchObject({
                params: { number: 'TIC-1001', from: 'Root', text: 'We restored them from the backup.' },
                nav: { screen: 'ticket', id: ticketId }
            })
            await http().post(`/me/notifications/${reply?.id}/read`).set(bearer(tokens.bob)).expect(204)
            expect((await mine('bob')).find(item => item.id === reply?.id)?.read).toBe(true)
            await http()
                .post('/me/notifications/0b6f2f61-0000-4000-8000-000000000000/read')
                .set(bearer(tokens.bob))
                .expect(404)

            const team = await http().get('/admin/support-team').set(bearer(tokens.root)).expect(200)
            expect(team.body).toEqual([{ id: ids.root, name: 'Root', email: 'root@example.com', outOfOffice: null }])
            const wrongMention = await http()
                .post(`/admin/tickets/${ticketId}/notes`)
                .set(bearer(tokens.root))
                .send({ text: 'Ask Bob', mentions: [ids.bob] })
                .expect(400)
            expect(wrongMention.body.error).toBe('support.MENTION_NOT_SUPPORT')
            const noted = await http()
                .post(`/admin/tickets/${ticketId}/notes`)
                .set(bearer(tokens.root))
                .send({ text: 'Backup of last night', mentions: [ids.root] })
                .expect(201)
            expect(noted.body.notes).toMatchObject([
                { text: 'Backup of last night', mentions: [{ id: ids.root, name: 'Root' }] }
            ])
            const seen = await http().get(`/tenants/current/tickets/${ticketId}`).set(bearer(tokens.bob)).expect(200)
            expect(seen.body).not.toHaveProperty('notes')
            expect(seen.body.messages).toHaveLength(2)

            await http().post(`/tenants/current/tickets/${ticketId}/close`).set(bearer(tokens.bob)).expect(200)
            const closed = await http()
                .post(`/tenants/current/tickets/${ticketId}/messages`)
                .set(bearer(tokens.bob))
                .send({ text: 'One more thing' })
                .expect(409)
            expect(closed.body.error).toBe('support.TICKET_CLOSED')
            const reopened = await http().post(`/admin/tickets/${ticketId}/reopen`).set(bearer(tokens.root)).expect(200)
            expect(reopened.body.status).toBe('in_progress')
            const again = await http()
                .post(`/tenants/current/tickets/${ticketId}/messages`)
                .set(bearer(tokens.bob))
                .send({ text: 'One more thing' })
                .expect(201)
            expect(again.body.status).toBe('open')
        })

        it('out of office: the customer sees the external message, colleagues the internal one', async () => {
            const until = new Date(Date.now() + 3 * 86_400_000).toISOString()
            await http()
                .put('/me/out-of-office')
                .set(bearer(tokens.root))
                .send({ enabled: true, until, internalMessage: 'Ask Sofie', externalMessage: 'Back on Monday' })
                .expect(200)
            // The ticket is handled by Root
            const customer = await http()
                .get(`/tenants/current/tickets/${ticketId}`)
                .set(bearer(tokens.bob))
                .expect(200)
            expect(customer.body.assignee).toMatchObject({ id: ids.root })
            expect(customer.body.assigneeOutOfOffice).toEqual({ until, message: 'Back on Monday' })
            const support = await http().get(`/admin/tickets/${ticketId}`).set(bearer(tokens.root)).expect(200)
            expect(support.body.assigneeOutOfOffice).toEqual({ until, message: 'Ask Sofie' })
            // Who mentions or assigns Root sees it in the team
            const team = await http().get('/admin/support-team').set(bearer(tokens.root)).expect(200)
            expect(team.body).toEqual([
                expect.objectContaining({ id: ids.root, outOfOffice: { until, message: 'Ask Sofie' } })
            ])

            await http().put('/me/out-of-office').set(bearer(tokens.root)).send({ enabled: false }).expect(200)
            const back = await http().get(`/tenants/current/tickets/${ticketId}`).set(bearer(tokens.bob)).expect(200)
            expect(back.body.assigneeOutOfOffice).toBeNull()
        })

        it('the customer rates a closed ticket; support sees the rating in its list', async () => {
            const rating = (body: object) =>
                http().post(`/tenants/current/tickets/${ticketId}/rating`).set(bearer(tokens.bob)).send(body)
            // Open (bob wrote again): not yet
            const open = await rating({ score: 5 }).set('Accept-Language', 'nl').expect(409)
            expect(open.body).toMatchObject({
                error: 'support.TICKET_NOT_CLOSED',
                message: 'Alleen een gesloten ticket kan beoordeeld worden.'
            })
            await http().post(`/tenants/current/tickets/${ticketId}/close`).set(bearer(tokens.bob)).expect(200)
            for (const body of [
                { score: 0 },
                { score: 6 },
                { score: 2.5 },
                {},
                { score: 3, comment: 'x'.repeat(1001) }
            ]) {
                expect((await rating(body).expect(400)).body.error).toBe('errors.BAD_REQUEST')
            }
            await http()
                .post(`/tenants/current/tickets/${ticketId}/rating`)
                .set(bearer(tokens.carol))
                .send({ score: 1 })
                .expect(404)

            const rated = await rating({ score: 4, comment: '  Fast and friendly  ' }).expect(200)
            expect(rated.body).toMatchObject({
                id: ticketId,
                status: 'closed',
                rating: { score: 4, comment: 'Fast and friendly' },
                messages: [{ role: 'customer' }, { role: 'support' }, { role: 'customer' }]
            })
            expect(typeof rated.body.rating.ratedAt).toBe('string')
            const again = await rating({ score: 5, comment: '' }).expect(200)
            expect(again.body.rating).toMatchObject({ score: 5, comment: null })
            expect(Date.parse(again.body.rating.ratedAt as string)).toBeGreaterThanOrEqual(
                Date.parse(rated.body.rating.ratedAt as string)
            )

            const list = await http().get('/admin/tickets').set(bearer(tokens.root)).expect(200)
            expect(list.body.find((item: { id: string }) => item.id === ticketId)).toMatchObject({
                rating: { score: 5, comment: null }
            })
            const mine = await http().get('/tenants/current/tickets').set(bearer(tokens.alice)).expect(200)
            expect(mine.body.find((item: { id: string }) => item.id === ticketId).rating.score).toBe(5)
            expect(
                (await http().get(`/admin/tickets/${ticketId}`).set(bearer(tokens.root)).expect(200)).body.rating
            ).toMatchObject({ score: 5 })
            expect(audit.events.filter(event => event.action === 'support.ticket_rated').at(-1)).toMatchObject({
                tenantId: ids.acme,
                targetId: ticketId,
                details: { score: 5 }
            })

            // Reopening keeps the rating
            const reopened = await http()
                .post(`/tenants/current/tickets/${ticketId}/reopen`)
                .set(bearer(tokens.bob))
                .expect(200)
            expect(reopened.body).toMatchObject({ status: 'open', rating: { score: 5 } })
        })

        it('support opens a ticket for an organisation: its admins hear about it', async () => {
            const created = await http()
                .post('/admin/tickets')
                .set(bearer(tokens.root))
                .send({ tenantId: ids.globex, subject: 'Maintenance', priority: 'high', text: 'Tonight at 22:00.' })
                .expect(201)
            expect(created.body).toMatchObject({ status: 'in_progress', priority: 'high', assignee: { id: ids.root } })
            expect((await mine('carol')).find(item => item.kind === 'ticket.reply')).toMatchObject({
                params: { number: created.body.number as string }
            })
            const missing = await http()
                .post('/admin/tickets')
                .set(bearer(tokens.root))
                .send({
                    tenantId: '0b6f2f61-0000-4000-8000-000000000000',
                    subject: 'x y',
                    priority: 'normal',
                    text: 'x'
                })
                .expect(404)
            expect(missing.body.error).toBe('oidc.TENANT_NOT_FOUND')
        })

        it('images: uploaded as JSON (up to 2 MiB), shown only to the own organisation and support', async () => {
            // A PNG of about 1.5 MB: about 2 MB of JSON, more than the usual limit of 100 kB
            const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(1_500_000, 7)])
            const uploaded = await http()
                .post('/tenants/current/tickets/attachments')
                .set(bearer(tokens.bob))
                .send({ filename: 'C:\\shots\\schermafbeelding é.png', dataBase64: png.toString('base64') })
                .expect(201)
            const image = uploaded.body.id as string
            expect(uploaded.body).toEqual({
                id: expect.stringMatching(/^[0-9a-f-]{36}$/),
                filename: 'schermafbeelding é.png',
                contentType: 'image/png',
                size: png.length
            })
            const fetched = await http()
                .get(`/tenants/current/tickets/attachments/${image}`)
                .set(bearer(tokens.alice))
                .responseType('blob')
                .expect(200)
            expect(fetched.headers['content-type']).toBe('image/png')
            expect(fetched.headers['content-disposition']).toBe(
                `inline; filename="schermafbeelding _.png"; filename*=UTF-8''schermafbeelding%20%C3%A9.png`
            )
            expect(fetched.headers['x-content-type-options']).toBe('nosniff')
            expect(fetched.headers['cache-control']).toBe('private, max-age=86400')
            expect((fetched.body as Buffer).equals(png)).toBe(true)
            const bySupport = await http()
                .get(`/admin/tickets/attachments/${image}`)
                .set(bearer(tokens.root))
                .responseType('blob')
                .expect(200)
            expect((bySupport.body as Buffer).length).toBe(png.length)
            const other = await http()
                .get(`/tenants/current/tickets/attachments/${image}`)
                .set(bearer(tokens.carol))
                .expect(404)
            expect(other.body.error).toBe('support.ATTACHMENT_NOT_FOUND')
            await http().get(`/admin/tickets/attachments/${image}`).set(bearer(tokens.alice)).expect(403)
            await http().get('/tenants/current/tickets/attachments/nope').set(bearer(tokens.bob)).expect(400)

            // A message shows the image as ![name](att:<id>); only images of the own organisation
            const text = `It looks like **this**:\n\n![shot.png](att:${image})`
            const created = await http()
                .post('/tenants/current/tickets')
                .set(bearer(tokens.bob))
                .send({ subject: 'With a picture', text })
                .expect(201)
            expect(created.body.messages).toMatchObject([{ text }])
            const answered = await http()
                .post(`/admin/tickets/${created.body.id as string}/messages`)
                .set(bearer(tokens.root))
                .send({ text: `Thanks, I see it:\n\n![shot.png](att:${image})` })
                .expect(201)
            expect(answered.body.messages).toHaveLength(2)
            expect((await mine('bob')).find(item => item.kind === 'ticket.reply')).toMatchObject({
                params: { text: 'Thanks, I see it:\n🖼' }
            })
            const list = await http().get('/tenants/current/tickets').set(bearer(tokens.bob)).expect(200)
            expect(list.body.find((item: { id: string }) => item.id === created.body.id)).toMatchObject({
                lastMessage: { role: 'support', text: 'Thanks, I see it:\n🖼' }
            })
            const unknown = await http()
                .post(`/tenants/current/tickets/${created.body.id as string}/messages`)
                .set(bearer(tokens.bob))
                .send({ text: '![x](att:0b6f2f61-0000-4000-8000-000000000000)' })
                .expect(400)
            expect(unknown.body.error).toBe('support.ATTACHMENT_UNKNOWN')
            const foreign = await http()
                .post('/tenants/current/tickets')
                .set(bearer(tokens.carol))
                .set('Accept-Language', 'nl')
                .send({ subject: 'Stolen picture', text: `![x](att:${image})` })
                .expect(400)
            expect(foreign.body).toMatchObject({
                error: 'support.ATTACHMENT_UNKNOWN',
                message: 'Het bericht bevat een afbeelding die niet gevonden werd.'
            })

            // Support uploads for an organisation; the type comes from the content, never from the upload
            const gif = await http()
                .post('/admin/tickets/attachments')
                .set(bearer(tokens.root))
                .send({
                    tenantId: ids.globex,
                    filename: 'a.png',
                    dataBase64: 'data:image/png;base64,R0lGODlhAQABAAAAACw='
                })
                .expect(201)
            expect(gif.body).toMatchObject({ filename: 'a.png', contentType: 'image/gif' })
            await http()
                .get(`/tenants/current/tickets/attachments/${gif.body.id as string}`)
                .set(bearer(tokens.carol))
                .expect(200)
                .expect('Content-Type', 'image/gif')
            const noTenant = await http()
                .post('/admin/tickets/attachments')
                .set(bearer(tokens.root))
                .send({ tenantId: '0b6f2f61-0000-4000-8000-000000000000', filename: 'a.gif', dataBase64: 'R0lGODlh' })
                .expect(404)
            expect(noTenant.body.error).toBe('oidc.TENANT_NOT_FOUND')
            await http()
                .post('/admin/tickets/attachments')
                .set(bearer(tokens.alice))
                .send({ tenantId: ids.acme, filename: 'a.gif', dataBase64: 'R0lGODlh' })
                .expect(403)
            const svg = await http()
                .post('/tenants/current/tickets/attachments')
                .set(bearer(tokens.bob))
                .set('Accept-Language', 'fr')
                .send({
                    filename: 'x.png',
                    dataBase64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')
                })
                .expect(400)
            expect(svg.body).toMatchObject({
                error: 'support.IMAGE_INVALID',
                message: "Ce fichier n'est pas une image PNG, JPEG, GIF ou WebP."
            })
            const large = await http()
                .post('/tenants/current/tickets/attachments')
                .set(bearer(tokens.bob))
                .set('Accept-Language', 'de')
                .send({
                    filename: 'big.png',
                    dataBase64: Buffer.concat([png, Buffer.alloc(600_000)]).toString('base64')
                })
                .expect(413)
            expect(large.body).toMatchObject({
                error: 'support.IMAGE_TOO_LARGE',
                message: 'Dieses Bild ist zu groß (höchstens 2 MB).'
            })
        })

        it('only the uploads get a larger JSON body (3 MB); every other route keeps 100 kB and its JSON', async () => {
            const huge = await http()
                .post('/tenants/current/tickets/attachments')
                .set(bearer(tokens.bob))
                .set('Accept-Language', 'nl')
                .send({ filename: 'huge.png', dataBase64: 'A'.repeat(3_200_000) })
                .expect(413)
            expect(huge.body).toMatchObject({ error: 'errors.PAYLOAD_TOO_LARGE', message: 'Het verzoek is te groot' })
            for (const size of [3_000_000, 200_000]) {
                const tooLarge = await http()
                    .post('/tenants/current/tickets')
                    .set(bearer(tokens.bob))
                    .send({ subject: 'Huge', text: 'x'.repeat(size) })
                    .expect(413)
                expect(tooLarge.body.error).toBe('errors.PAYLOAD_TOO_LARGE')
            }
            const broken = await http()
                .post('/tenants/current/tickets')
                .set(bearer(tokens.bob))
                .set('Content-Type', 'application/json')
                .send('{"subject": ')
                .expect(400)
            expect(broken.body.error).toBe('errors.BAD_REQUEST')

            // Next to the uploads, an ordinary JSON body still arrives: a ticket and a reply in it
            await http()
                .post('/tenants/current/tickets/attachments')
                .set(bearer(tokens.bob))
                .send({ filename: 'a.gif', dataBase64: 'R0lGODlhAQABAAAAACw=' })
                .expect(201)
            const created = await http()
                .post('/tenants/current/tickets')
                .set(bearer(tokens.bob))
                .send({ subject: 'Long', text: 'x'.repeat(20_000) })
                .expect(201)
            expect(created.body).toMatchObject({ subject: 'Long', messages: [{ text: 'x'.repeat(20_000) }] })
            const replied = await http()
                .post(`/tenants/current/tickets/${created.body.id as string}/messages`)
                .set(bearer(tokens.bob))
                .send({ text: 'A _plain_ reply' })
                .expect(201)
            expect(replied.body.messages.at(-1)).toMatchObject({ role: 'customer', text: 'A _plain_ reply' })
            const tooLong = await http()
                .post(`/tenants/current/tickets/${created.body.id as string}/messages`)
                .set(bearer(tokens.bob))
                .send({ text: 'x'.repeat(20_001) })
                .expect(400)
            expect(tooLong.body.error).toBe('errors.BAD_REQUEST')
        })
    })

    describe('the purchase wizard and invoices', () => {
        let subscriptionId = ''

        it('the quote adds VAT and tells why a code cannot be used', async () => {
            const quote = await http()
                .post('/tenants/current/licenses/quote')
                .set(bearer(tokens.alice))
                .send({ productCode: 'planner', interval: 'year', seats: 2 })
                .expect(200)
            expect(quote.body).toMatchObject({
                baseCents: 20000,
                firstCents: 20000,
                vatPercent: 21,
                firstVatCents: 4200,
                firstTotalCents: 24200,
                renewalTotalCents: 24200
            })
            await http()
                .post('/admin/discounts')
                .set(bearer(tokens.root))
                .send({ code: 'ONCE-ONLY', percentOff: 10, duration: 'once', maxRedemptions: 1 })
                .expect(201)
            await http()
                .post('/admin/discounts')
                .set(bearer(tokens.root))
                .send({
                    code: 'OLD-CODE',
                    percentOff: 10,
                    duration: 'once',
                    expiresAt: new Date(Date.now() + DAY).toISOString()
                })
                .expect(201)
            billing.discounts.find(item => item.code === 'OLD-CODE')!.expiresAt = new Date(Date.now() - DAY)
            const ask = (token: string, discountCode: string) =>
                http()
                    .post('/tenants/current/licenses/quote')
                    .set(bearer(token))
                    .send({ productCode: 'agenda', interval: 'month', seats: 1, discountCode })
                    .expect(400)
            expect((await ask(tokens.alice, 'OLD-CODE')).body.error).toBe('billing.DISCOUNT_EXPIRED')
            expect((await ask(tokens.alice, 'NO-SUCH-CODE')).body.error).toBe('billing.DISCOUNT_INVALID')
            // Globex uses the only redemption; then it is used by Globex, and used up for Acme
            const bought = await http()
                .post('/tenants/current/licenses/subscriptions')
                .set(bearer(tokens.carol))
                .send({ productCode: 'agenda', interval: 'month', seats: 1, discountCode: 'ONCE-ONLY' })
                .expect(201)
            expect(bought.body.status).toBe('pending')
            expect((await ask(tokens.carol, 'ONCE-ONLY')).body.error).toBe('billing.DISCOUNT_ALREADY_USED')
            expect((await ask(tokens.alice, 'ONCE-ONLY')).body.error).toBe('billing.DISCOUNT_USED_UP')
        })

        it('buys with an environment, a region and a payment method, and comes back to the given page', async () => {
            const refused = await http()
                .post('/tenants/current/licenses/subscriptions')
                .set(bearer(tokens.alice))
                .send({ productCode: 'planner', interval: 'year', seats: 2, returnPath: '//evil.example.com' })
                .expect(400)
            expect(refused.body.error).toBe('errors.BAD_REQUEST')
            await http()
                .post('/tenants/current/licenses/subscriptions')
                .set(bearer(tokens.alice))
                .send({ productCode: 'planner', interval: 'year', seats: 2, region: 'us-east-1' })
                .expect(400)
            const bought = await http()
                .post('/tenants/current/licenses/subscriptions')
                .set(bearer(tokens.alice))
                .send({
                    productCode: 'planner',
                    interval: 'year',
                    seats: 2,
                    environmentName: 'Praktijk De Linde',
                    region: 'eu-west-3',
                    method: 'card',
                    returnPath: '/apps/planner?welcome=1'
                })
                .expect(201)
            subscriptionId = bought.body.subscriptionId as string
            const paymentId = new URL(bought.body.checkoutUrl as string).pathname.split('/').pop() ?? ''
            expect(fake.payments.get(paymentId)).toMatchObject({ amountCents: 24200, method: 'creditcard' })

            const open = await http().get('/tenants/current/invoices').set(bearer(tokens.alice)).expect(200)
            expect(open.body).toMatchObject([
                {
                    number: `FAC-${new Date().getUTCFullYear()}-0002`,
                    app: 'Planner',
                    productCode: 'planner',
                    period: 'year',
                    amountCents: 20000,
                    vatCents: 4200,
                    totalCents: 24200,
                    status: 'open',
                    checkoutUrl: bought.body.checkoutUrl as string
                }
            ])
            expect((await mine('alice')).find(item => item.kind === 'invoice.created')).toMatchObject({
                params: { app: 'Planner', totalCents: 24200, status: 'open' },
                nav: { screen: 'invoices' }
            })
            // Members (not admins) see no invoices
            await http().get('/tenants/current/invoices').set(bearer(tokens.bob)).expect(403)

            const back = await checkout(bought.body.checkoutUrl as string)
            expect(back).toBe(`http://localhost:3000/apps/planner?welcome=1&subscription=${subscriptionId}`)
            const overview = await http().get('/tenants/current/licenses').set(bearer(tokens.alice)).expect(200)
            expect(
                overview.body.find((item: { product: { code: string } }) => item.product.code === 'planner')
                    .subscription
            ).toMatchObject({ status: 'active', environmentName: 'Praktijk De Linde', region: 'eu-west-3' })
            const paid = await http().get('/tenants/current/invoices').set(bearer(tokens.alice)).expect(200)
            expect(paid.body[0]).toMatchObject({ status: 'paid', checkoutUrl: null })
            expect((await mine('root')).find(item => item.kind === 'payment.received')).toMatchObject({
                params: { tenant: 'Acme', totalCents: 24200, app: 'Planner' },
                nav: { screen: 'admin-tenant', id: ids.acme }
            })
        })

        it('the PDF of an invoice, only for the own organisation', async () => {
            const [invoice] = (await http().get('/tenants/current/invoices').set(bearer(tokens.alice)).expect(200)).body
            const pdf = await http()
                .get(`/tenants/current/invoices/${invoice.id as string}/pdf`)
                .set(bearer(tokens.alice))
                .set('Accept-Language', 'fr')
                .responseType('blob')
                .expect(200)
            expect(pdf.headers['content-type']).toBe('application/pdf')
            expect(pdf.headers['content-disposition']).toBe(`attachment; filename="${invoice.number as string}.pdf"`)
            const body = pdf.body as Buffer
            expect(body.subarray(0, 8).toString()).toBe('%PDF-1.4')
            // "Facture" in Helvetica, WinAnsi as hex
            expect(body.toString('latin1')).toContain(Buffer.from('Facture', 'latin1').toString('hex'))
            const other = await http()
                .get(`/tenants/current/invoices/${invoice.id as string}/pdf`)
                .set(bearer(tokens.carol))
                .expect(404)
            expect(other.body.error).toBe('invoices.NOT_FOUND')
        })

        it('a 100% code: active at once, with a free invoice', async () => {
            await http()
                .post('/admin/discounts')
                .set(bearer(tokens.root))
                .send({ code: 'ALL-FREE', percentOff: 100, duration: 'forever' })
                .expect(201)
            const free = await http()
                .post('/tenants/current/licenses/subscriptions')
                .set(bearer(tokens.alice))
                .send({
                    productCode: 'agenda',
                    interval: 'month',
                    seats: 3,
                    discountCode: 'ALL-FREE',
                    region: 'eu-west-1'
                })
                .expect(201)
            expect(free.body).toMatchObject({ status: 'active', checkoutUrl: null })
            const list = await http().get('/tenants/current/invoices').set(bearer(tokens.alice)).expect(200)
            expect(list.body[0]).toMatchObject({ app: 'Agenda', status: 'free', totalCents: 0, checkoutUrl: null })
            const nothing = await http()
                .post('/tenants/current/invoices/pay')
                .set(bearer(tokens.alice))
                .send({})
                .expect(409)
            expect(nothing.body.error).toBe('invoices.NOTHING_TO_PAY')
        })

        it('a failed renewal leaves an open invoice; paying all open invoices renews the subscription', async () => {
            const providerId =
                [...fake.subscriptions.entries()].find(([, item]) => item.description.startsWith('Planner'))?.[0] ?? ''
            const failed = fake.renew(providerId, 'failed') ?? ''
            await http().post('/billing/webhook').type('form').send({ id: failed }).expect(200)
            const before = billing.subscriptions.find(item => item.id === subscriptionId)!
            expect(before.status).toBe('past_due')
            const periodEnd = before.currentPeriodEnd!.getTime()
            const open = (
                await http().get('/tenants/current/invoices').set(bearer(tokens.alice)).expect(200)
            ).body.filter((item: { status: string }) => item.status === 'open')
            expect(open).toMatchObject([{ app: 'Planner', totalCents: 24200, amountCents: 20000, vatCents: 4200 }])

            const pay = await http()
                .post('/tenants/current/invoices/pay')
                .set(bearer(tokens.alice))
                .send({ returnPath: '/invoices' })
                .expect(200)
            const paymentId = new URL(pay.body.checkoutUrl as string).pathname.split('/').pop() ?? ''
            expect(fake.payments.get(paymentId)?.amountCents).toBe(24200)
            expect(await checkout(pay.body.checkoutUrl as string)).toBe(
                'http://localhost:3000/invoices?payment=invoices'
            )
            const after = billing.subscriptions.find(item => item.id === subscriptionId)!
            expect(after.status).toBe('active')
            expect(after.currentPeriodEnd!.getTime()).toBeGreaterThan(periodEnd + 364 * DAY)
            const list = (await http().get('/tenants/current/invoices').set(bearer(tokens.alice)).expect(200)).body
            expect(list.filter((item: { status: string }) => item.status === 'open')).toEqual([])
            const actions = audit.events.map(event => event.action)
            for (const action of ['invoices.issued', 'invoices.paid', 'invoices.checkout_started'])
                expect(actions).toContain(action)
        })

        it('a canceled first checkout voids its invoice', async () => {
            const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
            const bought = await http()
                .post('/tenants/current/licenses/subscriptions')
                .set(bearer(tokens.carol))
                .send({ productCode: 'planner', interval: 'month', seats: 1 })
                .expect(201)
            await checkout(bought.body.checkoutUrl as string, 'cancel')
            const list = (await http().get('/tenants/current/invoices').set(bearer(tokens.carol)).expect(200)).body
            // The checkout of the agenda (ONCE-ONLY) is still open; the canceled one is not shown
            expect(list.map((item: { app: string; status: string }) => [item.app, item.status])).toEqual([
                ['Agenda', 'open']
            ])
            expect(invoices.invoices.filter(item => item.status === 'void')).toHaveLength(1)
            warn.mockRestore()
        })
    })

    describe('notifications', () => {
        it('a contract that renews within 30 days, with a stable id; read stays read; read-all', async () => {
            const planner = billing.subscriptions.find(item => item.tenantId === ids.acme && item.status === 'active')!
            planner.currentPeriodEnd = new Date(Date.now() + 10 * DAY)
            const contract = (await mine('alice')).find(item => item.kind === 'contract.expiring')
            expect(contract?.id).toMatch(/^contract:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}$/)
            expect(contract).toMatchObject({ params: { daysLeft: 10 }, nav: { screen: 'invoices' }, read: false })
            // Only admins
            expect((await mine('bob')).some(item => item.kind === 'contract.expiring')).toBe(false)
            await http()
                .post(`/me/notifications/${encodeURIComponent(contract?.id ?? '')}/read`)
                .set(bearer(tokens.alice))
                .expect(204)
            expect((await mine('alice')).find(item => item.id === contract?.id)?.read).toBe(true)
            await http().post('/me/notifications/read-all').set(bearer(tokens.alice)).expect(204)
            expect((await mine('alice')).every(item => item.read)).toBe(true)
        })

        it('superadmins hear about new organisations and invitations (not the one who made them)', async () => {
            const sam = store.addUser({ email: 'sam@example.com', name: 'Sam', passwordHash: '', isSuperadmin: true })
            await http()
                .post('/admin/tenants')
                .set(bearer(tokens.root))
                .send({ name: 'Initech', adminEmail: 'boss@initech.test' })
            const forSam = notifications.notifications.filter(item => item.userId === sam.id)
            expect(forSam.find(item => item.kind === 'tenant.created')).toMatchObject({
                params: { name: 'Initech' },
                nav: { screen: 'admin-tenant' }
            })
            expect(forSam.find(item => item.kind === 'member.invited')).toMatchObject({
                params: { tenant: 'Initech', email: 'boss@initech.test' }
            })
            // Root did it: nothing in the own bell
            expect((await mine('root')).some(item => item.kind === 'tenant.created')).toBe(false)
            // Not for an organisation
            expect((await mine('alice')).some(item => item.kind === 'tenant.created')).toBe(false)
        })
    })

    describe('statistics', () => {
        it('for superadmins only, per range', async () => {
            stats.data.tenants = [{ id: ids.acme, createdAt: new Date() }]
            stats.data.payments = [{ paidAt: new Date(), amountCents: 20000 }]
            const result = await http().get('/admin/stats?range=year').set(bearer(tokens.root)).expect(200)
            expect(result.body.months).toHaveLength(new Date().getUTCMonth() + 1)
            expect(result.body.kpis.tenants).toMatchObject({ value: 1 })
            expect(result.body.kpis.revenueMonthCents).toMatchObject({ value: 20000 })
            expect(result.body.kpis.tenants.spark).toHaveLength(8)
            expect(result.body.revenueCents.at(-1)).toBe(20000)
            await http().get('/admin/stats?range=week').set(bearer(tokens.root)).expect(400)
            await http().get('/admin/stats').set(bearer(tokens.alice)).expect(403)
        })
    })
})
