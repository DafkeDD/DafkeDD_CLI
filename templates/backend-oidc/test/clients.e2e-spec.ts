import { randomBytes } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { AUDIT_STORE } from '../src/audit/audit.store.js'
import { MemoryAuditStore } from '../src/audit/memory-audit.store.js'
import { BILLING_STORE } from '../src/billing/store/billing.store.js'
import { MemoryBillingStore } from '../src/billing/store/memory-billing.store.js'
import { DatabaseService } from '../src/database/database.service.js'
import type { Mail } from '../src/mail/mail.service.js'
import { MailService } from '../src/mail/mail.service.js'
import { pkceChallenge } from '../src/oidc/crypto.js'
import { LoginLimiter } from '../src/oidc/login-limiter.js'
import { OidcService } from '../src/oidc/oidc.service.js'
import { hashPassword } from '../src/oidc/password.js'
import { MemoryOidcStore } from '../src/oidc/store/memory-oidc.store.js'
import { OIDC_STORE } from '../src/oidc/store/oidc.store.js'
import { configureApp } from '../src/setup.js'
import { MemoryNotificationsStore } from '../src/notifications/memory-notifications.store.js'
import { NOTIFICATIONS_STORE } from '../src/notifications/notifications.store.js'
import { INVOICES_STORE } from '../src/billing/invoices/invoices.store.js'
import { MemoryInvoicesStore } from '../src/billing/invoices/memory-invoices.store.js'

process.env.OIDC_MASTER_KEY ??= randomBytes(32).toString('hex')
process.env.OIDC_LOGIN_RATE_LIMIT = '1000'
process.env.OIDC_LOGIN_UI_URL = ''
process.env.OIDC_MFA = 'optional'
// The accounts of these tests have no eID (the tests of OIDC_EID_REQUIRED are in eid.e2e-spec.ts)
process.env.OIDC_EID_REQUIRED = 'off'

const PASSWORD = 'correct-horse-battery'
const FRONTEND = { id: 'frontend', redirect: 'http://localhost:3000/api/auth/callback' }
const APP = {
    name: 'Partner Planner',
    redirectUris: ['https://planner.partner.com/callback'],
    postLogoutRedirectUris: ['https://planner.partner.com'],
    backchannelLogoutUri: 'https://planner.partner.com/backchannel',
    scopes: ['openid', 'profile', 'email'],
    refreshTokens: true,
    firstParty: false
}

