import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { INestApplication, Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { AUDIT_STORE } from '../src/audit/audit.store.js'
import { MemoryAuditStore } from '../src/audit/memory-audit.store.js'
import { MemoryNotificationsStore } from '../src/notifications/memory-notifications.store.js'
import { NOTIFICATIONS_STORE } from '../src/notifications/notifications.store.js'
import { BILLING_STORE } from '../src/billing/store/billing.store.js'
import { MemoryBillingStore } from '../src/billing/store/memory-billing.store.js'
import { DatabaseService } from '../src/database/database.service.js'
import { BACKCHANNEL_ATTEMPTS, BACKCHANNEL_EVENT, BackchannelService } from '../src/oidc/backchannel.service.js'
import { pkceChallenge } from '../src/oidc/crypto.js'
import { decodeUnverified, verifyJwt } from '../src/oidc/jose.js'
import { KeysService } from '../src/oidc/keys.service.js'
import { LoginLimiter } from '../src/oidc/login-limiter.js'
import { OidcService } from '../src/oidc/oidc.service.js'
import { hashPassword } from '../src/oidc/password.js'
import { MemoryOidcStore } from '../src/oidc/store/memory-oidc.store.js'
import { OIDC_STORE } from '../src/oidc/store/oidc.store.js'
import { configureApp } from '../src/setup.js'

process.env.OIDC_MASTER_KEY ??= randomBytes(32).toString('hex')
process.env.OIDC_LOGIN_RATE_LIMIT = '1000'
process.env.OIDC_LOGIN_UI_URL = ''
process.env.OIDC_MFA = 'optional'

const PASSWORD = 'correct-horse-battery'
const FRONTEND = { id: 'frontend', redirect: 'http://localhost:3000/api/auth/callback' }
const PARTNER = { id: 'partner.app', redirect: 'https://partner.example.com/callback' }

/** A client of another company that receives back-channel logouts (like its own server would). */
class Receiver {
    url = ''
    status = 200
    readonly received: string[] = []
    private server: Server | null = null

    async start() {
        this.server = createServer((req, res) => {
            let body = ''
            req.on('data', chunk => (body += String(chunk)))
            req.on('end', () => {
                this.received.push(new URLSearchParams(body).get('logout_token') ?? '')
                res.writeHead(this.status).end()
            })
        })
        await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve))
        this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/backchannel`
    }

    stop() {
        this.server?.close()
    }
}

describe('Applications that are not our own: consent screen and back-channel logout (e2e)', () => {
    let app: INestApplication<App>
    const store = new MemoryOidcStore()
    const audit = new MemoryAuditStore(store)
    const receiver = new Receiver()
    const http = () => request(app.getHttpServer())
    const ids = { acme: '', alice: '', bob: '' }

    beforeAll(async () => {
        await receiver.start()
        const passwordHash = await hashPassword(PASSWORD)
        const acme = store.addTenant('acme', 'Acme')
        const alice = store.addUser({ email: 'alice@example.com', name: 'Alice', passwordHash })
        const bob = store.addUser({ email: 'bob@example.com', name: 'Bob', passwordHash })
        store.addMembership(acme.id, alice.id, 'admin')
        store.addMembership(acme.id, bob.id, 'user')
        Object.assign(ids, { acme: acme.id, alice: alice.id, bob: bob.id })

        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(DatabaseService)
            .useValue({ ping: vi.fn().mockResolvedValue(true), query: vi.fn().mockResolvedValue({ rows: [] }) })
            .overrideProvider(OIDC_STORE)
            .useValue(store)
            .overrideProvider(BILLING_STORE)
            .useValue(new MemoryBillingStore())
            .overrideProvider(AUDIT_STORE)
            .useValue(audit)
            .overrideProvider(NOTIFICATIONS_STORE)
            .useValue(new MemoryNotificationsStore())
            .compile()
        app = moduleRef.createNestApplication()
        configureApp(app)
        await app.init()
        // The clients of config/oidc-clients.json, then the application of the partner (and no frontend running here)
        await app.get(OidcService).prepare()
        const frontend = (await store.findClient(FRONTEND.id))!
        await store.upsertClient({ ...frontend, backchannelLogoutUri: null })
        await store.upsertClient({
            clientId: PARTNER.id,
            name: 'Partner Planner',
            type: 'public',
            secretHash: null,
            redirectUris: [PARTNER.redirect],
            postLogoutRedirectUris: [],
            grantTypes: ['authorization_code', 'refresh_token'],
            scopes: ['openid', 'profile', 'email', 'tenant'],
            firstParty: false,
            backchannelLogoutUri: receiver.url,
            backchannelLogoutSessionRequired: true
        })
    })

    afterAll(async () => {
        await app.close()
        receiver.stop()
    })

    beforeEach(() => {
        app.get(LoginLimiter).clear()
        receiver.received.length = 0
        receiver.status = 200
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
                state: 'xyz',
                code_challenge: pkceChallenge(verifier),
                code_challenge_method: 'S256',
                ...extra
            }).toString()
        )
    }

    /** A login with the password through the HTML pages: the answer after the password, and the cookies. */
    async function passwordLogin(email: string, client = PARTNER, extra: Record<string, string> = {}) {
        const verifier = randomBytes(32).toString('base64url')
        const start = await http()
            .get(authorizeUrl(client, verifier, extra))
            .expect(303)
        const page = new URL(start.headers.location as string).pathname
        const interaction = cookieOf(start, 'oidc_ia_')
        const form = await http().get(page).set('Cookie', interaction).expect(200)
        const done = await http()
            .post(page + '/login')
            .set('Cookie', interaction)
            .type('form')
            .send({ csrf: csrfOf(form.text), email, password: PASSWORD })
        return {
            page,
            verifier,
            done,
            interaction: cookieOf(done, 'oidc_ia_') || interaction,
            session: cookieOf(done, 'oidc_session=')
        }
    }

    async function exchange(location: string, verifier: string, client = PARTNER) {
        const url = new URL(location)
        expect(url.origin + url.pathname).toBe(client.redirect)
        const code = url.searchParams.get('code') ?? ''
        const answer = await http()
            .post('/oidc/token')
            .type('form')
            .send({
                grant_type: 'authorization_code',
                code,
                redirect_uri: client.redirect,
                code_verifier: verifier,
                client_id: client.id
            })
            .expect(200)
        return answer.body as { access_token: string; id_token: string; refresh_token?: string }
    }

    /** Alice allows the partner (the first time), and gets its tokens. */
    async function alicePartner() {
        // Every time the first time
        await store.deleteConsent(ids.alice, PARTNER.id)
        const login = await passwordLogin('alice@example.com')
        expect(login.done.status).toBe(200)
        const answer = await http()
            .post(login.page + '/consent')
            .set('Cookie', login.interaction)
            .type('form')
            .send({ csrf: csrfOf(login.done.text), decision: 'allow' })
            .expect(303)
        return { ...login, tokens: await exchange(answer.headers.location as string, login.verifier) }
    }

    async function frontendToken(email: string) {
        const login = await passwordLogin(email, FRONTEND)
        expect(login.done.status).toBe(303)
        return (await exchange(login.done.headers.location as string, login.verifier, FRONTEND)).access_token
    }

    it('announces back-channel logout with sid', async () => {
        const discovery = (await http().get('/oidc/.well-known/openid-configuration').expect(200)).body
        expect(discovery).toMatchObject({
            backchannel_logout_supported: true,
            backchannel_logout_session_supported: true
        })
    })

    it('our own application never asks; another one asks once which data it may have', async () => {
        // The frontend (firstParty): straight back with a code
        expect((await passwordLogin('alice@example.com', FRONTEND)).done.status).toBe(303)

        const login = await passwordLogin('alice@example.com')
        // Logged in (the session cookie is set already), then the question
        expect(login.done.status).toBe(200)
        expect(login.session).toBeTruthy()
        expect(login.done.text).toContain('Allow Partner Planner?')
        for (const text of ['alice@example.com', 'Your name and language', 'Your email address', 'Your organisation'])
            expect(login.done.text).toContain(text)
        expect(store.consents).toHaveLength(0)

        const allowed = await http()
            .post(login.page + '/consent')
            .set('Cookie', login.interaction)
            .type('form')
            .send({ csrf: csrfOf(login.done.text), decision: 'allow' })
            .expect(303)
        const tokens = await exchange(allowed.headers.location as string, login.verifier)
        expect(decodeUnverified(tokens.id_token)).toMatchObject({ sub: ids.alice, aud: PARTNER.id })
        expect(await store.findConsent(ids.alice, PARTNER.id)).toMatchObject({
            scopes: ['email', 'openid', 'profile', 'tenant']
        })
        expect(audit.events.findLast(event => event.action === 'account.consent_granted')).toMatchObject({
            actorId: ids.alice,
            details: { client: PARTNER.id, scopes: 'openid profile email tenant' }
        })
        // The answer works once
        await http()
            .post(login.page + '/consent')
            .set('Cookie', login.interaction)
            .type('form')
            .send({ csrf: csrfOf(login.done.text), decision: 'allow' })
            .expect(400)

        // Next time (single sign-on): no question
        const verifier = randomBytes(32).toString('base64url')
        const again = await http().get(authorizeUrl(PARTNER, verifier)).set('Cookie', login.session).expect(303)
        expect(new URL(again.headers.location as string).searchParams.get('code')).toBeTruthy()
    })

    it('asks again with prompt=consent, or for more data than before; prompt=none gets consent_required', async () => {
        const { session } = await alicePartner()
        const verifier = randomBytes(32).toString('base64url')
        const forced = await http()
            .get(authorizeUrl(PARTNER, verifier, { prompt: 'consent' }))
            .set('Cookie', session)
            .expect(303)
        const page = new URL(forced.headers.location as string).pathname
        const shown = await http().get(page).set('Cookie', cookieOf(forced, 'oidc_ia_')).expect(200)
        expect(shown.text).toContain('Allow Partner Planner?')
        // The consent screen never makes a second session or a code another way
        for (const step of ['/continue', '/tenant'])
            await http()
                .post(page + step)
                .set('Cookie', cookieOf(forced, 'oidc_ia_'))
                .type('form')
                .send({ csrf: csrfOf(shown.text), tenant: ids.acme })
                .expect(400)

        // Bob logs in to the frontend, then the partner asks without a page: it may not
        const bob = await passwordLogin('bob@example.com', FRONTEND)
        const silent = await http()
            .get(authorizeUrl(PARTNER, verifier, { prompt: 'none' }))
            .set('Cookie', bob.session)
            .expect(303)
        expect(new URL(silent.headers.location as string).searchParams.get('error')).toBe('consent_required')

        // Bob allows only openid and email; later the partner also wants the organisation: asked again
        await store.saveConsent(ids.bob, PARTNER.id, ['openid', 'email'])
        const more = await http().get(authorizeUrl(PARTNER, verifier)).set('Cookie', bob.session).expect(303)
        expect(new URL(more.headers.location as string).pathname).toMatch(/^\/oidc\/interaction\//)
        const fewer = await http()
            .get(authorizeUrl(PARTNER, verifier, { scope: 'openid email' }))
            .set('Cookie', bob.session)
            .expect(303)
        expect(new URL(fewer.headers.location as string).searchParams.get('code')).toBeTruthy()

        // Without the tenant scope the partner never sees the organisation
        const code = new URL(fewer.headers.location as string).searchParams.get('code') ?? ''
        const tokens = await http()
            .post('/oidc/token')
            .type('form')
            .send({
                grant_type: 'authorization_code',
                code,
                redirect_uri: PARTNER.redirect,
                code_verifier: verifier,
                client_id: PARTNER.id
            })
            .expect(200)
        expect(decodeUnverified(tokens.body.access_token as string)).not.toHaveProperty('tenant')
        expect(decodeUnverified(tokens.body.id_token as string)).not.toHaveProperty('tenant')
    })

    it('with the tenant scope: allowed per organisation, another organisation asks again', async () => {
        const globex = store.addTenant('globex', 'Globex')
        store.addMembership(globex.id, ids.bob, 'user')
        try {
            await store.saveConsent(ids.bob, PARTNER.id, ['openid', 'profile', 'email', 'tenant'], ids.acme)
            const bob = await passwordLogin('bob@example.com', { ...FRONTEND }, { tenant_hint: ids.acme })
            const verifier = randomBytes(32).toString('base64url')
            const acme = await http()
                .get(authorizeUrl(PARTNER, verifier, { tenant_hint: ids.acme }))
                .set('Cookie', bob.session)
                .expect(303)
            expect(new URL(acme.headers.location as string).searchParams.get('code')).toBeTruthy()
            const other = await http()
                .get(authorizeUrl(PARTNER, verifier, { tenant_hint: globex.id }))
                .set('Cookie', bob.session)
                .expect(303)
            expect(new URL(other.headers.location as string).pathname).toMatch(/^\/oidc\/interaction\//)
        } finally {
            store.members = store.members.filter(member => member.tenantId !== globex.id)
            await store.deleteConsent(ids.bob, PARTNER.id)
        }
    })

    it('"Do not allow" sends access_denied to the application, and remembers nothing', async () => {
        const login = await passwordLogin('bob@example.com', PARTNER, { scope: 'openid profile' })
        const before = await store.findConsent(ids.bob, PARTNER.id)
        const denied = await http()
            .post(login.page + '/consent')
            .set('Cookie', login.interaction)
            .type('form')
            .send({ csrf: csrfOf(login.done.text), decision: 'deny' })
            .expect(303)
        const url = new URL(denied.headers.location as string)
        expect(url.searchParams.get('error')).toBe('access_denied')
        expect(url.searchParams.get('state')).toBe('xyz')
        expect(url.searchParams.get('code')).toBeNull()
        expect(await store.findConsent(ids.bob, PARTNER.id)).toEqual(before)
    })

    it('the login page of the frontend: JSON with the scopes, then { decision }', async () => {
        const login = await passwordLogin('bob@example.com', PARTNER, { scope: 'openid profile tenant' })
        const details = await http()
            .get(login.page)
            .set('Cookie', login.interaction)
            .set('Accept', 'application/json')
            .expect(200)
        expect(details.body.pending).toBe(true)
        const step = await http()
            .post(login.page + '/resume')
            .set('Cookie', login.interaction)
            .set('Accept', 'application/json')
            .send({ csrf: details.body.csrf })
            .expect(200)
        expect(step.body).toMatchObject({
            status: 'consent',
            clientName: 'Partner Planner',
            email: 'bob@example.com',
            scopes: ['openid', 'profile', 'tenant']
        })
        const done = await http()
            .post(login.page + '/consent')
            .set('Cookie', login.interaction)
            .set('Accept', 'application/json')
            .send({ csrf: details.body.csrf, decision: 'allow' })
            .expect(200)
        expect(done.body.status).toBe('redirect')
        expect(new URL(done.body.location as string).searchParams.get('code')).toBeTruthy()
    })

    it('/security lists the allowed applications; taking it back stops their refresh tokens', async () => {
        const { tokens } = await alicePartner()
        // The token of the partner works for the login (userinfo), never for our own API as the user
        await http().get('/oidc/userinfo').set(bearer(tokens.access_token)).expect(200)
        for (const path of ['/me/consents', '/me/sessions', '/tenants/current/members'])
            await http().get(path).set(bearer(tokens.access_token)).expect(403)
        const access = await frontendToken('alice@example.com')
        const list = await http().get('/me/consents').set(bearer(access)).expect(200)
        expect(list.body).toEqual([
            expect.objectContaining({
                clientId: PARTNER.id,
                clientName: 'Partner Planner',
                scopes: ['email', 'openid', 'profile', 'tenant']
            })
        ])
        await http()
            .delete('/me/consents/' + PARTNER.id)
            .set(bearer(access))
            .expect(200, { revoked: true })
        const refresh = await http()
            .post('/oidc/token')
            .type('form')
            .send({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: PARTNER.id })
        expect(refresh.status).toBe(400)
        expect(refresh.body.error).toBe('invalid_grant')
        expect(audit.events.findLast(event => event.action === 'account.consent_revoked')).toMatchObject({
            actorId: ids.alice,
            details: { client: PARTNER.id }
        })
        await http()
            .delete('/me/consents/' + PARTNER.id)
            .set(bearer(access))
            .expect(404)
        // The next login asks again
        expect((await passwordLogin('alice@example.com')).done.status).toBe(200)
    })

    it('a session that ends sends a signed logout token to the application, server to server', async () => {
        const { tokens } = await alicePartner()
        const sid = decodeUnverified(tokens.id_token)?.sid as string
        const access = await frontendToken('alice@example.com')
        // Alice ends that session on /security (from another browser)
        await http()
            .delete('/me/sessions/' + sid)
            .set(bearer(access))
            .expect(200)
        expect(await app.get(BackchannelService).flush()).toBe(1)
        expect(receiver.received).toHaveLength(1)

        const keys = await app.get(KeysService).verificationKeys()
        const issuer = (await http().get('/oidc/.well-known/openid-configuration')).body.issuer as string
        const { header, payload } = verifyJwt(receiver.received[0]!, {
            algorithms: ['RS256'],
            typ: 'logout+jwt',
            keys: kid => keys.get(kid),
            issuer,
            audience: PARTNER.id
        })
        expect(header.typ).toBe('logout+jwt')
        expect(payload).toMatchObject({ sub: ids.alice, sid, events: { [BACKCHANNEL_EVENT]: {} } })
        expect(payload).not.toHaveProperty('nonce')
        expect(payload.jti).toEqual(expect.any(String))
        // Delivered: not again
        expect(await app.get(BackchannelService).flush()).toBe(0)
        expect(receiver.received).toHaveLength(1)
    })

    it('every way a session ends counts: logout, password reset, a disabled member', async () => {
        // The sessions of the tests before: ended and delivered first
        await store.endUserSessions(ids.alice)
        await app.get(BackchannelService).flush()
        await alicePartner()
        await alicePartner()
        // Both sessions of Alice end at once (like a password reset)
        await store.endUserSessions(ids.alice)
        expect(await app.get(BackchannelService).flush()).toBe(2)
        // A member that is disabled: the sessions in that organisation end
        await alicePartner()
        await store.endTenantSessions(ids.acme, ids.alice)
        expect(await app.get(BackchannelService).flush()).toBe(1)
        // A session that simply runs out sends nothing
        await alicePartner()
        for (const session of store.sessions.values()) if (session.userId === ids.alice) session.expiresAt = new Date()
        expect(await app.get(BackchannelService).flush()).toBe(0)
    })

    it('tries again when the application is down, and gives up after five times', async () => {
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
        try {
            await alicePartner()
            receiver.status = 500
            await store.endUserSessions(ids.alice)
            const service = app.get(BackchannelService)
            expect(await service.flush()).toBe(0)
            // Not again at once: the next try is later
            expect(await service.flush()).toBe(0)
            expect(receiver.received).toHaveLength(1)
            for (let attempt = 2; attempt <= BACKCHANNEL_ATTEMPTS; attempt++) {
                for (const job of store.logoutQueue) job.nextAt = 0
                expect(await service.flush()).toBe(0)
            }
            expect(receiver.received).toHaveLength(BACKCHANNEL_ATTEMPTS)
            for (const job of store.logoutQueue) job.nextAt = 0
            expect(await service.flush()).toBe(0)
            expect(receiver.received).toHaveLength(BACKCHANNEL_ATTEMPTS)
            expect(audit.events.findLast(event => event.action === 'login.backchannel_failed')).toMatchObject({
                details: { client: PARTNER.id, reason: 'HTTP 500' }
            })
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('given up'))
        } finally {
            warn.mockRestore()
        }
    })
})
