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

    async credentials(input: { clientId: string; clientSecret: string; accessToken: string; ip: string }) {
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
        // The token must be issued to this app, for a doctor in an organisation
        const tenantId = (claims.tenant as { id?: unknown } | undefined)?.id
        if (claims.client_id !== client.clientId || typeof claims.sub !== 'string' || typeof tenantId !== 'string')
            throw unauthorized
        const user = await this.store.findUserById(claims.sub)
        if (user?.status !== 'active') throw unauthorized
        const tenant = await this.store.findTenant(tenantId)
        if (tenant?.status !== 'active') throw forbidden

        const viewer = { userId: user.id, tenantId, superadmin: user.isSuperadmin }
        if (!(await this.vault.allowed(viewer))) throw new AppException('oidc.VAULT_NOT_ALLOWED', HttpStatus.FORBIDDEN)
        if ((await this.licenses.claim(tenantId, user.id, product, user.isSuperadmin)).status === 'none')
            throw forbidden

        const credentials = await this.vault.reveal(user.id)
        await this.audit.record('account.vault_retrieved', {
            tenantId,
            actorId: user.id,
            target: { type: 'user', id: user.id },
            details: { clientId: client.clientId, product, thumbprint: credentials.thumbprint }
        })
        return credentials
    }
}