describe('Apps on /admin (e2e)', () => {
    let app: INestApplication<App>
    const store = new MemoryOidcStore()
    const billing = new MemoryBillingStore()
    const audit = new MemoryAuditStore(store)
    const outbox: Mail[] = []
    const http = () => request(app.getHttpServer())
    const tokens = { root: '', alice: '' }

    beforeAll(async () => {
        const passwordHash = await hashPassword(PASSWORD)
        const acme = store.addTenant('acme', 'Acme')
        const root = store.addUser({ email: 'root@example.com', name: 'Root', passwordHash, isSuperadmin: true })
        const alice = store.addUser({ email: 'alice@example.com', name: 'Alice', passwordHash })
        store.addMembership(acme.id, root.id, 'admin')
        store.addMembership(acme.id, alice.id, 'admin')

        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(DatabaseService)
            .useValue({ ping: vi.fn().mockResolvedValue(true), query: vi.fn().mockResolvedValue({ rows: [] }) })
            .overrideProvider(NOTIFICATIONS_STORE)
            .useValue(new MemoryNotificationsStore())
            .overrideProvider(INVOICES_STORE)
            .useValue(
                new MemoryInvoicesStore(async () => ({
                    tenantName: 'Test',
                    company: null,
                    vat: null,
                    billingAddress: null,
                    billingEmail: null
                }))
            )
            .overrideProvider(OIDC_STORE)
            .useValue(store)
            .overrideProvider(BILLING_STORE)
            .useValue(billing)
            .overrideProvider(AUDIT_STORE)
            .useValue(audit)
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
        tokens.root = (await login('root@example.com', FRONTEND, { tenant_hint: acme.id })).access_token
        tokens.alice = (await login('alice@example.com')).access_token
        tenantId = acme.id
        aliceId = alice.id
    })
    let tenantId = ''
    let aliceId = ''

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
    const csrfOf = (html: string) => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? ''

    function authorizeUrl(
        client: { id: string; redirect: string },
        verifier: string,
        extra: Record<string, string> = {}
    ) {
        return (
            '/oidc/authorize?' +
            new URLSearchParams({
                client_id: client.id,
                redirect_uri: client.redirect,
                response_type: 'code',
                scope: 'openid profile email tenant',
                code_challenge: pkceChallenge(verifier),
                code_challenge_method: 'S256',
                ...extra
            }).toString()
        )
    }

    /** A whole login through the HTML pages (with the consent screen when it comes); the token answer. */
    async function login(
        email: string,
        client = FRONTEND,
        extra: Record<string, string> = {},
        secret?: string
    ): Promise<{ access_token: string; refresh_token?: string }> {
        const verifier = randomBytes(32).toString('base64url')
        const start = await http()
            .get(authorizeUrl(client, verifier, extra))
            .expect(303)
        const page = new URL(start.headers.location as string).pathname
        const cookie = cookieOf(start, 'oidc_ia_')
        const form = await http().get(page).set('Cookie', cookie).expect(200)
        let done = await http()
            .post(page + '/login')
            .set('Cookie', cookie)
            .type('form')
            .send({ csrf: csrfOf(form.text), email, password: PASSWORD })
        if (done.status === 200 && done.text.includes('name="decision"'))
            done = await http()
                .post(page + '/consent')
                .set('Cookie', cookieOf(done, 'oidc_ia_') || cookie)
                .type('form')
                .send({ csrf: csrfOf(done.text), decision: 'allow' })
        expect(done.status).toBe(303)
        return redeem(done, client, verifier, secret)
    }

    /** The code of a 303 back to the client, exchanged for its tokens. */
    async function redeem(
        done: request.Response,
        client: { id: string; redirect: string },
        verifier: string,
        secret?: string
    ): Promise<{ access_token: string; refresh_token?: string }> {
        const code = new URL(done.headers.location as string).searchParams.get('code') ?? ''
        const exchange = http().post('/oidc/token').type('form')
        const body = { grant_type: 'authorization_code', code, redirect_uri: client.redirect, code_verifier: verifier }
        const answer = secret
            ? await exchange
                  .set('Authorization', 'Basic ' + Buffer.from(`${client.id}:${secret}`).toString('base64'))
                  .send(body)
            : await exchange.send({ ...body, client_id: client.id })
        expect(answer.status).toBe(200)
        return answer.body as { access_token: string; refresh_token?: string }
    }

    /** A login to an app that sells a product, without a licence of it: the "no licence" screen, no code. */
    async function noLicense(email: string, client: { id: string; redirect: string }) {
        const verifier = randomBytes(32).toString('base64url')
        const start = await http().get(authorizeUrl(client, verifier)).expect(303)
        const page = new URL(start.headers.location as string).pathname
        const cookie = cookieOf(start, 'oidc_ia_')
        const form = await http().get(page).set('Cookie', cookie).expect(200)
        const done = await http()
            .post(page + '/login')
            .set('Cookie', cookie)
            .type('form')
            .send({ csrf: csrfOf(form.text), email, password: PASSWORD })
            .expect(200)
        expect(done.headers.location).toBeUndefined()
        expect(done.text).toContain('No licence for')
        return {
            done,
            page,
            verifier,
            cookie: cookieOf(done, 'oidc_ia_') || cookie,
            session: cookieOf(done, 'oidc_session')
        }
    }

    const create = (body: Record<string, unknown>) =>
        http()
            .post('/admin/clients')
            .set(bearer(tokens.root))
            .send({ ...APP, type: 'public', ...body })

    it('only superadmins; the apps of the clients file are listed read-only, never a secret', async () => {
        await http().get('/admin/clients').set(bearer(tokens.alice)).expect(403)
        await http().get('/admin/clients').expect(401)
        const list = await http().get('/admin/clients').set(bearer(tokens.root)).expect(200)
        const frontend = (list.body as Record<string, unknown>[]).find(item => item.clientId === 'frontend')
        expect(frontend).toMatchObject({ source: 'file', disabled: false, firstParty: true, hasSecret: false })
        expect(frontend).not.toHaveProperty('secretHash')
        await http()
            .put('/admin/clients/frontend')
            .set(bearer(tokens.root))
            .send(APP)
            .expect(409)
            .expect(response => expect(response.body.message).toContain('config/oidc-clients.json'))
        await http().patch('/admin/clients/frontend').set(bearer(tokens.root)).send({ enabled: false }).expect(409)
    })

    it('makes a public app that logs in at once (with the consent screen)', async () => {
        const made = await create({ clientId: 'partner.planner' }).expect(201)
        expect(made.body.secret).toBeNull()
        expect(made.body.client).toMatchObject({
            clientId: 'partner.planner',
            source: 'admin',
            type: 'public',
            scopes: ['openid', 'profile', 'email'],
            grantTypes: ['authorization_code', 'refresh_token'],
            backchannelLogoutUri: 'https://planner.partner.com/backchannel'
        })
        const result = await login('alice@example.com', { id: 'partner.planner', redirect: APP.redirectUris[0]! })
        expect(result.refresh_token).toBeTruthy()
        expect(audit.events.findLast(event => event.action === 'platform.client_created')).toMatchObject({
            targetType: 'client',
            targetId: 'partner.planner',
            details: { client: 'partner.planner', type: 'public', firstParty: false }
        })
        // The clients file can never take over an app made here
        const file = (await app.get(OidcService).readClients())[0]!
        expect(await store.upsertClient({ ...file, clientId: 'partner.planner' })).toBe(false)
        expect((await store.findClient('partner.planner'))?.name).toBe('Partner Planner')
    })

    it('a confidential app gets a secret once; a new secret stops the old one at once', async () => {
        const made = await create({ type: 'confidential', name: 'Billing Server', firstParty: true }).expect(201)
        const client = { id: made.body.client.clientId as string, redirect: APP.redirectUris[0]! }
        expect(client.id).toMatch(/^billing-server-[0-9a-f]{6}$/)
        expect(made.body.secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(made.body.client.hasSecret).toBe(true)
        // Only the hash is kept
        expect(JSON.stringify(await http().get('/admin/clients').set(bearer(tokens.root)))).not.toContain(
            made.body.secret
        )
        await login('alice@example.com', client, {}, made.body.secret as string)

        const rotated = await http().post(`/admin/clients/${client.id}/secret`).set(bearer(tokens.root)).expect(200)
        expect(rotated.body.secret).not.toBe(made.body.secret)
        const verifier = randomBytes(32).toString('base64url')
        const old = await http()
            .post('/oidc/token')
            .type('form')
            .set('Authorization', 'Basic ' + Buffer.from(`${client.id}:${made.body.secret}`).toString('base64'))
            .send({
                grant_type: 'authorization_code',
                code: 'x',
                redirect_uri: client.redirect,
                code_verifier: verifier
            })
        expect(old.status).toBe(401)
        await login('alice@example.com', client, {}, rotated.body.secret as string)
        // A public app has no secret
        await http().post('/admin/clients/partner.planner/secret').set(bearer(tokens.root)).expect(409)
        expect(audit.events.findLast(event => event.action === 'platform.client_secret_rotated')).toBeTruthy()
    })

    it('checks every address, the scopes and the id', async () => {
        for (const uri of [
            'http://planner.partner.com/cb',
            'https://planner.partner.com/cb#x',
            'javascript:alert(1)'
        ]) {
            const answer = await create({ redirectUris: [uri] }).expect(400)
            expect(answer.body.error).toBe('oidc.CLIENT_INVALID_URI')
        }
        expect((await create({ backchannelLogoutUri: 'ftp://x.example.com' }).expect(400)).body.error).toBe(
            'oidc.CLIENT_INVALID_URI'
        )
        expect((await create({ redirectUris: [] }).expect(400)).body.error).toBe('oidc.CLIENT_NO_REDIRECT')
        await create({ scopes: ['openid', 'admin'] }).expect(400)
        await create({ clientId: 'no spaces' }).expect(400)
        await create({ redirectUris: Array.from({ length: 11 }, (_, i) => `https://a.example.com/${i}`) }).expect(400)
        await create({ type: 'secret' }).expect(400)
        expect((await create({ clientId: 'frontend' }).expect(409)).body.error).toBe('oidc.CLIENT_EXISTS')
        // openid is always there
        const made = await create({ scopes: ['email'] }).expect(201)
        expect(made.body.client.scopes).toEqual(['openid', 'email'])
    })

    it('changes an app; disabled it logs nobody in and its refresh tokens stop; removed only after disabling', async () => {
        const changed = await http()
            .put('/admin/clients/partner.planner')
            .set(bearer(tokens.root))
            .send({ ...APP, name: 'Planner', scopes: ['openid', 'email', 'tenant'], refreshTokens: true })
            .expect(200)
        expect(changed.body).toMatchObject({ name: 'Planner', scopes: ['openid', 'email', 'tenant'] })
        const client = { id: 'partner.planner', redirect: APP.redirectUris[0]! }
        const result = await login('alice@example.com', client)
        expect(changed.body.consents).toBeGreaterThanOrEqual(0)

        const off = await http()
            .patch('/admin/clients/partner.planner')
            .set(bearer(tokens.root))
            .send({ enabled: false })
            .expect(200)
        expect(off.body.disabled).toBe(true)
        const verifier = randomBytes(32).toString('base64url')
        const refused = await http().get(authorizeUrl(client, verifier)).expect(400)
        expect(refused.text).toContain('not known')
        const refresh = await http()
            .post('/oidc/token')
            .type('form')
            .send({ grant_type: 'refresh_token', refresh_token: result.refresh_token, client_id: client.id })
        expect(refresh.status).toBe(401)
        expect(audit.events.findLast(event => event.action === 'platform.client_disabled')).toBeTruthy()

        // On again: logging in works again (the old refresh tokens stay revoked)
        await http()
            .patch('/admin/clients/partner.planner')
            .set(bearer(tokens.root))
            .send({ enabled: true })
            .expect(200)
        await login('alice@example.com', client)
        await http().delete('/admin/clients/partner.planner').set(bearer(tokens.root)).expect(409)
        await http()
            .patch('/admin/clients/partner.planner')
            .set(bearer(tokens.root))
            .send({ enabled: false })
            .expect(200)
        await http().delete('/admin/clients/partner.planner').set(bearer(tokens.root)).expect(204)
        await http()
            .get('/admin/clients')
            .set(bearer(tokens.root))
            .expect(response => {
                expect((response.body as { clientId: string }[]).map(item => item.clientId)).not.toContain(
                    'partner.planner'
                )
            })
        expect(store.consents.filter(item => item.clientId === 'partner.planner')).toHaveLength(0)
        await http().delete('/admin/clients/partner.planner').set(bearer(tokens.root)).expect(404)
        expect(audit.events.findLast(event => event.action === 'platform.client_deleted')).toMatchObject({
            details: { client: 'partner.planner', name: 'Planner' }
        })
    })
    it('changing an app, rotating its secret or switching it off removes its link codes', async () => {
        await create({ clientId: 'revoked.app', type: 'confidential', firstParty: true }).expect(201)
        const code = async () =>
            (await http().post('/admin/clients/revoked.app/link-code').set(bearer(tokens.root)).expect(200)).body
                .code as string
        const usable = async (value: string) => (await http().post('/oidc/link').send({ code: value })).status === 200

        const afterUpdate = await code()
        await http()
            .put('/admin/clients/revoked.app')
            .set(bearer(tokens.root))
            .send({ ...APP, name: 'Renamed' })
            .expect(200)
        expect(await usable(afterUpdate)).toBe(false)

        const afterRotate = await code()
        await http().post('/admin/clients/revoked.app/secret').set(bearer(tokens.root)).expect(200)
        expect(await usable(afterRotate)).toBe(false)

        const afterSwitch = await code()
        await http().patch('/admin/clients/revoked.app').set(bearer(tokens.root)).send({ enabled: false }).expect(200)
        await http().patch('/admin/clients/revoked.app').set(bearer(tokens.root)).send({ enabled: true }).expect(200)
        expect(await usable(afterSwitch)).toBe(false)

        // A code that was not touched by a change still works once
        expect(await usable(await code())).toBe(true)
    })

    it('a link code links a new project once: its addresses are added, a confidential app gets a new secret', async () => {
        const made = await create({ clientId: 'linked.app', name: 'Linked', firstParty: true }).expect(201)
        expect(made.body.client.redirectUris).toEqual(APP.redirectUris)
        await http().post('/admin/clients/linked.app/link-code').set(bearer(tokens.alice)).expect(403)
        await http().post('/admin/clients/frontend/link-code').set(bearer(tokens.root)).expect(409)
        const first = await http().post('/admin/clients/linked.app/link-code').set(bearer(tokens.root)).expect(200)
        expect(first.body.code).toMatch(/^([A-HJ-NP-Z2-9]{4}-){5}[A-HJ-NP-Z2-9]{4}$/)
        expect(first.body.issuer).toMatch(/\/oidc$/)
        // A new code: the earlier one stops
        const second = await http().post('/admin/clients/linked.app/link-code').set(bearer(tokens.root)).expect(200)
        const project = {
            redirectUris: ['http://localhost:3001/api/auth/callback'],
            postLogoutRedirectUris: ['http://localhost:3001'],
            backchannelLogoutUri: 'http://localhost:3001/api/auth/backchannel-logout'
        }
        const stale = await http()
            .post('/oidc/link')
            .send({ code: first.body.code, ...project })
            .expect(400)
        expect(stale.body.error).toBe('oidc.LINK_CODE_INVALID')
        // Case and dashes do not matter
        const typed = (second.body.code as string).toLowerCase().replaceAll('-', ' ')
        const linked = await http()
            .post('/oidc/link')
            .send({ code: typed, ...project })
            .expect(200)
        expect(linked.body).toMatchObject({
            issuer: first.body.issuer,
            apiUrl: (first.body.issuer as string).replace(/\/oidc$/, ''),
            accountUrl: 'http://localhost:3000',
            client: { clientId: 'linked.app', name: 'Linked', type: 'public', firstParty: true, refreshTokens: true },
            clientSecret: null
        })
        const app = (await http().get('/admin/clients').set(bearer(tokens.root))).body.find(
            (item: { clientId: string }) => item.clientId === 'linked.app'
        )
        expect(app.redirectUris).toEqual([...APP.redirectUris, 'http://localhost:3001/api/auth/callback'])
        expect(app.postLogoutRedirectUris).toContain('http://localhost:3001')
        // The app had a back-channel URI already: kept
        expect(app.backchannelLogoutUri).toBe(APP.backchannelLogoutUri)
        // Once
        await http()
            .post('/oidc/link')
            .send({ code: second.body.code, ...project })
            .expect(400)
        // The new project logs in at once with its own redirect URI
        await login('alice@example.com', { id: 'linked.app', redirect: 'http://localhost:3001/api/auth/callback' })
        expect(audit.events.findLast(event => event.action === 'platform.client_linked')).toMatchObject({
            details: { client: 'linked.app', redirectUri: 'http://localhost:3001/api/auth/callback' }
        })

        // A confidential app: a new secret in the answer, the old one stops
        const server = await create({ clientId: 'linked.server', type: 'confidential', firstParty: true }).expect(201)
        const code = (await http().post('/admin/clients/linked.server/link-code').set(bearer(tokens.root))).body.code
        const answer = await http().post('/oidc/link').send({ code }).expect(200)
        expect(answer.body.clientSecret).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(answer.body.clientSecret).not.toBe(server.body.secret)
        await login(
            'alice@example.com',
            { id: 'linked.server', redirect: APP.redirectUris[0]! },
            {},
            answer.body.clientSecret
        )

        // Wrong addresses, unknown codes and a disabled app
        const wrong = (await http().post('/admin/clients/linked.app/link-code').set(bearer(tokens.root))).body.code
        const refused = await http()
            .post('/oidc/link')
            .send({ code: wrong, redirectUris: ['http://evil.example.com/cb'] })
            .expect(400)
        expect(refused.body.error).toBe('oidc.CLIENT_INVALID_URI')
        await http().post('/oidc/link').send({ code: 'AAAA-BBBB-CCCC' }).expect(400)
        await http().post('/oidc/link').send({}).expect(400)
        const off = (await http().post('/admin/clients/linked.app/link-code').set(bearer(tokens.root))).body.code
        await http().patch('/admin/clients/linked.app').set(bearer(tokens.root)).send({ enabled: false }).expect(200)
        await http().post('/oidc/link').send({ code: off }).expect(400)
    })

    it('an app sells a product: its tokens carry the licence of the user, checked again at every refresh', async () => {
        const claims = (token: string) =>
            JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>
        // The product must exist on /licenses
        const unknown = await create({ clientId: 'shop.app', product: 'shop' }).expect(400)
        expect(unknown.body.error).toBe('oidc.CLIENT_UNKNOWN_PRODUCT')
        expect(unknown.body.message).toContain('shop')
        await http()
            .post('/admin/products')
            .set(bearer(tokens.root))
            .send({ code: 'shop', name: 'Shop', priceMonthCents: 1000, priceYearCents: 10000 })
            .expect(201)
        const made = await create({ clientId: 'shop.app', product: 'shop', firstParty: true }).expect(201)
        expect(made.body.client.product).toBe('shop')
        // One product, one app
        const taken = await create({ clientId: 'shop.copy', product: 'shop' }).expect(409)
        expect(taken.body.error).toBe('oidc.CLIENT_PRODUCT_TAKEN')
        expect(taken.body.message).toContain('Partner Planner')
        await create({ clientId: 'shop.copy', product: 'Not A Code' }).expect(400)
        // The CLI learns the product with the link code
        const code = (await http().post('/admin/clients/shop.app/link-code').set(bearer(tokens.root))).body.code
        const linked = await http().post('/oidc/link').send({ code }).expect(200)
        expect(linked.body.client.product).toBe('shop')
        // The roles of the app (the developer sends them with a link code): only with a licence in the tokens
        const rolesCode = (await http().post('/admin/clients/shop.app/link-code').set(bearer(tokens.root))).body.code
        await http()
            .post('/oidc/link/roles')
            .send({
                code: rolesCode,
                roles: [
                    {
                        key: 'editor',
                        names: { en: 'Editor', nl: 'Bewerker', fr: 'Éditeur', de: 'Bearbeiter' },
                        default: true
                    }
                ]
            })
            .expect(200)

        // A login never starts a demo by itself, and without a licence it does not get into the app: the "no licence"
        // screen, with "Ask a demo" and the way to the apps on the portal
        const shop = { id: 'shop.app', redirect: APP.redirectUris[0]! }
        const refused = await noLicense('alice@example.com', shop)
        expect(refused.done.text).toContain('Ask a demo')
        expect(refused.done.text).toContain('http://localhost:3000/apps')
        // Logged in at the server meanwhile (single sign-on): still no code, the screen again; prompt=none: access_denied
        const sso = await http().get(authorizeUrl(shop, refused.verifier)).set('Cookie', refused.session).expect(303)
        expect(sso.headers.location).not.toContain('code=')
        const silent = await http()
            .get(authorizeUrl(shop, refused.verifier, { prompt: 'none' }))
            .set('Cookie', refused.session)
            .expect(303)
        expect(new URL(silent.headers.location as string).searchParams.get('error')).toBe('access_denied')
        // "Ask a demo" there: her demo starts and the login goes on into the app
        const demo = await http()
            .post(refused.page + '/demo')
            .set('Cookie', refused.cookie)
            .type('form')
            .send({ csrf: csrfOf(refused.done.text) })
            .expect(303)
        const first = await redeem(demo, shop, refused.verifier)
        const license = claims(first.access_token).license as { product: string; status: string; ends_at: number }
        expect(license).toMatchObject({ product: 'shop', status: 'trial' })
        // A demo: the default roles of the app
        expect(claims(first.access_token).roles).toEqual(['editor'])
        expect(license.ends_at * 1000).toBeGreaterThan(Date.now() + 13 * 24 * 60 * 60 * 1000)
        expect(audit.events.findLast(event => event.action === 'licences.trial_started')).toMatchObject({
            tenantId,
            targetId: aliceId,
            details: { product: 'shop' }
        })
        // The trial ends: the next token says so (no second trial)
        const product = (await billing.findProductByCode('shop'))!
        await billing.setTrialEnd(tenantId, product.id, aliceId, new Date(Date.now() - 1000))
        const refreshed = await http()
            .post('/oidc/token')
            .type('form')
            .send({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'shop.app' })
            .expect(200)
        expect(claims(refreshed.body.access_token).license).toEqual({ product: 'shop', status: 'none' })
        expect(claims(refreshed.body.access_token).roles).toEqual([])
        // A seat: the admin gives Alice one of the free seats a superadmin granted
        await http()
            .post(`/admin/tenants/${tenantId}/grants`)
            .set(bearer(tokens.root))
            .send({ productCode: 'shop', seats: 1 })
            .expect(201)
        await http()
            .post(`/tenants/current/licenses/shop/seats/${aliceId}`)
            .set(bearer(tokens.alice))
            .expect(response => expect([200, 201]).toContain(response.status))
        const seat = await login('alice@example.com', shop)
        expect(claims(seat.access_token).license).toEqual({ product: 'shop', status: 'seat' })
        expect(claims(seat.access_token).roles).toEqual(['editor'])
        // Superadmins always
        const root = await login('root@example.com', shop, { tenant_hint: tenantId })
        expect(claims(root.access_token).license).toEqual({ product: 'shop', status: 'superadmin' })

        // Without a product: no licence claim at all
        await http()
            .put('/admin/clients/shop.app')
            .set(bearer(tokens.root))
            .send({ ...APP, firstParty: true, product: '' })
            .expect(200)
            .expect(response => expect(response.body.product).toBeNull())
        expect(claims((await login('alice@example.com', shop)).access_token)).not.toHaveProperty('license')
    })

    it('roles per app: the developer sends them, the admins give them, the tokens carry them', async () => {
        const claims = (token: string) =>
            JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>
        const rolesApp = { id: 'roles.app', redirect: APP.redirectUris[0]! }
        await create({ clientId: 'roles.app', name: 'Roles App', firstParty: true }).expect(201)
        const code = async () =>
            (await http().post('/admin/clients/roles.app/link-code').set(bearer(tokens.root))).body.code as string
        const ROLES = [
            { key: 'editor', names: { en: 'Editor', nl: 'Bewerker', fr: 'Éditeur', de: 'Bearbeiter' }, default: true },
            { key: 'viewer', names: { en: 'Viewer', nl: 'Lezer', fr: 'Lecteur', de: 'Leser' } }
        ]
        // Checked: a key, a name in every language, no key twice
        // (the code first: two requests at once share the test server)
        const first = await code()
        const wrong = await http()
            .post('/oidc/link/roles')
            .set('Accept-Language', 'nl')
            .send({ code: first, roles: [{ key: 'Editor!', names: ROLES[0]!.names }] })
            .expect(400)
        expect(wrong.body.error).toBe('oidc.ROLES_INVALID')
        expect(wrong.body.message).toContain('Editor!')
        const second = await code()
        await http()
            .post('/oidc/link/roles')
            .send({ code: second, roles: [{ key: 'editor', names: { en: 'Editor' } }] })
            .expect(400)
        const third = await code()
        const pushed = await http().post('/oidc/link/roles').send({ code: third, roles: ROLES }).expect(200)
        expect(pushed.body).toEqual({ clientId: 'roles.app', roles: ['editor', 'viewer'] })
        expect(audit.events.findLast(event => event.action === 'platform.client_roles_pushed')).toMatchObject({
            details: { client: 'roles.app', roles: 'editor,viewer' }
        })
        // A used code does not work twice
        const once = await code()
        await http().post('/oidc/link/roles').send({ code: once, roles: ROLES }).expect(200)
        await http().post('/oidc/link/roles').send({ code: once, roles: ROLES }).expect(400)

        // Nobody gave roles yet: the default roles
        expect(claims((await login('alice@example.com', rolesApp)).access_token).roles).toEqual(['editor'])
        // The admins of the organisation see the apps with roles and who has which
        const apps = await http().get('/tenants/current/apps').set(bearer(tokens.alice)).expect(200)
        expect(apps.body.find((item: { clientId: string }) => item.clientId === 'roles.app')).toMatchObject({
            name: 'Roles App',
            roles: [
                { key: 'editor', default: true },
                { key: 'viewer', default: false }
            ]
        })
        const members = await http()
            .get('/tenants/current/apps/roles.app/members')
            .set(bearer(tokens.alice))
            .expect(200)
        expect(members.body.find((item: { userId: string }) => item.userId === aliceId)).toMatchObject({
            roles: ['editor'],
            assigned: false
        })
        await http().get('/tenants/current/apps/frontend/members').set(bearer(tokens.alice)).expect(404)
        // An admin gives roles; the next token has them
        const set = await http()
            .put(`/tenants/current/apps/roles.app/members/${aliceId}`)
            .set(bearer(tokens.alice))
            .send({ roles: ['viewer'] })
            .expect(200)
        expect(set.body).toEqual({ userId: aliceId, roles: ['viewer'], assigned: true })
        expect(claims((await login('alice@example.com', rolesApp)).access_token).roles).toEqual(['viewer'])
        expect(audit.events.findLast(event => event.action === 'members.app_roles_changed')).toMatchObject({
            tenantId,
            targetId: aliceId,
            details: { app: 'roles.app', roles: 'viewer' }
        })
        const unknown = await http()
            .put(`/tenants/current/apps/roles.app/members/${aliceId}`)
            .set(bearer(tokens.alice))
            .send({ roles: ['owner'] })
            .expect(400)
        expect(unknown.body.error).toBe('oidc.ROLE_UNKNOWN')
        await http()
            .put(`/tenants/current/apps/roles.app/members/00000000-0000-4000-8000-000000000000`)
            .set(bearer(tokens.alice))
            .send({ roles: [] })
            .expect(404)
        // No roles at all, then back to the default roles
        await http()
            .put(`/tenants/current/apps/roles.app/members/${aliceId}`)
            .set(bearer(tokens.alice))
            .send({ roles: [] })
            .expect(200)
        expect(claims((await login('alice@example.com', rolesApp)).access_token).roles).toEqual([])
        await http()
            .put(`/tenants/current/apps/roles.app/members/${aliceId}`)
            .set(bearer(tokens.alice))
            .send({ roles: null })
            .expect(200)
        expect(claims((await login('alice@example.com', rolesApp)).access_token).roles).toEqual(['editor'])
        // An app without roles: no roles claim
        expect(claims((await login('alice@example.com')).access_token)).not.toHaveProperty('roles')
    })

    it('an invitation with apps: the email names them, accepting gives their roles and a free seat', async () => {
        const claims = (token: string) =>
            JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>
        const ROLES = [
            { key: 'editor', names: { en: 'Editor', nl: 'Bewerker', fr: 'Éditeur', de: 'Bearbeiter' }, default: true },
            { key: 'viewer', names: { en: 'Viewer', nl: 'Lezer', fr: 'Lecteur', de: 'Leser' } }
        ]
        // An app with roles that sells a product, and one free seat in the organisation
        await http()
            .post('/admin/products')
            .set(bearer(tokens.root))
            .send({ code: 'agenda', name: 'Agenda', priceMonthCents: 500, priceYearCents: 5000 })
            .expect(201)
        await create({ clientId: 'agenda.app', name: 'Agenda', product: 'agenda', firstParty: true }).expect(201)
        const code = (await http().post('/admin/clients/agenda.app/link-code').set(bearer(tokens.root))).body.code
        await http().post('/oidc/link/roles').send({ code, roles: ROLES }).expect(200)
        await http()
            .post(`/admin/tenants/${tenantId}/grants`)
            .set(bearer(tokens.root))
            .send({ productCode: 'agenda', seats: 1 })
            .expect(201)
        const agenda = { id: 'agenda.app', redirect: APP.redirectUris[0]! }

        // The admins see every app they can give: its address (the home page) and the product it sells
        const apps = await http().get('/tenants/current/apps').set(bearer(tokens.alice)).expect(200)
        expect(apps.body.find((item: { clientId: string }) => item.clientId === 'agenda.app')).toMatchObject({
            name: 'Agenda',
            url: 'https://planner.partner.com',
            product: 'agenda',
            roles: [{ key: 'editor' }, { key: 'viewer' }]
        })
        // The apps of the clients file without roles are not given (the login server itself)
        expect(apps.body.some((item: { clientId: string }) => item.clientId === 'frontend')).toBe(false)

        const invite = (body: Record<string, unknown>) =>
            http()
                .post('/tenants/current/invitations')
                .set(bearer(tokens.alice))
                .send({ email: 'gina@example.com', role: 'user', ...body })
        // Checked: an app that cannot be given, a role the app does not have, a list that is not one
        const unknownApp = await invite({ apps: [{ clientId: 'nope.app' }] }).expect(400)
        expect(unknownApp.body.error).toBe('oidc.INVITATION_APP_UNKNOWN')
        expect(unknownApp.body.message).toContain('nope.app')
        const unknownRole = await invite({ apps: [{ clientId: 'agenda.app', roles: ['owner'] }] }).expect(400)
        expect(unknownRole.body.error).toBe('oidc.ROLE_UNKNOWN')
        await invite({ apps: [{ clientId: 5 }] }).expect(400)
        await invite({ apps: [{ clientId: 'agenda.app', extra: true }] }).expect(400)
        await invite({ apps: 'agenda.app' }).expect(400)
        expect(outbox.some(mail => mail.to === 'gina@example.com')).toBe(false)

        // Gina: viewer in the agenda, with a seat (the same app twice counts once)
        await invite({
            apps: [
                { clientId: 'agenda.app', roles: ['viewer'], seat: true },
                { clientId: 'agenda.app', roles: [] }
            ]
        }).expect(202)
        const open = await http().get('/tenants/current/invitations').set(bearer(tokens.alice)).expect(200)
        expect(open.body.find((item: { email: string }) => item.email === 'gina@example.com').apps).toEqual([
            { clientId: 'agenda.app', roles: ['viewer'], seat: true }
        ])
        expect(audit.events.findLast(event => event.action === 'members.invited')).toMatchObject({
            details: { email: 'gina@example.com', role: 'user', apps: 'agenda.app' }
        })
        // The email names the app
        const mail = outbox.filter(item => item.to === 'gina@example.com').at(-1)
        expect(mail?.text).toContain('Agenda')
        const token = /token=([^\s&]+)/.exec(mail?.text ?? '')?.[1] ?? ''
        expect(token).not.toBe('')
        // The invitation page shows the app, the roles that come with it and the seat
        const details = await http().get('/oidc/account/invitation').query({ token }).expect(200)
        expect(details.body.apps).toEqual([
            {
                clientId: 'agenda.app',
                name: 'Agenda',
                url: 'https://planner.partner.com',
                roles: [{ key: 'viewer', names: ROLES[1]!.names }],
                seat: true
            }
        ])
        // Accepting gives the roles and the seat, and tells where to open the app
        const accepted = await http()
            .post('/oidc/account/invitation/accept')
            .send({ token, name: 'Gina', password: PASSWORD })
            .expect(200)
        expect(accepted.body.apps).toEqual([
            { clientId: 'agenda.app', name: 'Agenda', url: 'https://planner.partner.com', seat: true }
        ])
        const gina = (await store.findUserByEmail('gina@example.com'))!
        const product = (await billing.findProductByCode('agenda'))!
        expect(
            (await billing.listAssignments(tenantId)).some(
                item => item.productId === product.id && item.userId === gina.id
            )
        ).toBe(true)
        expect(audit.events.findLast(event => event.action === 'members.app_roles_changed')).toMatchObject({
            actorId: aliceId,
            targetId: gina.id,
            details: { app: 'agenda.app', roles: 'viewer', reason: 'invitation' }
        })
        expect(audit.events.findLast(event => event.action === 'licences.seat_assigned')).toMatchObject({
            targetId: gina.id,
            details: { product: 'agenda' }
        })
        // Her tokens of the app carry the roles and the seat (no demo was started for her)
        const token1 = claims((await login('gina@example.com', agenda)).access_token)
        expect(token1.roles).toEqual(['viewer'])
        expect(token1.license).toEqual({ product: 'agenda', status: 'seat' })

        // No free seat left: Hank still joins (without a seat); the answer says so. Without a licence his tokens carry
        // no roles yet (his default roles come with a seat or a demo)
        await invite({ email: 'hank@example.com', apps: [{ clientId: 'agenda.app', seat: true }] }).expect(202)
        const hankToken = /token=([^\s&]+)/.exec(
            outbox.filter(item => item.to === 'hank@example.com').at(-1)?.text ?? ''
        )?.[1]
        const hank = await http()
            .post('/oidc/account/invitation/accept')
            .send({ token: hankToken, name: 'Hank', password: PASSWORD })
            .expect(200)
        expect(hank.body.apps).toEqual([
            { clientId: 'agenda.app', name: 'Agenda', url: 'https://planner.partner.com', seat: false }
        ])
        // Without a licence he does not get into the app: the "no licence" screen
        await noLicense('hank@example.com', agenda)
        // A demo (the token first: two requests at once share the test server)
        const hankAccess = (await login('hank@example.com')).access_token
        await http().post('/me/licenses/agenda/trial').set(bearer(hankAccess)).expect(201)
        expect(claims((await login('hank@example.com', agenda)).access_token).roles).toEqual(['editor'])
    })
})
