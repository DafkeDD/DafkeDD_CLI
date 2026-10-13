import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PKCE_CHALLENGE, PKCE_VERIFIER, pkceChallenge, randomToken, safeEqual, sha256 } from './crypto.js'
import { type Interaction, interactionKey, openInteraction, sealInteraction } from './interaction.js'
import { halfHash, JoseError, signJwt, verifyJwt } from './jose.js'
import { KeysService } from './keys.service.js'
import { OAuthError } from './oauth.error.js'
import { OIDC, OidcConfig } from './oidc.config.js'
import { hashPassword, verifyPassword } from './password.js'
import {
    type AuthorizationParams,
    type Membership,
    type OidcClient,
    OIDC_STORE,
    type OidcStore,
    type Session,
    type StoredUser
} from './store/oidc.store.js'

// Checked when the email does not exist, so a login attempt takes equally long either way.
const DUMMY_HASH = await hashPassword('not-a-real-password')

const PROMPTS = ['none', 'login', 'consent', 'select_account']
const MAX_STATE = 1024
const MAX_NONCE = 512

/** A login cookie the controller sets: `value` null removes it. */
export interface InteractionCookie {
    id: string
    value: string | null
}

export type AuthorizeResult =
    | { kind: 'page'; status: number; titleKey: string; textKey: string }
    | { kind: 'redirect'; location: string; interaction?: InteractionCookie }

export type LoginResult =
    | { kind: 'expired' }
    | { kind: 'form'; interaction: Interaction; client: OidcClient; errorKey: string; email: string }
    | { kind: 'no-tenant'; cookie: InteractionCookie }
    | { kind: 'choose-tenant'; interaction: Interaction; memberships: Membership[]; cookie: InteractionCookie }
    | { kind: 'done'; location: string; sessionId: string; cookie: InteractionCookie }

export interface TokenResponse {
    access_token: string
    token_type: 'Bearer'
    expires_in: number
    id_token: string
    scope: string
}

type Params = Record<string, unknown>

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)

/** The value of a request parameter. Undefined when absent; an OAuthError when it was sent more than once. */
function single(params: Params, name: string): string | undefined {
    const value = params[name]
    if (value === undefined || value === '') return undefined
    if (typeof value !== 'string') throw new OAuthError('invalid_request', `${name} must be sent once`)
    return value
}

