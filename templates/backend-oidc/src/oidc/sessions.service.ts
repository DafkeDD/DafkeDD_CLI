import { createHmac } from 'node:crypto'
import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { AppException } from '../common/app.exception.js'
import { deriveKey, safeEqual, sha256 } from './crypto.js'
import { JoseError, verifyJwt } from './jose.js'
import { KeysService } from './keys.service.js'
import { OAuthError } from './oauth.error.js'
import { OidcConfig } from './oidc.config.js'
import { OidcService, type Params, single } from './oidc.service.js'
import { type OidcClient, OIDC_STORE, type OidcStore } from './store/oidc.store.js'

/** What the logout endpoint answers. */
export type LogoutResult =
    /** Logged out (or there was nothing to log out): back to the client. */
    | { kind: 'redirect'; location: string }
    /** Logged out, no address to go back to: the page "You are logged out". */
    | { kind: 'done' }
    /** The browser has a session, but nothing proves the client asks for this user: ask first (a form with a CSRF token). */
    | {
          kind: 'confirm'
          csrf: string
          client: OidcClient | null
          fields: Record<string, string>
          formTargets: string[]
      }
    | { kind: 'error'; textKey: string }

/**
 * Ending logins: RP-initiated logout (OpenID Connect RP-Initiated Logout 1.0, the end_session_endpoint) and the
 * sessions of the own account (/me/sessions). Ending a session also stops its refresh tokens and, through the sid
 * claim, its access tokens.
 */
@Injectable()
export class SessionsService {
    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly keys: KeysService,
        private readonly oidc: OidcService,
        private readonly config: OidcConfig
    ) {}

    // ---------------------------------------------------------------- logout

    /** The CSRF token of the confirmation form: bound to the session cookie, so another site cannot make one. */
    private csrf(sessionCookie: string): string {
        return createHmac('sha256', deriveKey(this.config.masterKey(), 'oidc logout v1'))
            .update(sessionCookie)
            .digest('base64url')
    }

    /**
     * GET or POST /oidc/logout. With an id_token_hint of the user of this browser the session ends at once; without
     * one (or for another user) the user confirms first. `post_logout_redirect_uri` must be registered for the client.
     */
    async logout(params: Params, sessionCookie: string | undefined, confirmed: boolean): Promise<LogoutResult> {
        await this.oidc.prepare()
        let hint: string | undefined
        let clientId: string | undefined
        let redirect: string | undefined
        let state: string | undefined
        try {
            hint = single(params, 'id_token_hint')
            clientId = single(params, 'client_id')
            redirect = single(params, 'post_logout_redirect_uri')
            state = single(params, 'state')
        } catch (error) {
            if (error instanceof OAuthError) return { kind: 'error', textKey: 'oidc.INVALID_REQUEST' }
            throw error
        }

        // The ID token we gave the client says who it logs out; an expired one is fine, a forged one is not
        let hinted: { sub: string; aud: string; sid: unknown } | null = null
        if (hint) {
            try {
                const keys = await this.keys.verificationKeys()
                const { payload } = verifyJwt(hint, {
                    keys: kid => keys.get(kid),
                    algorithms: ['RS256'],
                    issuer: this.config.issuer,
                    ignoreExpiry: true
                })
                const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud
                if (typeof payload.sub !== 'string' || typeof aud !== 'string') throw new JoseError('Incomplete')
                hinted = { sub: payload.sub, aud, sid: payload.sid }
            } catch (error) {
                if (error instanceof JoseError) return { kind: 'error', textKey: 'oidc.LOGOUT_INVALID_HINT' }
                throw error
            }
            if (clientId !== undefined && clientId !== hinted.aud)
                return { kind: 'error', textKey: 'oidc.LOGOUT_INVALID_HINT' }
            clientId = hinted.aud
        }
        const client = clientId ? await this.store.findClient(clientId) : null
        if (clientId && !client) return { kind: 'error', textKey: 'oidc.UNKNOWN_CLIENT' }
        if (redirect !== undefined && !client?.postLogoutRedirectUris.includes(redirect))
            return { kind: 'error', textKey: 'oidc.INVALID_POST_LOGOUT_REDIRECT' }

        const finish = (): LogoutResult => {
            if (!redirect) return { kind: 'done' }
            const location = new URL(redirect)
            if (state !== undefined) location.searchParams.set('state', state)
            return { kind: 'redirect', location: location.toString() }
        }
        const session = sessionCookie ? await this.store.findSession(sha256(sessionCookie)) : null
        if (!session || !sessionCookie) return finish()

        const sure =
            // An ID token of THIS session (sid): an old ID token of another login still asks first
            (hinted?.sub === session.userId && hinted.sid === session.id) ||
            (confirmed && typeof params.csrf === 'string' && safeEqual(params.csrf, this.csrf(sessionCookie)))
        if (sure) {
            await this.store.endSession(session.idHash)
            return finish()
        }
        const fields: Record<string, string> = {
            ...(clientId ? { client_id: clientId } : {}),
            ...(redirect ? { post_logout_redirect_uri: redirect } : {}),
            ...(state !== undefined ? { state } : {})
        }
        return {
            kind: 'confirm',
            csrf: this.csrf(sessionCookie),
            client,
            fields,
            formTargets: redirect ? [new URL(redirect).origin] : []
        }
    }

    // ---------------------------------------------------------------- sessions of the own account

    /** The active sessions of the account; `current` is the one of this access token. */
    async list(userId: string, currentId: string) {
        const sessions = await this.store.listUserSessions(userId)
        return sessions.map(session => ({
            id: session.id,
            current: session.id === currentId,
            tenant: session.tenantId ? { id: session.tenantId, name: session.tenantName } : null,
            userAgent: session.userAgent,
            acr: session.acr,
            amr: session.amr,
            createdAt: session.createdAt,
            lastUsedAt: session.lastUsedAt,
            expiresAt: session.expiresAt
        }))
    }

    /** Ends one session of the account (also the current one: that is logging out). */
    async end(userId: string, id: string) {
        if (!(await this.store.endUserSession(userId, id)))
            throw new AppException('oidc.SESSION_NOT_FOUND', HttpStatus.NOT_FOUND)
        return { ended: 1 }
    }

    /** Ends every other session of the account: "log out everywhere else". */
    async endOthers(userId: string, currentId: string) {
        return { ended: await this.store.endOtherUserSessions(userId, currentId || null) }
    }
}
