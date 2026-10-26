import { createHmac, randomUUID } from 'node:crypto'
import { AuditService } from '../audit/audit.service.js'
import { AppLicenses } from './app-licenses.js'
import { AppRolesService } from './app-roles.service.js'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { deriveKey, PKCE_VERIFIER, pkceChallenge, randomToken, safeEqual, sha256 } from './crypto.js'
import { halfHash, signJwt } from './jose.js'
import { KeysService } from './keys.service.js'
import { OAuthError } from './oauth.error.js'
import { OIDC, OidcConfig } from './oidc.config.js'
import { OidcService, type Params, single } from './oidc.service.js'
import {
    type Membership,
    type OidcClient,
    OIDC_STORE,
    type OidcStore,
    type RefreshToken,
    type Session,
    type StoredUser
} from './store/oidc.store.js'

export interface TokenResponse {
    access_token: string
    token_type: 'Bearer'
    expires_in: number
    id_token: string
    scope: string
    /** Only for clients with the refresh_token grant (config/oidc-clients.json). */
    refresh_token?: string
}

/** What a token is issued for: the login (session) behind it, and how it went. */
interface Grant {
    scope: string
    nonce: string | null
    session: Session
}

/** RFC 7662: an inactive token says nothing more than this. */
const INACTIVE = { active: false } as const

/**
 * The token endpoint (authorization code with PKCE, refresh token with rotation), revocation (RFC 7009) and
 * introspection (RFC 7662). Errors are OAuthErrors in the format of RFC 6749 section 5.2.
 */
