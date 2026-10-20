import { randomBytes } from 'node:crypto'
import { MockEidClient, SAMPLE_IDENTITY, SAMPLE_PIN } from '@dafkedd/eid/mock'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { BILLING_STORE } from '../src/billing/store/billing.store.js'
import { MemoryBillingStore } from '../src/billing/store/memory-billing.store.js'
import { AUDIT_STORE } from '../src/audit/audit.store.js'
import { MemoryAuditStore } from '../src/audit/memory-audit.store.js'
import { DatabaseService } from '../src/database/database.service.js'
import type { Mail } from '../src/mail/mail.service.js'
import { MailService } from '../src/mail/mail.service.js'
import { pkceChallenge } from '../src/oidc/crypto.js'
import { decodeUnverified } from '../src/oidc/jose.js'
import { LoginLimiter } from '../src/oidc/login-limiter.js'
import { hashPassword } from '../src/oidc/password.js'
import { MemoryOidcStore } from '../src/oidc/store/memory-oidc.store.js'
import { OIDC_STORE } from '../src/oidc/store/oidc.store.js'
import { configureApp } from '../src/setup.js'

process.env.OIDC_MASTER_KEY ??= randomBytes(32).toString('hex')
process.env.OIDC_LOGIN_RATE_LIMIT = '1000'
process.env.OIDC_LOGIN_UI_URL = ''
process.env.OIDC_REGISTRATION = 'open'
process.env.OIDC_MFA = 'optional'
// The virtual card of the DafkeDD eID bridge (npx dafke-eid --mock) is signed by a test PKI: only with OIDC_EID=test
process.env.OIDC_EID = 'test'
process.env.APP_URL = 'http://localhost:3000'

const ORIGIN = 'http://localhost:3000'
const REDIRECT = 'http://localhost:3000/api/auth/callback'
const PASSWORD = 'correct-horse-battery'
const NAME = `${SAMPLE_IDENTITY.firstNames} ${SAMPLE_IDENTITY.lastName}`

/** The DafkeDD eID bridge with a virtual card in the reader, as the login page of the frontend talks to it. */
const bridge = new MockEidClient({ origin: ORIGIN, readDelayMs: 0 })
const sign = async (nonce: string, client = bridge) => (await client.authenticate({ nonce, pin: SAMPLE_PIN })).token

