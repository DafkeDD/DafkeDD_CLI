import { randomBytes, randomUUID } from 'node:crypto'
import { Controller, Get, INestApplication, Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { BillingModule } from '../src/billing/billing.module.js'
import { License } from '../src/billing/license.guard.js'
import { FakeProvider } from '../src/billing/payments/fake.provider.js'
import { PAYMENT_PROVIDER } from '../src/billing/payments/payment-provider.js'
import { BILLING_STORE } from '../src/billing/store/billing.store.js'
import { MemoryBillingStore } from '../src/billing/store/memory-billing.store.js'
import { DatabaseService } from '../src/database/database.service.js'
import type { Mail } from '../src/mail/mail.service.js'
import { MailService } from '../src/mail/mail.service.js'
import { pkceChallenge } from '../src/oidc/crypto.js'
import { LoginLimiter } from '../src/oidc/login-limiter.js'
import { OidcModule } from '../src/oidc/oidc.module.js'
import { hashPassword } from '../src/oidc/password.js'
import { MemoryOidcStore } from '../src/oidc/store/memory-oidc.store.js'
import { OIDC_STORE } from '../src/oidc/store/oidc.store.js'
import { configureApp } from '../src/setup.js'

process.env.OIDC_MASTER_KEY ??= randomBytes(32).toString('hex')
process.env.OIDC_LOGIN_RATE_LIMIT = '1000'
process.env.OIDC_LOGIN_UI_URL = ''
process.env.OIDC_MFA = 'optional'
process.env.OIDC_REGISTRATION = 'open'
process.env.APP_URL = 'http://localhost:3000'
// The checkout page of this API instead of Mollie
process.env.PAYMENTS = 'fake'
process.env.BILLING_TRIAL_DAYS = '14'

const REDIRECT = 'http://localhost:3000/api/auth/callback'
const PASSWORD = 'correct-horse-battery'
const DAY = 24 * 60 * 60 * 1000

/** A route of "your application" that needs a licence for the product planner. */
@Controller('demo')
class DemoController {
    @Get('planner')
    @License('planner')
    planner() {
        return { ok: true }
    }
}

describe('Licences, trials, subscriptions, discount codes and free seats (e2e)', () => {
    let app: INestApplication<App>
    let fake: FakeProvider
    const store = new MemoryOidcStore()
    const billing = new MemoryBillingStore()
    const outbox: Mail[] = []
    const http = () => request(app.getHttpServer())
    const ids = { acme: '', alice: '', bob: '', carol: '', root: '' }
    const tokens = { alice: '', bob: '', carol: '', root: '' }

    beforeAll(async () => {
        const passwordHash = await hashPassword(PASSWORD)
        const acme = store.addTenant('acme', 'Acme')
        const alice = store.addUser({ email: 'alice@example.com', name: 'Alice', passwordHash })
        const bob = store.addUser({ email: 'bob@example.com', name: 'Bob', passwordHash })
        const carol = store.addUser({ email: 'carol@example.com', name: 'Carol', passwordHash })
        const root = store.addUser({ email: 'root@example.com', name: 'Root', passwordHash, isSuperadmin: true })
        store.addMembership(acme.id, alice.id, 'admin')
        store.addMembership(acme.id, bob.id, 'user')
        store.addMembership(acme.id, carol.id, 'user')
        Object.assign(ids, { acme: acme.id, alice: alice.id, bob: bob.id, carol: carol.id, root: root.id })

        const moduleRef = await Test.createTestingModule({
            imports: [AppModule, OidcModule, BillingModule],
            controllers: [DemoController]
        })
            .overrideProvider(DatabaseService)
            .useValue({ ping: vi.fn().mockResolvedValue(true), query: vi.fn().mockResolvedValue({ rows: [] }) })
            .overrideProvider(OIDC_STORE)
            .useValue(store)
            .overrideProvider(BILLING_STORE)
            .useValue(billing)
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
            tokens[name] = await accessToken(`${name}@example.com`)
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

    async function accessToken(email: string, tenant = 'acme') {
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
        const page = await http().get(path).expect(200)
        expect(page.text).toContain('name="action"')
        const done = await http().post(path).type('form').send({ action }).expect(303)
        return done.headers.location as string
    }

    const overview = async (product = 'planner') =>
        (await http().get('/tenants/current/licenses').set(bearer(tokens.alice)).expect(200)).body.find(
            (item: { product: { code: string } }) => item.product.code === product
        )

    describe('products (superadmin)', () => {
        it('creates products; a year must be cheaper than twelve months', async () => {
            const tooExpensive = await http()
                .post('/admin/products')
                .set(bearer(tokens.root))
                .send({ code: 'planner', name: 'Planner', priceMonthCents: 1000, priceYearCents: 12000 })
                .expect(400)
            expect(tooExpensive.body.error).toBe('billing.YEAR_NOT_CHEAPER')
            await http()
                .post('/admin/products')
                .set(bearer(tokens.root))
                .send({
                    code: 'planner',
                    name: 'Planner',
                    description: 'Plan your week',
                    priceMonthCents: 1000,
                    priceYearCents: 10000
                })
                .expect(201)
            await http()
                .post('/admin/products')
                .set(bearer(tokens.root))
                .send({ code: 'planner', name: 'Again', priceMonthCents: 1000, priceYearCents: 10000 })
                .expect(409)
            await http()
                .post('/admin/products')
                .set(bearer(tokens.root))
                .send({ code: 'reports', name: 'Reports', priceMonthCents: 500, priceYearCents: 5000 })
                .expect(201)
            await http()
                .post('/admin/products')
                .set(bearer(tokens.alice))
                .send({ code: 'nope', name: 'Nope', priceMonthCents: 1, priceYearCents: 1 })
                .expect(403)
            const updated = await http()
                .patch('/admin/products/reports')
                .set(bearer(tokens.root))
                .send({ priceYearCents: 4800 })
                .expect(200)
            expect(updated.body).toMatchObject({ code: 'reports', priceYearCents: 4800 })
            const list = await http().get('/admin/products').set(bearer(tokens.root)).expect(200)
            expect(list.body.map((product: { code: string }) => product.code)).toEqual(['planner', 'reports'])
        })
    })

    describe('trials', () => {
        it('a new member gets 14 days of every active product; the licence guard lets them in', async () => {
            await http()
                .post('/oidc/account/register')
                .send({ name: 'Dora', email: 'dora@example.com', password: PASSWORD, organisation: 'Dora BV' })
                .expect(202)
            const dora = await store.findUserByEmail('dora@example.com')
            const trials = billing.trials.filter(trial => trial.userId === dora?.id)
            expect(trials).toHaveLength(2)
            const days = (trials[0]!.endsAt.getTime() - Date.now()) / DAY
            expect(days).toBeGreaterThan(13.9)
            expect(days).toBeLessThanOrEqual(14)
        })

        it('existing members get their trial from an admin, once', async () => {
            await http()
                .post(`/tenants/current/licenses/planner/trials/${ids.bob}`)
                .set(bearer(tokens.alice))
                .expect(201)
            const again = await http()
                .post(`/tenants/current/licenses/planner/trials/${ids.bob}`)
                .set(bearer(tokens.alice))
                .expect(409)
            expect(again.body.error).toBe('billing.TRIAL_USED')
            await http().get('/demo/planner').set(bearer(tokens.bob)).expect(200)
            const mine = await http().get('/me/licenses').set(bearer(tokens.bob)).expect(200)
            expect(mine.body).toEqual(
                expect.arrayContaining([expect.objectContaining({ code: 'planner', access: true, via: 'trial' })])
            )
            // Members only: no access to the licences of the organisation
            await http().get('/tenants/current/licenses').set(bearer(tokens.bob)).expect(403)
        })

        it('after the trial: no access; a superadmin can extend it', async () => {
            const trial = billing.trials.find(item => item.userId === ids.bob)!
            trial.endsAt = new Date(Date.now() - 1000)
            const refused = await http().get('/demo/planner').set(bearer(tokens.bob)).expect(403)
            expect(refused.body.error).toBe('billing.LICENSE_REQUIRED')
            expect(refused.body.message).toContain('planner')
            const extended = await http()
                .post(`/admin/tenants/${ids.acme}/trials`)
                .set(bearer(tokens.root))
                .send({ productCode: 'planner', userId: ids.bob, days: 7 })
                .expect(201)
            expect(new Date(extended.body.endsAt as string).getTime()).toBeGreaterThan(Date.now() + 6.9 * DAY)
            await http().get('/demo/planner').set(bearer(tokens.bob)).expect(200)
            trial.endsAt = new Date(Date.now() - 1000)
            // A superadmin always has access
            await http().get('/demo/planner').set(bearer(tokens.root)).expect(200)
        })
    })

    describe('a subscription', () => {
        let subscriptionId = ''

        it('buys seats per year through the checkout; the return page asks the status', async () => {
            const quote = await http()
                .post('/tenants/current/licenses/quote')
                .set(bearer(tokens.alice))
                .send({ productCode: 'planner', interval: 'year', seats: 2 })
                .expect(200)
            expect(quote.body).toMatchObject({
                unitCents: 10000,
                baseCents: 20000,
                firstCents: 20000,
                renewalCents: 20000
            })
            const bought = await http()
                .post('/tenants/current/licenses/subscriptions')
                .set(bearer(tokens.alice))
                .send({ productCode: 'planner', interval: 'year', seats: 2 })
                .expect(201)
            expect(bought.body.status).toBe('pending')
            subscriptionId = bought.body.subscriptionId as string
            expect((await overview()).subscription).toMatchObject({ status: 'pending', valid: false })
            const back = await checkout(bought.body.checkoutUrl as string)
            expect(back).toBe(`http://localhost:3000/licenses/return?subscription=${subscriptionId}`)
            const synced = await http()
                .post(`/tenants/current/licenses/subscriptions/${subscriptionId}/sync`)
                .set(bearer(tokens.alice))
                .expect(200)
            expect(synced.body).toEqual({ payment: 'paid', subscription: 'active', seats: 2 })
            const planner = await overview()
            expect(planner.subscription).toMatchObject({
                status: 'active',
                valid: true,
                interval: 'year',
                renewalCents: 20000
            })
            expect(planner.seats).toMatchObject({ paid: 2, free: 0, total: 2, used: 0 })
            const renewal = new Date(planner.subscription.currentPeriodEnd as string).getTime()
            expect(renewal).toBeGreaterThan(Date.now() + 364 * DAY)
            // The renewal at Mollie (here the fake provider) starts at the end of the paid year
            expect([...fake.subscriptions.values()][0]).toMatchObject({ amountCents: 20000, interval: 'year' })
            const twice = await http()
                .post('/tenants/current/licenses/subscriptions')
                .set(bearer(tokens.alice))
                .send({ productCode: 'planner', interval: 'month', seats: 1 })
                .expect(409)
            expect(twice.body.error).toBe('billing.SUBSCRIPTION_EXISTS')
        })

        it('gives seats to members, refuses when they are all in use, and moves a seat to someone else', async () => {
            await http()
                .post(`/tenants/current/licenses/planner/seats/${ids.bob}`)
                .set(bearer(tokens.alice))
                .expect(201)
            await http()
                .post(`/tenants/current/licenses/planner/seats/${ids.alice}`)
                .set(bearer(tokens.alice))
                .expect(201)
            const full = await http()
                .post(`/tenants/current/licenses/planner/seats/${ids.carol}`)
                .set(bearer(tokens.alice))
                .expect(409)
            expect(full.body.error).toBe('billing.NO_FREE_SEAT')
            await http().get('/demo/planner').set(bearer(tokens.bob)).expect(200)
            // Bob's seat goes to Carol
            await http()
                .delete(`/tenants/current/licenses/planner/seats/${ids.bob}`)
                .set(bearer(tokens.alice))
                .expect(200)
            await http()
                .post(`/tenants/current/licenses/planner/seats/${ids.carol}`)
                .set(bearer(tokens.alice))
                .expect(201)
            await http().get('/demo/planner').set(bearer(tokens.bob)).expect(403)
            await http().get('/demo/planner').set(bearer(tokens.carol)).expect(200)
            await http()
                .delete(`/tenants/current/licenses/planner/seats/${ids.bob}`)
                .set(bearer(tokens.alice))
                .expect(404)
            const stranger = randomUUID()
            const notMember = await http()
                .post(`/tenants/current/licenses/planner/seats/${stranger}`)
                .set(bearer(tokens.alice))
                .expect(404)
            expect(notMember.body.error).toBe('billing.NOT_A_MEMBER')
        })

        it('more seats: a payment for the rest of the year; fewer seats only when they are free', async () => {
            const more = await http()
                .patch('/tenants/current/licenses/subscriptions/planner')
                .set(bearer(tokens.alice))
                .send({ seats: 3 })
                .expect(200)
            expect(more.body.status).toBe('pending')
            const paidFor = fake.payments.get(new URL(more.body.checkoutUrl as string).pathname.split('/').pop() ?? '')
            // Almost a full year left: about the price of one seat for a year
            expect(paidFor?.amountCents).toBeGreaterThan(9900)
            expect(paidFor?.amountCents).toBeLessThanOrEqual(10000)
            await checkout(more.body.checkoutUrl as string)
            expect((await overview()).seats).toMatchObject({ paid: 3, total: 3, used: 2 })
            expect([...fake.subscriptions.values()][0]?.amountCents).toBe(30000)

            const tooFew = await http()
                .patch('/tenants/current/licenses/subscriptions/planner')
                .set(bearer(tokens.alice))
                .send({ seats: 1 })
                .expect(409)
            expect(tooFew.body.error).toBe('billing.SEATS_IN_USE')
            await http()
                .patch('/tenants/current/licenses/subscriptions/planner')
                .set(bearer(tokens.alice))
                .send({ seats: 2 })
                .expect(200)
            expect((await overview()).seats.paid).toBe(2)
            expect([...fake.subscriptions.values()][0]?.amountCents).toBe(20000)
        })

        it('a canceled checkout buys nothing', async () => {
            const more = await http()
                .patch('/tenants/current/licenses/subscriptions/planner')
                .set(bearer(tokens.alice))
                .send({ seats: 5 })
                .expect(200)
            await checkout(more.body.checkoutUrl as string, 'cancel')
            const synced = await http()
                .post(`/tenants/current/licenses/subscriptions/${subscriptionId}/sync`)
                .set(bearer(tokens.alice))
                .expect(200)
            expect(synced.body).toMatchObject({ payment: 'canceled', seats: 2 })
        })

        it('renews through the webhook (once, also when it comes twice); a failed renewal is past due', async () => {
            const before = new Date((await overview()).subscription.currentPeriodEnd as string).getTime()
            // The subscription at the provider (its id is not in the overview)
            const providerId = [...fake.subscriptions.keys()][0] ?? ''
            const paid = fake.renew(providerId) ?? ''
            await http().post('/billing/webhook').type('form').send({ id: paid }).expect(200)
            await http().post('/billing/webhook').type('form').send({ id: paid }).expect(200)
            const after = new Date((await overview()).subscription.currentPeriodEnd as string).getTime()
            expect(Math.round((after - before) / DAY)).toBeGreaterThanOrEqual(365)
            expect(Math.round((after - before) / DAY)).toBeLessThanOrEqual(366)
            const failed = fake.renew(providerId, 'failed') ?? ''
            await http().post('/billing/webhook').type('form').send({ id: failed }).expect(200)
            expect((await overview()).subscription.status).toBe('past_due')
            // Unknown payments: the same empty answer
            await http().post('/billing/webhook').type('form').send({ id: 'tr_unknown' }).expect(200)
        })

        it('cancels: no more renewals, the seats stay until the end of the period', async () => {
            const canceled = await http()
                .delete('/tenants/current/licenses/subscriptions/planner')
                .set(bearer(tokens.alice))
                .expect(200)
            expect(canceled.body.status).toBe('canceled')
            expect([...fake.subscriptions.values()][0]?.canceled).toBe(true)
            expect((await overview()).subscription).toMatchObject({
                status: 'canceled',
                valid: true,
                cancelAtPeriodEnd: true
            })
            await http().get('/demo/planner').set(bearer(tokens.carol)).expect(200)
            await http().delete('/tenants/current/licenses/subscriptions/planner').set(bearer(tokens.alice)).expect(409)
        })
    })

    describe('discount codes and free seats (superadmin)', () => {
        it('makes codes (a random one when none is given) and switches them off', async () => {
            const made = await http()
                .post('/admin/discounts')
                .set(bearer(tokens.root))
                .send({ percentOff: 25, duration: 'repeating', durationPeriods: 2, productCode: 'reports' })
                .expect(201)
            expect(made.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
            await http()
                .post('/admin/discounts')
                .set(bearer(tokens.root))
                .send({ code: 'free-forever', percentOff: 100, duration: 'forever' })
                .expect(201)
            await http()
                .post('/admin/discounts')
                .set(bearer(tokens.root))
                .send({ code: 'FREE-FOREVER', percentOff: 50, duration: 'once' })
                .expect(409)
            const both = await http()
                .post('/admin/discounts')
                .set(bearer(tokens.root))
                .send({ percentOff: 10, amountOffCents: 100, duration: 'once' })
                .expect(400)
            expect(both.body.error).toBe('billing.DISCOUNT_AMOUNT')
            await http()
                .post('/admin/discounts')
                .set(bearer(tokens.root))
                .send({ percentOff: 10, duration: 'repeating' })
                .expect(400)
            const list = await http().get('/admin/discounts').set(bearer(tokens.root)).expect(200)
            expect(list.body).toHaveLength(2)
            await http()
                .patch('/admin/discounts/FREE-FOREVER')
                .set(bearer(tokens.root))
                .send({ active: false })
                .expect(200)
            const off = await http()
                .post('/tenants/current/licenses/quote')
                .set(bearer(tokens.alice))
                .send({ productCode: 'reports', interval: 'month', seats: 1, discountCode: 'FREE-FOREVER' })
                .expect(400)
            expect(off.body.error).toBe('billing.DISCOUNT_INVALID')
            await http()
                .patch('/admin/discounts/FREE-FOREVER')
                .set(bearer(tokens.root))
                .send({ active: true })
                .expect(200)
        })

        it('a 25% code for two months: the first payment and the next renewal are cheaper, then the full price', async () => {
            const code = billing.discounts.find(item => item.percentOff === 25)!.code
            const quote = await http()
                .post('/tenants/current/licenses/quote')
                .set(bearer(tokens.alice))
                .send({ productCode: 'reports', interval: 'month', seats: 4, discountCode: code })
                .expect(200)
            expect(quote.body).toMatchObject({ baseCents: 2000, firstCents: 1500, renewalCents: 1500 })
            const wrongProduct = await http()
                .post('/tenants/current/licenses/quote')
                .set(bearer(tokens.alice))
                .send({ productCode: 'planner', interval: 'month', seats: 1, discountCode: code })
                .expect(400)
            expect(wrongProduct.body.error).toBe('billing.DISCOUNT_INVALID')

            const bought = await http()
                .post('/tenants/current/licenses/subscriptions')
                .set(bearer(tokens.alice))
                .send({ productCode: 'reports', interval: 'month', seats: 4, discountCode: code.toLowerCase() })
                .expect(201)
            const paymentId = new URL(bought.body.checkoutUrl as string).pathname.split('/').pop() ?? ''
            expect(fake.payments.get(paymentId)?.amountCents).toBe(1500)
            await checkout(bought.body.checkoutUrl as string)
            const reports = await overview('reports')
            expect(reports.subscription).toMatchObject({
                discountPeriodsLeft: 1,
                renewalCents: 1500,
                discount: { percentOff: 25 }
            })
            const providerId =
                [...fake.subscriptions.entries()].find(([, item]) => item.description.startsWith('Reports'))?.[0] ?? ''
            expect(fake.subscriptions.get(providerId)?.amountCents).toBe(1500)
            // The second (last discounted) month is paid: from then on the full price
            await http()
                .post('/billing/webhook')
                .type('form')
                .send({ id: fake.renew(providerId) ?? '' })
                .expect(200)
            expect(fake.subscriptions.get(providerId)?.amountCents).toBe(2000)
            // A code works once per organisation
            expect(billing.discounts.find(item => item.code === code)?.redemptions).toBe(1)
        })

        it('a 100% code forever: the seats are there at once, without a payment', async () => {
            const other = store.addTenant('globex', 'Globex')
            store.addMembership(other.id, ids.carol, 'admin')
            const carol = await accessToken('carol@example.com', 'globex')
            const free = await http()
                .post('/tenants/current/licenses/subscriptions')
                .set(bearer(carol))
                .send({ productCode: 'planner', interval: 'month', seats: 3, discountCode: 'FREE-FOREVER' })
                .expect(201)
            expect(free.body).toMatchObject({ status: 'active', checkoutUrl: null })
            const overviewGlobex = (
                await http().get('/tenants/current/licenses').set(bearer(carol)).expect(200)
            ).body.find((item: { product: { code: string } }) => item.product.code === 'planner')
            expect(overviewGlobex.subscription).toMatchObject({ valid: true, currentPeriodEnd: null })
            expect(overviewGlobex.seats.total).toBe(3)
            const change = await http()
                .patch('/tenants/current/licenses/subscriptions/planner')
                .set(bearer(carol))
                .send({ seats: 4 })
                .expect(409)
            expect(change.body.error).toBe('billing.FREE_SUBSCRIPTION')
        })

        it('free seats from a superadmin count with the paid ones, until they end', async () => {
            const grant = await http()
                .post(`/admin/tenants/${ids.acme}/grants`)
                .set(bearer(tokens.root))
                .send({ productCode: 'reports', seats: 2, note: 'Partner' })
                .expect(201)
            let reports = await overview('reports')
            expect(reports.seats).toMatchObject({ paid: 4, free: 2, total: 6 })
            const platformView = await http()
                .get(`/admin/tenants/${ids.acme}/licenses`)
                .set(bearer(tokens.root))
                .expect(200)
            expect(platformView.body).toHaveLength(2)
            await http()
                .delete(`/admin/tenants/${ids.acme}/grants/${grant.body.id as string}`)
                .set(bearer(tokens.root))
                .expect(200)
            reports = await overview('reports')
            expect(reports.seats.free).toBe(0)
        })
    })
    describe('payments that come late, twice or fail', () => {
        const paymentOf = (checkoutUrl: string) => new URL(checkoutUrl).pathname.split('/').pop() ?? ''
        const buy = (productCode: string, body: object, status = 201) =>
            http()
                .post('/tenants/current/licenses/subscriptions')
                .set(bearer(tokens.alice))
                .send({ productCode, ...body })
                .expect(status)
        const warnings = () => vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        beforeAll(async () => {
            for (const code of ['agenda', 'notes', 'chat'])
                await http()
                    .post('/admin/products')
                    .set(bearer(tokens.root))
                    .send({ code, name: code, priceMonthCents: 1000, priceYearCents: 10000 })
                    .expect(201)
            await http()
                .post('/admin/discounts')
                .set(bearer(tokens.root))
                .send({ code: 'LATE-10', percentOff: 10, duration: 'once', maxRedemptions: 1 })
                .expect(201)
        })

        it('an older checkout of a replaced purchase buys nothing; the code of the unpaid try can be used again', async () => {
            const warn = warnings()
            const cheap = await buy('agenda', { interval: 'month', seats: 1, discountCode: 'LATE-10' })
            // A second try (other seats, other interval) with the same once-only code: the first one gave it back
            const real = await buy('agenda', { interval: 'year', seats: 3, discountCode: 'LATE-10' })
            expect(real.body.subscriptionId).toBe(cheap.body.subscriptionId)
            // Paying the old cheap checkout does not give 3 seats for a year
            await checkout(cheap.body.checkoutUrl as string)
            expect((await overview('agenda')).subscription).toMatchObject({ status: 'pending', valid: false })
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('refund it'))
            await checkout(real.body.checkoutUrl as string)
            expect((await overview('agenda')).subscription).toMatchObject({
                status: 'active',
                seats: 3,
                interval: 'year'
            })
            const agenda = [...fake.subscriptions.values()].filter(item => item.description.startsWith('agenda'))
            expect(agenda).toHaveLength(1)
            const codes = await http().get('/admin/discounts').set(bearer(tokens.root)).expect(200)
            expect(codes.body.find((code: { code: string }) => code.code === 'LATE-10').redemptions).toBe(1)
            warn.mockRestore()
        })

        it('a failure after the payment is tried again by the next webhook, and creates one renewal', async () => {
            const bought = await buy('notes', { interval: 'month', seats: 1 })
            const id = paymentOf(bought.body.checkoutUrl as string)
            fake.complete(id, 'paid')
            const down = vi.spyOn(fake, 'createSubscription').mockRejectedValueOnce(new Error('Mollie is down'))
            const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
            // 500: Mollie calls the webhook again later
            await http().post('/billing/webhook').type('form').send({ id }).expect(500)
            expect((await overview('notes')).subscription.status).toBe('pending')
            await http().post('/billing/webhook').type('form').send({ id }).expect(200)
            await http().post('/billing/webhook').type('form').send({ id }).expect(200)
            expect((await overview('notes')).subscription).toMatchObject({ status: 'active', seats: 1 })
            expect(down).toHaveBeenCalledTimes(2)
            const notes = [...fake.subscriptions.values()].filter(item => item.description.startsWith('notes'))
            expect(notes).toHaveLength(1)
            down.mockRestore()
            error.mockRestore()
        })

        it('more seats paid after the renewal add nothing; while a renewal is on its way the seats stay valid', async () => {
            const warn = warnings()
            await buy('chat', { interval: 'month', seats: 1 }).then(bought =>
                checkout(bought.body.checkoutUrl as string)
            )
            const more = await http()
                .patch('/tenants/current/licenses/subscriptions/chat')
                .set(bearer(tokens.alice))
                .send({ seats: 50 })
                .expect(200)
            // The month renews before the extra seats are paid: they were priced for the month that ended
            const chat = [...fake.subscriptions.entries()].find(([, item]) => item.description.startsWith('chat'))
            const renewal = fake.renew(chat?.[0] ?? '') ?? ''
            await http().post('/billing/webhook').type('form').send({ id: renewal }).expect(200)
            await checkout(more.body.checkoutUrl as string)
            expect((await overview('chat')).subscription.seats).toBe(1)
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('refund it'))

            // The period ended and the renewal (SEPA takes days) is not paid yet: still valid, nothing can be changed
            const subscription = billing.subscriptions.find(
                item => item.productId === billing.products.find(product => product.code === 'chat')?.id
            )!
            subscription.currentPeriodEnd = new Date(Date.now() - 2 * DAY)
            expect((await overview('chat')).subscription.valid).toBe(true)
            const seats = await http()
                .patch('/tenants/current/licenses/subscriptions/chat')
                .set(bearer(tokens.alice))
                .send({ seats: 2 })
                .expect(409)
            expect(seats.body.error).toBe('billing.RENEWAL_PENDING')
            expect((await buy('chat', { interval: 'month', seats: 1 }, 409)).body.error).toBe(
                'billing.SUBSCRIPTION_EXISTS'
            )
            // A week later without a paid renewal: no longer valid
            subscription.currentPeriodEnd = new Date(Date.now() - 8 * DAY)
            expect((await overview('chat')).subscription.valid).toBe(false)
            warn.mockRestore()
        })
    })
})
