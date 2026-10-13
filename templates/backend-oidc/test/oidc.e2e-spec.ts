import { createPublicKey, type JsonWebKey, randomBytes } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { DatabaseService } from '../src/database/database.service.js'
import { pkceChallenge, sha256 } from '../src/oidc/crypto.js'
import { decodeUnverified, halfHash, verifyJwt, type JwsAlgorithm } from '../src/oidc/jose.js'
import { LoginLimiter } from '../src/oidc/login-limiter.js'
import { hashPassword } from '../src/oidc/password.js'
import { MemoryOidcStore } from '../src/oidc/store/memory-oidc.store.js'
import { OIDC_STORE } from '../src/oidc/store/oidc.store.js'
import { configureApp } from '../src/setup.js'

process.env.OIDC_MASTER_KEY ??= randomBytes(32).toString('hex')
process.env.OIDC_LOGIN_RATE_LIMIT = '1000'

const ISSUER = 'http://localhost:__PORT__/oidc'
const AUDIENCE = 'http://localhost:__PORT__'
const CLIENT = 'demo'
const REDIRECT = 'http://localhost:4400/callback'
const PASSWORD = 'correct-horse-battery'

/** Texts of the login pages in every language (from src/i18n/<language>/oidc.json). */
const MESSAGES: Record<string, Record<string, string>> = __OIDC_MESSAGES__

const pkce = () => {
    const verifier = randomBytes(32).toString('base64url')
    return { verifier, challenge: pkceChallenge(verifier) }
}