@Injectable()
export class TokensService {
    private readonly logger = new Logger(TokensService.name)

    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly keys: KeysService,
        private readonly oidc: OidcService,
        private readonly config: OidcConfig,
        private readonly audit: AuditService,
        private readonly licenses: AppLicenses,
        private readonly appRoles: AppRolesService
    ) {}

    async token(authorization: string | undefined, body: Params): Promise<TokenResponse> {
        await this.oidc.prepare()
        for (const name of Object.keys(body)) single(body, name)
        const client = await this.authenticateClient(authorization, body)
        const grantType = single(body, 'grant_type')
        if (grantType === 'authorization_code') return this.codeGrant(client, body)
        if (grantType === 'refresh_token') return this.refreshGrant(client, body)
        throw new OAuthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported')
    }

    // ------------------------------------------------------------------ authorization code

    private async codeGrant(client: OidcClient, body: Params): Promise<TokenResponse> {
        if (!client.grantTypes.includes('authorization_code')) {
            throw new OAuthError('unauthorized_client', 'This client may not use the authorization code flow')
        }
        const code = single(body, 'code')
        const redirectUri = single(body, 'redirect_uri')
        const verifier = single(body, 'code_verifier')
        if (!code || !redirectUri || !verifier) {
            throw new OAuthError('invalid_request', 'code, redirect_uri and code_verifier are required')
        }

        const grant = await this.store.consumeCode(sha256(code))
        const invalid = new OAuthError(
            'invalid_grant',
            'The code is invalid, expired, used or not issued to this client'
        )
        if (!grant) {
            // A code that comes back was copied: what it gave is revoked (RFC 6749 section 4.1.2)
            const family = await this.store.usedCodeRefreshFamily(sha256(code))
            if (family) await this.store.revokeRefreshFamily(family)
            throw invalid
        }
        if (grant.clientId !== client.clientId || grant.redirectUri !== redirectUri) throw invalid
        if (!PKCE_VERIFIER.test(verifier) || !safeEqual(pkceChallenge(verifier), grant.codeChallenge)) {
            throw new OAuthError('invalid_grant', 'The code_verifier does not match the code_challenge')
        }
        // The login behind the code must still be active (not logged out in the meantime)
        const session = await this.store.findSession(grant.sessionHash)
        if (session?.userId !== grant.userId) throw invalid
        const { user, membership } = await this.account(grant.userId, grant.tenantId, invalid)

        const response = await this.issue(client, user, membership, { scope: grant.scope, nonce: grant.nonce, session })
        if (client.grantTypes.includes('refresh_token')) {
            const refresh = randomToken()
            const familyId = randomUUID()
            await this.store.createRefreshToken({
                tokenHash: sha256(refresh),
                familyId,
                sessionId: session.id,
                clientId: client.clientId,
                userId: user.id,
                tenantId: membership?.tenantId ?? null,
                scope: grant.scope,
                expiresAt: session.expiresAt
            })
            await this.store.setCodeRefreshFamily(sha256(code), familyId)
            response.refresh_token = refresh
        }
        return response
    }

    // ------------------------------------------------------------------ refresh token

    /**
     * A new access token (and ID token) for a refresh token, and a new refresh token: the old one is used up. It works
     * while its session is active (logout, a password reset or ending the session stops it), and checks the account,
     * the organisation and the role again. An old refresh token that comes back after the grace period means it was
     * copied: its whole family and its session end.
     */
    private async refreshGrant(client: OidcClient, body: Params): Promise<TokenResponse> {
        if (!client.grantTypes.includes('refresh_token')) {
            throw new OAuthError('unauthorized_client', 'This client may not use refresh tokens')
        }
        const token = single(body, 'refresh_token')
        if (!token) throw new OAuthError('invalid_request', 'refresh_token is required')
        const invalid = new OAuthError('invalid_grant', 'The refresh token is invalid, expired or revoked')
        const stored = await this.store.findRefreshToken(sha256(token))
        if (!stored || stored.clientId !== client.clientId) throw invalid
        const session = await this.store.findSessionById(stored.sessionId)
        if (session?.userId !== stored.userId || !this.oidc.strongEnough(session.acr)) throw invalid

        // A smaller scope may be asked, never a larger one (RFC 6749 section 6)
        const granted = stored.scope.split(' ')
        const asked = single(body, 'scope')
        const scope = asked === undefined ? granted : asked.split(' ').filter(Boolean)
        if (scope.some(value => !granted.includes(value)) || !scope.includes('openid')) {
            throw new OAuthError('invalid_scope', 'The scope may only be the same as, or smaller than, the original')
        }

        const { user, membership } = await this.account(stored.userId, stored.tenantId, invalid)
        const next = this.successor(token)
        const result = await this.store.rotateRefreshToken(
            sha256(token),
            { tokenHash: sha256(next), scope: scope.join(' '), expiresAt: session.expiresAt },
            OIDC.REFRESH_REUSE_GRACE_SECONDS * 1000
        )
        if (result.status === 'reused') {
            this.logger.warn(`A used refresh token came back: family and session of user ${user.id} ended`)
            await this.store.endSession(session.idHash)
            await this.audit.record('login.token_reuse', {
                tenantId: stored.tenantId,
                actorId: null,
                target: { type: 'user', id: user.id },
                details: { client: client.clientId, session: session.id }
            })
            throw invalid
        }
        if (result.status !== 'ok') throw invalid
        await this.store.touchSession(session.id).catch(() => undefined)
        const response = await this.issue(client, user, membership, { scope: scope.join(' '), nonce: null, session })
        return { ...response, refresh_token: next }
    }

    /**
     * The next refresh token, derived from the current one (HMAC with a key of this server): two requests with the same
     * token at the same moment get the same successor, so there is never a second, unnoticed chain of tokens.
     */
    private successor(token: string): string {
        return createHmac('sha256', deriveKey(this.config.masterKey(), 'oidc refresh successor v1'))
            .update(token)
            .digest('base64url')
    }

    /** The account and its organisation, checked again (blocked account, removed or disabled member, suspended tenant). */
    private async account(userId: string, tenantId: string | null, invalid: OAuthError) {
        const user = await this.store.findUserById(userId)
        if (user?.status !== 'active') throw invalid
        // No tenant: a platform login, only for superadmins
        const membership =
            tenantId === null ? null : (await this.oidc.memberships(user)).find(item => item.tenantId === tenantId)
        if (membership === undefined || (membership === null && !user.isSuperadmin)) throw invalid
        return { user, membership }
    }

    /** Signs a new access token (ES256, at+jwt) and ID token (RS256). Both carry the session as `sid`. */
    private async issue(
        client: OidcClient,
        user: StoredUser,
        membership: Membership | null,
        grant: Grant
    ): Promise<TokenResponse> {
        const now = Math.floor(Date.now() / 1000)
        const authTime = Math.floor(grant.session.authTime.getTime() / 1000)
        // An application of others only sees the organisation (and superadmin) when the user allowed the tenant scope
        const tenantVisible = client.firstParty || grant.scope.split(' ').includes('tenant')
        const tenantClaim =
            membership && tenantVisible
                ? { tenant: { id: membership.tenantId, name: membership.name, role: membership.role } }
                : {}
        const superadmin = user.isSuperadmin && tenantVisible ? { superadmin: true } : {}
        // An app that sells a product: may this user use it in this organisation? Checked again at every refresh.
        const license = client.product
            ? {
                  license: await this.licenses.claim(
                      membership?.tenantId ?? null,
                      user.id,
                      client.product,
                      user.isSuperadmin
                  )
              }
            : {}
        // An app with roles: the roles of the user in this organisation (given by its admins, or the default ones). In an
        // app that sells a product only with a licence: a seat, a running demo (trial) or a superadmin; none without
        const licensed = license.license?.status !== 'none'
        const roles = client.roles?.length
            ? { roles: licensed ? await this.appRoles.claim(client, membership?.tenantId ?? null, user.id) : [] }
            : {}
        const accessKey = await this.keys.signingKey('ES256')
        const accessToken = signJwt(
            {
                iss: this.config.issuer,
                sub: user.id,
                aud: this.config.audience,
                client_id: client.clientId,
                scope: grant.scope,
                iat: now,
                exp: now + OIDC.ACCESS_TOKEN_SECONDS,
                jti: randomUUID(),
                auth_time: authTime,
                acr: grant.session.acr,
                sid: grant.session.id,
                ...tenantClaim,
                ...superadmin,
                ...license,
                ...roles
            },
            { alg: 'ES256', kid: accessKey.kid, typ: 'at+jwt' },
            accessKey.privateKey
        )
        const idKey = await this.keys.signingKey('RS256')
        const idToken = signJwt(
            {
                iss: this.config.issuer,
                sub: user.id,
                aud: client.clientId,
                iat: now,
                exp: now + OIDC.ID_TOKEN_SECONDS,
                auth_time: authTime,
                ...(grant.nonce !== null ? { nonce: grant.nonce } : {}),
                acr: grant.session.acr,
                amr: grant.session.amr,
                sid: grant.session.id,
                at_hash: halfHash(accessToken),
                ...(grant.scope.split(' ').includes('tenant')
                    ? { ...tenantClaim, ...superadmin, ...license, ...roles }
                    : {})
            },
            { alg: 'RS256', kid: idKey.kid, typ: 'JWT' },
            idKey.privateKey
        )
        return {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: OIDC.ACCESS_TOKEN_SECONDS,
            id_token: idToken,
            scope: grant.scope
        }
    }

    // ------------------------------------------------------------------ revocation (RFC 7009)

    /**
     * Revokes a refresh token of this client, with its whole family. Unknown tokens and tokens of other clients get the
     * same 200 answer (nothing to learn). Access tokens cannot be revoked one by one: they live 10 minutes and stop
     * with their session (log out, or end the session on /me/sessions).
     */
    async revoke(authorization: string | undefined, body: Params): Promise<void> {
        await this.oidc.prepare()
        for (const name of Object.keys(body)) single(body, name)
        const client = await this.authenticateClient(authorization, body)
        const token = single(body, 'token')
        if (!token) throw new OAuthError('invalid_request', 'token is required')
        const hint = single(body, 'token_type_hint')
        if (hint === 'access_token' || token.includes('.')) {
            throw new OAuthError(
                'unsupported_token_type',
                'Access tokens expire after 10 minutes and stop with their session: revoke the refresh token or log out'
            )
        }
        const stored = await this.store.findRefreshToken(sha256(token))
        if (stored?.clientId === client.clientId) await this.store.revokeRefreshFamily(stored.familyId)
    }

    // ------------------------------------------------------------------ introspection (RFC 7662)

    /**
     * Is a token active, and what does it say? Only for confidential clients (resource servers, other backends): a
     * public client has nothing to prove who it is. Refresh tokens can only be introspected by their own client.
     */
    async introspect(authorization: string | undefined, body: Params): Promise<Record<string, unknown>> {
        await this.oidc.prepare()
        for (const name of Object.keys(body)) single(body, name)
        const client = await this.authenticateClient(authorization, body)
        if (client.type !== 'confidential') {
            throw new OAuthError('invalid_client', 'Only confidential clients may use introspection', 401)
        }
        const token = single(body, 'token')
        if (!token) throw new OAuthError('invalid_request', 'token is required')
        if (token.includes('.')) return this.introspectAccessToken(token)
        const stored = await this.store.findRefreshToken(sha256(token))
        if (stored?.clientId !== client.clientId) return INACTIVE
        return this.introspectRefreshToken(stored)
    }

    private async introspectAccessToken(token: string) {
        let claims: Record<string, unknown>
        try {
            claims = await this.oidc.verifyAccessToken(token)
        } catch (error) {
            if (error instanceof OAuthError) return INACTIVE
            throw error
        }
        const user = typeof claims.sub === 'string' ? await this.store.findUserById(claims.sub) : null
        if (user?.status !== 'active') return INACTIVE
        const pick = [
            'scope',
            'client_id',
            'sub',
            'aud',
            'iss',
            'exp',
            'iat',
            'jti',
            'sid',
            'acr',
            'auth_time',
            'tenant'
        ]
        return {
            active: true,
            token_type: 'Bearer',
            ...Object.fromEntries(pick.filter(name => claims[name] !== undefined).map(name => [name, claims[name]])),
            ...(user.isSuperadmin ? { superadmin: true } : {})
        }
    }

    private async introspectRefreshToken(stored: RefreshToken) {
        const now = new Date()
        if (stored.revokedAt || stored.usedAt || stored.expiresAt <= now) return INACTIVE
        // The same checks as a refresh: the session, the account and the organisation
        const session = await this.store.findSessionById(stored.sessionId)
        if (session?.userId !== stored.userId || !this.oidc.strongEnough(session.acr)) return INACTIVE
        try {
            await this.account(stored.userId, stored.tenantId, new OAuthError('invalid_grant', 'inactive'))
        } catch (error) {
            if (error instanceof OAuthError) return INACTIVE
            throw error
        }
        return {
            active: true,
            token_type: 'refresh_token',
            client_id: stored.clientId,
            sub: stored.userId,
            scope: stored.scope,
            exp: Math.floor(stored.expiresAt.getTime() / 1000),
            iss: this.config.issuer,
            sid: stored.sessionId
        }
    }

    // ------------------------------------------------------------------ clients

    /** client_secret_basic, client_secret_post or none (public clients, protected by PKCE). */
    private async authenticateClient(authorization: string | undefined, body: Params): Promise<OidcClient> {
        let basicId: string | undefined
        let basicSecret: string | undefined
        if (authorization?.startsWith('Basic ')) {
            const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8')
            const colon = decoded.indexOf(':')
            if (colon < 0) throw new OAuthError('invalid_client', 'Malformed Basic authentication', 401)
            try {
                basicId = decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, ' '))
                basicSecret = decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, ' '))
            } catch {
                throw new OAuthError('invalid_client', 'Malformed Basic authentication', 401)
            }
        }
        const bodyId = single(body, 'client_id')
        const bodySecret = single(body, 'client_secret')
        if (basicId !== undefined && bodySecret !== undefined) {
            throw new OAuthError('invalid_request', 'Use only one client authentication method')
        }
        if (basicId !== undefined && bodyId !== undefined && bodyId !== basicId) {
            throw new OAuthError('invalid_request', 'client_id does not match the Basic authentication')
        }
        const clientId = basicId ?? bodyId
        const secret = basicSecret ?? bodySecret
        const client = clientId ? await this.store.findClient(clientId) : null
        const failed = new OAuthError('invalid_client', 'Client authentication failed', 401)
        if (!client) throw failed
        if (client.type === 'confidential') {
            if (!secret || !client.secretHash || !safeEqual(sha256(secret), client.secretHash)) throw failed
        } else if (secret !== undefined) {
            throw failed
        }
        return client
    }
}
