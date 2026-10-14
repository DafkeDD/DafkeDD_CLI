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
process.env.APP_URL = 'http://localhost:3000'

const REDIRECT = 'http://localhost:3000/api/auth/callback'
const PASSWORD = 'correct-horse-battery'
const BROWSER = 'AuditTest/1.0 (e2e)'

interface Event {
    id: string
    action: string
    tenant: { id: string; name: string | null } | null
    actor: { id: string; name: string | null; email: string | null } | null
    target: { type: string; id: string; label: string | null } | null
    details: Record<string, unknown>
    ip: string | null
    userAgent: string | null
}

describe('Audit log (e2e)', () => {
    let app: INestApplication<App>
    const store = new MemoryOidcStore()
    const audit = new MemoryAuditStore(store)
    const http = () => request(app.getHttpServer())
    const ids = { acme: '', globex: '', alice: '', bob: '', carol: '', root: '' }
    const tokens = { alice: '', bob: '', carol: '', root: '' }

    beforeAll(async () => {
        const passwordHash = await hashPassword(PASSWORD)
        const acme = store.addTenant('acme', 'Acme')
        const globex = store.addTenant('globex', 'Globex')
        const alice = store.addUser({ email: 'alice@example.com', name: 'Alice', passwordHash })
        const bob = store.addUser({ email: 'bob@example.com', name: 'Bob', passwordHash })
        const carol = store.addUser({ email: 'carol@example.com', name: 'Carol', passwordHash })
        const root = store.addUser({ email: 'root@example.com', name: 'Root', passwordHash, isSuperadmin: true })
        store.addMembership(acme.id, alice.id, 'admin')
        store.addMembership(acme.id, bob.id, 'user')
        store.addMembership(globex.id, carol.id, 'admin')
        store.addMembership(globex.id, bob.id, 'user')
        Object.assign(ids, {
            acme: acme.id,
            globex: globex.id,
            alice: alice.id,
            bob: bob.id,
            carol: carol.id,
            root: root.id
        })

        const moduleRef = await Test.createTestingModule({ imports: [AppModule, OidcModule] })
            .overrideProvider(DatabaseService)
            .useValue({ ping: vi.fn().mockResolvedValue(true), query: vi.fn().mockResolvedValue({ rows: [] }) })
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
        tokens.alice = await accessToken('alice@example.com', 'acme')
        tokens.bob = await accessToken('bob@example.com', 'acme')
        tokens.carol = await accessToken('carol@example.com', 'globex')
        tokens.root = await accessToken('root@example.com', 'platform')
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

    /** The login form up to the code; returns where the browser goes after the password. */
    async function login(email: string, password: string, tenant: string) {
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
            .set('User-Agent', BROWSER)
            .type('form')
            .send({ csrf, email, password })
        return { done, verifier }
    }

    async function accessToken(email: string, tenant: string) {
        const { done, verifier } = await login(email, PASSWORD, tenant)
        expect(done.status).toBe(303)
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

    const read = async (path: string, token: string) =>
        (await http().get(path).set(bearer(token)).expect(200)).body as { events: Event[]; next: string | null }

    it('records logins: who, in which organisation, how, from which IP address and browser', async () => {
        const { events } = await read('/tenants/current/audit?category=login', tokens.alice)
        const mine = events.find(event => event.action === 'login.succeeded' && event.actor?.id === ids.alice)
        expect(mine).toMatchObject({
            tenant: { id: ids.acme, name: 'Acme' },
            actor: { name: 'Alice', email: 'alice@example.com' },
            target: { type: 'session' },
            details: { method: 'pwd', client: 'frontend' },
            userAgent: BROWSER
        })
        expect(mine?.ip).toBeTruthy()
        // Carol logged in to Globex: not in the log of Acme
        expect(events.some(event => event.actor?.id === ids.carol)).toBe(false)
    })

    it('records failed logins for superadmins and the account, never with the password', async () => {
        await login('alice@example.com', 'wrong-password-123', 'acme')
        await login('nobody@example.com', 'wrong-password-123', 'acme')
        const platform = await read('/admin/audit?tenant=platform&category=login', tokens.root)
        const failed = platform.events.filter(event => event.action === 'login.failed')
        expect(failed.map(event => event.details.reason)).toEqual(['unknown_email', 'wrong_password'])
        expect(failed[1]).toMatchObject({
            tenant: null,
            actor: null,
            target: { type: 'user', id: ids.alice, label: 'alice@example.com' },
            details: { method: 'password', email: 'alice@example.com' }
        })
        expect(JSON.stringify(platform.events)).not.toContain('wrong-password-123')
        // Alice sees the attempt on her own account; Bob does not
        const own = await read('/me/audit', tokens.alice)
        expect(own.events.some(event => event.action === 'login.failed')).toBe(true)
        const bob = await read('/me/audit', tokens.bob)
        expect(bob.events.some(event => event.action === 'login.failed')).toBe(false)
        // Not in the log of the organisation: it is not known which one was meant
        const acme = await read('/tenants/current/audit', tokens.alice)
        expect(acme.events.some(event => event.action === 'login.failed')).toBe(false)
    })

    it('only admins read the log of an organisation, only superadmins the platform', async () => {
        await http().get('/tenants/current/audit').set(bearer(tokens.bob)).expect(403)
        await http().get('/admin/audit').set(bearer(tokens.alice)).expect(403)
        await http().get('/tenants/current/audit').expect(401)
        await http().get('/me/audit').set(bearer(tokens.bob)).expect(200)
    })

    it('records what admins change, and every organisation only sees its own log', async () => {
        await http()
            .patch(`/tenants/current/members/${ids.bob}`)
            .set(bearer(tokens.alice))
            .set('User-Agent', BROWSER)
            // The frontend calls the API for the browser (from this computer): it tells the IP address of the user
            .set('X-Forwarded-For', '198.51.100.4')
            .send({ role: 'admin' })
            .expect(200)
        await http()
            .patch(`/tenants/current/members/${ids.bob}/status`)
            .set(bearer(tokens.carol))
            .send({ status: 'disabled' })
            .expect(200)
        const acme = await read('/tenants/current/audit?category=members', tokens.alice)
        expect(acme.events).toHaveLength(1)
        expect(acme.events[0]).toMatchObject({
            action: 'members.role_changed',
            tenant: { id: ids.acme },
            actor: { id: ids.alice },
            target: { type: 'user', id: ids.bob, label: 'bob@example.com' },
            details: { from: 'user', to: 'admin' },
            ip: '198.51.100.4',
            userAgent: BROWSER
        })
        const globex = await read('/tenants/current/audit?category=members', tokens.carol)
        expect(globex.events.map(event => event.action)).toEqual(['members.disabled'])
        // The superadmin sees both, or one organisation
        const all = await read('/admin/audit?category=members', tokens.root)
        expect(all.events.map(event => event.action).sort()).toEqual(['members.disabled', 'members.role_changed'])
        const one = await read(`/admin/audit?category=members&tenant=${ids.globex}`, tokens.root)
        expect(one.events.map(event => event.action)).toEqual(['members.disabled'])
    })

    it('pages from new to old', async () => {
        const first = await read('/tenants/current/audit?limit=1', tokens.alice)
        expect(first.events).toHaveLength(1)
        expect(first.next).toBe(first.events[0]?.id)
        const second = await read(`/tenants/current/audit?limit=1&before=${first.next}`, tokens.alice)
        expect(Number(second.events[0]?.id)).toBeLessThan(Number(first.events[0]?.id))
        const actor = await read(`/tenants/current/audit?actor=${ids.alice}`, tokens.alice)
        expect(actor.events.every(event => event.actor?.id === ids.alice)).toBe(true)
    })

    it('checks the filters', async () => {
        for (const query of ['category=everything', 'limit=500', 'limit=0', 'before=abc', 'actor=nobody', 'tenant=x'])
            await http()
                .get('/admin/audit?' + query)
                .set(bearer(tokens.root))
                .expect(400)
    })

    it('a superadmin who resets two-step verification is in the log of the platform', async () => {
        await http().delete(`/admin/users/${ids.carol}/mfa`).set(bearer(tokens.root)).expect(204)
        const { events } = await read('/admin/audit?tenant=platform&category=account', tokens.root)
        expect(events[0]).toMatchObject({
            action: 'account.mfa_reset',
            actor: { id: ids.root },
            target: { type: 'user', id: ids.carol }
        })
        // In the own log of the superadmin too: it did it
        const root = await read('/me/audit?category=account', tokens.root)
        expect(root.events.some(event => event.target?.id === ids.carol)).toBe(true)
    })
})
