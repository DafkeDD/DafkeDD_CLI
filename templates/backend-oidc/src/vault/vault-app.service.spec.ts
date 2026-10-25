import { randomBytes } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import forge from 'node-forge'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuditService } from '../audit/audit.service.js'
import { MemoryAuditStore } from '../audit/memory-audit.store.js'
import type { BillingService } from '../billing/billing.service.js'
import { CatalogService } from '../billing/catalog.service.js'
import { MemoryBillingStore } from '../billing/store/memory-billing.store.js'
import { AppException } from '../common/app.exception.js'
import type { AppLicenses } from '../oidc/app-licenses.js'
import { sha256 } from '../oidc/crypto.js'
import { LoginLimiter } from '../oidc/login-limiter.js'
import { OAuthError } from '../oidc/oauth.error.js'
import { OidcConfig } from '../oidc/oidc.config.js'
import type { OidcService } from '../oidc/oidc.service.js'
import { MemoryOidcStore } from '../oidc/store/memory-oidc.store.js'
import { MemoryVaultStore } from './memory-vault.store.js'
import { VaultAppService } from './vault-app.service.js'
import { VaultService } from './vault.service.js'

const PASSWORD = 's3cret'

/** A self-signed certificate in a PKCS#12 file (base64) with this password. */
function makePkcs12(password: string) {
    const keys = forge.pki.rsa.generateKeyPair(1024)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '0a1b2c3d'
    cert.validity.notBefore = new Date('2026-01-01T00:00:00Z')
    cert.validity.notAfter = new Date('2028-01-01T00:00:00Z')
    cert.setSubject([{ shortName: 'CN', value: 'Dr. Ada Lovelace' }])
    cert.setIssuer([{ shortName: 'CN', value: 'eHealth Test CA' }])
    cert.sign(keys.privateKey, forge.md.sha256.create())
    const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' })
    return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary').toString('base64')
}

const p12Base64 = makePkcs12(PASSWORD)

const errorOf = async (promise: Promise<unknown>) => {
    try {
        await promise
    } catch (error) {
        if (error instanceof AppException) return { key: error.key, status: error.getStatus() }
        throw error
    }
    return null
}

async function setup() {
    const config = new OidcConfig(new ConfigService({ OIDC_MASTER_KEY: randomBytes(32).toString('hex') }))
    const oidc = new MemoryOidcStore()
    const billing = new MemoryBillingStore()
    const auditStore = new MemoryAuditStore()
    const audit = new AuditService(auditStore, new ConfigService({}))
    const access = { access: async () => ({ access: false }) } as unknown as BillingService
    const catalog = new CatalogService(billing, oidc, access)
    const vault = new VaultService(new MemoryVaultStore(), oidc, catalog, config, audit)

    await billing.createProduct({
        code: 'dossier',
        name: 'Dossier',
        description: '',
        priceMonthCents: 3900,
        priceYearCents: 39000,
        active: true,
        requiresVault: true
    })
    await billing.createProduct({
        code: 'todo',
        name: 'Todo',
        description: '',
        priceMonthCents: 100,
        priceYearCents: 1000,
        active: true
    })
    const client = (clientId: string, product: string | null, secret: string | null = 'app-secret') =>
        oidc.createClient({
            clientId,
            name: clientId,
            type: secret ? 'confidential' : 'public',
            secretHash: secret ? sha256(secret) : null,
            redirectUris: ['https://app.example.com/cb'],
            postLogoutRedirectUris: [],
            grantTypes: ['authorization_code'],
            scopes: ['openid'],
            firstParty: false,
            product
        })
    await client('dossier-app', 'dossier')
    await client('todo-app', 'todo')
    await client('free-app', null)
    await client('spa', 'dossier', null)

    const tenant = oidc.addTenant('praktijk', 'Praktijk')
    const doctor = oidc.addUser({ email: 'doc@example.com', name: 'Doc', passwordHash: 'x' })
    const staff = oidc.addUser({ email: 'staff@example.com', name: 'Staff', passwordHash: 'x' })
    oidc.addMembership(tenant.id, doctor.id, 'user')
    oidc.addMembership(tenant.id, staff.id, 'user')
    await oidc.setMemberProfession(tenant.id, doctor.id, 'doctor')

    // What the token verification answers: the claims of the token that the test hands over
    const claims = new Map<string, Record<string, unknown>>()
    const oidcService = {
        verifyAccessToken: async (token: string | undefined) => {
            const found = token ? claims.get(token) : undefined
            if (!found) throw new OAuthError('invalid_token', 'invalid', 401)
            return found
        }
    } as unknown as OidcService
    const licenseStatus = { value: 'seat' as 'seat' | 'none' }
    const licenses = {
        claim: async (_tenantId: string | null, _userId: string, code: string) => ({
            product: code,
            status: licenseStatus.value
        })
    } as unknown as AppLicenses
    const service = new VaultAppService(oidc, vault, oidcService, catalog, licenses, new LoginLimiter(config), audit)
    const token = (userId: string, clientId: string) => {
        const name = userId + clientId + 'token'
        claims.set(name, { sub: userId, client_id: clientId, tenant: { id: tenant.id } })
        return name
    }
    const owner = (userId: string) => ({ userId, tenantId: '', superadmin: true })
    return { vault, service, auditStore, doctor, staff, token, licenseStatus, owner }
}

