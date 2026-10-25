import { createHash, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { INestApplication, Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { AUDIT_STORE } from '../src/audit/audit.store.js'
import { MemoryAuditStore } from '../src/audit/memory-audit.store.js'
import { BILLING_STORE } from '../src/billing/store/billing.store.js'
import { MemoryBillingStore } from '../src/billing/store/memory-billing.store.js'
import { DatabaseService } from '../src/database/database.service.js'
import { MailService } from '../src/mail/mail.service.js'
import { pkceChallenge } from '../src/oidc/crypto.js'
import { signJwt, thumbprint } from '../src/oidc/jose.js'
import { LoginLimiter } from '../src/oidc/login-limiter.js'
import { OidcModule } from '../src/oidc/oidc.module.js'
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

const REDIRECT = 'http://localhost:3000/api/auth/callback'
const PASSWORD = 'correct-horse-battery'
const CLIENT_ID = 'our-app'
const CLIENT_SECRET = 'a-secret-of-the-other-server'

/** Who the other server says logged in, for the next code it gives. */
interface Person {
    sub: string
    email?: string
    email_verified?: boolean
    name?: string
    amr?: string[]
}

/**
 * A small OpenID Connect server that plays "the other server" (like Entra ID or Keycloak): discovery, JWKS and the
 * token endpoint. It checks the client secret, the redirect URI and PKCE, and signs ID tokens with its own RSA key.
 */
class OtherServer {
    issuer = ''
    private server: Server | null = null
    private readonly key = generateKeyPairSync('rsa', { modulusLength: 2048 })
    private readonly kid: string
    private readonly codes = new Map<string, { person: Person; nonce: string; challenge: string; redirect: string }>()
    /** Sign with another key (an attacker), or change the nonce. */
    forge: 'key' | 'nonce' | null = null

    constructor() {
        this.kid = thumbprint(this.key.publicKey.export({ format: 'jwk' }))
    }

    async start() {
        this.server = createServer((req, res) => void this.handle(req.url ?? '', req, res))
        await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve))
        this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/realm`
    }

    stop() {
        this.server?.close()
    }

    /** "The user logged in there": a code for the callback, as the browser would bring it back. */
    login(authorizeUrl: string, person: Person) {
        const url = new URL(authorizeUrl)
        const code = randomBytes(16).toString('hex')
        this.codes.set(code, {
            person,
            nonce: url.searchParams.get('nonce') ?? '',
            challenge: url.searchParams.get('code_challenge') ?? '',
            redirect: url.searchParams.get('redirect_uri') ?? ''
        })
        return { code, state: url.searchParams.get('state') ?? '' }
    }

    private json(res: import('node:http').ServerResponse, status: number, body: unknown) {
        res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
    }

    private async handle(
        path: string,
        req: import('node:http').IncomingMessage,
        res: import('node:http').ServerResponse
    ) {
        if (path === '/realm/.well-known/openid-configuration')
            return this.json(res, 200, {
                issuer: this.issuer,
                authorization_endpoint: this.issuer + '/authorize',
                token_endpoint: this.issuer + '/token',
                jwks_uri: this.issuer + '/jwks'
            })
        if (path === '/realm/jwks')
            return this.json(res, 200, {
                keys: [{ ...this.key.publicKey.export({ format: 'jwk' }), kid: this.kid, use: 'sig', alg: 'RS256' }]
            })
        if (path !== '/realm/token' || req.method !== 'POST') return this.json(res, 404, {})
        let raw = ''
        for await (const chunk of req) raw += String(chunk)
        const body = new URLSearchParams(raw)
        const basic = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString()
        if (basic !== `${CLIENT_ID}:${CLIENT_SECRET}`) return this.json(res, 401, { error: 'invalid_client' })
        const entry = this.codes.get(body.get('code') ?? '')
        this.codes.delete(body.get('code') ?? '')
        const verifier = body.get('code_verifier') ?? ''
        if (
            !entry ||
            entry.redirect !== body.get('redirect_uri') ||
            createHash('sha256').update(verifier).digest('base64url') !== entry.challenge
        )
            return this.json(res, 400, { error: 'invalid_grant' })
        const now = Math.floor(Date.now() / 1000)
        const key: KeyObject =
            this.forge === 'key' ? generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey : this.key.privateKey
        const idToken = signJwt(
            {
                iss: this.issuer,
                aud: CLIENT_ID,
                iat: now,
                exp: now + 300,
                nonce: this.forge === 'nonce' ? 'another-nonce' : entry.nonce,
                ...entry.person
            },
            { alg: 'RS256', kid: this.kid, typ: 'JWT' },
            key
        )
        return this.json(res, 200, { access_token: 'x', token_type: 'Bearer', id_token: idToken })
    }
}

describe('Logging in at another OpenID Connect server (e2e)', () => {
    let app: INestApplication<App>
    const other = new OtherServer()
    const store = new MemoryOidcStore()
    const audit = new MemoryAuditStore(store)
    const http = () => request(app.getHttpServer())
    const ids = { acme: '', globex: '', alice: '' }

    beforeAll(async () => {
        await other.start()
        process.env.OIDC_EXTERNAL_ISSUER = other.issuer
        process.env.OIDC_EXTERNAL_CLIENT_ID = CLIENT_ID
        process.env.OIDC_EXTERNAL_CLIENT_SECRET = CLIENT_SECRET
        process.env.OIDC_EXTERNAL_NAME = 'Contoso'
        const acme = store.addTenant('acme', 'Acme')
        const globex = store.addTenant('globex', 'Globex')
        const alice = store.addUser({
            email: 'alice@example.com',
            name: 'Alice',
            passwordHash: await hashPassword(PASSWORD)
        })
        store.addMembership(acme.id, alice.id, 'admin')
        Object.assign(ids, { acme: acme.id, globex: globex.id, alice: alice.id })

        const moduleRef = await Test.createTestingModule({ imports: [AppModule, OidcModule] })
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
            .useValue(new MemoryBillingStore())
            .overrideProvider(AUDIT_STORE)
            .useValue(audit)
            .overrideProvider(MailService)
            .useValue({ send: async () => true })
            .compile()
        app = moduleRef.createNestApplication()
        configureApp(app)
        await app.init()
    })

    afterAll(async () => {
        await app.close()
        other.stop()
        for (const name of ['ISSUER', 'CLIENT_ID', 'CLIENT_SECRET', 'NAME']) delete process.env['OIDC_EXTERNAL_' + name]
    })

    beforeEach(() => {
        app.get(LoginLimiter).clear()
        other.forge = null
    })

    const cookieOf = (response: request.Response, name: string) =>
        ((response.headers['set-cookie'] as unknown as string[] | undefined) ?? [])
            .find(c => c.startsWith(name))
            ?.split(';')[0] ?? ''

    /** /oidc/authorize of our server: the login page, its cookie and its CSRF token. */
    async function begin() {
        const verifier = randomBytes(32).toString('base64url')
        const query = new URLSearchParams({
            client_id: 'frontend',
            redirect_uri: REDIRECT,
            response_type: 'code',
            scope: 'openid profile email tenant',
            code_challenge: pkceChallenge(verifier),
            code_challenge_method: 'S256'
        })
        const start = await http()
            .get('/oidc/authorize?' + query.toString())
            .expect(303)
        const page = new URL(start.headers.location as string).pathname
        const cookie = cookieOf(start, 'oidc_ia_')
        const html = await http().get(page).set('Cookie', cookie).expect(200)
        const csrf = /name="csrf" value="([^"]+)"/.exec(html.text)?.[1] ?? ''
        return { page, cookie, csrf, html: html.text, verifier }
    }

    /** "Log in with Contoso", the login there as `person`, and back to our callback. */
    async function viaOther(person: Person, change?: (query: { code: string; state: string }) => void) {
        const login = await begin()
        expect(login.html).toContain('Log in with Contoso')
        const started = await http()
            .post(login.page + '/external')
            .set('Cookie', login.cookie)
            .type('form')
            .send({ csrf: login.csrf })
            .expect(303)
        const authorize = started.headers.location as string
        const external = cookieOf(started, 'oidc_ext')
        const query = other.login(authorize, person)
        change?.(query)
        const back = await http()
            .get('/oidc/external/callback?' + new URLSearchParams(query).toString())
            .set('Cookie', external)
        return { login, authorize, back }
    }

    it('starts with PKCE, state and nonce, at the authorization endpoint of the other server', async () => {
        const login = await begin()
        const started = await http()
            .post(login.page + '/external')
            .set('Cookie', login.cookie)
            .type('form')
            .send({ csrf: login.csrf })
            .expect(303)
        const url = new URL(started.headers.location as string)
        expect(url.origin + url.pathname).toBe(other.issuer + '/authorize')
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
            response_type: 'code',
            client_id: CLIENT_ID,
            redirect_uri: expect.stringMatching(/\/oidc\/external\/callback$/),
            scope: 'openid profile email',
            code_challenge_method: 'S256'
        })
        expect(url.searchParams.get('state')).toHaveLength(43)
        expect(url.searchParams.get('nonce')).toHaveLength(43)
        // The cookie that remembers this login only goes to the callback
        const set = (started.headers['set-cookie'] as unknown as string[])[0] ?? ''
        expect(set).toMatch(/^oidc_ext_[0-9a-f]{16}=/)
        for (const part of ['Path=/oidc/external', 'HttpOnly', 'SameSite=Lax']) expect(set).toContain(part)
        // A wrong CSRF token: nothing happens
        await http()
            .post(login.page + '/external')
            .set('Cookie', login.cookie)
            .type('form')
            .send({ csrf: 'wrong' })
            .expect(400)
    })

    it('a first login with a verified email address joins the existing account (without its two-step login there)', async () => {
        const { back } = await viaOther({
            sub: 'contoso-alice',
            email: 'Alice@Example.com',
            email_verified: true,
            name: 'Alice C.',
            amr: ['pwd', 'mfa']
        })
        expect(back.status).toBe(303)
        const location = new URL(back.headers.location as string)
        expect(location.origin + location.pathname).toBe(REDIRECT)
        expect(location.searchParams.get('code')).toBeTruthy()
        expect(cookieOf(back, 'oidc_session')).toBeTruthy()
        const linked = audit.events.find(event => event.action === 'account.external_linked')
        expect(linked).toMatchObject({ actorId: ids.alice, details: { provider: 'Contoso' } })
        // Joining an account never counts the two-step login of the other server: our own one would follow
        const login = audit.events.findLast(event => event.action === 'login.succeeded')
        expect(login).toMatchObject({ actorId: ids.alice, tenantId: ids.acme, details: { method: 'fed', acr: 'loa1' } })
    })

    it('later logins find the account by its subject, also when the email address changed there', async () => {
        const { back } = await viaOther({
            sub: 'contoso-alice',
            email: 'alice.new@example.com',
            email_verified: true,
            amr: ['pwd', 'mfa']
        })
        expect(back.status).toBe(303)
        expect(new URL(back.headers.location as string).searchParams.get('code')).toBeTruthy()
        // Linked before: the two-step login of the other server counts now
        expect(audit.events.findLast(event => event.action === 'login.succeeded')).toMatchObject({
            actorId: ids.alice,
            details: { method: 'fed mfa', acr: 'loa2' }
        })
        expect(audit.events.filter(event => event.action === 'account.external_linked')).toHaveLength(1)
    })

    it('a new person gets an account without an organisation: an admin invites them', async () => {
        const { back } = await viaOther({
            sub: 'contoso-bob',
            email: 'bob@example.com',
            email_verified: true,
            name: 'Bob'
        })
        expect(back.status).toBe(403)
        expect(back.text).toContain('organisation')
        const bob = await store.findUserByEmail('bob@example.com')
        expect(bob).toMatchObject({ name: 'Bob', emailVerified: true, passwordHash: null })
        expect(audit.events.findLast(event => event.action === 'account.registered')).toMatchObject({
            actorId: bob?.id,
            details: { method: 'external', provider: 'Contoso' }
        })
        // Member of two organisations: the choice, and the frontend can go on with /resume
        store.addMembership(ids.acme, bob!.id, 'user')
        store.addMembership(ids.globex, bob!.id, 'user')
        const again = await viaOther({ sub: 'contoso-bob', email: 'bob@example.com', email_verified: true })
        expect(again.back.status).toBe(200)
        expect(again.back.text).toContain('Globex')
        const cookie = cookieOf(again.back, 'oidc_ia_')
        const resumed = await http()
            .post(again.login.page + '/resume')
            .set('Cookie', cookie)
            .set('Accept', 'application/json')
            .send({ csrf: again.login.csrf })
            .expect(200)
        expect(resumed.body).toMatchObject({ status: 'choose-tenant', platform: false })
        expect(resumed.body.tenants).toHaveLength(2)
        const pending = await http()
            .get(again.login.page)
            .set('Cookie', cookie)
            .set('Accept', 'application/json')
            .expect(200)
        expect(pending.body).toMatchObject({ pending: true, password: true, external: { name: 'Contoso' } })
    })

    it('never takes over an account with an email address that is not verified, there or here', async () => {
        const { back } = await viaOther({ sub: 'contoso-mallory', email: 'alice@example.com', email_verified: false })
        expect(back.status).toBe(403)
        expect(audit.events.findLast(event => event.action === 'login.failed')).toMatchObject({
            details: { method: 'external', reason: 'external_email_unverified' }
        })
        // Someone registered here with that address first, without verifying it: not linked either
        store.addUser({ email: 'carol@example.com', name: 'Not Carol', passwordHash: 'x', emailVerified: false })
        const squatted = await viaOther({ sub: 'contoso-carol', email: 'carol@example.com', email_verified: true })
        expect(squatted.back.status).toBe(409)
        expect(squatted.back.text).toContain('exists already')
    })

    it('an account with two-step verification proves it with its own code at the first link', async () => {
        const dave = store.addUser({ email: 'dave@example.com', name: 'Dave', passwordHash: 'x', mfaEnabled: true })
        store.addMembership(ids.acme, dave.id, 'user')
        const { back } = await viaOther({
            sub: 'contoso-dave',
            email: 'dave@example.com',
            email_verified: true,
            amr: ['pwd', 'mfa']
        })
        // The code of the authenticator app, not straight back to the client
        expect(back.status).toBe(200)
        expect(back.text).toContain('name="code"')
        expect(audit.events.some(event => event.action === 'login.succeeded' && event.actorId === dave.id)).toBe(false)
    })

    it('refuses a forged ID token, a wrong nonce, a wrong state, an error of the other server and a missing cookie', async () => {
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
        for (const forge of ['key', 'nonce'] as const) {
            other.forge = forge
            const { back } = await viaOther({ sub: 'contoso-alice', email: 'alice@example.com', email_verified: true })
            expect(back.status, forge).toBe(401)
            expect(back.text).toContain('did not work')
        }
        other.forge = null
        // Another state: not the cookie of this login (it stays for its own callback)
        const state = await viaOther({ sub: 'contoso-alice' }, query => (query.state = 'x'.repeat(43)))
        expect(state.back.status).toBe(400)
        expect(state.back.headers['set-cookie']).toBeUndefined()
        const denied = await viaOther({ sub: 'contoso-alice' }, query =>
            Object.assign(query, { error: 'access_denied', code: '' })
        )
        expect(denied.back.status).toBe(401)
        const noCookie = await http().get('/oidc/external/callback?code=a&state=b')
        expect(noCookie.status).toBe(400)
        expect(audit.events.filter(event => event.details.reason === 'external_failed').length).toBeGreaterThanOrEqual(
            3
        )
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Login at the other server failed'))
        warn.mockRestore()
    })

    it('OIDC_EXTERNAL_ONLY: only that server, no password login and no registration here', async () => {
        process.env.OIDC_EXTERNAL_ONLY = 'true'
        try {
            const login = await begin()
            expect(login.html).toContain('Log in with Contoso')
            expect(login.html).not.toContain('name="password"')
            const json = await http().get(login.page).set('Cookie', login.cookie).set('Accept', 'application/json')
            expect(json.body).toMatchObject({
                password: false,
                eid: false,
                registration: false,
                external: { name: 'Contoso' }
            })
            const refused = await http()
                .post(login.page + '/login')
                .set('Cookie', login.cookie)
                .set('Accept', 'application/json')
                .send({ csrf: login.csrf, email: 'alice@example.com', password: PASSWORD })
                .expect(403)
            expect(refused.body.error).toBe('PASSWORD_LOGIN_OFF')
            const options = await http().get('/oidc/account/registration').expect(200)
            expect(options.body).toEqual({ password: false, eid: false, eidRequired: false })
        } finally {
            delete process.env.OIDC_EXTERNAL_ONLY
        }
    })
})
