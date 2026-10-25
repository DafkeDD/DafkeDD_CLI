import { randomBytes } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import forge from 'node-forge'
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
import { hashPassword } from '../src/oidc/password.js'
import { MemoryOidcStore } from '../src/oidc/store/memory-oidc.store.js'
import { OIDC_STORE } from '../src/oidc/store/oidc.store.js'
import { MemoryNotificationsStore } from '../src/notifications/memory-notifications.store.js'
import { NOTIFICATIONS_STORE } from '../src/notifications/notifications.store.js'
import { MemoryVaultStore } from '../src/vault/memory-vault.store.js'
import { VAULT_STORE } from '../src/vault/vault.store.js'
import { configureApp } from '../src/setup.js'
import { INVOICES_STORE } from '../src/billing/invoices/invoices.store.js'
import { MemoryInvoicesStore } from '../src/billing/invoices/memory-invoices.store.js'

process.env.OIDC_MASTER_KEY ??= randomBytes(32).toString('hex')
process.env.OIDC_LOGIN_RATE_LIMIT = '1000'
process.env.OIDC_LOGIN_UI_URL = ''
process.env.OIDC_MFA = 'optional'
// The accounts of these tests have no eID (the tests of OIDC_EID_REQUIRED are in eid.e2e-spec.ts)
process.env.OIDC_EID_REQUIRED = 'off'
process.env.APP_URL = 'http://localhost:3000'
process.env.PAYMENTS = 'off'

const REDIRECT = 'http://localhost:3000/api/auth/callback'
const PASSWORD = 'correct-horse-battery'

/** A PKCS#12 file with a self-signed certificate. */
function pkcs12(password: string) {
    const keys = forge.pki.rsa.generateKeyPair(1024)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date('2026-01-01T00:00:00Z')
    cert.validity.notAfter = new Date('2027-01-01T00:00:00Z')
    cert.setSubject([{ shortName: 'CN', value: 'Dr. Alice' }])
    cert.setIssuer([{ shortName: 'CN', value: 'Test CA' }])
    cert.sign(keys.privateKey, forge.md.sha256.create())
    const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' })
    return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary').toString('base64')
}

