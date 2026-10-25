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
import { pkceChallenge } from '../src/oidc/crypto.js'
import { decodeUnverified } from '../src/oidc/jose.js'
import { LoginLimiter } from '../src/oidc/login-limiter.js'
import { hashPassword } from '../src/oidc/password.js'
import { MemoryOidcStore } from '../src/oidc/store/memory-oidc.store.js'
import { OIDC_STORE } from '../src/oidc/store/oidc.store.js'
import { configureApp } from '../src/setup.js'
import { VirtualPasskey } from './virtual-authenticator.js'
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

const CLIENT = 'frontend'
const REDIRECT = 'http://localhost:3000/api/auth/callback'
const PASSWORD = 'correct-horse-battery'
/** The login page of the frontend (APP_URL): where the browser uses the passkeys. */
const ORIGIN = 'http://localhost:3000'

describe('Passkeys (e2e)', () => {
    let app: INestApplication<App>
    const store = new MemoryOidcStore()
    const audit = new MemoryAuditStore(store)
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
            .compile()
        app = moduleRef.createNestApplication()
        configureApp(app)
        await app.init()
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

    /** /oidc/authorize: the login page, its cookie and its CSRF token. */
    async function begin() {
        const verifier = randomBytes(32).toString('base64url')
        const query = new URLSearchParams({
            client_id: CLIENT,
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
        const details = await http().get(page).set('Cookie', cookie).set('Accept', 'application/json').expect(200)
        return { page, cookie, csrf: details.body.csrf as string, details: details.body, verifier }
    }

    async function tokens(location: string, verifier: string) {
        const code = new URL(location).searchParams.get('code') ?? ''
        const answer = await http()
            .post('/oidc/token')
            .type('form')
            .send({
                grant_type: 'authorization_code',
                code,
                redirect_uri: REDIRECT,
                code_verifier: verifier,
                client_id: CLIENT
            })
            .expect(200)
        return answer.body as { access_token: string; id_token: string }
    }

    /** Logged in with the password: an access token for /me/passkeys. */
    async function passwordToken(email: string) {
        const login = await begin()
        const done = await http()
            .post(login.page + '/login')
            .set('Cookie', login.cookie)
            .type('form')
            .send({ csrf: login.csrf, email, password: PASSWORD })
            .expect(303)
        return (await tokens(done.headers.location as string, login.verifier)).access_token
    }

    /** Adds the device as a passkey of the account of `token`. */
    async function add(token: string, device: VirtualPasskey, name = 'Laptop', origin = ORIGIN) {
        const start = await http().post('/me/passkeys/options').set(bearer(token)).expect(200)
        const options = start.body.options as { challenge: string; rp: { id: string }; user: { id: string } }
        return http()
            .post('/me/passkeys')
            .set(bearer(token))
            .send({ token: start.body.token as string, name, credential: device.create(options, origin) })
    }

    /** "Log in with a passkey" on the login page of the frontend (JSON). */
    async function passkeyLogin(device: VirtualPasskey, change: { origin?: string; userHandle?: string } = {}) {
        const login = await begin()
        const challenge = await http()
            .post(login.page + '/passkey/challenge')
            .set('Cookie', login.cookie)
            .set('Accept', 'application/json')
            .send({ csrf: login.csrf })
            .expect(200)
        const cookie = cookieOf(challenge, 'oidc_ia_')
        const options = challenge.body.options as { challenge: string; rpId: string }
        const credential = device.get(options, ORIGIN, change)
        const answer = await http()
            .post(login.page + '/passkey')
            .set('Cookie', cookie)
            .set('Accept', 'application/json')
            .send({ csrf: login.csrf, credential })
        return { login, cookie, credential, answer, options }
    }

    let aliceToken = ''
    const device = new VirtualPasskey({ synced: true })

    it('the login page offers passkeys', async () => {
        const login = await begin()
        expect(login.details).toMatchObject({ passkey: true, password: true })
    })

    it('an account adds a passkey on /security, and sees it', async () => {
        aliceToken = await passwordToken('alice@example.com')
        expect((await http().get('/me/passkeys').set(bearer(aliceToken)).expect(200)).body).toEqual({
            enabled: true,
            passkeys: []
        })
        const start = await http().post('/me/passkeys/options').set(bearer(aliceToken)).expect(200)
        expect(start.body.options).toMatchObject({
            rp: { id: 'localhost' },
            user: { id: Buffer.from(ids.alice).toString('base64url'), name: 'alice@example.com', displayName: 'Alice' },
            authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
            attestation: 'none',
            excludeCredentials: []
        })
        const added = await add(aliceToken, device)
        expect(added.status).toBe(201)
        expect(added.body).toMatchObject({ name: 'Laptop', synced: true, lastUsedAt: null })
        expect(added.body).not.toHaveProperty('publicKey')

        const list = await http().get('/me/passkeys').set(bearer(aliceToken)).expect(200)
        expect(list.body.passkeys).toHaveLength(1)
        // The device is not offered twice
        const again = await http().post('/me/passkeys/options').set(bearer(aliceToken)).expect(200)
        expect(again.body.options.excludeCredentials).toEqual([
            { type: 'public-key', id: device.credentialId, transports: ['internal', 'hybrid'] }
        ])
        expect(audit.events.findLast(event => event.action === 'account.passkey_added')).toMatchObject({
            actorId: ids.alice,
            details: { name: 'Laptop', synced: true }
        })
    })

    it('refuses the same passkey twice, another site, a token of another account or an old token', async () => {
        expect((await add(aliceToken, device)).status).toBe(409)
        const other = new VirtualPasskey()
        const wrongOrigin = await add(aliceToken, other, 'Evil', 'https://evil.example')
        expect(wrongOrigin.status).toBe(400)
        expect(wrongOrigin.body.message).toContain('could not be verified')

        // The token is sealed for one account
        const bobToken = await passwordToken('bob@example.com')
        const start = await http().post('/me/passkeys/options').set(bearer(aliceToken)).expect(200)
        const stolen = await http()
            .post('/me/passkeys')
            .set(bearer(bobToken))
            .send({ token: start.body.token as string, credential: other.create(start.body.options, ORIGIN) })
        expect(stolen.status).toBe(400)
        expect(stolen.body.message).toContain('expired')
        // Validation
        await http().post('/me/passkeys').set(bearer(aliceToken)).send({ token: 'x', credential: 'x' }).expect(400)
        await http().get('/me/passkeys').expect(401)
    })

    it('logs in with the passkey: two-step verification in one, straight to the client', async () => {
        const { answer, login } = await passkeyLogin(device)
        expect(answer.status).toBe(200)
        expect(answer.body.status).toBe('redirect')
        const result = await tokens(answer.body.location as string, login.verifier)
        const claims = decodeUnverified(result.id_token)
        expect(claims).toMatchObject({ sub: ids.alice, acr: 'loa2', amr: ['pop', 'user', 'mfa'] })
        expect(audit.events.findLast(event => event.action === 'login.succeeded')).toMatchObject({
            actorId: ids.alice,
            tenantId: ids.acme
        })
        const list = await http().get('/me/passkeys').set(bearer(aliceToken)).expect(200)
        expect(list.body.passkeys[0].lastUsedAt).toBeTruthy()
    })

    it('a challenge works once, also with an old copy of the login cookie', async () => {
        const { answer, cookie, credential, login } = await passkeyLogin(device)
        expect(answer.status).toBe(200)
        const replay = await http()
            .post(login.page + '/passkey')
            .set('Cookie', cookie)
            .set('Accept', 'application/json')
            .send({ csrf: login.csrf, credential })
        expect(replay.status).toBe(400)
        expect(replay.body.error).toBe('PASSKEY_EXPIRED')
        // Without a challenge first
        const fresh = await begin()
        const none = await http()
            .post(fresh.page + '/passkey')
            .set('Cookie', fresh.cookie)
            .set('Accept', 'application/json')
            .send({ csrf: fresh.csrf, credential })
        expect(none.body.error).toBe('PASSKEY_EXPIRED')
    })

    it('refuses an unknown passkey, another origin, another user handle, and logs why', async () => {
        const unknown = await passkeyLogin(new VirtualPasskey())
        expect(unknown.answer.status).toBe(401)
        expect(unknown.answer.body.error).toBe('PASSKEY_UNKNOWN')
        const origin = await passkeyLogin(device, { origin: 'https://evil.example' })
        expect(origin.answer.body.error).toBe('PASSKEY_INVALID')
        const handle = await passkeyLogin(device, { userHandle: Buffer.from(ids.bob).toString('base64url') })
        expect(handle.answer.body.error).toBe('PASSKEY_INVALID')
        expect(audit.events.findLast(event => event.action === 'login.failed')).toMatchObject({
            details: { method: 'passkey', reason: 'passkey_invalid' }
        })
    })

    it('refuses a counting device whose counter goes back (a clone)', async () => {
        const key = new VirtualPasskey({ counting: true })
        expect((await add(aliceToken, key, 'Security key')).status).toBe(201)
        expect((await passkeyLogin(key)).answer.status).toBe(200)
        key.counter = 0
        const clone = await passkeyLogin(key)
        expect(clone.answer.status).toBe(401)
        expect(clone.answer.body.error).toBe('PASSKEY_INVALID')
    })

    it('a disabled account cannot log in with its passkey', async () => {
        const bobToken = await passwordToken('bob@example.com')
        const bobKey = new VirtualPasskey()
        expect((await add(bobToken, bobKey, 'Phone')).status).toBe(201)
        store.users.find(item => item.id === ids.bob)!.status = 'disabled'
        const refused = await passkeyLogin(bobKey)
        expect(refused.answer.body.error).toBe('ACCOUNT_DISABLED')
        store.users.find(item => item.id === ids.bob)!.status = 'active'
    })

    it('an account with an unconfirmed email address cannot log in with its passkey', async () => {
        const carol = store.addUser({
            email: 'carol@example.com',
            name: 'Carol',
            passwordHash: await hashPassword(PASSWORD)
        })
        store.addMembership(ids.acme, carol.id, 'user')
        const carolKey = new VirtualPasskey()
        expect((await add(await passwordToken('carol@example.com'), carolKey, 'Phone')).status).toBe(201)
        store.users.find(item => item.id === carol.id)!.emailVerified = false
        const refused = await passkeyLogin(carolKey)
        expect(refused.answer.body.error).toBe('EMAIL_NOT_VERIFIED')
        expect(refused.answer.body.location).toBeUndefined()
    })

    it('renames and removes passkeys, but never the last way to log in', async () => {
        const list = await http().get('/me/passkeys').set(bearer(aliceToken)).expect(200)
        const [first, second] = list.body.passkeys as { id: string }[]
        await http()
            .patch('/me/passkeys/' + first!.id)
            .set(bearer(aliceToken))
            .send({ name: 'Phone' })
            .expect(200, { id: first!.id, name: 'Phone' })
        await http()
            .patch('/me/passkeys/' + first!.id)
            .set(bearer(aliceToken))
            .send({ name: '' })
            .expect(400)
        await http()
            .delete('/me/passkeys/' + second!.id)
            .set(bearer(aliceToken))
            .expect(200, { removed: true })
        expect(audit.events.findLast(event => event.action === 'account.passkey_removed')).toMatchObject({
            actorId: ids.alice
        })
        // Bob cannot touch the passkey of Alice
        const bobToken = await passwordToken('bob@example.com')
        await http()
            .delete('/me/passkeys/' + first!.id)
            .set(bearer(bobToken))
            .expect(404)

        // Without a password the last passkey stays
        const alice = store.users.find(item => item.id === ids.alice)!
        const hash = alice.passwordHash
        alice.passwordHash = null
        const last = await http()
            .delete('/me/passkeys/' + first!.id)
            .set(bearer(aliceToken))
        expect(last.status).toBe(409)
        expect(last.body.message).toContain('only way left')
        alice.passwordHash = hash
        await http()
            .delete('/me/passkeys/' + first!.id)
            .set(bearer(aliceToken))
            .expect(200)
    })

    it('can be turned off (OIDC_PASSKEYS=off)', async () => {
        process.env.OIDC_PASSKEYS = 'off'
        try {
            const login = await begin()
            expect(login.details.passkey).toBe(false)
            await http()
                .post(login.page + '/passkey/challenge')
                .set('Cookie', login.cookie)
                .set('Accept', 'application/json')
                .send({ csrf: login.csrf })
                .expect(404)
            await http().post('/me/passkeys/options').set(bearer(aliceToken)).expect(404)
            expect((await http().get('/me/passkeys').set(bearer(aliceToken)).expect(200)).body.enabled).toBe(false)
        } finally {
            delete process.env.OIDC_PASSKEYS
        }
    })
})