describe('OpenID Connect (e2e)', () => {
    let app: INestApplication<App>
    let store: MemoryOidcStore
    const http = () => request(app.getHttpServer())
    const ids = { acme: '', globex: '', alice: '', bob: '', carol: '' }

    beforeAll(async () => {
        store = new MemoryOidcStore()
        const passwordHash = await hashPassword(PASSWORD)
        const acme = store.addTenant('acme', 'Acme')
        const globex = store.addTenant('globex', 'Globex')
        const alice = store.addUser({ email: 'alice@example.com', name: 'Alice', passwordHash })
        const bob = store.addUser({ email: 'bob@example.com', name: 'Bob', passwordHash })
        const carol = store.addUser({ email: 'carol@example.com', name: 'Carol', passwordHash })
        store.addMember(acme.id, alice.id, ['admin'])
        store.addMember(acme.id, bob.id, [])
        store.addMember(globex.id, bob.id, ['editor'])
        Object.assign(ids, { acme: acme.id, globex: globex.id, alice: alice.id, bob: bob.id, carol: carol.id })
        await store.upsertClient({
            clientId: 'server-app',
            name: 'Server app',
            type: 'confidential',
            secretHash: sha256('a-very-long-client-secret-of-at-least-32-chars'),
            redirectUris: ['https://app.example.com/callback'],
            postLogoutRedirectUris: [],
            grantTypes: ['authorization_code'],
            scopes: ['openid', 'email'],
            firstParty: true
        })

        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(DatabaseService)
            .useValue({ ping: vi.fn().mockResolvedValue(true), query: vi.fn().mockResolvedValue({ rows: [] }) })
            .overrideProvider(OIDC_STORE)
            .useValue(store)
            .compile()
        app = moduleRef.createNestApplication()
        configureApp(app)
        await app.init()
    })

    afterAll(async () => {
        await app.close()
    })

    /** GET /oidc/authorize with sensible defaults. */
    function authorize(params: Record<string, string>, cookie?: string) {
        const query = new URLSearchParams({
            client_id: CLIENT,
            redirect_uri: REDIRECT,
            response_type: 'code',
            scope: 'openid profile email tenant',
            state: 'state-123',
            nonce: 'nonce-456',
            code_challenge_method: 'S256',
            ...params
        })
        const call = http().get('/oidc/authorize?' + query.toString())
        return cookie ? call.set('Cookie', cookie) : call
    }

    const path = (location: string) => {
        const url = new URL(location)
        return url.pathname + url.search
    }
    const csrfOf = (html: string) => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? ''
    /** Where the form on the page posts to (keeps ?lang=). */
    const actionOf = (html: string) => path((/action="([^"]+)"/.exec(html)?.[1] ?? '').replaceAll('&amp;', '&'))
    const sessionCookie = (response: request.Response) =>
        ((response.headers['set-cookie'] as unknown as string[] | undefined) ?? []).find(c =>
            c.startsWith('oidc_session=')
        ) ?? ''

    /** Starts a login, submits the password, and returns the response of the login form. */
    async function login(email: string, extra: Record<string, string> = {}, password = PASSWORD) {
        const { verifier, challenge } = pkce()
        const start = await authorize({ code_challenge: challenge, ...extra }).expect(303)
        const interaction = path(start.headers.location as string)
        expect(interaction).toMatch(/^\/oidc\/interaction\//)
        const page = await http().get(interaction).expect(200)
        const response = await http()
            .post(actionOf(page.text))
            .type('form')
            .send({ csrf: csrfOf(page.text), email, password })
        return { response, verifier, interaction, page }
    }

    function exchange(code: string, verifier: string, extra: Record<string, string> = {}) {
        return http()
            .post('/oidc/token')
            .type('form')
            .send({
                grant_type: 'authorization_code',
                code,
                redirect_uri: REDIRECT,
                client_id: CLIENT,
                code_verifier: verifier,
                ...extra
            })
    }

    async function verifyToken(token: string, alg: JwsAlgorithm, audience: string, typ: string) {
        const { keys } = (await http().get('/oidc/jwks').expect(200)).body as {
            keys: (JsonWebKey & { kid: string; alg: JwsAlgorithm })[]
        }
        return verifyJwt(token, {
            keys: kid => {
                const jwk = keys.find(key => key.kid === kid)
                return jwk ? { alg: jwk.alg, key: createPublicKey({ key: jwk, format: 'jwk' }) } : undefined
            },
            algorithms: [alg],
            issuer: ISSUER,
            audience,
            typ
        }).payload
    }

    describe('discovery and keys', () => {
        it('publishes the discovery document', async () => {
            const response = await http().get('/oidc/.well-known/openid-configuration').expect(200)
            expect(response.body).toMatchObject({
                issuer: ISSUER,
                authorization_endpoint: ISSUER + '/authorize',
                token_endpoint: ISSUER + '/token',
                userinfo_endpoint: ISSUER + '/userinfo',
                jwks_uri: ISSUER + '/jwks',
                response_types_supported: ['code'],
                code_challenge_methods_supported: ['S256'],
                subject_types_supported: ['public'],
                id_token_signing_alg_values_supported: ['RS256'],
                authorization_response_iss_parameter_supported: true
            })
            expect(response.body.grant_types_supported).not.toContain('implicit')
        })

        it('publishes the same document as OAuth 2.0 metadata (RFC 8414)', async () => {
            const discovery = await http().get('/oidc/.well-known/openid-configuration')
            const metadata = await http().get('/.well-known/oauth-authorization-server/oidc').expect(200)
            expect(metadata.body).toEqual(discovery.body)
        })

        it('publishes an RS256 and an ES256 public key, never a private part', async () => {
            const response = await http().get('/oidc/jwks').expect(200)
            const keys = response.body.keys as Record<string, string>[]
            expect(keys.map(key => key.alg).sort()).toEqual(['ES256', 'RS256'])
            for (const key of keys) {
                expect(key.use).toBe('sig')
                expect(key.kid).toBeTruthy()
                for (const secret of ['d', 'p', 'q', 'dp', 'dq', 'qi']) expect(key[secret]).toBeUndefined()
            }
        })

        it('stores the private keys encrypted', () => {
            for (const key of store.keys) {
                expect(key.privateKey.startsWith('v1.')).toBe(true)
                expect(key.privateKey).not.toContain('PRIVATE KEY')
            }
        })
    })

    describe('authorization request', () => {
        it('shows an error page (no redirect) for an unknown client', async () => {
            const response = await authorize({ client_id: 'nope', code_challenge: pkce().challenge }).expect(400)
            expect(response.headers['content-type']).toContain('text/html')
            expect(response.headers.location).toBeUndefined()
        })

        it('shows an error page (no redirect) for a redirect_uri that is not registered exactly', async () => {
            await authorize({
                redirect_uri: 'http://localhost:4400/callback/',
                code_challenge: pkce().challenge
            }).expect(400)
            await authorize({
                redirect_uri: 'https://evil.example.com/callback',
                code_challenge: pkce().challenge
            }).expect(400)
        })

        it.each([
            [{ code_challenge: '' }, 'invalid_request'],
            [{ code_challenge: pkce().challenge, code_challenge_method: 'plain' }, 'invalid_request'],
            [{ code_challenge: pkce().challenge, response_type: 'token' }, 'unsupported_response_type'],
            [{ code_challenge: pkce().challenge, response_type: 'id_token' }, 'unsupported_response_type'],
            [{ code_challenge: pkce().challenge, scope: 'profile email' }, 'invalid_scope'],
            [{ code_challenge: pkce().challenge, prompt: 'none' }, 'login_required'],
            [{ code_challenge: pkce().challenge, prompt: 'none login' }, 'invalid_request'],
            [{ code_challenge: pkce().challenge, request: 'eyJ.x.y' }, 'request_not_supported'],
            [{ code_challenge: pkce().challenge, max_age: '-1' }, 'invalid_request']
        ])('sends %o back to the client as %s, with state and iss', async (params, error) => {
            const response = await authorize(params).expect(303)
            const location = new URL(response.headers.location as string)
            expect(location.origin + location.pathname).toBe(REDIRECT)
            expect(location.searchParams.get('error')).toBe(error)
            expect(location.searchParams.get('state')).toBe('state-123')
            expect(location.searchParams.get('iss')).toBe(ISSUER)
            expect(location.searchParams.get('code')).toBeNull()
        })

        it('refuses parameters that are sent twice', async () => {
            const response = await http()
                .get(
                    '/oidc/authorize?client_id=demo&redirect_uri=' +
                        encodeURIComponent(REDIRECT) +
                        '&scope=openid&scope=email&response_type=code&code_challenge_method=S256&code_challenge=' +
                        pkce().challenge
                )
                .expect(303)
            expect(new URL(response.headers.location as string).searchParams.get('error')).toBe('invalid_request')
        })

        it('sends the user to the login page, in the language of ui_locales', async () => {
            const response = await authorize({ code_challenge: pkce().challenge, ui_locales: 'nl-BE en' }).expect(303)
            const location = new URL(response.headers.location as string)
            expect(location.pathname).toMatch(/^\/oidc\/interaction\/[A-Za-z0-9_-]{43}$/)
            expect(location.searchParams.get('lang')).toBe('nl')
        })
    })

    describe('login page', () => {
        it('is a safe HTML page: CSP, no framing, no caching', async () => {
            const { page } = await login('alice@example.com')
            expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'")
            expect(page.headers['content-security-policy']).toContain("default-src 'none'")
            expect(page.headers['content-security-policy']).toContain('form-action')
            expect(page.headers['x-frame-options']).toBe('DENY')
            expect(page.headers['cache-control']).toBe('no-store')
            expect(page.text).toContain('name="csrf"')
            expect(page.text).not.toContain('<script')
        })

        it.each(Object.entries(MESSAGES))('is translated (%s)', async (language, texts) => {
            const start = await authorize({ code_challenge: pkce().challenge, ui_locales: language }).expect(303)
            const page = await http()
                .get(path(start.headers.location as string))
                .expect(200)
            expect(page.text).toContain(`lang="${language}"`)
            expect(page.text).toContain(texts.LOGIN_SUBMIT)
            expect(page.text).toContain(texts.PASSWORD)
        })

        it.each(Object.entries(MESSAGES))(
            'shows the same translated error for a wrong password and an unknown email (%s)',
            async (language, texts) => {
                const wrong = await login('alice@example.com', { ui_locales: language }, 'wrong-password')
                const unknown = await login('nobody@example.com', { ui_locales: language }, 'wrong-password')
                expect(wrong.response.status).toBe(401)
                expect(unknown.response.status).toBe(401)
                expect(wrong.response.text).toContain(texts.INVALID_CREDENTIALS)
                expect(unknown.response.text).toContain(texts.INVALID_CREDENTIALS)
                expect(sessionCookie(wrong.response)).toBe('')
            }
        )

        it('escapes what the user typed', async () => {
            const { response } = await login('"><script>alert(1)</script>@x.com', {}, 'wrong-password')
            expect(response.text).not.toContain('<script>alert(1)</script>')
        })

        it('refuses a form without the right CSRF token', async () => {
            const { page } = await login('alice@example.com', {}, 'wrong-password')
            await http()
                .post(actionOf(page.text))
                .type('form')
                .send({ csrf: 'forged', email: 'alice@example.com', password: PASSWORD })
                .expect(400)
        })

        it('shows a page when the login link expired or does not exist', async () => {
            await http().get('/oidc/interaction/does-not-exist').expect(400)
        })
    })

    describe('code flow with PKCE', () => {
        it('logs in, sets a safe session cookie and sends a code back with state and iss', async () => {
            const { response } = await login('ALICE@example.com')
            expect(response.status).toBe(303)
            const location = new URL(response.headers.location as string)
            expect(location.origin + location.pathname).toBe(REDIRECT)
            expect(location.searchParams.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/)
            expect(location.searchParams.get('state')).toBe('state-123')
            expect(location.searchParams.get('iss')).toBe(ISSUER)
            const cookie = sessionCookie(response)
            expect(cookie).toContain('HttpOnly')
            expect(cookie).toContain('SameSite=Lax')
            expect(cookie).toContain('Path=/oidc')
        })

        it('exchanges the code for verified tokens with the tenant, and the code works only once', async () => {
            const { response, verifier } = await login('alice@example.com')
            const code = new URL(response.headers.location as string).searchParams.get('code') ?? ''
            const tokens = await exchange(code, verifier).expect(200)
            expect(tokens.headers['cache-control']).toBe('no-store')
            expect(tokens.body).toMatchObject({
                token_type: 'Bearer',
                expires_in: 600,
                scope: 'openid profile email tenant'
            })

            const id = await verifyToken(tokens.body.id_token, 'RS256', CLIENT, 'JWT')
            expect(id).toMatchObject({ sub: ids.alice, aud: CLIENT, nonce: 'nonce-456', acr: 'loa1', amr: ['pwd'] })
            expect(id.at_hash).toBe(halfHash(tokens.body.access_token))
            expect(id.tenant).toEqual({ id: ids.acme, name: 'Acme', roles: ['admin'] })

            const access = await verifyToken(tokens.body.access_token, 'ES256', AUDIENCE, 'at+jwt')
            expect(access).toMatchObject({ sub: ids.alice, client_id: CLIENT, scope: 'openid profile email tenant' })
            expect((access.exp as number) - (access.iat as number)).toBe(600)

            const again = await exchange(code, verifier).expect(400)
            expect(again.body.error).toBe('invalid_grant')
        })

        it('refuses a wrong code_verifier, a wrong redirect_uri and an unknown code', async () => {
            for (const [extra, verifierOk] of [
                [{}, false],
                [{ redirect_uri: 'http://localhost:4400/other' }, true]
            ] as const) {
                const { response, verifier } = await login('alice@example.com')
                const code = new URL(response.headers.location as string).searchParams.get('code') ?? ''
                const result = await exchange(code, verifierOk ? verifier : pkce().verifier, extra).expect(400)
                expect(result.body.error).toBe('invalid_grant')
            }
            expect((await exchange('unknown-code', pkce().verifier).expect(400)).body.error).toBe('invalid_grant')
        })

        it('refuses other grant types and unknown clients', async () => {
            const refresh = await http()
                .post('/oidc/token')
                .type('form')
                .send({ grant_type: 'refresh_token', client_id: CLIENT, refresh_token: 'x' })
            expect(refresh.status).toBe(400)
            expect(refresh.body.error).toBe('unsupported_grant_type')
            const unknown = await http()
                .post('/oidc/token')
                .type('form')
                .send({ grant_type: 'authorization_code', client_id: 'nope', code: 'x' })
            expect(unknown.status).toBe(401)
            expect(unknown.body.error).toBe('invalid_client')
        })

        it('authenticates confidential clients with client_secret_basic', async () => {
            const basic = (secret: string) => 'Basic ' + Buffer.from('server-app:' + secret).toString('base64')
            const wrong = await http()
                .post('/oidc/token')
                .set('Authorization', basic('wrong'))
                .type('form')
                .send({ grant_type: 'authorization_code', code: 'x' })
            expect(wrong.status).toBe(401)
            expect(wrong.headers['www-authenticate']).toContain('Basic')
            const right = await http()
                .post('/oidc/token')
                .set('Authorization', basic('a-very-long-client-secret-of-at-least-32-chars'))
                .type('form')
                .send({
                    grant_type: 'authorization_code',
                    code: 'unknown',
                    redirect_uri: 'https://app.example.com/callback',
                    code_verifier: pkce().verifier
                })
            expect(right.status).toBe(400)
            expect(right.body.error).toBe('invalid_grant')
        })

        it('a public client may not send a secret', async () => {
            const response = await exchange('x', pkce().verifier, { client_secret: 'guess' })
            expect(response.status).toBe(401)
        })
    })

    describe('single sign-on', () => {
        it('reuses the session: a second login needs no password', async () => {
            const { response } = await login('alice@example.com')
            const cookie = sessionCookie(response).split(';')[0] ?? ''
            const second = await authorize({ code_challenge: pkce().challenge }, cookie).expect(303)
            const location = new URL(second.headers.location as string)
            expect(location.origin + location.pathname).toBe(REDIRECT)
            expect(location.searchParams.get('code')).toBeTruthy()
            const silent = await authorize({ code_challenge: pkce().challenge, prompt: 'none' }, cookie).expect(303)
            expect(new URL(silent.headers.location as string).searchParams.get('code')).toBeTruthy()
        })

        it('asks for the password again with prompt=login or an old session (max_age)', async () => {
            const { response } = await login('alice@example.com')
            const cookie = sessionCookie(response).split(';')[0] ?? ''
            for (const extra of [{ prompt: 'login' }, { max_age: '0' }]) {
                await new Promise(resolve => setTimeout(resolve, 5))
                const again = await authorize({ code_challenge: pkce().challenge, ...extra }, cookie).expect(303)
                expect(path(again.headers.location as string)).toMatch(/^\/oidc\/interaction\//)
            }
        })

        it('ignores a forged session cookie', async () => {
            const response = await authorize({ code_challenge: pkce().challenge }, 'oidc_session=forged').expect(303)
            expect(path(response.headers.location as string)).toMatch(/^\/oidc\/interaction\//)
        })
    })

    describe('multi-tenant', () => {
        it('lets a member of several tenants choose, and puts that tenant in the tokens', async () => {
            const { response, verifier } = await login('bob@example.com')
            expect(response.status).toBe(200)
            expect(response.text).toContain('Acme')
            expect(response.text).toContain('Globex')
            const choice = await http()
                .post(actionOf(response.text))
                .type('form')
                .send({ csrf: csrfOf(response.text), tenant: ids.globex })
                .expect(303)
            const code = new URL(choice.headers.location as string).searchParams.get('code') ?? ''
            const tokens = await exchange(code, verifier).expect(200)
            expect(decodeUnverified(tokens.body.access_token)?.tenant).toEqual({
                id: ids.globex,
                name: 'Globex',
                roles: ['editor']
            })
        })

        it('never lets a user pick a tenant they do not belong to', async () => {
            const { response } = await login('bob@example.com')
            const other = store.addTenant('initech', 'Initech')
            const choice = await http()
                .post(actionOf(response.text))
                .type('form')
                .send({ csrf: csrfOf(response.text), tenant: other.id })
                .expect(200)
            expect(choice.headers.location).toBeUndefined()
        })

        it('uses tenant_hint (id or slug) to skip the choice', async () => {
            const { response, verifier } = await login('bob@example.com', { tenant_hint: 'acme' })
            expect(response.status).toBe(303)
            const code = new URL(response.headers.location as string).searchParams.get('code') ?? ''
            const tokens = await exchange(code, verifier).expect(200)
            expect(decodeUnverified(tokens.body.id_token)?.tenant).toMatchObject({ id: ids.acme })
        })

        it('refuses users without a tenant', async () => {
            const { response } = await login('carol@example.com')
            expect(response.status).toBe(403)
            expect(sessionCookie(response)).toBe('')
        })

        it('a suspended tenant can no longer be used', async () => {
            const tenant = store.addTenant('suspended-co', 'Suspended Co', 'suspended')
            store.addMember(tenant.id, ids.carol, [])
            const { response } = await login('carol@example.com')
            expect(response.status).toBe(403)
        })
    })

    describe('userinfo', () => {
        async function accessToken() {
            const { response, verifier } = await login('alice@example.com')
            const code = new URL(response.headers.location as string).searchParams.get('code') ?? ''
            return (await exchange(code, verifier).expect(200)).body.access_token as string
        }

        it('returns the claims of the scopes, with GET and POST', async () => {
            const token = await accessToken()
            const expected = {
                sub: ids.alice,
                name: 'Alice',
                email: 'alice@example.com',
                email_verified: true,
                tenant: { id: ids.acme, name: 'Acme', roles: ['admin'] }
            }
            expect(
                (
                    await http()
                        .get('/oidc/userinfo')
                        .set('Authorization', 'Bearer ' + token)
                        .expect(200)
                ).body
            ).toEqual(expected)
            expect(
                (await http().post('/oidc/userinfo').type('form').send({ access_token: token }).expect(200)).body
            ).toEqual(expected)
        })

        it('answers 401 with WWW-Authenticate without a token or with a forged one', async () => {
            const missing = await http().get('/oidc/userinfo').expect(401)
            expect(missing.headers['www-authenticate']).toBe('Bearer realm="oidc"')
            const token = await accessToken()
            const [header, payload] = token.split('.')
            const forged = header + '.' + payload + '.' + Buffer.alloc(64).toString('base64url')
            const response = await http()
                .get('/oidc/userinfo')
                .set('Authorization', 'Bearer ' + forged)
                .expect(401)
            expect(response.headers['www-authenticate']).toContain('error="invalid_token"')
            expect(response.body.error).toBe('invalid_token')
        })

        it('does not accept an ID token as access token', async () => {
            const { response, verifier } = await login('alice@example.com')
            const code = new URL(response.headers.location as string).searchParams.get('code') ?? ''
            const tokens = await exchange(code, verifier).expect(200)
            await http()
                .get('/oidc/userinfo')
                .set('Authorization', 'Bearer ' + tokens.body.id_token)
                .expect(401)
        })
    })

    describe('rate limit', () => {
        it('blocks too many login attempts with a translated page', async () => {
            process.env.OIDC_LOGIN_RATE_LIMIT = '2'
            app.get(LoginLimiter).clear()
            try {
                const attempts = []
                for (let i = 0; i < 3; i++)
                    attempts.push(await login('limited@example.com', { ui_locales: 'de' }, 'wrong-password'))
                expect(attempts.map(attempt => attempt.response.status)).toEqual([401, 401, 429])
                expect(attempts[2]?.response.text).toContain(MESSAGES.de?.TOO_MANY_ATTEMPTS)
            } finally {
                process.env.OIDC_LOGIN_RATE_LIMIT = '1000'
            }
        })
    })
})
