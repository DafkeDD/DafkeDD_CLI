import { randomBytes } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import forge from 'node-forge'
import { AuditService } from '../audit/audit.service.js'
import { MemoryAuditStore } from '../audit/memory-audit.store.js'
import type { BillingService } from '../billing/billing.service.js'
import { CatalogService } from '../billing/catalog.service.js'
import { MemoryBillingStore } from '../billing/store/memory-billing.store.js'
import { AppException } from '../common/app.exception.js'
import { OidcConfig } from '../oidc/oidc.config.js'
import { MemoryOidcStore } from '../oidc/store/memory-oidc.store.js'
import { MemoryVaultStore } from './memory-vault.store.js'
import { isPkcs12, readPkcs12 } from './pkcs12.js'
import { VaultService } from './vault.service.js'

/** A self-signed eHealth-like certificate in a PKCS#12 file with this password. */
function makePkcs12(password: string) {
    const keys = forge.pki.rsa.generateKeyPair(1024)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '0a1b2c3d'
    cert.validity.notBefore = new Date('2026-01-01T00:00:00Z')
    cert.validity.notAfter = new Date('2028-01-01T00:00:00Z')
    const name = [
        { shortName: 'C', value: 'BE' },
        { shortName: 'CN', value: 'Dr. Ada Lovelace' }
    ]
    cert.setSubject(name)
    cert.setIssuer([{ shortName: 'CN', value: 'eHealth Test CA' }])
    cert.sign(keys.privateKey, forge.md.sha256.create())
    const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' })
    const der = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary')
    const thumbprint = forge.md.sha1
        .create()
        .update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes())
        .digest()
        .toHex()
        .toUpperCase()
        .match(/../g)
        ?.join(':')
    return { der, thumbprint }
}

const withPassword = makePkcs12('s3cret')
const withoutPassword = makePkcs12('')

function setup() {
    const config = new OidcConfig(new ConfigService({ OIDC_MASTER_KEY: randomBytes(32).toString('hex') }))
    const oidc = new MemoryOidcStore()
    const billing = new MemoryBillingStore()
    const vault = new MemoryVaultStore()
    const auditStore = new MemoryAuditStore()
    const audit = new AuditService(auditStore, new ConfigService({}))
    const access = { access: async () => ({ access: false }) } as unknown as BillingService
    const catalog = new CatalogService(billing, oidc, access)
    const service = new VaultService(vault, oidc, catalog, config, audit)
    const tenant = oidc.addTenant('praktijk', 'Praktijk')
    const doctor = oidc.addUser({ email: 'doc@example.com', name: 'Doc', passwordHash: 'x' })
    const staff = oidc.addUser({ email: 'staff@example.com', name: 'Staff', passwordHash: 'x' })
    oidc.addMembership(tenant.id, doctor.id, 'user')
    oidc.addMembership(tenant.id, staff.id, 'user')
    return {
        oidc,
        billing,
        vault,
        auditStore,
        service,
        tenant,
        doctor: { userId: doctor.id, tenantId: tenant.id, superadmin: false },
        staff: { userId: staff.id, tenantId: tenant.id, superadmin: false }
    }
}

const errorOf = async (promise: Promise<unknown>) => {
    try {
        await promise
    } catch (error) {
        if (error instanceof AppException) return { key: error.key, status: error.getStatus() }
        throw error
    }
    return null
}

describe('PKCS#12', () => {
    it('reads the certificate with the right password only', () => {
        expect(isPkcs12(withPassword.der)).toBe(true)
        expect(isPkcs12(Buffer.from('not a certificate'))).toBe(false)
        expect(readPkcs12(withPassword.der, 's3cret')).toEqual({
            thumbprint: withPassword.thumbprint,
            subject: 'C=BE, CN=Dr. Ada Lovelace',
            issuer: 'CN=eHealth Test CA',
            serial: '0A1B2C3D',
            validUntil: new Date('2028-01-01T00:00:00Z')
        })
        expect(() => readPkcs12(withPassword.der, 'wrong')).toThrow()
        expect(() => readPkcs12(withPassword.der, '')).toThrow()
    })
})

