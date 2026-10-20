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
import { DatabaseService } from '../src/database/database.service.js'
import type { Mail } from '../src/mail/mail.service.js'
import { MailService } from '../src/mail/mail.service.js'
import { pkceChallenge } from '../src/oidc/crypto.js'
import { decodeUnverified } from '../src/oidc/jose.js'
import { LoginLimiter } from '../src/oidc/login-limiter.js'
import { hashPassword } from '../src/oidc/password.js'
import { MemoryOidcStore } from '../src/oidc/store/memory-oidc.store.js'
import { OIDC_STORE } from '../src/oidc/store/oidc.store.js'
import { base32Decode, hotp, totpStep } from '../src/oidc/totp.js'
import { configureApp } from '../src/setup.js'

process.env.OIDC_MASTER_KEY ??= randomBytes(32).toString('hex')
process.env.OIDC_LOGIN_RATE_LIMIT = '1000'
process.env.OIDC_LOGIN_UI_URL = ''
process.env.OIDC_REGISTRATION = 'open'
// Two-step verification is required by default; the tests that are not about it switch it off
process.env.OIDC_MFA = 'optional'
process.env.APP_URL = 'http://localhost:3000'

const REDIRECT = 'http://localhost:3000/api/auth/callback'
const PASSWORD = 'correct-horse-battery'

/** Texts of the API and of the emails in every language (src/i18n/<language>/oidc.json and mail.json). */
const MESSAGES: Record<string, Record<string, string>> = __OIDC_MESSAGES__
const MAIL: Record<string, Record<string, string>> = __MAIL_MESSAGES__

/** The fixed part of a text with {placeholders}: what every filled-in version contains. */
const fixed = (text = '') => text.split('{')[0] ?? ''

