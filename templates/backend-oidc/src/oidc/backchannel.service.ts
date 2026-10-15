import { randomUUID } from 'node:crypto'
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { AuditService } from '../audit/audit.service.js'
import { signJwt } from './jose.js'
import { KeysService } from './keys.service.js'
import { OIDC, OidcConfig } from './oidc.config.js'
import { type LogoutJob, OIDC_STORE, type OidcStore } from './store/oidc.store.js'

/** The event of a logout token (OpenID Connect Back-Channel Logout 1.0). */
export const BACKCHANNEL_EVENT = 'http://schemas.openid.net/event/backchannel-logout'
/** Tries per logout token: now, after 30 seconds, 2, 8 and 32 minutes. */
export const BACKCHANNEL_ATTEMPTS = 5
const BATCH = 20
const TIMEOUT_MS = 5000

/**
 * Back-channel logout: when a session ends (logout, ended on /security, password reset, member disabled, a stolen
 * refresh token), every client that got a code in it and has a `backchannelLogoutUri` receives a signed logout token
 * from server to server, so it can end its own session too, even when the browser is closed. The database queues the
 * tokens (a trigger on oidc_sessions); this service delivers them every few seconds, with retries.
 */
@Injectable()
export class BackchannelService implements OnApplicationBootstrap, OnModuleDestroy {
    private readonly logger = new Logger('BackchannelLogout')
    private timer: NodeJS.Timeout | null = null
    private running: Promise<number> | null = null

    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly keys: KeysService,
        private readonly config: OidcConfig,
        private readonly audit: AuditService
    ) {}

    onApplicationBootstrap() {
        const seconds = this.config.backchannelIntervalSeconds
        if (seconds <= 0) return
        this.timer = setInterval(() => void this.flush().catch(() => undefined), seconds * 1000)
        this.timer.unref()
    }

    onModuleDestroy() {
        if (this.timer) clearInterval(this.timer)
    }

    /** Delivers the logout tokens that are due now; returns how many were delivered. One run at a time. */
    flush(): Promise<number> {
        this.running ??= this.deliverDue().finally(() => {
            this.running = null
        })
        return this.running
    }

    private async deliverDue(): Promise<number> {
        let delivered = 0
        for (;;) {
            const jobs = await this.store.claimLogouts(BATCH, BACKCHANNEL_ATTEMPTS)
            if (jobs.length === 0) return delivered
            const results = await Promise.all(jobs.map(job => this.deliver(job)))
            delivered += results.filter(Boolean).length
            if (jobs.length < BATCH) return delivered
        }
    }

    /** The logout token for one client: who (sub), which session (sid), signed like an ID token, valid 2 minutes. */
    async logoutToken(job: Pick<LogoutJob, 'sessionId' | 'userId' | 'clientId'>): Promise<string> {
        const key = await this.keys.signingKey('RS256')
        const now = Math.floor(Date.now() / 1000)
        return signJwt(
            {
                iss: this.config.issuer,
                aud: job.clientId,
                iat: now,
                exp: now + OIDC.LOGOUT_TOKEN_SECONDS,
                jti: randomUUID(),
                sub: job.userId,
                sid: job.sessionId,
                events: { [BACKCHANNEL_EVENT]: {} }
            },
            // A logout token is never mistaken for an ID token (RFC 8725): its own type, and no nonce
            { alg: 'RS256', kid: key.kid, typ: 'logout+jwt' },
            key.privateKey
        )
    }

    private async deliver(job: LogoutJob): Promise<boolean> {
        const client = await this.store.findClient(job.clientId)
        const uri = client?.backchannelLogoutUri
        if (!uri) {
            await this.store.finishLogout(job.id)
            return false
        }
        let reason: string
        try {
            const response = await fetch(uri, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-store' },
                body: new URLSearchParams({ logout_token: await this.logoutToken(job) }).toString(),
                // Never somewhere else: a redirect is a failure
                redirect: 'error',
                signal: AbortSignal.timeout(TIMEOUT_MS)
            })
            await response.body?.cancel().catch(() => undefined)
            if (response.ok) {
                await this.store.finishLogout(job.id)
                return true
            }
            reason = 'HTTP ' + response.status
        } catch (error) {
            reason = error instanceof Error ? error.name : 'error'
        }
        const last = job.attempts >= BACKCHANNEL_ATTEMPTS
        this.logger.warn(
            `Back-channel logout to ${job.clientId} failed (${reason}), try ${job.attempts} of ${BACKCHANNEL_ATTEMPTS}` +
                (last ? ': given up' : '')
        )
        if (last)
            await this.audit.record('login.backchannel_failed', {
                tenantId: null,
                actorId: null,
                target: { type: 'session', id: job.sessionId },
                details: { client: job.clientId, reason }
            })
        return false
    }
}
