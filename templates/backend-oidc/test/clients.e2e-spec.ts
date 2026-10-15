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
    const audit = new MemoryAuditStore(store)
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
        tokens.root = (await login('root@example.com', FRONTEND, { tenant_hint: acme.id })).access_token
        tokens.alice = (await login('alice@example.com')).access_token
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
})