/** The OpenID Connect server: authorization (with PKCE), login, tokens and userinfo. */
@Injectable()
export class OidcService implements OnApplicationBootstrap {
    private readonly logger = new Logger(OidcService.name)
    private prepared: Promise<void> | null = null

    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly keys: KeysService,
        private readonly config: OidcConfig,
        private readonly env: ConfigService
    ) {}

    onApplicationBootstrap() {
        // The API also starts while the database is down: everything is prepared again on the first request.
        this.prepare().catch((error: unknown) => {
            this.logger.warn(
                'OpenID Connect is not ready yet: ' + (error instanceof Error ? error.message : String(error))
            )
        })
    }

    /** Registers the clients of config/oidc-clients.json, creates the signing keys and the first admin. Once. */
    prepare(): Promise<void> {
        this.prepared ??= this.setup().catch((error: unknown) => {
            this.prepared = null
            throw error
        })
        return this.prepared
    }

    private async setup() {
        for (const client of await this.readClients()) await this.store.upsertClient(client)
        await this.keys.ensure()
        const admin = this.config.bootstrapAdmin()
        if (admin && (await this.store.bootstrapAdmin(admin))) {
            this.logger.log(`Created the first tenant "${admin.tenantName}" and its admin ${admin.email}`)
        }
        await this.store.deleteExpired(new Date())
    }

    /** Reads config/oidc-clients.json (or OIDC_CLIENTS_FILE). Secrets of confidential clients come from .env. */
    async readClients(): Promise<OidcClient[]> {
        const file = resolve(this.env.get<string>('OIDC_CLIENTS_FILE') ?? 'config/oidc-clients.json')
        const json = JSON.parse(await readFile(file, 'utf8')) as { clients?: Record<string, unknown>[] }
        return (json.clients ?? []).map(raw => {
            const clientId = text(raw.clientId)
            const type = raw.type === 'confidential' ? 'confidential' : 'public'
            const redirectUris = Array.isArray(raw.redirectUris) ? raw.redirectUris.map(String) : []
            if (!/^[A-Za-z0-9._-]{1,100}$/.test(clientId)) throw new Error(`Invalid clientId "${clientId}" in ${file}`)
            for (const uri of redirectUris) assertRedirectUri(uri)
            let secretHash: string | null = null
            if (type === 'confidential') {
                const secretEnv = text(raw.secretEnv)
                const secret = secretEnv ? this.env.get<string>(secretEnv) : undefined
                if (!secret || secret.length < 32)
                    throw new Error(
                        `Client ${clientId}: set a secret of at least 32 characters in ${secretEnv || 'secretEnv'}`
                    )
                secretHash = sha256(secret)
            }
            return {
                clientId,
                name: text(raw.name, clientId),
                type,
                secretHash,
                redirectUris,
                postLogoutRedirectUris: Array.isArray(raw.postLogoutRedirectUris)
                    ? raw.postLogoutRedirectUris.map(String)
                    : [],
                grantTypes: ['authorization_code'],
                scopes: Array.isArray(raw.scopes) ? raw.scopes.map(String) : ['openid'],
                firstParty: raw.firstParty === true
            } satisfies OidcClient
        })
    }

    // ------------------------------------------------------------------ discovery

    discovery() {
        const issuer = this.config.issuer
        return {
            issuer,
            authorization_endpoint: issuer + '/authorize',
            token_endpoint: issuer + '/token',
            userinfo_endpoint: issuer + '/userinfo',
            jwks_uri: issuer + '/jwks',
            scopes_supported: [...OIDC.SCOPES],
            response_types_supported: ['code'],
            response_modes_supported: ['query'],
            grant_types_supported: ['authorization_code'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            userinfo_signing_alg_values_supported: ['none'],
            token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
            code_challenge_methods_supported: ['S256'],
            acr_values_supported: [OIDC.ACR_PASSWORD],
            claims_supported: [
                'sub',
                'iss',
                'aud',
                'exp',
                'iat',
                'auth_time',
                'nonce',
                'acr',
                'amr',
                'sid',
                'name',
                'locale',
                'email',
                'email_verified',
                'tenant'
            ],
            ui_locales_supported: [...OIDC.LOCALES],
            claims_parameter_supported: false,
            request_parameter_supported: false,
            request_uri_parameter_supported: false,
            authorization_response_iss_parameter_supported: true
        }
    }

    async jwks() {
        await this.prepare()
        return this.keys.jwks()
    }

    // ------------------------------------------------------------------ authorization

    async authorize(query: Params, sessionId: string | undefined): Promise<AuthorizeResult> {
        await this.prepare()
        const page = (textKey: string): AuthorizeResult => ({
            kind: 'page',
            status: 400,
            titleKey: 'oidc.ERROR_TITLE',
            textKey
        })

        // Without a known client and an exact, registered redirect_uri there is nobody safe to send an error to.
        let clientId: string | undefined
        let redirectUri: string | undefined
        try {
            clientId = single(query, 'client_id')
            redirectUri = single(query, 'redirect_uri')
        } catch {
            return page('oidc.INVALID_REQUEST')
        }
        const client = clientId ? await this.store.findClient(clientId) : null
        if (!client) return page('oidc.UNKNOWN_CLIENT')
        if (!redirectUri || !client.redirectUris.includes(redirectUri)) return page('oidc.INVALID_REDIRECT')

        const rawState = typeof query.state === 'string' && query.state.length <= MAX_STATE ? query.state : null
        let params: AuthorizationParams
        try {
            params = this.validateAuthorization(query, client, redirectUri)
        } catch (error) {
            if (error instanceof OAuthError) return this.errorRedirect(redirectUri, error, rawState)
            throw error
        }

        const session = sessionId ? await this.usableSession(sessionId, params) : null
        if (session) return this.issueCode(params, session.session, session.user, session.membership)
        if (params.prompt.includes('none')) {
            return this.errorRedirect(
                redirectUri,
                new OAuthError('login_required', 'The user is not logged in'),
                params.state
            )
        }

        // The login itself is not stored: it goes into an encrypted cookie for /oidc/interaction/<id>.
        const id = randomToken()
        const sealed = this.seal({
            id,
            params,
            csrf: randomToken(),
            userId: null,
            expiresAt: Date.now() + OIDC.INTERACTION_SECONDS * 1000
        })
        if (sealed.length > OIDC.MAX_INTERACTION_COOKIE) {
            return this.errorRedirect(
                redirectUri,
                new OAuthError(
                    'invalid_request',
                    'The authorization request is too large (state, nonce or login_hint)'
                ),
                params.state
            )
        }
        const ui = this.config.loginUiUrl
        const location = new URL(ui ?? this.config.issuer + '/interaction/' + id)
        if (ui) location.searchParams.set('interaction', id)
        const locale = params.uiLocales[0]
        if (locale) location.searchParams.set('lang', locale)
        return { kind: 'redirect', location: location.toString(), interaction: { id, value: sealed } }
    }

    private seal(interaction: Interaction): string {
        return sealInteraction(interaction, interactionKey(this.config.masterKey()))
    }

    private validateAuthorization(query: Params, client: OidcClient, redirectUri: string): AuthorizationParams {
        for (const name of Object.keys(query)) single(query, name)
        if (query.request !== undefined)
            throw new OAuthError('request_not_supported', 'The request parameter is not supported')
        if (query.request_uri !== undefined) {
            throw new OAuthError('request_uri_not_supported', 'The request_uri parameter is not supported')
        }
        if (!client.grantTypes.includes('authorization_code')) {
            throw new OAuthError('unauthorized_client', 'This client may not use the authorization code flow')
        }
        if (single(query, 'response_type') !== 'code') {
            throw new OAuthError('unsupported_response_type', 'Only response_type=code is supported')
        }
        const responseMode = single(query, 'response_mode')
        if (responseMode !== undefined && responseMode !== 'query') {
            throw new OAuthError('invalid_request', 'Only response_mode=query is supported')
        }

        const requested = (single(query, 'scope') ?? '').split(' ').filter(Boolean)
        if (!requested.includes('openid')) throw new OAuthError('invalid_scope', 'The openid scope is required')
        const allowed: readonly string[] = OIDC.SCOPES
        const scope = [...new Set(requested.filter(value => allowed.includes(value) && client.scopes.includes(value)))]
        if (!scope.includes('openid')) throw new OAuthError('invalid_scope', 'This client may not use the openid scope')

        const codeChallenge = single(query, 'code_challenge')
        if (!codeChallenge) throw new OAuthError('invalid_request', 'code_challenge is required (PKCE)')
        if (single(query, 'code_challenge_method') !== 'S256') {
            throw new OAuthError('invalid_request', 'code_challenge_method must be S256')
        }
        if (!PKCE_CHALLENGE.test(codeChallenge)) throw new OAuthError('invalid_request', 'Invalid code_challenge')

        const prompt = (single(query, 'prompt') ?? '').split(' ').filter(Boolean)
        if (prompt.some(value => !PROMPTS.includes(value)))
            throw new OAuthError('invalid_request', 'Unknown prompt value')
        if (prompt.includes('none') && prompt.length > 1) {
            throw new OAuthError('invalid_request', 'prompt=none cannot be combined with other values')
        }

        const maxAgeText = single(query, 'max_age')
        if (maxAgeText !== undefined && !/^\d{1,9}$/.test(maxAgeText))
            throw new OAuthError('invalid_request', 'Invalid max_age')

        const state = single(query, 'state') ?? null
        if (state !== null && state.length > MAX_STATE) throw new OAuthError('invalid_request', 'state is too long')
        const nonce = single(query, 'nonce') ?? null
        if (nonce !== null && nonce.length > MAX_NONCE) throw new OAuthError('invalid_request', 'nonce is too long')

        const locales: readonly string[] = OIDC.LOCALES
        return {
            clientId: client.clientId,
            redirectUri,
            scope,
            state,
            nonce,
            codeChallenge,
            prompt,
            maxAge: maxAgeText === undefined ? null : Number(maxAgeText),
            loginHint: single(query, 'login_hint')?.slice(0, 254) ?? null,
            tenantHint: single(query, 'tenant_hint')?.slice(0, 100) ?? null,
            uiLocales: (single(query, 'ui_locales') ?? '')
                .split(' ')
                .map(value => value.toLowerCase().split('-')[0] ?? '')
                .filter(value => locales.includes(value))
        }
    }

    /** The existing browser session, when it may be used for this request without logging in again. */
    private async usableSession(sessionId: string, params: AuthorizationParams) {
        if (params.prompt.includes('login') || params.prompt.includes('select_account')) return null
        const session = await this.store.findSession(sha256(sessionId))
        if (!session) return null
        if (params.maxAge !== null && Date.now() - session.authTime.getTime() > params.maxAge * 1000) return null
        const user = await this.store.findUserById(session.userId)
        if (user?.status !== 'active') return null
        const membership = (await this.store.listMemberships(user.id)).find(item => item.tenantId === session.tenantId)
        if (!membership) return null
        if (params.tenantHint && params.tenantHint !== membership.tenantId && params.tenantHint !== membership.slug)
            return null
        return { session, user, membership }
    }

    // ------------------------------------------------------------------ login pages

    /** The running login of this id and its cookie (oidc_ia_<id>), with its client; null when expired or invalid. */
    async findInteraction(id: string, sealed: string | undefined) {
        const interaction = openInteraction(id, sealed, interactionKey(this.config.masterKey()))
        if (!interaction) return null
        const client = await this.store.findClient(interaction.params.clientId)
        return client ? { interaction, client } : null
    }

    async login(id: string, sealed: string | undefined, form: Params, allowed: boolean): Promise<LoginResult> {
        const found = await this.findInteraction(id, sealed)
        if (!found || typeof form.csrf !== 'string' || !safeEqual(form.csrf, found.interaction.csrf))
            return { kind: 'expired' }
        const { interaction, client } = found
        const email = typeof form.email === 'string' ? form.email.trim().toLowerCase().slice(0, 254) : ''
        const password = typeof form.password === 'string' ? form.password.slice(0, 128) : ''
        if (!allowed) return { kind: 'form', interaction, client, errorKey: 'oidc.TOO_MANY_ATTEMPTS', email }

        const user = email ? await this.store.findUserByEmail(email) : null
        const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)
        if (!user || !valid || user.status !== 'active') {
            return { kind: 'form', interaction, client, errorKey: 'oidc.INVALID_CREDENTIALS', email }
        }

        const memberships = await this.store.listMemberships(user.id)
        const hinted = memberships.find(
            item => item.tenantId === interaction.params.tenantHint || item.slug === interaction.params.tenantHint
        )
        const only = memberships.length === 1 ? memberships[0] : undefined
        const membership = hinted ?? only
        if (membership) return this.finish(interaction, user, membership)
        if (memberships.length === 0) return { kind: 'no-tenant', cookie: { id, value: null } }
        // The password was right: remember the user in the cookie while they choose an organisation.
        const chosen = { ...interaction, userId: user.id }
        return { kind: 'choose-tenant', interaction: chosen, memberships, cookie: { id, value: this.seal(chosen) } }
    }

    async chooseTenant(id: string, sealed: string | undefined, form: Params): Promise<LoginResult> {
        const found = await this.findInteraction(id, sealed)
        if (!found || typeof form.csrf !== 'string' || !safeEqual(form.csrf, found.interaction.csrf))
            return { kind: 'expired' }
        const { interaction } = found
        const user = interaction.userId ? await this.store.findUserById(interaction.userId) : null
        if (user?.status !== 'active') return { kind: 'expired' }
        const memberships = await this.store.listMemberships(user.id)
        const membership = memberships.find(item => item.tenantId === form.tenant)
        if (!membership)
            return { kind: 'choose-tenant', interaction, memberships, cookie: { id, value: sealed ?? null } }
        return this.finish(interaction, user, membership)
    }

    /**
     * Logged in: a new session (never reuse an old id), a code, and back to the client. The session remembers the
     * login, so a copy of the login cookie cannot log in a second time.
     */
    private async finish(interaction: Interaction, user: StoredUser, membership: Membership): Promise<LoginResult> {
        const sessionId = randomToken()
        const now = new Date()
        const session: Session = {
            idHash: sha256(sessionId),
            interactionHash: sha256(interaction.id),
            userId: user.id,
            tenantId: membership.tenantId,
            authTime: now,
            acr: OIDC.ACR_PASSWORD,
            amr: ['pwd'],
            expiresAt: new Date(now.getTime() + OIDC.SESSION_SECONDS * 1000)
        }
        if (!(await this.store.createSession(session))) return { kind: 'expired' }
        const result = await this.issueCode(interaction.params, session, user, membership)
        return {
            kind: 'done',
            location: result.kind === 'redirect' ? result.location : '',
            sessionId,
            cookie: { id: interaction.id, value: null }
        }
    }

    private async issueCode(
        params: AuthorizationParams,
        session: Session,
        user: StoredUser,
        membership: Membership
    ): Promise<AuthorizeResult> {
        const code = randomToken()
        await this.store.createCode({
            codeHash: sha256(code),
            clientId: params.clientId,
            userId: user.id,
            tenantId: membership.tenantId,
            sessionHash: session.idHash,
            redirectUri: params.redirectUri,
            scope: params.scope.join(' '),
            nonce: params.nonce,
            codeChallenge: params.codeChallenge,
            authTime: session.authTime,
            acr: session.acr,
            amr: session.amr,
            expiresAt: new Date(Date.now() + OIDC.CODE_SECONDS * 1000)
        })
        const location = new URL(params.redirectUri)
        location.searchParams.set('code', code)
        if (params.state !== null) location.searchParams.set('state', params.state)
        location.searchParams.set('iss', this.config.issuer)
        return { kind: 'redirect', location: location.toString() }
    }

    private errorRedirect(redirectUri: string, error: OAuthError, state: string | null): AuthorizeResult {
        const location = new URL(redirectUri)
        location.searchParams.set('error', error.error)
        location.searchParams.set('error_description', error.description)
        if (state !== null) location.searchParams.set('state', state)
        location.searchParams.set('iss', this.config.issuer)
        return { kind: 'redirect', location: location.toString() }
    }

    // ------------------------------------------------------------------ token endpoint

    async token(authorization: string | undefined, body: Params): Promise<TokenResponse> {
        await this.prepare()
        for (const name of Object.keys(body)) single(body, name)
        const client = await this.authenticateClient(authorization, body)

        const grantType = single(body, 'grant_type')
        if (grantType !== 'authorization_code') {
            throw new OAuthError('unsupported_grant_type', 'Only grant_type=authorization_code is supported')
        }
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
        if (!grant || grant.clientId !== client.clientId || grant.redirectUri !== redirectUri) throw invalid
        if (!PKCE_VERIFIER.test(verifier) || !safeEqual(pkceChallenge(verifier), grant.codeChallenge)) {
            throw new OAuthError('invalid_grant', 'The code_verifier does not match the code_challenge')
        }
        const user = await this.store.findUserById(grant.userId)
        const membership = user
            ? (await this.store.listMemberships(user.id)).find(item => item.tenantId === grant.tenantId)
            : undefined
        if (user?.status !== 'active' || !membership) throw invalid

        const now = Math.floor(Date.now() / 1000)
        const tenant = { id: membership.tenantId, name: membership.name, roles: membership.roles }
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
                auth_time: Math.floor(grant.authTime.getTime() / 1000),
                acr: grant.acr,
                tenant
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
                auth_time: Math.floor(grant.authTime.getTime() / 1000),
                ...(grant.nonce !== null ? { nonce: grant.nonce } : {}),
                acr: grant.acr,
                amr: grant.amr,
                sid: grant.sessionHash.slice(0, 32),
                at_hash: halfHash(accessToken),
                ...(grant.scope.split(' ').includes('tenant') ? { tenant } : {})
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

    // ------------------------------------------------------------------ userinfo

    async userinfo(token: string | undefined): Promise<Record<string, unknown>> {
        await this.prepare()
        if (!token) throw new OAuthError('invalid_token', 'An access token is required', 401)
        let payload
        try {
            const keys = await this.keys.verificationKeys()
            payload = verifyJwt(token, {
                keys: kid => keys.get(kid),
                algorithms: ['ES256'],
                issuer: this.config.issuer,
                audience: this.config.audience,
                typ: 'at+jwt'
            }).payload
        } catch (error) {
            if (error instanceof JoseError)
                throw new OAuthError('invalid_token', 'The access token is invalid or expired', 401)
            throw error
        }
        const scope = typeof payload.scope === 'string' ? payload.scope.split(' ') : []
        if (!scope.includes('openid') || typeof payload.sub !== 'string') {
            throw new OAuthError('insufficient_scope', 'The openid scope is required', 403)
        }
        const user = await this.store.findUserById(payload.sub)
        if (user?.status !== 'active') throw new OAuthError('invalid_token', 'The user no longer exists', 401)
        return {
            sub: user.id,
            ...(scope.includes('profile') ? { name: user.name, ...(user.locale ? { locale: user.locale } : {}) } : {}),
            ...(scope.includes('email') ? { email: user.email, email_verified: user.emailVerified } : {}),
            ...(scope.includes('tenant') ? { tenant: payload.tenant } : {})
        }
    }
}

/** Redirect URIs must be absolute, without a fragment, and HTTPS (plain HTTP only on localhost). */
export function assertRedirectUri(uri: string): void {
    let url: URL
    try {
        url = new URL(uri)
    } catch {
        throw new Error(`Invalid redirect URI "${uri}"`)
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) {
        throw new Error(`Redirect URI "${uri}" must use https (http only on localhost) and have no #fragment`)
    }
}