describe('Login and registration with the Belgian eID (e2e)', () => {
    let app: INestApplication<App>
    const store = new MemoryOidcStore()
    const outbox: Mail[] = []
    const http = () => request(app.getHttpServer())
    const ids = { acme: '', alice: '', bob: '' }

    beforeAll(async () => {
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
            .useValue(new MemoryAuditStore())
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
    })

    afterAll(async () => {
        await app.close()
    })

    beforeEach(() => {
        outbox.length = 0
        app.get(LoginLimiter).clear()
    })

    const bearer = (token: string) => ({ Authorization: 'Bearer ' + token })
    const loginCookie = (response: request.Response) =>
        ((response.headers['set-cookie'] as unknown as string[]) ?? [])
            .find(c => c.startsWith('oidc_ia_'))
            ?.split(';')[0] ?? ''

    /** Starts a login like the login page of the frontend: the login cookie, the csrf token and the interaction path. */
    async function startLogin(extra: Record<string, string> = {}, cookie = '') {
        const verifier = randomBytes(32).toString('base64url')
        const query = new URLSearchParams({
            client_id: 'frontend',
            redirect_uri: REDIRECT,
            response_type: 'code',
            scope: 'openid profile email tenant',
            code_challenge: pkceChallenge(verifier),
            code_challenge_method: 'S256',
            ...extra
        })
        const start = await http()
            .get('/oidc/authorize?' + query.toString())
            .set('Cookie', cookie)
            .expect(303)
        const location = new URL(start.headers.location as string)
        if (location.searchParams.has('code'))
            return { verifier, location, base: '', cookie: '', csrf: '', details: null }
        const first = loginCookie(start)
        const details = await http()
            .get(location.pathname)
            .set('Cookie', first)
            .set('Accept', 'application/json')
            .expect(200)
        return {
            verifier,
            location,
            base: location.pathname,
            cookie: first,
            csrf: details.body.csrf as string,
            details: details.body
        }
    }

    type Login = Awaited<ReturnType<typeof startLogin>>

    /** Step 1 of the eID login: a nonce for the bridge (the login cookie remembers it). */
    async function eidChallenge(login: Login) {
        const response = await http()
            .post(login.base + '/eid/challenge')
            .set('Cookie', login.cookie)
            .send({ csrf: login.csrf })
            .expect(200)
        login.cookie = loginCookie(response) || login.cookie
        return response.body.nonce as string
    }

    /** Step 2: the token of the bridge. */
    async function eidSubmit(login: Login, token: unknown) {
        const response = await http()
            .post(login.base + '/eid')
            .set('Cookie', login.cookie)
            .send({ csrf: login.csrf, token })
        login.cookie = loginCookie(response) || login.cookie
        return response
    }

    /** A whole eID login; returns the answer of step 2. */
    async function eidLogin(extra: Record<string, string> = {}) {
        const login = await startLogin(extra)
        const response = await eidSubmit(login, await sign(await eidChallenge(login)))
        return { login, response }
    }

    async function tokens(login: Login, location: string) {
        const code = new URL(location).searchParams.get('code') ?? ''
        const response = await http()
            .post('/oidc/token')
            .type('form')
            .send({
                grant_type: 'authorization_code',
                code,
                redirect_uri: REDIRECT,
                client_id: 'frontend',
                code_verifier: login.verifier
            })
            .expect(200)
        return response.body as { access_token: string; id_token: string }
    }

    /** An access token through the password login (two-step verification is optional in these tests). */
    async function passwordToken(email: string) {
        const login = await startLogin()
        const response = await http()
            .post(login.base + '/login')
            .set('Cookie', login.cookie)
            .send({ csrf: login.csrf, email, password: PASSWORD })
            .expect(200)
        expect(response.body.status).toBe('redirect')
        return (await tokens(login, response.body.location as string)).access_token
    }

    async function registerChallenge() {
        return (await http().post('/oidc/account/eid/challenge').expect(200)).body as {
            challenge: string
            nonce: string
        }
    }

    it('announces the eID in discovery and on the login page', async () => {
        const discovery = await http().get('/oidc/.well-known/openid-configuration').expect(200)
        expect(discovery.body.acr_values_supported).not.toContain('loa4')
        expect((await startLogin()).details).toMatchObject({ eid: true, registration: true })
        expect((await http().get('/oidc/account/registration').expect(200)).body).toEqual({ password: true, eid: true })
    })

    describe('registration', () => {
        let userId = ''

        it('creates an account with the name of the card and a chosen password, and sends a verification mail', async () => {
            const { challenge, nonce } = await registerChallenge()
            expect(nonce).toHaveLength(44)
            const response = await http()
                .post('/oidc/account/register-eid')
                .set('Accept-Language', 'nl')
                .send({
                    challenge,
                    token: await sign(nonce),
                    email: 'Jan@Example.com',
                    password: PASSWORD,
                    organisation: 'Specimen BV'
                })
                .expect(202)
            expect(response.body).toEqual({ status: 'check-email', name: NAME })

            const user = await store.findUserByEmail('jan@example.com')
            expect(user).toMatchObject({ name: NAME, emailVerified: false, locale: 'nl' })
            expect(user?.passwordHash).toBeTruthy()
            userId = user?.id ?? ''
            const memberships = await store.listMemberships(userId)
            expect(memberships).toEqual([expect.objectContaining({ name: 'Specimen BV', role: 'admin' })])
            // Only an HMAC of the national register number is stored
            const identifier = await store.findIdentifier(userId, 'eid')
            expect(identifier?.valueHash).toMatch(/^[A-Za-z0-9_-]{43}$/)
            expect(JSON.stringify(store.identifiers)).not.toContain(SAMPLE_IDENTITY.nationalNumber)
            expect(outbox.at(-1)?.to).toBe('jan@example.com')
        })

        it('needs a password: the eID alone does not make an account', async () => {
            const { challenge, nonce } = await registerChallenge()
            await http()
                .post('/oidc/account/register-eid')
                .send({ challenge, token: await sign(nonce), email: 'nopw@example.com', organisation: 'No Pw' })
                .expect(400)
            expect(await store.findUserByEmail('nopw@example.com')).toBeNull()
        })

        it('refuses a second account for the same eID', async () => {
            const { challenge, nonce } = await registerChallenge()
            const response = await http()
                .post('/oidc/account/register-eid')
                .send({
                    challenge,
                    token: await sign(nonce),
                    email: 'other@example.com',
                    password: PASSWORD,
                    organisation: 'Other'
                })
                .expect(409)
            expect(response.body.error).toBe('oidc.EID_ALREADY_LINKED')
            expect(await store.findUserByEmail('other@example.com')).toBeNull()
        })

        it('refuses a token for another nonce, of another website, or a challenge that was changed', async () => {
            const first = await registerChallenge()
            const second = await registerChallenge()
            const body = { email: 'x@example.com', password: PASSWORD, organisation: 'Xylo' }
            const other = await http()
                .post('/oidc/account/register-eid')
                .send({ ...body, challenge: first.challenge, token: await sign(second.nonce) })
                .expect(401)
            expect(other.body.error).toBe('oidc.EID_INVALID')
            const evil = new MockEidClient({ origin: 'https://evil.example', readDelayMs: 0 })
            await http()
                .post('/oidc/account/register-eid')
                .send({ ...body, challenge: first.challenge, token: await sign(first.nonce, evil) })
                .expect(401)
            const changed = await http()
                .post('/oidc/account/register-eid')
                .send({ ...body, challenge: first.challenge.slice(0, -2) + 'AA', token: await sign(first.nonce) })
                .expect(400)
            expect(changed.body.error).toBe('oidc.EID_EXPIRED')
            await http()
                .post('/oidc/account/register-eid')
                .send({ ...body, challenge: first.challenge, token: 'x' })
                .expect(400)
        })

        it('logs in only after the email address was verified', async () => {
            const early = await eidLogin()
            expect(early.response.status).toBe(403)
            expect(early.response.body.error).toBe('EMAIL_NOT_VERIFIED')
            await store.setEmailVerified(userId)
        })

        it('logs in with the eID as the first factor only: sc pin, no mfa claim', async () => {
            const { login, response } = await eidLogin()
            expect(response.status).toBe(200)
            expect(response.body.status).toBe('redirect')
            const { id_token, access_token } = await tokens(login, response.body.location as string)
            const claims = decodeUnverified(id_token)
            expect(claims).toMatchObject({ sub: userId, amr: ['sc', 'pin'] })
            expect(claims?.acr).not.toBe('loa4')
            const userinfo = await http().get('/oidc/userinfo').set(bearer(access_token)).expect(200)
            expect(userinfo.body).toMatchObject({ name: NAME, email: 'jan@example.com' })
            expect((await store.findIdentifier(userId, 'eid'))?.lastUsedAt).toBeInstanceOf(Date)
            const status = await http().get('/me/eid').set(bearer(access_token)).expect(200)
            expect(status.body).toMatchObject({ enabled: true, linked: true, hasPassword: true })
        })

        it('also logs in with the chosen password', async () => {
            const login = await startLogin()
            const response = await http()
                .post(login.base + '/login')
                .set('Cookie', login.cookie)
                .send({ csrf: login.csrf, email: 'jan@example.com', password: PASSWORD })
                .expect(200)
            expect(response.body.status).toBe('redirect')
        })

        it('is never the second factor: when two-step is required the authenticator follows the eID', async () => {
            process.env.OIDC_MFA = 'required'
            try {
                const { response } = await eidLogin()
                expect(response.status).toBe(200)
                expect(response.body.status).toBe('mfa-setup')
                // No session before the authenticator code
                const cookies = (response.headers['set-cookie'] as unknown as string[]) ?? []
                expect(cookies.find(c => c.startsWith('oidc_session='))).toBeFalsy()
            } finally {
                process.env.OIDC_MFA = 'optional'
            }
        })
    })

    describe('the login', () => {
        it('uses a nonce once', async () => {
            const login = await startLogin()
            const token = await sign(await eidChallenge(login))
            const old = login.cookie
            expect((await eidSubmit(login, token)).status).toBe(200)
            // The same token with the cookie from before: the session of that login exists already
            const replay = await http()
                .post(login.base + '/eid')
                .set('Cookie', old)
                .send({ csrf: login.csrf, token })
            expect(replay.body.status).not.toBe('redirect')
        })

        it('refuses a token without a challenge, for another nonce or of another website', async () => {
            const login = await startLogin()
            const none = await eidSubmit(login, await sign(randomBytes(32).toString('base64')))
            expect(none.status).toBe(400)
            expect(none.body.error).toBe('EID_EXPIRED')

            const wrong = await eidSubmit(
                login,
                await sign((await eidChallenge(login)).replace(/^./, c => (c === 'A' ? 'B' : 'A')))
            )
            expect(wrong.status).toBe(401)
            expect(wrong.body.error).toBe('EID_INVALID')

            const evil = new MockEidClient({ origin: 'https://evil.example', readDelayMs: 0 })
            const foreign = await eidSubmit(login, await sign(await eidChallenge(login), evil))
            expect(foreign.status).toBe(401)
            // After a failure the nonce is gone too
            const after = await eidSubmit(login, await sign(randomBytes(32).toString('base64')))
            expect(after.body.error).toBe('EID_EXPIRED')
        })

        it('needs the csrf token of the login', async () => {
            const login = await startLogin()
            await http()
                .post(login.base + '/eid/challenge')
                .set('Cookie', login.cookie)
                .send({ csrf: 'wrong' })
                .expect(410)
        })
    })

    describe('linking to an existing account', () => {
        it('refuses an eID that belongs to another account', async () => {
            const token = await passwordToken('alice@example.com')
            expect((await http().get('/me/eid').set(bearer(token)).expect(200)).body).toMatchObject({
                linked: false,
                hasPassword: true
            })
            const { challenge, nonce } = (await http().post('/me/eid/challenge').set(bearer(token)).expect(200)).body
            const response = await http()
                .post('/me/eid')
                .set(bearer(token))
                .send({ challenge, token: await sign(nonce) })
                .expect(409)
            expect(response.body.error).toBe('oidc.EID_ALREADY_LINKED')
        })

        it('links, logs in with it, and unlinks', async () => {
            // The virtual card is free again (the account of the registration is gone)
            const jan = await store.findUserByEmail('jan@example.com')
            await store.unlinkIdentifier(jan?.id ?? '', 'eid')

            const token = await passwordToken('alice@example.com')
            const { challenge, nonce } = (await http().post('/me/eid/challenge').set(bearer(token)).expect(200)).body
            const linked = await http()
                .post('/me/eid')
                .set(bearer(token))
                .send({ challenge, token: await sign(nonce) })
                .expect(200)
            expect(linked.body).toMatchObject({ linked: true, hasPassword: true })

            const { login, response } = await eidLogin()
            expect(response.body.status).toBe('redirect')
            const ids2 = await tokens(login, response.body.location as string)
            expect(decodeUnverified(ids2.id_token)).toMatchObject({ sub: ids.alice, amr: ['sc', 'pin'] })

            await http().delete('/me/eid').set(bearer(token)).expect(200)
            const after = await eidLogin()
            expect(after.response.status).toBe(404)
            expect(after.response.body.error).toBe('EID_NOT_LINKED')
        })

        it('binds a link challenge to the account that asked for it', async () => {
            const alice = await passwordToken('alice@example.com')
            const bob = await passwordToken('bob@example.com')
            const { challenge, nonce } = (await http().post('/me/eid/challenge').set(bearer(alice)).expect(200)).body
            const response = await http()
                .post('/me/eid')
                .set(bearer(bob))
                .send({ challenge, token: await sign(nonce) })
                .expect(400)
            expect(response.body.error).toBe('oidc.EID_EXPIRED')
        })

        it('needs a login', async () => {
            await http().get('/me/eid').expect(401)
            await http().post('/me/eid/challenge').expect(401)
        })
    })

    it('refuses everything when OIDC_EID=off', async () => {
        process.env.OIDC_EID = 'off'
        try {
            expect((await startLogin()).details).toMatchObject({ eid: false })
            const challenge = await http().post('/oidc/account/eid/challenge').expect(404)
            expect(challenge.body.error).toBe('oidc.EID_DISABLED')
            const login = await startLogin()
            await http()
                .post(login.base + '/eid/challenge')
                .set('Cookie', login.cookie)
                .send({ csrf: login.csrf })
                .expect(404)
            expect((await http().get('/oidc/account/registration').expect(200)).body).toEqual({
                password: true,
                eid: false
            })
        } finally {
            process.env.OIDC_EID = 'test'
        }
    })

    it('OIDC_REGISTRATION=eid: only registration with the eID', async () => {
        process.env.OIDC_REGISTRATION = 'eid'
        try {
            expect((await http().get('/oidc/account/registration').expect(200)).body).toEqual({
                password: false,
                eid: true
            })
            const response = await http()
                .post('/oidc/account/register')
                .send({ name: 'Eve', email: 'eve@example.com', password: PASSWORD, organisation: 'Evil' })
                .expect(403)
            expect(response.body.error).toBe('oidc.REGISTRATION_CLOSED')
        } finally {
            process.env.OIDC_REGISTRATION = 'open'
        }
    })
})