describe('VaultService', () => {
    it('is only for doctors of the organisation of the token (and superadmins)', async () => {
        const { service, oidc, tenant, doctor, staff } = setup()
        expect((await service.status(staff)).allowed).toBe(false)
        const upload = { filename: 'ehealth.p12', dataBase64: withPassword.der.toString('base64') }
        expect(await errorOf(service.upload(staff, upload))).toEqual({ key: 'oidc.VAULT_NOT_ALLOWED', status: 403 })
        await oidc.setMemberProfession(tenant.id, doctor.userId, 'doctor')
        expect((await service.status(doctor)).allowed).toBe(true)
        expect(await service.allowed({ userId: staff.userId, tenantId: '', superadmin: true })).toBe(true)
        expect(await service.allowed({ ...doctor, tenantId: '' })).toBe(false)
    })

    it('lets a doctor choose the colleagues who may use the certificate, and logs it', async () => {
        const { service, oidc, tenant, doctor, staff, vault, auditStore } = setup()
        expect(await errorOf(service.colleagues(doctor))).toEqual({ key: 'oidc.VAULT_NOT_ALLOWED', status: 403 })
        await oidc.setMemberProfession(tenant.id, doctor.userId, 'doctor')
        expect(await service.colleagues(doctor)).toEqual([
            { userId: staff.userId, name: 'Staff', email: 'staff@example.com', profession: 'staff', allowed: false }
        ])
        const chosen = await service.setColleagues(doctor, [staff.userId, staff.userId])
        expect(chosen[0]?.allowed).toBe(true)
        expect(await vault.listDelegates(doctor.userId, tenant.id)).toEqual([staff.userId])
        expect(await service.ownersFor(staff.userId, tenant.id)).toEqual([doctor.userId])
        expect(await service.delegated(doctor.userId, staff.userId, tenant.id)).toBe(true)
        expect(JSON.stringify(auditStore)).toContain('account.vault_delegates_changed')
        // Itself, or somebody of another organisation: not a colleague
        expect((await errorOf(service.setColleagues(doctor, [doctor.userId])))?.key).toBe('oidc.MEMBER_NOT_FOUND')
        const other = oidc.addUser({ email: 'x@example.com', name: 'X', passwordHash: 'x' })
        expect((await errorOf(service.setColleagues(doctor, [other.id])))?.key).toBe('oidc.MEMBER_NOT_FOUND')
        await service.setColleagues(doctor, [])
        expect(await service.ownersFor(staff.userId, tenant.id)).toEqual([])
    })

    it('stores the file encrypted, asks the password, checks it and shows what the certificate says', async () => {
        const { service, oidc, vault, tenant, doctor, auditStore } = setup()
        await oidc.setMemberProfession(tenant.id, doctor.userId, 'doctor')
        const uploaded = await service.upload(doctor, {
            filename: 'ehealth.p12',
            dataBase64: withPassword.der.toString('base64')
        })
        expect(uploaded.cert).toMatchObject({
            filename: 'ehealth.p12',
            sizeBytes: withPassword.der.length,
            thumbprint: null,
            subject: null,
            passwordSaved: false
        })
        // Never the file in plain text
        const stored = vault.entries.get(doctor.userId)
        expect(stored?.p12Encrypted.includes(withPassword.der.subarray(0, 64))).toBe(false)
        expect(stored?.p12Encrypted.toString('utf8')).not.toContain(withPassword.der.toString('base64').slice(0, 40))

        expect(await errorOf(service.setPassword(doctor, 'wrong'))).toEqual({
            key: 'oidc.VAULT_WRONG_PASSWORD',
            status: 422
        })
        const opened = await service.setPassword(doctor, 's3cret')
        expect(opened.cert).toMatchObject({
            thumbprint: withPassword.thumbprint,
            subject: 'C=BE, CN=Dr. Ada Lovelace',
            issuer: 'CN=eHealth Test CA',
            serial: '0A1B2C3D',
            validUntil: new Date('2028-01-01T00:00:00Z'),
            passwordSaved: true
        })
        expect(JSON.stringify(opened)).not.toContain('s3cret')
        expect(stored?.passwordEncrypted?.toString('utf8')).not.toContain('s3cret')

        await service.remove(doctor)
        expect((await service.status(doctor)).cert).toBeNull()
        expect(await errorOf(service.setPassword(doctor, 's3cret'))).toEqual({ key: 'oidc.VAULT_EMPTY', status: 404 })
        expect(auditStore.events.map(event => event.action)).toEqual([
            'account.vault_uploaded',
            'account.vault_password_saved',
            'account.vault_removed'
        ])
    })

    it('opens a file without a password at once, and refuses files that are no certificate', async () => {
        const { service, oidc, tenant, doctor } = setup()
        await oidc.setMemberProfession(tenant.id, doctor.userId, 'doctor')
        const uploaded = await service.upload(doctor, {
            filename: 'cert.PFX',
            dataBase64: 'data:application/x-pkcs12;base64,' + withoutPassword.der.toString('base64')
        })
        expect(uploaded.cert).toMatchObject({ thumbprint: withoutPassword.thumbprint, passwordSaved: true })
        for (const input of [
            { filename: 'cert.pem', dataBase64: withPassword.der.toString('base64') },
            { filename: 'cert.p12', dataBase64: Buffer.from('hello').toString('base64') },
            { filename: 'cert.p12', dataBase64: '***' },
            { filename: 'cert.p12', dataBase64: Buffer.alloc(64 * 1024 + 1, 0x30).toString('base64') }
        ])
            expect(await errorOf(service.upload(doctor, input))).toEqual({
                key: 'oidc.VAULT_INVALID_FILE',
                status: 400
            })
    })

    it('lists the apps that need the vault, and which ones the organisation has', async () => {
        const { service, billing, tenant, doctor } = setup()
        const dossier = await billing.createProduct({
            code: 'dossier',
            name: 'Patiëntendossier',
            description: '',
            priceMonthCents: 3900,
            priceYearCents: 39000,
            active: true,
            requiresVault: true,
            icon: 'idcard',
            color: '#ea580c'
        })
        await billing.createProduct({
            code: 'facturatie',
            name: 'Facturatie',
            description: '',
            priceMonthCents: 2400,
            priceYearCents: 24000,
            active: true,
            requiresVault: true
        })
        await billing.createProduct({
            code: 'todo',
            name: 'Takenlijst',
            description: '',
            priceMonthCents: 1200,
            priceYearCents: 12000,
            active: true
        })
        await billing.addGrant({
            tenantId: tenant.id,
            productId: dossier?.id ?? '',
            seats: 1,
            endsAt: null,
            note: '',
            grantedBy: doctor.userId
        })
        expect((await service.status(doctor)).apps).toEqual([
            { code: 'facturatie', name: 'Facturatie', icon: 'box', color: null, owned: false },
            { code: 'dossier', name: 'Patiëntendossier', icon: 'idcard', color: '#ea580c', owned: true }
        ])
    })
})
