import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import type { AuthContext } from '../access/access.js'
import { AuditService } from '../audit/audit.service.js'
import { CatalogService } from '../billing/catalog.service.js'
import { AppException } from '../common/app.exception.js'
import { decrypt, deriveKey, encrypt } from '../oidc/crypto.js'
import { OidcConfig } from '../oidc/oidc.config.js'
import { OIDC_STORE, type OidcStore } from '../oidc/store/oidc.store.js'
import { isPkcs12, readPkcs12 } from './pkcs12.js'
import { type CertificateMeta, VAULT_STORE, type VaultEntry, type VaultStore } from './vault.store.js'

/** The largest certificate file: 64 KiB. */
export const VAULT_MAX_BYTES = 64 * 1024
const FILENAME = /\.(p12|pfx)$/i
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

const EMPTY_META: CertificateMeta = { thumbprint: null, subject: null, issuer: null, serial: null, validUntil: null }

/** Who uses the vault: the account and the organisation of its token. */
export type VaultViewer = Pick<AuthContext, 'userId' | 'tenantId' | 'superadmin'>

/**
 * The eHealth vault: the eHealth certificate (PKCS#12) of an account, for the apps that sign or call eHealth for a
 * doctor. Only members whose profession is doctor in the organisation of the token use it (and superadmins). The file
 * and its password are stored encrypted (AES-256-GCM, a key derived from OIDC_MASTER_KEY, bound to the account) and
 * never leave the API; only what the certificate says is shown.
 */
@Injectable()
export class VaultService {
    constructor(
        @Inject(VAULT_STORE) private readonly store: VaultStore,
        @Inject(OIDC_STORE) private readonly oidc: OidcStore,
        private readonly catalog: CatalogService,
        private readonly config: OidcConfig,
        private readonly audit: AuditService
    ) {}

    private get key(): Buffer {
        return deriveKey(this.config.masterKey(), 'vault v1')
    }

    private seal(value: string, context: string, userId: string): Buffer {
        return Buffer.from(encrypt(value, this.key, `vault:${context}:${userId}`), 'utf8')
    }

    private open(value: Buffer, context: string, userId: string): string {
        return decrypt(value.toString('utf8'), this.key, `vault:${context}:${userId}`)
    }

    /** A doctor in the organisation of the token, or a superadmin. */
    async allowed(viewer: VaultViewer): Promise<boolean> {
        if (viewer.superadmin) return true
        if (!viewer.tenantId) return false
        const member = await this.oidc.findMember(viewer.tenantId, viewer.userId)
        return member?.status === 'active' && member.profession === 'doctor'
    }

    private async assertAllowed(viewer: VaultViewer) {
        if (!(await this.allowed(viewer))) throw new AppException('oidc.VAULT_NOT_ALLOWED', HttpStatus.FORBIDDEN)
    }

    private certificate(entry: VaultEntry | null) {
        if (!entry) return null
        return {
            filename: entry.filename,
            sizeBytes: entry.sizeBytes,
            uploadedAt: entry.uploadedAt,
            thumbprint: entry.thumbprint,
            subject: entry.subject,
            issuer: entry.issuer,
            serial: entry.serial,
            validUntil: entry.validUntil,
            passwordSaved: entry.passwordEncrypted !== null
        }
    }

    /** Whether the account may use the vault, its certificate (never the file or the password) and the apps that need it. */
    async status(viewer: VaultViewer) {
        const [allowed, entry, apps] = await Promise.all([
            this.allowed(viewer),
            this.store.find(viewer.userId),
            this.catalog.vaultApps(viewer.tenantId || null)
        ])
        return { allowed, cert: this.certificate(entry), apps }
    }

