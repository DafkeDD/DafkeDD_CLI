import { randomBytes } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { BILLING_STORE } from '../src/billing/store/billing.store.js'
import { MemoryBillingStore } from '../src/billing/store/memory-billing.store.js'
import { AUDIT_STORE } from '../src/audit/audit.store.js'
import { MemoryAuditStore } from '../src/audit/memory-audit.store.js'
import { MemoryNotificationsStore } from '../src/notifications/memory-notifications.store.js'
import { NOTIFICATIONS_STORE } from '../src/notifications/notifications.store.js'
import { DatabaseService } from '../src/database/database.service.js'
import { pkceChallenge, sha256 } from '../src/oidc/crypto.js'
import { decodeUnverified } from '../src/oidc/jose.js'
import { LoginLimiter } from '../src/oidc/login-limiter.js'
import { hashPassword } from '../src/oidc/password.js'
import { MemoryOidcStore } from '../src/oidc/store/memory-oidc.store.js'
import { OIDC_STORE } from '../src/oidc/store/oidc.store.js'
import { configureApp } from '../src/setup.js'

process.env.OIDC_MASTER_KEY ??= randomBytes(32).toString('hex')
process.env.OIDC_LOGIN_RATE_LIMIT = '1000'
process.env.OIDC_LOGIN_UI_URL = ''
process.env.OIDC_MFA = 'optional'

const CLIENT = 'frontend'
const REDIRECT = 'http://localhost:3000/api/auth/callback'
const AFTER_LOGOUT = 'http://localhost:3000'
const PASSWORD = 'correct-horse-battery'
const SERVER_SECRET = 'a-very-long-client-secret-of-at-least-32-chars'
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36'