const ask = (
    service: VaultAppService,
    accessToken: string,
    overrides: Partial<{ clientId: string; clientSecret: string }> = {}
) =>
    service.credentials({
        clientId: 'dossier-app',
        clientSecret: 'app-secret',
        accessToken,
        ip: '1.2.3.4',
        ...overrides
    })

describe('VaultAppService', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    it('gives the app the certificate and the password of the doctor, and records it', async () => {
        const { service, vault, doctor, token, auditStore, owner } = await setup()
        await vault.upload(owner(doctor.id), { filename: 'a.p12', dataBase64: p12Base64 })
        await vault.setPassword(owner(doctor.id), PASSWORD)

        const result = await ask(service, token(doctor.id, 'dossier-app'))
        expect(result.p12Base64).toBe(p12Base64)
        expect(result.password).toBe(PASSWORD)
        expect(result.filename).toBe('a.p12')
        expect(result.subject).toBe('CN=Dr. Ada Lovelace')
        const log = JSON.stringify(auditStore)
        expect(log).toContain('account.vault_retrieved')
        expect(log).not.toContain(PASSWORD)
    })

    it('refuses a wrong secret, a public app, an unknown app and a token of another app', async () => {
        const { service, doctor, token } = await setup()
        const own = token(doctor.id, 'dossier-app')
        expect((await errorOf(ask(service, own, { clientSecret: 'nope' })))?.key).toBe('oidc.VAULT_APP_UNAUTHORIZED')
        expect((await errorOf(ask(service, own, { clientId: 'spa', clientSecret: '' })))?.key).toBe(
            'oidc.VAULT_APP_UNAUTHORIZED'
        )
        expect((await errorOf(ask(service, own, { clientId: 'ghost' })))?.status).toBe(401)
        // The token of the doctor was issued to another app: a leaked secret alone is not enough
        expect((await errorOf(ask(service, token(doctor.id, 'todo-app'))))?.key).toBe('oidc.VAULT_APP_UNAUTHORIZED')
        expect((await errorOf(ask(service, 'not-a-token')))?.key).toBe('oidc.VAULT_APP_UNAUTHORIZED')
    })

    it('refuses apps that do not need the vault', async () => {
        const { service, doctor, token } = await setup()
        for (const clientId of ['todo-app', 'free-app']) {
            const error = await errorOf(ask(service, token(doctor.id, clientId), { clientId }))
            expect(error).toEqual({ key: 'oidc.VAULT_APP_NOT_ALLOWED', status: 403 })
        }
    })

    it('refuses staff, and organisations without a licence', async () => {
        const { service, vault, doctor, staff, token, licenseStatus, owner } = await setup()
        await vault.upload(owner(doctor.id), { filename: 'a.p12', dataBase64: p12Base64 })
        await vault.setPassword(owner(doctor.id), PASSWORD)
        expect((await errorOf(ask(service, token(staff.id, 'dossier-app'))))?.key).toBe('oidc.VAULT_NOT_ALLOWED')
        licenseStatus.value = 'none'
        expect((await errorOf(ask(service, token(doctor.id, 'dossier-app'))))?.key).toBe('oidc.VAULT_APP_NOT_ALLOWED')
    })

    it('says what is missing: no file, no password, an expired certificate', async () => {
        const { service, vault, doctor, token, owner } = await setup()
        const own = token(doctor.id, 'dossier-app')
        expect(await errorOf(ask(service, own))).toEqual({ key: 'oidc.VAULT_EMPTY', status: 404 })
        await vault.upload(owner(doctor.id), { filename: 'a.p12', dataBase64: p12Base64 })
        // The password of this file is not empty, so it is not known yet
        expect(await errorOf(ask(service, own))).toEqual({ key: 'oidc.VAULT_NO_PASSWORD', status: 409 })
        await vault.setPassword(owner(doctor.id), PASSWORD)
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2029-01-01T00:00:00Z'))
        expect(await errorOf(ask(service, own))).toEqual({ key: 'oidc.VAULT_EXPIRED', status: 409 })
    })

    it('slows down repeated attempts', async () => {
        const { service } = await setup()
        let last: { key: string; status: number } | null = null
        for (let i = 0; i < 200 && last?.status !== 429; i++)
            last = await errorOf(ask(service, 'x', { clientSecret: 'bad' }))
        expect(last?.key).toBe('oidc.TOO_MANY_ATTEMPTS')
    })
})
