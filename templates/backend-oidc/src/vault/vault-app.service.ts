import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service.js'
import { CatalogService } from '../billing/catalog.service.js'
import { AppException } from '../common/app.exception.js'
import { AppLicenses } from '../oidc/app-licenses.js'
import { safeEqual, sha256 } from '../oidc/crypto.js'
import { LoginLimiter } from '../oidc/login-limiter.js'
import { OAuthError } from '../oidc/oauth.error.js'
import { OidcService } from '../oidc/oidc.service.js'
import { OIDC_STORE, type OidcStore } from '../oidc/store/oidc.store.js'
import { VaultService } from './vault.service.js'

/**
 * The apps that call eHealth for a doctor fetch the certificate here. Three things must be true at once: the app
 * proves itself (its client id and secret: a confidential app that sells a product that needs the vault), the doctor
 * is logged in to that very app (an access token issued to it, so a leaked secret alone gives nothing), and the
 * doctor may use the vault and the product in the organisation of that token. Every fetch is in the audit log.
 */
@Injectable()
export class VaultAppService {
    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly vault: VaultService,
        private readonly oidc: OidcService,
        private readonly catalog: CatalogService,
        private readonly licenses: AppLicenses,
        private readonly limiter: LoginLimiter,
        private readonly audit: AuditService
    ) {}

    /**
     * Who asks: the app (its client id and secret, a confidential app that sells a product that needs the vault) and
     * the account of the access token (issued to that app, in an active organisation, with a licence of the product).
     */
    private async caller(input: { clientId: string; clientSecret: string; accessToken: string; ip: string }) {
        // Failed attempts and good ones count alike: an app fetches once per session, not in a loop
        if (!this.limiter.allow(['vault-ip:' + input.ip, 'vault-client:' + input.clientId]))
            throw new AppException('oidc.TOO_MANY_ATTEMPTS', HttpStatus.TOO_MANY_REQUESTS)

        const unauthorized = new AppException('oidc.VAULT_APP_UNAUTHORIZED', HttpStatus.UNAUTHORIZED)
        const client = await this.store.findClient(input.clientId)
        if (
            client?.type !== 'confidential' ||
            !client.secretHash ||
            !safeEqual(sha256(input.clientSecret), client.secretHash)
        )
            throw unauthorized

        const forbidden = new AppException('oidc.VAULT_APP_NOT_ALLOWED', HttpStatus.FORBIDDEN)
        const product = client.product
        if (!product || !(await this.catalog.vaultApps(null)).some(app => app.code === product)) throw forbidden

        let claims: Record<string, unknown>
        try {
            claims = await this.oidc.verifyAccessToken(input.accessToken)
        } catch (error) {
            if (error instanceof OAuthError) throw unauthorized
            throw error
        }
        // The token must be issued to this app, for an account in an organisation
        const tenantId = (claims.tenant as { id?: unknown } | undefined)?.id
        if (claims.client_id !== client.clientId || typeof claims.sub !== 'string' || typeof tenantId !== 'string')
            throw unauthorized
        const user = await this.store.findUserById(claims.sub)
        if (user?.status !== 'active') throw unauthorized
        const tenant = await this.store.findTenant(tenantId)
        if (tenant?.status !== 'active') throw forbidden
        if ((await this.licenses.claim(tenantId, user.id, product, user.isSuperadmin)).status === 'none')
            throw forbidden
        return { client, product, user, tenantId }
    }

    /** May the certificate of this doctor be used in this organisation (a doctor there with a certificate)? */
    private async doctor(userId: string, tenantId: string) {
        const owner = await this.store.findUserById(userId)
        if (owner?.status !== 'active') return null
        return (await this.vault.allowed({ userId, tenantId, superadmin: false })) ? owner : null
    }

    /**
     * The certificate of a doctor for the app: its own (a doctor), or `doctorId`: that of a doctor of the same
     * organisation who chose this account (the secretariat) on /vault. Every fetch is in the audit log.
     */
    async credentials(input: {
        clientId: string
        clientSecret: string
        accessToken: string
        ip: string
        doctorId?: string | null
    }) {
        const { client, product, user, tenantId } = await this.caller(input)
        const notAllowed = new AppException('oidc.VAULT_NOT_ALLOWED', HttpStatus.FORBIDDEN)
        let ownerId = user.id
        if (input.doctorId && input.doctorId !== user.id) {
            // On behalf of a doctor: that doctor chose this account, in this organisation
            if (!(await this.doctor(input.doctorId, tenantId))) throw notAllowed
            if (!(await this.vault.delegated(input.doctorId, user.id, tenantId))) throw notAllowed
            ownerId = input.doctorId
        } else if (!(await this.vault.allowed({ userId: user.id, tenantId, superadmin: user.isSuperadmin })))
            throw notAllowed

        const credentials = await this.vault.reveal(ownerId)
        await this.audit.record('account.vault_retrieved', {
            tenantId,
            actorId: user.id,
            target: { type: 'user', id: ownerId },
            details: {
                clientId: client.clientId,
                product,
                thumbprint: credentials.thumbprint,
                ...(ownerId !== user.id ? { onBehalfOf: ownerId } : {})
            }
        })
        return credentials
    }

    /**
     * The doctors whose certificate this account may use in the app: itself (a doctor), and the doctors of the
     * organisation who chose it. With whether their certificate is ready (a file and its password, not expired).
     */
    async doctors(input: { clientId: string; clientSecret: string; accessToken: string; ip: string }) {
        const { user, tenantId } = await this.caller(input)
        const ids = await this.vault.ownersFor(user.id, tenantId)
        if (await this.vault.allowed({ userId: user.id, tenantId, superadmin: user.isSuperadmin })) ids.unshift(user.id)
        const result = []
        for (const id of new Set(ids)) {
            const owner = id === user.id ? user : await this.doctor(id, tenantId)
            if (!owner) continue
            const ready = await this.vault.reveal(id).then(
                () => true,
                () => false
            )
            result.push({ id, name: owner.name, email: owner.email, self: id === user.id, ready })
        }
        return result
    }
}