describe('Sessions, refresh tokens, logout, revocation and introspection (e2e)', () => {
    let app: INestApplication<App>
    const store = new MemoryOidcStore()
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
        await store.upsertClient({
            clientId: 'server-app',
            name: 'Server app',
            type: 'confidential',
            secretHash: sha256(SERVER_SECRET),
            redirectUris: ['https://app.example.com/callback'],
            postLogoutRedirectUris: ['https://app.example.com/bye'],
            grantTypes: ['authorization_code'],
            scopes: ['openid', 'email', 'tenant'],
            firstParty: true
        })

        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(DatabaseService)
            .useValue({ ping: vi.fn().mockResolvedValue(true), query: vi.fn().mockResolvedValue({ rows: [] }) })
            .overrideProvider(OIDC_STORE)
            .useValue(store)
            .overrideProvider(BILLING_STORE)
            .useValue(new MemoryBillingStore())
            .overrideProvider(AUDIT_STORE)
            .useValue(new MemoryAuditStore())
            .overrideProvider(NOTIFICATIONS_STORE)
            .useValue(new MemoryNotificationsStore())
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
    const basic = (secret = SERVER_SECRET) => ({
        Authorization: 'Basic ' + Buffer.from('server-app:' + secret).toString('base64')
    })
    const setCookies = (response: request.Response) =>
        (response.headers['set-cookie'] as unknown as string[] | undefined) ?? []
    const cookieOf = (response: request.Response, name: string) =>
        setCookies(response)
            .find(c => c.startsWith(name))
            ?.split(';')[0] ?? ''

    type Tokens = { access_token: string; id_token: string; refresh_token?: string; scope: string }

    /** A whole login through the HTML page; returns the tokens and the session cookie of the browser. */
    async function login(email: string, client = CLIENT, redirect = REDIRECT, scope = 'openid profile email tenant') {
        const verifier = randomBytes(32).toString('base64url')
        const query = new URLSearchParams({
            client_id: client,
            redirect_uri: redirect,
            response_type: 'code',
            scope,
            code_challenge: pkceChallenge(verifier),
            code_challenge_method: 'S256'
        })
        const start = await http()
            .get('/oidc/authorize?' + query.toString())
            .set('User-Agent', BROWSER)
            .expect(303)
        const location = new URL(start.headers.location as string)
        const first = cookieOf(start, 'oidc_ia_')
        const page = await http().get(location.pathname).set('Cookie', first).expect(200)
        const csrf = /name="csrf" value="([^"]+)"/.exec(page.text)?.[1] ?? ''
        const done = await http()
            .post(location.pathname + '/login')
            .set('Cookie', first)
            .type('form')
            .send({ csrf, email, password: PASSWORD })
            .expect(303)
        const code = new URL(done.headers.location as string).searchParams.get('code') ?? ''
        const exchange = http().post('/oidc/token').type('form')
        const body = { grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier }
        const tokens =
            client === CLIENT
                ? await exchange.send({ ...body, client_id: client }).expect(200)
                : await exchange.set(basic()).send(body).expect(200)
        return { tokens: tokens.body as Tokens, session: cookieOf(done, 'oidc_session='), code, verifier }
    }

    const refresh = (token: string, extra: Record<string, string> = {}) =>
        http()
            .post('/oidc/token')
            .type('form')
            .send({ grant_type: 'refresh_token', client_id: CLIENT, refresh_token: token, ...extra })

    it('announces logout, revocation, introspection and the refresh_token grant', async () => {
        const discovery = (await http().get('/oidc/.well-known/openid-configuration').expect(200)).body
        expect(discovery).toMatchObject({
            end_session_endpoint: expect.stringMatching(/\/oidc\/logout$/),
            revocation_endpoint: expect.stringMatching(/\/oidc\/revoke$/),
            introspection_endpoint: expect.stringMatching(/\/oidc\/introspect$/),
            grant_types_supported: ['authorization_code', 'refresh_token']
        })
    })

    describe('refresh tokens', () => {
        it('only for clients with the refresh_token grant; the tokens carry the session as sid', async () => {
            const { tokens } = await login('alice@example.com')
            expect(tokens.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
            const sid = decodeUnverified(tokens.access_token)?.sid
            expect(sid).toEqual(decodeUnverified(tokens.id_token)?.sid)
            expect(store.sessions.size).toBeGreaterThan(0)
            const server = await login(
                'alice@example.com',
                'server-app',
                'https://app.example.com/callback',
                'openid email'
            )
            expect(server.tokens.refresh_token).toBeUndefined()
        })

        it('gives new tokens and a new refresh token; the old one is used up', async () => {
            const { tokens } = await login('alice@example.com')
            const first = await refresh(tokens.refresh_token ?? '').expect(200)
            expect(first.headers['cache-control']).toBe('no-store')
            expect(first.body.refresh_token).not.toBe(tokens.refresh_token)
            const access = decodeUnverified(first.body.access_token as string)
            expect(access).toMatchObject({ sub: ids.alice, tenant: { id: ids.acme, role: 'admin' } })
            expect(access?.sid).toBe(decodeUnverified(tokens.access_token)?.sid)
            expect(decodeUnverified(first.body.id_token as string)).toMatchObject({ sub: ids.alice, aud: CLIENT })
            await http()
                .get('/oidc/userinfo')
                .set(bearer(first.body.access_token as string))
                .expect(200)
            // The next refresh uses the new token
            await refresh(first.body.refresh_token as string).expect(200)
        })

        it('accepts a used token again within 30 seconds (two requests at once), but not later: then everything ends', async () => {
            const { tokens } = await login('alice@example.com')
            const old = tokens.refresh_token ?? ''
            const first = await refresh(old).expect(200)
            // The same browser, a second request at the same moment: the SAME successor, never a second chain
            const second = await refresh(old).expect(200)
            expect(second.body.refresh_token).toBe(first.body.refresh_token)

            // A copy used later: the family is revoked and the session ends
            const stored = store.refreshTokens.get(sha256(old))
            if (stored) stored.usedAt = new Date(Date.now() - 60_000)
            const stolen = await refresh(old).expect(400)
            expect(stolen.body.error).toBe('invalid_grant')
            await refresh(first.body.refresh_token as string).expect(400)
            await refresh(second.body.refresh_token as string).expect(400)
            await http()
                .get('/oidc/userinfo')
                .set(bearer(first.body.access_token as string))
                .expect(401)
        })

        it('a code that comes back revokes the refresh tokens it gave', async () => {
            const { tokens, code, verifier } = await login('alice@example.com')
            const again = await http()
                .post('/oidc/token')
                .type('form')
                .send({
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: REDIRECT,
                    code_verifier: verifier,
                    client_id: CLIENT
                })
                .expect(400)
            expect(again.body.error).toBe('invalid_grant')
            await refresh(tokens.refresh_token ?? '').expect(400)
        })

        it('may ask a smaller scope, never a larger one, and only for its own client', async () => {
            const { tokens } = await login('alice@example.com')
            const smaller = await refresh(tokens.refresh_token ?? '', { scope: 'openid email' }).expect(200)
            expect(smaller.body.scope).toBe('openid email')
            const larger = await refresh(smaller.body.refresh_token as string, {
                scope: 'openid email profile'
            }).expect(400)
            expect(larger.body.error).toBe('invalid_scope')
            const other = await http()
                .post('/oidc/token')
                .set(basic())
                .type('form')
                .send({ grant_type: 'refresh_token', refresh_token: smaller.body.refresh_token as string })
            expect(other.status).toBe(400)
            expect(other.body.error).toBe('unauthorized_client')
            expect((await refresh('not-a-token').expect(400)).body.error).toBe('invalid_grant')
        })

        it('checks the member again: a disabled member gets no new tokens', async () => {
            const { tokens } = await login('bob@example.com')
            const member = store.members.find(item => item.userId === ids.bob)
            if (member) member.status = 'disabled'
            try {
                expect((await refresh(tokens.refresh_token ?? '').expect(400)).body.error).toBe('invalid_grant')
            } finally {
                if (member) member.status = 'active'
            }
        })
    })

    describe('revocation and introspection', () => {
        it('revokes a refresh token with its family; unknown tokens get the same answer', async () => {
            const { tokens } = await login('alice@example.com')
            const next = await refresh(tokens.refresh_token ?? '').expect(200)
            await http()
                .post('/oidc/revoke')
                .type('form')
                .send({ client_id: CLIENT, token: tokens.refresh_token ?? '', token_type_hint: 'refresh_token' })
                .expect(200)
            // The whole family: also the newer token
            await refresh(next.body.refresh_token as string).expect(400)
            await http().post('/oidc/revoke').type('form').send({ client_id: CLIENT, token: 'unknown' }).expect(200)
            const access = await http()
                .post('/oidc/revoke')
                .type('form')
                .send({ client_id: CLIENT, token: tokens.access_token })
                .expect(400)
            expect(access.body.error).toBe('unsupported_token_type')
            await http().post('/oidc/revoke').type('form').send({ client_id: 'nope', token: 'x' }).expect(401)
        })

        it('introspection is only for confidential clients', async () => {
            const { tokens } = await login('alice@example.com')
            const public_ = await http()
                .post('/oidc/introspect')
                .type('form')
                .send({ client_id: CLIENT, token: tokens.access_token })
                .expect(401)
            expect(public_.body.error).toBe('invalid_client')
            await http().post('/oidc/introspect').set(basic('wrong')).type('form').send({ token: 'x' }).expect(401)

            const active = await http()
                .post('/oidc/introspect')
                .set(basic())
                .type('form')
                .send({ token: tokens.access_token })
                .expect(200)
            expect(active.body).toMatchObject({
                active: true,
                token_type: 'Bearer',
                sub: ids.alice,
                client_id: CLIENT,
                tenant: { id: ids.acme },
                sid: decodeUnverified(tokens.access_token)?.sid
            })
            // The refresh token of another client says nothing
            const foreign = await http()
                .post('/oidc/introspect')
                .set(basic())
                .type('form')
                .send({ token: tokens.refresh_token ?? '' })
                .expect(200)
            expect(foreign.body).toEqual({ active: false })
            const garbage = await http().post('/oidc/introspect').set(basic()).type('form').send({ token: 'a.b.c' })
            expect(garbage.body).toEqual({ active: false })
        })
    })

    describe('logout (end_session_endpoint)', () => {
        const logout = (params: Record<string, string>, cookie = '') =>
            http()
                .get('/oidc/logout?' + new URLSearchParams(params).toString())
                .set('Cookie', cookie)

        it('ends the session at once with an id_token_hint: tokens, refresh tokens and single sign-on stop', async () => {
            const { tokens, session } = await login('alice@example.com')
            const response = await logout(
                { id_token_hint: tokens.id_token, post_logout_redirect_uri: AFTER_LOGOUT, state: 'bye' },
                session
            ).expect(303)
            expect(response.headers.location).toBe(AFTER_LOGOUT + '/?state=bye')
            expect(setCookies(response).some(c => c.startsWith('oidc_session=;'))).toBe(true)
            await http().get('/oidc/userinfo').set(bearer(tokens.access_token)).expect(401)
            await http().get('/me/mfa').set(bearer(tokens.access_token)).expect(401)
            await refresh(tokens.refresh_token ?? '').expect(400)
            const introspected = await http()
                .post('/oidc/introspect')
                .set(basic())
                .type('form')
                .send({ token: tokens.access_token })
            expect(introspected.body).toEqual({ active: false })
            // The browser has to log in again
            const again = await http()
                .get(
                    '/oidc/authorize?' +
                        new URLSearchParams({
                            client_id: CLIENT,
                            redirect_uri: REDIRECT,
                            response_type: 'code',
                            scope: 'openid',
                            code_challenge: pkceChallenge(randomBytes(32).toString('base64url')),
                            code_challenge_method: 'S256',
                            prompt: 'none'
                        }).toString()
                )
                .set('Cookie', session)
                .expect(303)
            expect(new URL(again.headers.location as string).searchParams.get('error')).toBe('login_required')
        })

        it('asks first when the id_token_hint is of another (older) login of the same user', async () => {
            const old = await login('alice@example.com')
            const { tokens, session } = await login('alice@example.com')
            const page = await logout(
                { id_token_hint: old.tokens.id_token, post_logout_redirect_uri: AFTER_LOGOUT },
                session
            ).expect(200)
            expect(page.text).toContain('name="confirm"')
            await http().get('/oidc/userinfo').set(bearer(tokens.access_token)).expect(200)
        })

        it('accepts an expired id_token_hint, but never a forged one or an unregistered address', async () => {
            const { tokens, session } = await login('alice@example.com')
            const [header, payload] = tokens.id_token.split('.')
            const forged = `${header}.${payload}.${Buffer.from('x'.repeat(256)).toString('base64url')}`
            const bad = await logout({ id_token_hint: forged }, session).expect(400)
            expect(bad.text).toContain('<html')
            await logout(
                { id_token_hint: tokens.id_token, post_logout_redirect_uri: 'https://evil.example.com' },
                session
            ).expect(400)
            await logout({ client_id: 'server-app', id_token_hint: tokens.id_token }, session).expect(400)
            // The session is still there
            await http().get('/oidc/userinfo').set(bearer(tokens.access_token)).expect(200)
        })

        it('asks first without a hint, and logs out after the confirmation with its CSRF token', async () => {
            const { tokens, session } = await login('alice@example.com')
            const page = await logout({ client_id: CLIENT, post_logout_redirect_uri: AFTER_LOGOUT }, session).expect(
                200
            )
            expect(page.headers['content-security-policy']).toContain('form-action')
            const csrf = /name="csrf" value="([^"]+)"/.exec(page.text)?.[1] ?? ''
            expect(csrf).toBeTruthy()
            // Another site cannot make the CSRF token
            const forged = await http()
                .post('/oidc/logout')
                .set('Cookie', session)
                .type('form')
                .send({ client_id: CLIENT, post_logout_redirect_uri: AFTER_LOGOUT, confirm: 'yes', csrf: 'guess' })
                .expect(200)
            expect(forged.text).toContain('name="confirm"')
            await http().get('/oidc/userinfo').set(bearer(tokens.access_token)).expect(200)
            const done = await http()
                .post('/oidc/logout')
                .set('Cookie', session)
                .type('form')
                .send({ client_id: CLIENT, post_logout_redirect_uri: AFTER_LOGOUT, confirm: 'yes', csrf })
                .expect(303)
            expect(done.headers.location).toBe(AFTER_LOGOUT + '/')
            await http().get('/oidc/userinfo').set(bearer(tokens.access_token)).expect(401)
        })

        it('without a session there is nothing to ask: straight back, or the page "logged out"', async () => {
            const back = await logout({ client_id: CLIENT, post_logout_redirect_uri: AFTER_LOGOUT, state: 's' }).expect(
                303
            )
            expect(back.headers.location).toBe(AFTER_LOGOUT + '/?state=s')
            const page = await logout({}).expect(200)
            expect(page.text).toContain('<html')
        })
    })

    describe('sessions of the own account (/me/sessions)', () => {
        it('lists the sessions with the browser, and ends one or all others', async () => {
            const bob = await login('bob@example.com')
            await login('bob@example.com')
            const third = await login('bob@example.com')
            const token = bob.tokens.access_token
            const list = (await http().get('/me/sessions').set(bearer(token)).expect(200)).body as {
                id: string
                current: boolean
                userAgent: string
                tenant: { name: string }
                amr: string[]
            }[]
            expect(list.length).toBeGreaterThanOrEqual(3)
            const current = list.find(item => item.current)
            expect(current).toMatchObject({ userAgent: BROWSER, tenant: { name: 'Acme' }, amr: ['pwd'] })
            expect(current?.id).toBe(decodeUnverified(token)?.sid)

            // End one other session: its tokens stop
            const thirdSid = String(decodeUnverified(third.tokens.access_token)?.sid)
            await http()
                .delete('/me/sessions/' + thirdSid)
                .set(bearer(token))
                .expect(200)
            await http().get('/me/sessions').set(bearer(third.tokens.access_token)).expect(401)
            await http()
                .delete('/me/sessions/' + thirdSid)
                .set(bearer(token))
                .expect(404)

            // Another account cannot end it
            const alice = await login('alice@example.com')
            const notYours = await http()
                .delete('/me/sessions/' + String(decodeUnverified(token)?.sid))
                .set(bearer(alice.tokens.access_token))
                .expect(404)
            expect(notYours.body.error).toBe('oidc.SESSION_NOT_FOUND')
            await http().delete('/me/sessions/not-a-uuid').set(bearer(token)).expect(404)

            // Log out everywhere else: only this one stays
            const others = await http().delete('/me/sessions').set(bearer(token)).expect(200)
            expect(others.body.ended).toBeGreaterThanOrEqual(1)
            const left = (await http().get('/me/sessions').set(bearer(token)).expect(200)).body as {
                current: boolean
            }[]
            expect(left).toEqual([expect.objectContaining({ current: true })])
            await http().get('/me/sessions').expect(401)
        })
    })
})