describe('Profiles, billing details, professions, catalogue, tenants and the eHealth vault (e2e)', () => {
    let app: INestApplication<App>
    const store = new MemoryOidcStore()
    const billing = new MemoryBillingStore()
    const vault = new MemoryVaultStore()
    const audit = new MemoryAuditStore(store)
    const outbox: Mail[] = []
    const http = () => request(app.getHttpServer())
    const ids = { acme: '', alice: '', bob: '' }
    const tokens = { alice: '', bob: '', root: '' }

    beforeAll(async () => {
        const passwordHash = await hashPassword(PASSWORD)
        const acme = store.addTenant('acme', 'Acme')
        const alice = store.addUser({ email: 'alice@example.com', name: 'Alice', passwordHash })
        const bob = store.addUser({ email: 'bob@example.com', name: 'Bob', passwordHash })
        store.addUser({ email: 'root@example.com', name: 'Root', passwordHash, isSuperadmin: true })
        store.addMembership(acme.id, alice.id, 'admin')
        store.addMembership(acme.id, bob.id, 'user')
        Object.assign(ids, { acme: acme.id, alice: alice.id, bob: bob.id })

        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(DatabaseService)
            .useValue({ ping: vi.fn().mockResolvedValue(true), query: vi.fn().mockResolvedValue({ rows: [] }) })
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
            .overrideProvider(VAULT_STORE)
            .useValue(vault)
            .overrideProvider(NOTIFICATIONS_STORE)
            .useValue(new MemoryNotificationsStore())
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
        for (const name of ['alice', 'bob', 'root'] as const) tokens[name] = await accessToken(`${name}@example.com`)
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

    async function accessToken(email: string, tenant = 'acme') {
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
            .type('form')
            .send({ csrf, email, password: PASSWORD })
            .expect(303)
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

    it('shows and changes the own profile; a new email address only after its link', async () => {
        const profile = await http().get('/me/profile').set(bearer(tokens.bob)).expect(200)
        expect(profile.body).toMatchObject({
            id: ids.bob,
            email: 'bob@example.com',
            eid: { linked: false, rrn: null },
            tenant: { id: ids.acme, slug: 'acme', role: 'user', profession: 'staff' }
        })
        const changed = await http()
            .patch('/me/profile')
            .set(bearer(tokens.bob))
            .send({ firstName: 'Bob', lastName: 'Builder', phone: '+32 9 000 00 00', email: 'bob@builder.be' })
            .expect(200)
        expect(changed.body).toMatchObject({
            name: 'Bob Builder',
            email: 'bob@example.com',
            pendingEmail: 'bob@builder.be'
        })
        // rrn and address are read-only: unknown fields are refused
        await http().patch('/me/profile').set(bearer(tokens.bob)).send({ rrn: '85.07.31-003.23' }).expect(400)
        await http().patch('/me/profile').set(bearer(tokens.bob)).send({ locale: 'xx' }).expect(400)
        const taken = await http()
            .patch('/me/profile')
            .set(bearer(tokens.bob))
            .send({ email: 'alice@example.com' })
            .expect(409)
        expect(taken.body.error).toBe('oidc.EMAIL_TAKEN')

        const link = /http\S+/.exec(outbox.find(mail => mail.to === 'bob@builder.be')?.text ?? '')?.[0] ?? ''
        expect(link).toContain('/verify-email?token=')
        const token = new URL(link).searchParams.get('token')
        const confirmed = await http().post('/oidc/account/verify-email').send({ token }).expect(200)
        expect(confirmed.body).toEqual({ status: 'email-changed', email: 'bob@builder.be' })
        expect((await http().get('/me/profile').set(bearer(tokens.bob)).expect(200)).body).toMatchObject({
            email: 'bob@builder.be',
            pendingEmail: null
        })
    })

    it('billing details: every member reads them, admins change them', async () => {
        await http().patch('/tenants/current/billing').set(bearer(tokens.bob)).send({ company: 'Nope' }).expect(403)
        await http()
            .patch('/tenants/current/billing')
            .set(bearer(tokens.alice))
            .send({ vat: 'X'.repeat(33) })
            .expect(400)
        const saved = await http()
            .patch('/tenants/current/billing')
            .set(bearer(tokens.alice))
            .send({ company: 'Acme BV', vat: 'BE0123456789', billingAddress: 'Kerkstraat 1, Gent', billingEmail: '' })
            .expect(200)
        expect(saved.body).toEqual({
            company: 'Acme BV',
            vat: 'BE0123456789',
            billingAddress: 'Kerkstraat 1, Gent',
            billingEmail: null
        })
        expect((await http().get('/tenants/current/billing').set(bearer(tokens.bob)).expect(200)).body).toEqual(
            saved.body
        )
    })

    it('admins set the profession; the vault is for doctors; superadmins manage any tenant', async () => {
        const forbidden = await http()
            .put('/me/vault')
            .set(bearer(tokens.bob))
            .send({
                filename: 'cert.p12',
                dataBase64: pkcs12('pw')
            })
        expect(forbidden.status).toBe(403)
        expect(forbidden.body.error).toBe('oidc.VAULT_NOT_ALLOWED')

        await http()
            .patch(`/tenants/current/members/${ids.bob}/profession`)
            .set(bearer(tokens.bob))
            .send({ profession: 'doctor' })
            .expect(403)
        expect(
            (
                await http()
                    .patch(`/tenants/current/members/${ids.bob}/profession`)
                    .set(bearer(tokens.alice))
                    .send({ profession: 'doctor' })
                    .expect(200)
            ).body
        ).toEqual({ userId: ids.bob, profession: 'doctor' })
        const members = await http().get('/tenants/current/members').set(bearer(tokens.alice)).expect(200)
        expect(members.body.find((member: { userId: string }) => member.userId === ids.bob).profession).toBe('doctor')

        const uploaded = await http()
            .put('/me/vault')
            .set(bearer(tokens.bob))
            .send({ filename: 'cert.p12', dataBase64: pkcs12('pw') })
            .expect(200)
        expect(uploaded.body).toMatchObject({ allowed: true, cert: { filename: 'cert.p12', passwordSaved: false } })
        const wrong = await http().put('/me/vault/password').set(bearer(tokens.bob)).send({ password: 'no' })
        expect(wrong.status).toBe(422)
        expect(wrong.body.error).toBe('oidc.VAULT_WRONG_PASSWORD')
        const opened = await http()
            .put('/me/vault/password')
            .set(bearer(tokens.bob))
            .send({ password: 'pw' })
            .expect(200)
        expect(opened.body.cert).toMatchObject({ subject: 'CN=Dr. Alice', serial: '01', passwordSaved: true })
        await http().delete('/me/vault').set(bearer(tokens.bob)).expect(204)
        expect((await http().get('/me/vault').set(bearer(tokens.bob)).expect(200)).body.cert).toBeNull()

        // Superadmins: the tenant of the URL
        await http().get(`/admin/tenants/${ids.acme}/members`).set(bearer(tokens.alice)).expect(403)
        const changed = await http()
            .patch(`/admin/tenants/${ids.acme}/members/${ids.bob}/profession`)
            .set(bearer(tokens.root))
            .send({ profession: 'staff' })
            .expect(200)
        expect(changed.body).toEqual({ userId: ids.bob, profession: 'staff' })
        const invited = await http()
            .post(`/admin/tenants/${ids.acme}/invitations`)
            .set(bearer(tokens.root))
            .send({ email: 'carol@example.com', role: 'user' })
            .expect(202)
        const invitations = await http().get(`/admin/tenants/${ids.acme}/invitations`).set(bearer(tokens.root))
        expect(invitations.body.map((item: { id: string }) => item.id)).toContain(invited.body.id)
        await http()
            .delete(`/admin/tenants/${ids.acme}/invitations/${invited.body.id}`)
            .set(bearer(tokens.root))
            .expect(204)
        const missing = await http()
            .get('/admin/tenants/00000000-0000-4000-8000-000000000000/members')
            .set(bearer(tokens.root))
            .expect(404)
        expect(missing.body.error).toBe('oidc.TENANT_NOT_FOUND')
    })

    it('superadmins list, create, read and change tenants', async () => {
        const created = await http()
            .post('/admin/tenants')
            .set(bearer(tokens.root))
            .send({
                name: 'Praktijk Peeters',
                adminEmail: 'jan@peeters.be',
                contactName: 'Jan',
                city: 'Gent',
                plan: 'Pro'
            })
            .expect(201)
        expect(created.body).toMatchObject({
            invited: 'jan@peeters.be',
            tenant: { provisioning: true, plan: 'Pro', city: 'Gent', contact: { name: 'Jan', email: 'jan@peeters.be' } }
        })
        const id = created.body.tenant.id as string
        const changed = await http()
            .patch(`/admin/tenants/${id}`)
            .set(bearer(tokens.root))
            .send({ status: 'suspended', name: 'Peeters', plan: 'Enterprise' })
            .expect(200)
        expect(changed.body).toMatchObject({ id, status: 'suspended', name: 'Peeters', plan: 'Enterprise' })
        expect((await http().get(`/admin/tenants/${id}`).set(bearer(tokens.root)).expect(200)).body.name).toBe(
            'Peeters'
        )
        const list = await http().get('/admin/tenants').set(bearer(tokens.root)).expect(200)
        expect(list.body.find((item: { id: string }) => item.id === ids.acme)).toMatchObject({
            members: 2,
            apps: 0,
            plan: 'Starter',
            provisioning: false,
            contact: { email: 'alice@example.com' }
        })
    })

    it('products have catalogue fields; members see the catalogue', async () => {
        await http()
            .post('/admin/products')
            .set(bearer(tokens.root))
            .send({
                code: 'agenda',
                name: 'Online Agenda',
                priceMonthCents: 1800,
                priceYearCents: 18000,
                icon: 'calendar',
                category: 'Planning',
                short: 'Afspraken online',
                features: ['Online boeken'],
                color: '#2563EB',
                requiresVault: false,
                demoEnabled: false,
                launchUrl: 'https://{slug}.agenda.example.com',
                sort: 2
            })
            .expect(201)
        await http()
            .post('/admin/products')
            .set(bearer(tokens.root))
            .send({ code: 'bad', name: 'Bad', priceMonthCents: 100, priceYearCents: 1000, color: 'blue' })
            .expect(400)
        const patched = await http()
            .patch('/admin/products/agenda')
            .set(bearer(tokens.root))
            .send({ requiresVault: true, demoEnabled: true, launchUrl: null })
            .expect(200)
        expect(patched.body).toMatchObject({
            icon: 'calendar',
            color: '#2563eb',
            requiresVault: true,
            demoEnabled: true,
            launchUrl: null
        })
        const catalog = await http().get('/tenants/current/catalog').set(bearer(tokens.bob)).expect(200)
        expect(catalog.body).toEqual([
            expect.objectContaining({
                code: 'agenda',
                short: 'Afspraken online',
                features: ['Online boeken'],
                owned: false,
                // Bob joined before the product existed: no trial
                access: false,
                seatsUsed: 0,
                seatsTotal: 0,
                launchUrl: null,
                environment: null
            })
        ])
        const vaultApps = await http().get('/me/vault').set(bearer(tokens.bob)).expect(200)
        expect(vaultApps.body.apps).toEqual([
            { code: 'agenda', name: 'Online Agenda', icon: 'calendar', color: '#2563eb', owned: false }
        ])
    })
})