    /**
     * Stores a new certificate file (it replaces the old one and its password). It is opened with an empty password
     * first: when that works nothing more is needed, otherwise what it says is known once the password is set.
     */
    async upload(viewer: VaultViewer, input: { filename: string; dataBase64: string }) {
        await this.assertAllowed(viewer)
        const filename = input.filename.trim()
        const base64 = input.dataBase64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
        const invalid = () => new AppException('oidc.VAULT_INVALID_FILE', HttpStatus.BAD_REQUEST)
        if (!FILENAME.test(filename) || !BASE64.test(base64)) throw invalid()
        const der = Buffer.from(base64, 'base64')
        if (der.length === 0 || der.length > VAULT_MAX_BYTES || !isPkcs12(der)) throw invalid()
        let meta = EMPTY_META
        let passwordEncrypted: Buffer | null = null
        try {
            meta = readPkcs12(der, '')
            passwordEncrypted = this.seal('', 'password', viewer.userId)
        } catch {
            // A password is needed (PUT /me/vault/password)
        }
        await this.store.save({
            userId: viewer.userId,
            filename,
            sizeBytes: der.length,
            p12Encrypted: this.seal(der.toString('base64'), 'p12', viewer.userId),
            passwordEncrypted,
            ...meta
        })
        await this.audit.record('account.vault_uploaded', {
            tenantId: null,
            actorId: viewer.userId,
            target: { type: 'user', id: viewer.userId },
            details: { filename, sizeBytes: der.length, thumbprint: meta.thumbprint }
        })
        return this.status(viewer)
    }

    /** The password of the certificate: checked by opening the file (422 oidc.VAULT_WRONG_PASSWORD), then stored. */
    async setPassword(viewer: VaultViewer, password: string) {
        await this.assertAllowed(viewer)
        const entry = await this.store.find(viewer.userId)
        if (!entry) throw new AppException('oidc.VAULT_EMPTY', HttpStatus.NOT_FOUND)
        const der = Buffer.from(this.open(entry.p12Encrypted, 'p12', viewer.userId), 'base64')
        let meta: CertificateMeta
        try {
            meta = readPkcs12(der, password)
        } catch {
            // A wrong password, or a file that turns out not to hold a certificate
            throw new AppException('oidc.VAULT_WRONG_PASSWORD', HttpStatus.UNPROCESSABLE_ENTITY)
        }
        await this.store.setPassword(viewer.userId, this.seal(password, 'password', viewer.userId), meta)
        await this.audit.record('account.vault_password_saved', {
            tenantId: null,
            actorId: viewer.userId,
            target: { type: 'user', id: viewer.userId },
            details: { thumbprint: meta.thumbprint }
        })
        return this.status(viewer)
    }

    /**
     * The certificate file and its password in the clear, for an app that calls eHealth for this doctor (see
     * VaultAppService, which checks who may ask). 404 oidc.VAULT_EMPTY: no file; 409 oidc.VAULT_NO_PASSWORD: the
     * password is not stored yet; 409 oidc.VAULT_EXPIRED: the certificate is no longer valid.
     */
    async reveal(userId: string) {
        const entry = await this.store.find(userId)
        if (!entry) throw new AppException('oidc.VAULT_EMPTY', HttpStatus.NOT_FOUND)
        if (!entry.passwordEncrypted) throw new AppException('oidc.VAULT_NO_PASSWORD', HttpStatus.CONFLICT)
        if (entry.validUntil && entry.validUntil.getTime() < Date.now())
            throw new AppException('oidc.VAULT_EXPIRED', HttpStatus.CONFLICT)
        return {
            filename: entry.filename,
            p12Base64: this.open(entry.p12Encrypted, 'p12', userId),
            password: this.open(entry.passwordEncrypted, 'password', userId),
            thumbprint: entry.thumbprint,
            subject: entry.subject,
            issuer: entry.issuer,
            serial: entry.serial,
            validUntil: entry.validUntil
        }
    }

    /** Removes the certificate and its password (always allowed: it is the own data of the account). */
    async remove(viewer: VaultViewer) {
        if (await this.store.delete(viewer.userId))
            await this.audit.record('account.vault_removed', {
                tenantId: null,
                actorId: viewer.userId,
                target: { type: 'user', id: viewer.userId }
            })
    }
}