describe('Accounts, roles and the platform (e2e)', () => {
    let app: INestApplication<App>
    const store = new MemoryOidcStore()
    const outbox: Mail[] = []
    const http = () => request(app.getHttpServer())
    const ids = { acme: '', globex: '', alice: '', bob: '', root: '' }

    beforeAll(async () => {
        const passwordHash = await hashPassword(PASSWORD)
        const acme = store.addTenant('acme', 'Acme')
        const globex = store.addTenant('globex', 'Globex')
        const alice = store.addUser({ email: 'alice@example.com', name: 'Alice', passwordHash })
        const bob = store.addUser({ email: 'bob@example.com', name: 'Bob', passwordHash })
        const root = store.addUser({ email: 'root@example.com', name: 'Root', passwordHash, isSuperadmin: true })
        store.addMembership(acme.id, alice.id, 'admin')
        store.addMembership(acme.id, bob.id, 'user')
        Object.assign(ids, { acme: acme.id, globex: globex.id, alice: alice.id, bob: bob.id, root: root.id })

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

    /** The last mail to an address, and the token of its link. */
    function mailTo(email: string) {
        const mail = outbox.filter(item => item.to === email).at(-1)
        const link = /(http:\/\/localhost:3000\/[a-z-]+\?token=[^\s]+)/.exec(mail?.text ?? '')?.[1] ?? ''
        return { mail, link, token: link ? (new URL(link).searchParams.get('token') ?? '') : '' }
    }

    /** Logs in through the HTML login page; returns the last response (303 with a code, or the page with an error). */
    async function login(email: string, password = PASSWORD, extra: Record<string, string> = {}) {
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
            .expect(303)
        const location = new URL(start.headers.location as string)
        const cookie = ((start.headers['set-cookie'] as unknown as string[]) ?? [])[0]?.split(';')[0] ?? ''
        const page = await http()
            .get(location.pathname + location.search)
            .set('Cookie', cookie)
        const csrf = /name="csrf" value="([^"]+)"/.exec(page.text)?.[1] ?? ''
        const response = await http()
            .post(location.pathname + '/login')
            .set('Cookie', cookie)
            .type('form')
            .send({ csrf, email, password })
        return { response, verifier }
    }

    /** An access token for a user (in the tenant of tenant_hint when the user has several). */
    async function accessToken(email: string, tenant?: string) {
        const { response, verifier } = await login(email, PASSWORD, tenant ? { tenant_hint: tenant } : {})
        expect(response.status).toBe(303)
        const code = new URL(response.headers.location as string).searchParams.get('code') ?? ''
        const tokens = await http()
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
        return tokens.body as { access_token: string; id_token: string }
    }

    const bearer = (token: string) => ({ Authorization: 'Bearer ' + token })

    // ---------------------------------------------------------------- registration and email verification

    describe('registration', () => {
        it('creates an account and an organisation, and sends a translated verification mail', async () => {
            const response = await http()
                .post('/oidc/account/register')
                .set('Accept-Language', 'nl')
                .send({ name: 'Dora', email: 'Dora@Example.com', password: PASSWORD, organisation: 'Initech Labs' })
                .expect(202)
            expect(response.body).toEqual({ status: 'check-email' })
            const { mail, link } = mailTo('dora@example.com')
            expect(mail?.subject).toContain(fixed(MAIL.nl?.VERIFY_SUBJECT))
            expect(mail?.text).toContain(MAIL.nl?.VERIFY_TEXT)
            expect(link.startsWith('http://localhost:3000/verify-email?token=')).toBe(true)
            const user = await store.findUserByEmail('dora@example.com')
            expect(user).toMatchObject({ emailVerified: false, isSuperadmin: false, locale: 'nl' })
            expect(await store.listMemberships(user?.id ?? '')).toEqual([
                expect.objectContaining({ name: 'Initech Labs', slug: 'initech-labs', role: 'admin' })
            ])
        })

        it('refuses to log in before the email address is verified (only after the right password)', async () => {
            const wrong = await login('dora@example.com', 'wrong-password-123')
            expect(wrong.response.status).toBe(401)
            const { response } = await login('dora@example.com')
            expect(response.status).toBe(403)
            expect(response.text).toContain(MESSAGES.en?.EMAIL_NOT_VERIFIED)
        })

        it('verifies the email address with the link, then the account can log in as admin of its organisation', async () => {
            await http().post('/oidc/account/resend-verification').send({ email: 'dora@example.com' }).expect(202)
            const { token } = mailTo('dora@example.com')
            const verified = await http().post('/oidc/account/verify-email').send({ token }).expect(200)
            expect(verified.body).toEqual({ status: 'verified', email: 'dora@example.com' })
            const tokens = await accessToken('dora@example.com')
            expect(decodeUnverified(tokens.access_token)?.tenant).toMatchObject({ name: 'Initech Labs', role: 'admin' })
            expect(decodeUnverified(tokens.access_token)?.superadmin).toBeUndefined()
        })

        it('answers the same for an address that has an account, and mails its owner instead', async () => {
            const response = await http()
                .post('/oidc/account/register')
                .send({ name: 'Mallory', email: 'alice@example.com', password: PASSWORD, organisation: 'Evil' })
                .expect(202)
            expect(response.body).toEqual({ status: 'check-email' })
            const { mail, link } = mailTo('alice@example.com')
            expect(mail?.subject).toContain(fixed(MAIL.en?.EXISTS_SUBJECT))
            expect(link).toBe('')
            expect(mail?.text).toContain('http://localhost:3000/forgot-password')
            expect((await store.listTenants()).some(tenant => tenant.name === 'Evil')).toBe(false)
        })

        it('does not send a verification mail to a verified account', async () => {
            await http().post('/oidc/account/resend-verification').send({ email: 'alice@example.com' }).expect(202)
            expect(outbox).toHaveLength(0)
        })

        it('refuses invalid input, an invalid link, and registration when it is closed', async () => {
            await http()
                .post('/oidc/account/register')
                .send({ name: 'X', email: 'not-an-email', password: 'short', organisation: '' })
                .expect(400)
            const invalid = await http()
                .post('/oidc/account/verify-email')
                .set('Accept-Language', 'fr')
                .send({ token: 'v1.forged.token.value' })
                .expect(400)
            expect(invalid.body).toMatchObject({ error: 'oidc.INVALID_LINK', message: MESSAGES.fr?.INVALID_LINK })
            process.env.OIDC_REGISTRATION = 'closed'
            try {
                const closed = await http()
                    .post('/oidc/account/register')
                    .send({ name: 'Eve', email: 'eve@example.com', password: PASSWORD, organisation: 'Eve Co' })
                    .expect(403)
                expect(closed.body.error).toBe('oidc.REGISTRATION_CLOSED')
            } finally {
                process.env.OIDC_REGISTRATION = 'open'
            }
        })

        it('is rate limited', async () => {
            process.env.OIDC_LOGIN_RATE_LIMIT = '2'
            try {
                const statuses = []
                for (let i = 0; i < 3; i++)
                    statuses.push(
                        (await http().post('/oidc/account/forgot-password').send({ email: 'x@example.com' })).status
                    )
                expect(statuses).toEqual([202, 202, 429])
            } finally {
                process.env.OIDC_LOGIN_RATE_LIMIT = '1000'
            }
        })
    })

    // ---------------------------------------------------------------- forgotten password

    describe('forgotten password', () => {
        it('sends nothing for an unknown address, but answers the same', async () => {
            const response = await http()
                .post('/oidc/account/forgot-password')
                .send({ email: 'nobody@example.com' })
                .expect(202)
            expect(response.body).toEqual({ status: 'check-email' })
            expect(outbox).toHaveLength(0)
        })

        it('sets a new password once with the link, and ends the sessions of the account', async () => {
            const user = store.addUser({
                email: 'erin@example.com',
                name: 'Erin',
                passwordHash: await hashPassword(PASSWORD)
            })
            store.addMembership(ids.globex, user.id, 'user')
            const before = await login('erin@example.com')
            const session = ((before.response.headers['set-cookie'] as unknown as string[]) ?? []).find(c =>
                c.startsWith('oidc_session=')
            )
            expect(session).toBeTruthy()

            await http()
                .post('/oidc/account/forgot-password')
                .set('Accept-Language', 'de')
                .send({ email: 'erin@example.com' })
                .expect(202)
            const { mail, token, link } = mailTo('erin@example.com')
            expect(mail?.subject).toContain(fixed(MAIL.de?.RESET_SUBJECT))
            expect(link.startsWith('http://localhost:3000/reset-password?token=')).toBe(true)

            await http()
                .post('/oidc/account/reset-password')
                .send({ token, password: 'a-new-long-password' })
                .expect(200)
            await http()
                .post('/oidc/account/reset-password')
                .send({ token, password: 'yet-another-password' })
                .expect(400)
            expect((await login('erin@example.com')).response.status).toBe(401)
            expect((await login('erin@example.com', 'a-new-long-password')).response.status).toBe(303)

            // The old browser session no longer logs in without a password
            const silent = await http()
                .get(
                    '/oidc/authorize?' +
                        new URLSearchParams({
                            client_id: 'frontend',
                            redirect_uri: REDIRECT,
                            response_type: 'code',
                            scope: 'openid',
                            code_challenge: pkceChallenge(randomBytes(32).toString('base64url')),
                            code_challenge_method: 'S256',
                            prompt: 'none'
                        }).toString()
                )
                .set('Cookie', session?.split(';')[0] ?? '')
                .expect(303)
            expect(new URL(silent.headers.location as string).searchParams.get('error')).toBe('login_required')
        })
    })

    // ---------------------------------------------------------------- members and roles

    describe('members of the own tenant', () => {
        it('needs an access token and the admin role', async () => {
            await http().get('/tenants/current/members').expect(401)
            await http().get('/tenants/current/members').set(bearer('forged.token.value')).expect(401)
            const bob = await accessToken('bob@example.com')
            const forbidden = await http()
                .get('/tenants/current/members')
                .set(bearer(bob.access_token))
                .set('Accept-Language', 'nl')
                .expect(403)
            expect(forbidden.body.error).toBe('errors.FORBIDDEN')
        })

        it('lists the members with role, status and who is online for an admin', async () => {
            const alice = await accessToken('alice@example.com')
            const response = await http().get('/tenants/current/members').set(bearer(alice.access_token)).expect(200)
            expect(response.body).toEqual([
                expect.objectContaining({
                    userId: ids.alice,
                    name: 'Alice',
                    email: 'alice@example.com',
                    role: 'admin',
                    status: 'active',
                    online: true
                }),
                expect.objectContaining({
                    userId: ids.bob,
                    name: 'Bob',
                    email: 'bob@example.com',
                    role: 'user',
                    status: 'active'
                })
            ])
            expect(new Date(response.body[0].lastSeenAt as string).getTime()).toBeGreaterThan(Date.now() - 60_000)
            // A member who was active more than two minutes ago is no longer online
            const bob = store.members.find(member => member.userId === ids.bob && member.tenantId === ids.acme)
            if (bob) bob.lastSeenAt = new Date(Date.now() - 3 * 60_000)
            const later = await http().get('/tenants/current/members').set(bearer(alice.access_token)).expect(200)
            expect(later.body[1]).toMatchObject({ userId: ids.bob, online: false })
            await http().post('/me/heartbeat').set(bearer(alice.access_token)).expect(204)
            await http().post('/me/heartbeat').expect(401)
        })

        it('disables a member at once (no API, no login, sessions end) and enables it again', async () => {
            const tenant = store.addTenant('trio', 'Trio')
            const boss = store.addUser({
                email: 'boss@trio.com',
                name: 'Boss',
                passwordHash: await hashPassword(PASSWORD)
            })
            const worker = store.addUser({
                email: 'worker@trio.com',
                name: 'Worker',
                passwordHash: await hashPassword(PASSWORD)
            })
            store.addMembership(tenant.id, boss.id, 'admin')
            store.addMembership(tenant.id, worker.id, 'admin')
            const bossToken = (await accessToken('boss@trio.com')).access_token
            const workerToken = (await accessToken('worker@trio.com')).access_token
            const status = (id: string) => '/tenants/current/members/' + id + '/status'

            await http().patch(status(worker.id)).set(bearer(bossToken)).send({ status: 'disabled' }).expect(200)
            // Same token, but disabled: its session ended, so no access any more, and no login to this tenant
            await http().get('/tenants/current/members').set(bearer(workerToken)).expect(401)
            expect((await login('worker@trio.com')).response.status).toBe(403)
            const listed = await http().get('/tenants/current/members').set(bearer(bossToken)).expect(200)
            expect(listed.body).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ userId: worker.id, status: 'disabled', online: false })
                ])
            )
            // The last active admin cannot disable itself
            const last = await http()
                .patch(status(boss.id))
                .set(bearer(bossToken))
                .send({ status: 'disabled' })
                .expect(409)
            expect(last.body.error).toBe('oidc.LAST_ADMIN')
            await http().patch(status(worker.id)).set(bearer(bossToken)).send({ status: 'paused' }).expect(400)

            await http().patch(status(worker.id)).set(bearer(bossToken)).send({ status: 'active' }).expect(200)
            expect((await login('worker@trio.com')).response.status).toBe(303)
        })

        it('shows open invitations, sends them again and withdraws them', async () => {
            const alice = (await accessToken('alice@example.com')).access_token
            const invited = await http()
                .post('/tenants/current/invitations')
                .set(bearer(alice))
                .send({ email: 'Jane@Example.com', role: 'admin' })
                .expect(202)
            const id = invited.body.id as string
            const list = await http().get('/tenants/current/invitations').set(bearer(alice)).expect(200)
            expect(list.body[0]).toMatchObject({ id, email: 'jane@example.com', role: 'admin', invitedByName: 'Alice' })
            const first = mailTo('jane@example.com').token

            await http().post(`/tenants/current/invitations/${id}/resend`).set(bearer(alice)).expect(202)
            expect(outbox.filter(mail => mail.to === 'jane@example.com')).toHaveLength(2)
            const second = mailTo('jane@example.com').token
            expect(second).not.toBe(first)
            await http().get('/oidc/account/invitation').query({ token: second }).expect(200)

            await http().delete(`/tenants/current/invitations/${id}`).set(bearer(alice)).expect(204)
            // Withdrawn: both links stop working
            for (const token of [first, second])
                await http().get('/oidc/account/invitation').query({ token }).expect(400)
            expect((await http().get('/tenants/current/invitations').set(bearer(alice)).expect(200)).body).toEqual([])
            const gone = await http().post(`/tenants/current/invitations/${id}/resend`).set(bearer(alice)).expect(404)
            expect(gone.body.error).toBe('oidc.INVITATION_NOT_FOUND')
            await http().delete(`/tenants/current/invitations/${id}`).set(bearer(alice)).expect(404)
        })

        it('invites someone new: the link creates a verified account in the tenant', async () => {
            const alice = await accessToken('alice@example.com')
            await http()
                .post('/tenants/current/invitations')
                .set(bearer(alice.access_token))
                .send({ email: 'frank@example.com', role: 'user' })
                .expect(202)
            const { mail, token, link } = mailTo('frank@example.com')
            expect(mail?.subject).toContain('Alice')
            expect(mail?.subject).toContain('Acme')
            expect(link.startsWith('http://localhost:3000/invite?token=')).toBe(true)

            const details = await http().get('/oidc/account/invitation').query({ token }).expect(200)
            expect(details.body).toEqual({
                email: 'frank@example.com',
                tenantName: 'Acme',
                role: 'user',
                inviterName: 'Alice',
                accountExists: false,
                apps: []
            })
            const missing = await http().post('/oidc/account/invitation/accept').send({ token }).expect(400)
            expect(missing.body.error).toBe('oidc.ACCOUNT_DETAILS_NEEDED')
            const accepted = await http()
                .post('/oidc/account/invitation/accept')
                .send({ token, name: 'Frank', password: PASSWORD })
                .expect(200)
            expect(accepted.body).toEqual({ status: 'accepted', tenantName: 'Acme', accountExists: false, apps: [] })
            const frank = await accessToken('frank@example.com')
            expect(decodeUnverified(frank.access_token)?.tenant).toMatchObject({ id: ids.acme, role: 'user' })
            // Accepted: no longer open, and the link works only once
            const open = await http().get('/tenants/current/invitations').set(bearer(alice.access_token)).expect(200)
            expect((open.body as { email: string }[]).some(item => item.email === 'frank@example.com')).toBe(false)
            await http().get('/oidc/account/invitation').query({ token }).expect(400)
        })

        it('invites an existing account, which joins without a new password; members cannot be invited twice', async () => {
            const alice = await accessToken('alice@example.com')
            await http()
                .post('/tenants/current/invitations')
                .set(bearer(alice.access_token))
                .send({ email: 'erin@example.com', role: 'admin' })
                .expect(202)
            const { token } = mailTo('erin@example.com')
            const accepted = await http().post('/oidc/account/invitation/accept').send({ token }).expect(200)
            expect(accepted.body.accountExists).toBe(true)
            expect(
                await store.findMemberRole(ids.acme, (await store.findUserByEmail('erin@example.com'))?.id ?? '')
            ).toBe('admin')
            const twice = await http()
                .post('/tenants/current/invitations')
                .set(bearer(alice.access_token))
                .send({ email: 'bob@example.com', role: 'user' })
                .expect(409)
            expect(twice.body.error).toBe('oidc.ALREADY_MEMBER')
        })

        it('changes roles, never removes the last admin, and a role taken away works at once', async () => {
            const tenant = store.addTenant('solo', 'Solo')
            const owner = store.addUser({
                email: 'owner@example.com',
                name: 'Owner',
                passwordHash: await hashPassword(PASSWORD)
            })
            const helper = store.addUser({
                email: 'helper@example.com',
                name: 'Helper',
                passwordHash: await hashPassword(PASSWORD)
            })
            store.addMembership(tenant.id, owner.id, 'admin')
            store.addMembership(tenant.id, helper.id, 'user')
            const token = (await accessToken('owner@example.com')).access_token
            const members = (path = '') => '/tenants/current/members' + path

            const last = await http()
                .patch(members('/' + owner.id))
                .set(bearer(token))
                .send({ role: 'user' })
                .expect(409)
            expect(last.body.error).toBe('oidc.LAST_ADMIN')
            await http()
                .delete(members('/' + owner.id))
                .set(bearer(token))
                .expect(409)
            await http()
                .patch(members('/' + helper.id))
                .set(bearer(token))
                .send({ role: 'boss' })
                .expect(400)
            await http()
                .patch(members('/' + randomUUIDLike()))
                .set(bearer(token))
                .send({ role: 'user' })
                .expect(404)

            await http()
                .patch(members('/' + helper.id))
                .set(bearer(token))
                .send({ role: 'admin' })
                .expect(200)
            const helperToken = (await accessToken('helper@example.com')).access_token
            await http().get(members()).set(bearer(helperToken)).expect(200)
            await http()
                .patch(members('/' + helper.id))
                .set(bearer(token))
                .send({ role: 'user' })
                .expect(200)
            // Same token, but the role in the database changed: no access any more
            await http().get(members()).set(bearer(helperToken)).expect(403)

            await http()
                .delete(members('/' + helper.id))
                .set(bearer(token))
                .expect(204)
            expect(await store.findMemberRole(tenant.id, helper.id)).toBeNull()
        })

        it('an invitation stops working when the inviter is no longer admin', async () => {
            const tenant = store.addTenant('duo', 'Duo')
            const a = store.addUser({ email: 'a@duo.com', name: 'A', passwordHash: await hashPassword(PASSWORD) })
            const b = store.addUser({ email: 'b@duo.com', name: 'B', passwordHash: await hashPassword(PASSWORD) })
            store.addMembership(tenant.id, a.id, 'admin')
            store.addMembership(tenant.id, b.id, 'admin')
            const token = (await accessToken('b@duo.com')).access_token
            await http()
                .post('/tenants/current/invitations')
                .set(bearer(token))
                .send({ email: 'guest@duo.com', role: 'user' })
                .expect(202)
            const invitation = mailTo('guest@duo.com').token
            await store.setMemberRole(tenant.id, b.id, 'user')
            await http().get('/oidc/account/invitation').query({ token: invitation }).expect(400)
        })
    })

    // ---------------------------------------------------------------- superadmin

    describe('superadmin', () => {
        it('can log in to every active tenant as admin, and the tokens say superadmin', async () => {
            const { response } = await login('root@example.com')
            expect(response.status).toBe(200)
            for (const name of ['Acme', 'Globex', 'Initech Labs']) expect(response.text).toContain(name)
            expect(response.text).toContain('value="platform"')
            const tokens = await accessToken('root@example.com', 'globex')
            const claims = decodeUnverified(tokens.access_token)
            expect(claims?.tenant).toMatchObject({ id: ids.globex, role: 'admin' })
            expect(claims?.superadmin).toBe(true)
            expect(decodeUnverified(tokens.id_token)?.superadmin).toBe(true)
            await http().get('/tenants/current/members').set(bearer(tokens.access_token)).expect(200)
        })

        it('manages tenants: list, create with an invited admin, suspend', async () => {
            const root = (await accessToken('root@example.com', 'acme')).access_token
            const alice = (await accessToken('alice@example.com')).access_token
            await http().get('/admin/tenants').set(bearer(alice)).expect(403)

            const list = await http().get('/admin/tenants').set(bearer(root)).expect(200)
            expect(list.body).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: ids.acme, name: 'Acme', status: 'active', members: 4 })
                ])
            )
            const created = await http()
                .post('/admin/tenants')
                .set(bearer(root))
                .send({ name: 'Umbrella Corp', adminEmail: 'boss@umbrella.com' })
                .expect(201)
            expect(created.body.tenant).toMatchObject({
                name: 'Umbrella Corp',
                slug: 'umbrella-corp',
                status: 'active'
            })
            expect(created.body.invited).toBe('boss@umbrella.com')
            const { token } = mailTo('boss@umbrella.com')
            await http()
                .post('/oidc/account/invitation/accept')
                .send({ token, name: 'Boss', password: PASSWORD })
                .expect(200)
            expect((await accessToken('boss@umbrella.com')).access_token).toBeTruthy()

            await http()
                .patch('/admin/tenants/' + created.body.tenant.id)
                .set(bearer(root))
                .send({ status: 'suspended' })
                .expect(200)
            const blocked = await login('boss@umbrella.com')
            expect(blocked.response.status).toBe(403)
            await http()
                .patch('/admin/tenants/' + randomUUIDLike())
                .set(bearer(root))
                .send({ status: 'active' })
                .expect(404)
        })

        it('logs in without an organisation (platform): only the platform and the own account, no tenant API', async () => {
            const tokens = await accessToken('root@example.com', 'platform')
            const claims = decodeUnverified(tokens.access_token)
            expect(claims?.tenant).toBeUndefined()
            expect(claims?.superadmin).toBe(true)
            expect(decodeUnverified(tokens.id_token)?.tenant).toBeUndefined()
            await http().get('/admin/tenants').set(bearer(tokens.access_token)).expect(200)
            await http().get('/me/mfa').set(bearer(tokens.access_token)).expect(200)
            await http().get('/tenants/current/members').set(bearer(tokens.access_token)).expect(403)
            // A normal member cannot ask for the platform: it gets its own organisation
            const alice = await accessToken('alice@example.com', 'platform')
            expect(decodeUnverified(alice.access_token)?.tenant).toMatchObject({ id: ids.acme })
        })

        it('switches organisation with the same session: no new password or code (tenant_hint)', async () => {
            const { response } = await login('root@example.com', PASSWORD, { tenant_hint: 'platform' })
            const session =
                ((response.headers['set-cookie'] as unknown as string[]) ?? [])
                    .find(c => c.startsWith('oidc_session='))
                    ?.split(';')[0] ?? ''
            const silent = async (hint: string) => {
                const verifier = randomBytes(32).toString('base64url')
                const answer = await http()
                    .get(
                        '/oidc/authorize?' +
                            new URLSearchParams({
                                client_id: 'frontend',
                                redirect_uri: REDIRECT,
                                response_type: 'code',
                                scope: 'openid tenant',
                                code_challenge: pkceChallenge(verifier),
                                code_challenge_method: 'S256',
                                prompt: 'none',
                                tenant_hint: hint
                            }).toString()
                    )
                    .set('Cookie', session)
                    .expect(303)
                const code = new URL(answer.headers.location as string).searchParams.get('code') ?? ''
                const tokens = await http()
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
                return decodeUnverified(tokens.body.access_token as string)
            }
            expect((await silent('globex'))?.tenant).toMatchObject({ id: ids.globex, role: 'admin' })
            expect((await silent('acme'))?.tenant).toMatchObject({ id: ids.acme })
            expect((await silent('platform'))?.tenant).toBeUndefined()
        })

        it('a new server: the superadmin needs no organisation and logs in straight to the platform', async () => {
            const empty = new MemoryOidcStore()
            empty.addUser({
                email: 'first@example.com',
                name: 'First',
                passwordHash: await hashPassword(PASSWORD),
                isSuperadmin: true
            })
            const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
                .overrideProvider(DatabaseService)
                .useValue({ ping: vi.fn().mockResolvedValue(true), query: vi.fn().mockResolvedValue({ rows: [] }) })
                .overrideProvider(OIDC_STORE)
                .useValue(empty)
                .overrideProvider(BILLING_STORE)
                .useValue(new MemoryBillingStore())
                .overrideProvider(AUDIT_STORE)
                .useValue(new MemoryAuditStore())
                .overrideProvider(MailService)
                .useValue({ send: async () => true })
                .compile()
            const fresh = moduleRef.createNestApplication()
            configureApp(fresh)
            await fresh.init()
            try {
                const client = () => request(fresh.getHttpServer())
                const verifier = randomBytes(32).toString('base64url')
                const start = await client()
                    .get(
                        '/oidc/authorize?' +
                            new URLSearchParams({
                                client_id: 'frontend',
                                redirect_uri: REDIRECT,
                                response_type: 'code',
                                scope: 'openid profile email tenant',
                                code_challenge: pkceChallenge(verifier),
                                code_challenge_method: 'S256'
                            }).toString()
                    )
                    .expect(303)
                const location = new URL(start.headers.location as string)
                const cookie = ((start.headers['set-cookie'] as unknown as string[]) ?? [])[0]?.split(';')[0] ?? ''
                const page = await client().get(location.pathname).set('Cookie', cookie).expect(200)
                const csrf = /name="csrf" value="([^"]+)"/.exec(page.text)?.[1] ?? ''
                const done = await client()
                    .post(location.pathname + '/login')
                    .set('Cookie', cookie)
                    .type('form')
                    .send({ csrf, email: 'first@example.com', password: PASSWORD })
                    .expect(303)
                const code = new URL(done.headers.location as string).searchParams.get('code') ?? ''
                const tokens = await client()
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
                const token = tokens.body.access_token as string
                expect(decodeUnverified(token)?.tenant).toBeUndefined()
                // Creates the first organisation on the platform
                await client().get('/admin/tenants').set(bearer(token)).expect(200)
                const created = await client()
                    .post('/admin/tenants')
                    .set(bearer(token))
                    .send({ name: 'First Co' })
                    .expect(201)
                expect(created.body.tenant).toMatchObject({ name: 'First Co' })
            } finally {
                await fresh.close()
            }
        })

        it('grants and revokes superadmin, but never the last one', async () => {
            const root = (await accessToken('root@example.com', 'acme')).access_token
            const granted = await http()
                .post('/admin/superadmins')
                .set(bearer(root))
                .send({ email: 'bob@example.com' })
                .expect(200)
            expect(granted.body).toEqual({ userId: ids.bob, name: 'Bob', email: 'bob@example.com' })
            const list = await http().get('/admin/superadmins').set(bearer(root)).expect(200)
            expect((list.body as { email: string }[]).map(user => user.email).sort()).toEqual([
                'bob@example.com',
                'root@example.com'
            ])
            await http()
                .delete('/admin/superadmins/' + ids.bob)
                .set(bearer(root))
                .expect(204)
            const last = await http()
                .delete('/admin/superadmins/' + ids.root)
                .set(bearer(root))
                .expect(409)
            expect(last.body.error).toBe('oidc.LAST_SUPERADMIN')
            await http().post('/admin/superadmins').set(bearer(root)).send({ email: 'nobody@example.com' }).expect(404)
        })
    })

    // ---------------------------------------------------------------- two-step verification (TOTP)

    describe('two-step verification', () => {
        const code = (secret: string, offset = 0) => hotp(base32Decode(secret), totpStep() + offset)
        const setCookie = (response: request.Response) =>
            ((response.headers['set-cookie'] as unknown as string[]) ?? [])
                .find(c => c.startsWith('oidc_ia_'))
                ?.split(';')[0] ?? ''

        /** Password step: returns the second-factor page, its form action and the login cookie for it. */
        async function passwordStep(email: string) {
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
            const location = new URL(start.headers.location as string)
            const first = setCookie(start)
            const page = await http().get(location.pathname).set('Cookie', first)
            const csrf = /name="csrf" value="([^"]+)"/.exec(page.text)?.[1] ?? ''
            const response = await http()
                .post(location.pathname + '/login')
                .set('Cookie', first)
                .type('form')
                .send({ csrf, email, password: PASSWORD })
            return { response, csrf, verifier, cookie: setCookie(response) || first, base: location.pathname }
        }

        const secondStep = (step: { base: string; cookie: string; csrf: string }, value: string) =>
            http()
                .post(step.base + '/mfa')
                .set('Cookie', step.cookie)
                .type('form')
                .send({ csrf: step.csrf, code: value })

        let secret = ''
        let recovery: string[] = []

        it('sets up with a QR code, and turns on only after a correct code', async () => {
            const user = store.addUser({
                email: 'gina@example.com',
                name: 'Gina',
                passwordHash: await hashPassword(PASSWORD)
            })
            store.addMembership(ids.acme, user.id, 'user')
            const token = (await accessToken('gina@example.com')).access_token
            expect((await http().get('/me/mfa').set(bearer(token)).expect(200)).body).toEqual({
                enabled: false,
                recoveryCodesLeft: 0
            })
            const early = await http().post('/me/mfa/enable').set(bearer(token)).send({ code: '123456' }).expect(400)
            expect(early.body.error).toBe('oidc.MFA_SETUP_FIRST')

            const setup = await http().post('/me/mfa/setup').set(bearer(token)).expect(200)
            secret = setup.body.secret as string
            expect(secret).toMatch(/^[A-Z2-7]{32}$/)
            expect(setup.body.qrSvg).toMatch(/^<svg[\s\S]*<\/svg>\s*$/)
            const url = new URL(setup.body.otpauthUrl as string)
            expect(url.searchParams.get('secret')).toBe(secret)
            expect(decodeURIComponent(url.pathname)).toContain('gina@example.com')

            const wrong = await http().post('/me/mfa/enable').set(bearer(token)).send({ code: '000000' }).expect(400)
            expect(wrong.body.error).toBe('oidc.MFA_INVALID_CODE')
            const enabled = await http()
                .post('/me/mfa/enable')
                .set(bearer(token))
                .send({ code: code(secret) })
                .expect(200)
            recovery = enabled.body.recoveryCodes as string[]
            expect(recovery).toHaveLength(10)
            expect((await http().get('/me/mfa').set(bearer(token)).expect(200)).body).toEqual({
                enabled: true,
                recoveryCodesLeft: 10
            })
            await http().post('/me/mfa/setup').set(bearer(token)).expect(409)
        })

        it('asks the code after the password; a used, wrong or skipped code does not log in', async () => {
            const step = await passwordStep('gina@example.com')
            expect(step.response.status).toBe(200)
            expect(step.response.text).toContain(MESSAGES.en?.MFA_TITLE)
            expect(step.response.text).toContain('autocomplete="one-time-code"')
            // The organisation step cannot be skipped to
            await http()
                .post(step.base + '/tenant')
                .set('Cookie', step.cookie)
                .type('form')
                .send({ csrf: step.csrf, tenant: ids.acme })
                .expect(400)
            // The code of the setup was used already
            const reused = await secondStep(step, code(secret))
            expect(reused.status).toBe(401)
            expect(reused.text).toContain(MESSAGES.en?.MFA_INVALID_CODE)
            expect((await secondStep(step, '000000')).status).toBe(401)

            const done = await secondStep(step, code(secret, 1))
            expect(done.status).toBe(303)
            const location = new URL(done.headers.location as string)
            const tokens = await http()
                .post('/oidc/token')
                .type('form')
                .send({
                    grant_type: 'authorization_code',
                    code: location.searchParams.get('code') ?? '',
                    redirect_uri: REDIRECT,
                    client_id: 'frontend',
                    code_verifier: step.verifier
                })
                .expect(200)
            const id = decodeUnverified(tokens.body.id_token as string)
            expect(id?.acr).toBe('loa2')
            expect(id?.amr).toEqual(['pwd', 'otp', 'mfa'])
        })

        it('logs in once with each recovery code, makes new ones, and turns off with a code', async () => {
            const first = await passwordStep('gina@example.com')
            expect((await secondStep(first, recovery[0] ?? '')).status).toBe(303)
            const second = await passwordStep('gina@example.com')
            expect((await secondStep(second, recovery[0] ?? '')).status).toBe(401)
            expect((await secondStep(second, (recovery[1] ?? '').toUpperCase().replace('-', ' '))).status).toBe(303)

            const token = (
                await (async () => {
                    const step = await passwordStep('gina@example.com')
                    const done = await secondStep(step, recovery[2] ?? '')
                    const tokens = await http()
                        .post('/oidc/token')
                        .type('form')
                        .send({
                            grant_type: 'authorization_code',
                            code: new URL(done.headers.location as string).searchParams.get('code') ?? '',
                            redirect_uri: REDIRECT,
                            client_id: 'frontend',
                            code_verifier: step.verifier
                        })
                    return tokens.body as { access_token: string }
                })()
            ).access_token
            expect((await http().get('/me/mfa').set(bearer(token)).expect(200)).body.recoveryCodesLeft).toBe(7)

            const fresh = await http()
                .post('/me/mfa/recovery-codes')
                .set(bearer(token))
                .send({ code: recovery[3] })
                .expect(200)
            const codes = fresh.body.recoveryCodes as string[]
            expect(codes).toHaveLength(10)
            await http().post('/me/mfa/disable').set(bearer(token)).send({ code: recovery[4] }).expect(400)
            await http().post('/me/mfa/disable').set(bearer(token)).send({ code: codes[0] }).expect(200)
            expect((await http().get('/me/mfa').set(bearer(token)).expect(200)).body.enabled).toBe(false)
            expect((await login('gina@example.com')).response.status).toBe(303)
        })

        it('answers the login page of the frontend with JSON', async () => {
            const user = store.addUser({
                email: 'hank@example.com',
                name: 'Hank',
                passwordHash: await hashPassword(PASSWORD)
            })
            store.addMembership(ids.acme, user.id, 'user')
            const token = (await accessToken('hank@example.com')).access_token
            const own = (await http().post('/me/mfa/setup').set(bearer(token)).expect(200)).body.secret as string
            await http()
                .post('/me/mfa/enable')
                .set(bearer(token))
                .send({ code: code(own) })
                .expect(200)
            process.env.OIDC_LOGIN_UI_URL = 'http://localhost:3000/login'
            try {
                const verifier = randomBytes(32).toString('base64url')
                const start = await http()
                    .get(
                        '/oidc/authorize?' +
                            new URLSearchParams({
                                client_id: 'frontend',
                                redirect_uri: REDIRECT,
                                response_type: 'code',
                                scope: 'openid',
                                code_challenge: pkceChallenge(verifier),
                                code_challenge_method: 'S256'
                            }).toString()
                    )
                    .expect(303)
                const interaction = new URL(start.headers.location as string).searchParams.get('interaction') ?? ''
                const base = '/oidc/interaction/' + interaction
                let cookie = setCookie(start)
                const json = (call: request.Test) =>
                    call.set('Accept', 'application/json').set('Origin', 'http://localhost:3000').set('Cookie', cookie)
                const { csrf } = (await json(http().get(base)).expect(200)).body as { csrf: string }
                const password = await json(http().post(base + '/login'))
                    .send({ csrf, email: 'hank@example.com', password: PASSWORD })
                    .expect(200)
                expect(password.body).toEqual({ status: 'mfa', csrf })
                cookie = setCookie(password) || cookie
                const wrong = await json(http().post(base + '/mfa'))
                    .set('Accept-Language', 'de')
                    .send({ csrf, code: '000000' })
                    .expect(401)
                expect(wrong.body).toEqual({
                    status: 'mfa',
                    csrf,
                    error: 'MFA_INVALID_CODE',
                    message: MESSAGES.de?.MFA_INVALID_CODE
                })
                const done = await json(http().post(base + '/mfa'))
                    .send({ csrf, code: code(own, 1) })
                    .expect(200)
                expect(done.body.status).toBe('redirect')
            } finally {
                process.env.OIDC_LOGIN_UI_URL = ''
            }
        })

        it('is required by default: an account without it sets it up during the login, before it gets a session', async () => {
            process.env.OIDC_MFA = 'required'
            try {
                const user = store.addUser({
                    email: 'ivy@example.com',
                    name: 'Ivy',
                    passwordHash: await hashPassword(PASSWORD)
                })
                store.addMembership(ids.acme, user.id, 'user')
                const sessionSet = (r: request.Response) =>
                    ((r.headers['set-cookie'] as unknown as string[]) ?? []).some(c => c.startsWith('oidc_session='))
                const step = await passwordStep('ivy@example.com')
                expect(step.response.status).toBe(200)
                expect(step.response.text).toContain(MESSAGES.en?.MFA_SETUP_TITLE)
                expect(step.response.text).toMatch(/<div class="qr"[^>]*><svg/)
                expect(sessionSet(step.response)).toBe(false)
                // The secret is shown on the page in groups of four characters
                const shown = /<p class="secret">([A-Z2-7 ]+)<\/p>/.exec(step.response.text)?.[1] ?? ''
                const own = shown.replace(/ /g, '')
                expect(own).toMatch(/^[A-Z2-7]{32}$/)

                const wrong = await secondStep(step, '000000')
                expect(wrong.status).toBe(401)
                expect(wrong.text).toContain(MESSAGES.en?.MFA_SETUP_TITLE)
                const codes = await secondStep(step, code(own))
                expect(codes.status).toBe(200)
                expect(codes.text).toContain(MESSAGES.en?.RECOVERY_TITLE)
                expect((codes.text.match(/<li>[a-z2-7]{4}-[a-z2-7]{4}<\/li>/g) ?? []).length).toBe(10)
                expect(sessionSet(codes)).toBe(false)
                const done = await http()
                    .post(step.base + '/continue')
                    .set('Cookie', setCookie(codes) || step.cookie)
                    .type('form')
                    .send({ csrf: step.csrf })
                    .expect(303)
                expect(sessionSet(done)).toBe(true)
                expect(new URL(done.headers.location as string).searchParams.get('code')).toBeTruthy()
                expect((await store.findUserById(user.id))?.mfaEnabled).toBe(true)

                // From now on: the code after the password, and it cannot be turned off
                const again = await passwordStep('ivy@example.com')
                expect(again.response.text).toContain(MESSAGES.en?.MFA_TITLE)
                const finished = await secondStep(again, code(own, 1))
                const tokens = await http()
                    .post('/oidc/token')
                    .type('form')
                    .send({
                        grant_type: 'authorization_code',
                        code: new URL(finished.headers.location as string).searchParams.get('code') ?? '',
                        redirect_uri: REDIRECT,
                        client_id: 'frontend',
                        code_verifier: again.verifier
                    })
                    .expect(200)
                const token = (tokens.body as { access_token: string }).access_token
                const refused = await http()
                    .post('/me/mfa/disable')
                    .set(bearer(token))
                    .send({ code: '000000' })
                    .expect(403)
                expect(refused.body.error).toBe('oidc.MFA_REQUIRED')
            } finally {
                process.env.OIDC_MFA = 'optional'
            }
        })

        it('a session without two-step verification does not count when it is required', async () => {
            const { response } = await login('alice@example.com')
            const session = ((response.headers['set-cookie'] as unknown as string[]) ?? []).find(c =>
                c.startsWith('oidc_session=')
            )
            const silent = (cookie: string) =>
                http()
                    .get(
                        '/oidc/authorize?' +
                            new URLSearchParams({
                                client_id: 'frontend',
                                redirect_uri: REDIRECT,
                                response_type: 'code',
                                scope: 'openid',
                                code_challenge: pkceChallenge(randomBytes(32).toString('base64url')),
                                code_challenge_method: 'S256',
                                prompt: 'none'
                            }).toString()
                    )
                    .set('Cookie', cookie)
                    .expect(303)
            const cookie = session?.split(';')[0] ?? ''
            expect(new URL((await silent(cookie)).headers.location as string).searchParams.get('code')).toBeTruthy()
            process.env.OIDC_MFA = 'required'
            try {
                const refused = await silent(cookie)
                expect(new URL(refused.headers.location as string).searchParams.get('error')).toBe('login_required')
            } finally {
                process.env.OIDC_MFA = 'optional'
            }
        })

        it('a superadmin can reset it for an account that lost its phone', async () => {
            const root = (await accessToken('root@example.com', 'acme')).access_token
            const ivy = await store.findUserByEmail('ivy@example.com')
            await http().delete(`/admin/users/${ivy?.id}/mfa`).set(bearer(root)).expect(204)
            expect((await store.findUserById(ivy?.id ?? ''))?.mfaEnabled).toBe(false)
            await http().delete(`/admin/users/${randomUUIDLike()}/mfa`).set(bearer(root)).expect(404)
            const alice = (await accessToken('alice@example.com')).access_token
            await http().delete(`/admin/users/${ivy?.id}/mfa`).set(bearer(alice)).expect(403)
        })
    })
})

/** A valid uuid that belongs to nothing. */
function randomUUIDLike() {
    return '00000000-0000-4000-8000-' + randomBytes(6).toString('hex')
}
