import { createHmac, randomUUID } from 'node:crypto'
import { AuditService } from '../audit/audit.service.js'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { HttpStatus, Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { decrypt, deriveKey, encrypt, PKCE_CHALLENGE, randomToken, safeEqual, sha256 } from './crypto.js'
import { PasskeyService } from './passkeys/passkey.service.js'
import { type ExternalAttempt, type ExternalIdentity, ExternalService } from './external/external.service.js'
import { type Interaction, interactionKey, openInteraction, sealInteraction } from './interaction.js'
import { JoseError, verifyJwt } from './jose.js'
import { AppException } from '../common/app.exception.js'
import { EidService } from './eid.service.js'
import { KeysService } from './keys.service.js'
import { MFA_AMR, MfaService, type MfaSetup, type SecondFactor } from './mfa.service.js'
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

/** How the user logged in after the second factor: password or the other server (fed), and the code. */
function secondFactorAmr(interaction: Interaction, factor: SecondFactor): string[] {
    return interaction.amr.includes('fed')
        ? ['fed', ...MFA_AMR[factor].filter(value => value !== 'pwd')]
        : MFA_AMR[factor]
}

/**
 * The cookie of a login at the other server is named after its state: logins in several tabs do not overwrite each
 * other, and a callback with another state never touches it.
 */
export const externalCookieName = (state: string) => 'oidc_ext_' + sha256('external:' + state).slice(0, 16)

/** The cookie of a login at the other server, from the start until its callback (path /oidc/external). */
interface ExternalCookie {
    id: string
    interaction: string
    attempt: ExternalAttempt
}

// Checked when the email does not exist, so a login attempt takes equally long either way.
const DUMMY_HASH = await hashPassword('not-a-real-password')

const PROMPTS = ['none', 'login', 'consent', 'select_account']
/** Grant types a client can have in config/oidc-clients.json. */
const GRANT_TYPES = ['authorization_code', 'refresh_token']
/** tenant (choice) or tenant_hint for a login of a superadmin without an organisation: platform management. */
export const PLATFORM = 'platform'
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
    | {
          kind: 'form'
          interaction: Interaction
          client: OidcClient
          errorKey: string
          email: string
          cookie?: InteractionCookie
      }
    | { kind: 'no-tenant'; cookie: InteractionCookie }
    | {
          kind: 'choose-tenant'
          interaction: Interaction
          memberships: Membership[]
          /** A superadmin can also log in without an organisation (platform management). */
          platform: boolean
          cookie: InteractionCookie
      }
    | { kind: 'done'; location: string; sessionId: string; cookie: InteractionCookie }
    | { kind: 'mfa'; interaction: Interaction; client: OidcClient; cookie: InteractionCookie; errorKey?: string }
    | {
          kind: 'mfa-setup'
          interaction: Interaction
          client: OidcClient
          setup: MfaSetup
          cookie: InteractionCookie
          errorKey?: string
      }
    | { kind: 'recovery-codes'; interaction: Interaction; recoveryCodes: string[]; cookie: InteractionCookie }
    /** The options for navigator.credentials.get() (JSON only). */
    | { kind: 'passkey-challenge'; options: Record<string, unknown>; cookie: InteractionCookie }
    /** A nonce for the eID bridge (JSON only). */
    | { kind: 'eid-challenge'; nonce: string; cookie: InteractionCookie }
    /** To the other OpenID Connect server; `external` is the cookie that remembers this login until it comes back. */
    | { kind: 'external'; location: string; external: string; cookieName: string }

export type Params = Record<string, unknown>

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)

/** The value of a request parameter. Undefined when absent; an OAuthError when it was sent more than once. */
export function single(params: Params, name: string): string | undefined {
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
        private readonly mfa: MfaService,
        private readonly eid: EidService,
        private readonly config: OidcConfig,
        private readonly env: ConfigService,
        private readonly audit: AuditService,
        private readonly external: ExternalService,
        private readonly passkeys: PasskeyService
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
            this.logger.log(`Created the superadmin ${admin.email}`)
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
            const postLogoutRedirectUris = Array.isArray(raw.postLogoutRedirectUris)
                ? raw.postLogoutRedirectUris.map(String)
                : []
            for (const uri of [...redirectUris, ...postLogoutRedirectUris]) assertRedirectUri(uri)
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
                postLogoutRedirectUris,
                // refresh_token: the client also gets a refresh token (bound to the session, rotated at every use)
                grantTypes: Array.isArray(raw.grantTypes)
                    ? GRANT_TYPES.filter(type => (raw.grantTypes as unknown[]).includes(type))
                    : ['authorization_code'],
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
            end_session_endpoint: issuer + '/logout',
            revocation_endpoint: issuer + '/revoke',
            introspection_endpoint: issuer + '/introspect',
            scopes_supported: [...OIDC.SCOPES],
            response_types_supported: ['code'],
            response_modes_supported: ['query'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            userinfo_signing_alg_values_supported: ['none'],
            token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
            revocation_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
            introspection_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
            code_challenge_methods_supported: ['S256'],
            acr_values_supported: [OIDC.ACR_PASSWORD, OIDC.ACR_MFA, ...(this.eid.enabled ? [OIDC.ACR_EID] : [])],
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

    async authorize(query: Params, sessionId: string | undefined, userAgent = ''): Promise<AuthorizeResult> {
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
            mfaPending: false,
            enrolling: false,
            amr: [],
            eidNonce: null,
            passkeyChallenge: null,
            // Shown on /me/sessions ("Chrome on Windows"); shortened so the login cookie stays small
            userAgent: userAgent.slice(0, OIDC.USER_AGENT_MAX),
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
        // A session from before two-step verification was required does not count any more (the eID counts as two steps)
        if (!this.strongEnough(session.acr)) return null
        if (params.maxAge !== null && Date.now() - session.authTime.getTime() > params.maxAge * 1000) return null
        const user = await this.store.findUserById(session.userId)
        if (user?.status !== 'active') return null
        // The session proves who the user is; the tenant comes from tenant_hint (switching organisation without a new
        // password and code), or else from the session. No tenant: a platform login, only for superadmins.
        const hint = params.tenantHint
        const wanted = hint ?? session.tenantId ?? PLATFORM
        if (wanted === PLATFORM) return user.isSuperadmin ? { session, user, membership: null } : null
        const membership = (await this.memberships(user)).find(
            item => item.tenantId === wanted || (hint !== null && item.slug === wanted)
        )
        return membership ? { session, user, membership } : null
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
        if (this.config.externalOnly)
            return { kind: 'form', interaction, client, errorKey: 'oidc.PASSWORD_LOGIN_OFF', email }
        if (!allowed) {
            await this.loginFailed('password', 'too_many_attempts', email, null)
            return { kind: 'form', interaction, client, errorKey: 'oidc.TOO_MANY_ATTEMPTS', email }
        }

        const user = email ? await this.store.findUserByEmail(email) : null
        const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)
        if (!user || !valid || user.status !== 'active') {
            const reason = !user ? 'unknown_email' : !valid ? 'wrong_password' : 'account_blocked'
            await this.loginFailed('password', reason, email, user?.id ?? null)
            return { kind: 'form', interaction, client, errorKey: 'oidc.INVALID_CREDENTIALS', email }
        }
        // Only said after the right password, so it does not reveal which email addresses have an account
        if (!user.emailVerified) {
            await this.loginFailed('password', 'email_not_verified', email, user.id)
            return { kind: 'form', interaction, client, errorKey: 'oidc.EMAIL_NOT_VERIFIED', email }
        }

        // Two-step verification: the password was right, now the code of the authenticator app
        if (user.mfaEnabled) {
            const waiting = { ...interaction, userId: user.id, mfaPending: true, enrolling: false, amr: ['pwd'] }
            return { kind: 'mfa', interaction: waiting, client, cookie: { id, value: this.seal(waiting) } }
        }
        // Required but not set up yet: set it up now (QR code), before there is a session
        if (this.config.mfaRequired) {
            const waiting = { ...interaction, userId: user.id, mfaPending: true, enrolling: true, amr: ['pwd'] }
            const setup = await this.mfa.pendingSetup(user)
            return { kind: 'mfa-setup', interaction: waiting, client, setup, cookie: { id, value: this.seal(waiting) } }
        }
        return this.authenticated(
            { ...interaction, userId: user.id, mfaPending: false, enrolling: false, amr: ['pwd'] },
            user
        )
    }

    /**
     * Logging in with the eID, step 1: a nonce for the bridge. It is kept in the login cookie and can be used once.
     */
    async eidChallenge(id: string, sealed: string | undefined, form: Params): Promise<LoginResult> {
        const found = await this.findInteraction(id, sealed)
        if (!found || typeof form.csrf !== 'string' || !safeEqual(form.csrf, found.interaction.csrf))
            return { kind: 'expired' }
        this.eid.assertEnabled()
        const nonce = this.eid.nonce()
        const next = { ...found.interaction, eidNonce: nonce }
        return { kind: 'eid-challenge', nonce, cookie: { id, value: this.seal(next) } }
    }

    /**
     * Logging in with the eID, step 2: the token of the bridge (the card signed the nonce after the PIN). The card and
     * its PIN are two factors, so no code of the authenticator app follows (acr loa4, amr sc pin mfa).
     */
    async eidLogin(id: string, sealed: string | undefined, form: Params, allowed: boolean): Promise<LoginResult> {
        const found = await this.findInteraction(id, sealed)
        if (!found || typeof form.csrf !== 'string' || !safeEqual(form.csrf, found.interaction.csrf))
            return { kind: 'expired' }
        this.eid.assertEnabled()
        const { client } = found
        // The nonce works once: the cookie forgets it, whatever the outcome
        const interaction = { ...found.interaction, eidNonce: null }
        const cookie = { id, value: this.seal(interaction) }
        const refused = async (errorKey: string, userId: string | null = null): Promise<LoginResult> => {
            await this.loginFailed('eid', errorKey.replace(/^oidc\./, '').toLowerCase(), null, userId)
            return { kind: 'form', interaction, client, errorKey, email: '', cookie }
        }
        if (!allowed) return refused('oidc.TOO_MANY_ATTEMPTS')
        if (!found.interaction.eidNonce) return refused('oidc.EID_EXPIRED')

        let person
        try {
            person = await this.eid.verify(form.token, found.interaction.eidNonce)
        } catch (error) {
            if (error instanceof AppException) return refused(error.key)
            throw error
        }
        const user = await this.store.findUserByIdentifier('eid', person.valueHash)
        if (!user) return refused('oidc.EID_NOT_LINKED')
        if (user.status !== 'active') return refused('oidc.ACCOUNT_DISABLED', user.id)
        if (!user.emailVerified) return refused('oidc.EMAIL_NOT_VERIFIED', user.id)
        await this.store.touchIdentifier('eid', person.valueHash)
        return this.authenticated(
            { ...interaction, userId: user.id, mfaPending: false, enrolling: false, amr: [...OIDC.EID_AMR] },
            user
        )
    }

    // ------------------------------------------------------------------ login at another OpenID Connect server

    private externalKey() {
        return deriveKey(this.config.masterKey(), 'oidc external login v1')
    }

    /** Opens the cookie of a login at the other server; null when it is missing, changed or expired. */
    openExternal(sealed: string | undefined): ExternalCookie | null {
        if (!sealed) return null
        try {
            const value = JSON.parse(decrypt(sealed, this.externalKey(), 'external')) as ExternalCookie & { e: number }
            return value.e > Date.now() ? value : null
        } catch {
            return null
        }
    }

    /** "Log in with ...": the browser goes to the other server; this login waits in a cookie until it comes back. */
    async externalStart(id: string, sealed: string | undefined, form: Params): Promise<LoginResult> {
        const found = await this.findInteraction(id, sealed)
        if (!found || typeof form.csrf !== 'string' || !safeEqual(form.csrf, found.interaction.csrf))
            return { kind: 'expired' }
        if (!this.external.enabled) throw new AppException('oidc.EXTERNAL_DISABLED', HttpStatus.NOT_FOUND)
        const { location, attempt } = await this.external.start(found.interaction.params.loginHint)
        const cookie = { id, interaction: this.seal(found.interaction), attempt, e: found.interaction.expiresAt }
        return {
            kind: 'external',
            location,
            external: encrypt(JSON.stringify(cookie), this.externalKey(), 'external'),
            cookieName: externalCookieName(attempt.state)
        }
    }

    /**
     * Back from the other server: who it says logged in becomes (or is linked to) an account here, then the login goes
     * on as with a password: two-step verification (unless the other server did it), the organisation, the client.
     */
    async externalCallback(
        query: Params,
        sealed: string | undefined
    ): Promise<{ id: string | null; result: LoginResult }> {
        const saved = this.openExternal(sealed)
        const interaction = saved
            ? openInteraction(saved.id, saved.interaction, interactionKey(this.config.masterKey()))
            : null
        const client = interaction ? await this.store.findClient(interaction.params.clientId) : null
        if (!saved || !interaction || !client) return { id: null, result: { kind: 'expired' } }
        const id = interaction.id
        const cookie = { id, value: this.seal(interaction) }
        const refused = async (errorKey: string, reason: string, userId: string | null = null) => {
            await this.loginFailed('external', reason, null, userId)
            return { id, result: { kind: 'form' as const, interaction, client, errorKey, email: '', cookie } }
        }

        let identity: ExternalIdentity
        try {
            identity = await this.external.finish(query, saved.attempt)
        } catch (error) {
            this.external.warn(error instanceof Error ? error.message : String(error))
            return refused('oidc.EXTERNAL_FAILED', 'external_failed')
        }
        const found = await this.externalAccount(identity)
        if (typeof found === 'string') return refused(found, found.replace(/^oidc\./, '').toLowerCase())
        const { user, linkedNow } = found
        if (user.status !== 'active') return refused('oidc.ACCOUNT_DISABLED', 'account_blocked', user.id)

        const settings = this.config.external
        // The first login that joins an existing account proves it with OUR second factor (when it has one, or
        // OIDC_MFA=required): control over an email address at the other server alone never takes over an account
        const mfaThere =
            !linkedNow && (settings?.mfa === 'trust' || (settings?.mfa === 'external' && identity.amr.includes('mfa')))
        if (mfaThere)
            return {
                id,
                result: await this.authenticated(
                    { ...interaction, userId: user.id, mfaPending: false, enrolling: false, amr: ['fed', 'mfa'] },
                    user
                )
            }
        if (user.mfaEnabled) {
            const waiting = { ...interaction, userId: user.id, mfaPending: true, enrolling: false, amr: ['fed'] }
            return {
                id,
                result: { kind: 'mfa', interaction: waiting, client, cookie: { id, value: this.seal(waiting) } }
            }
        }
        if (this.config.mfaRequired) {
            const waiting = { ...interaction, userId: user.id, mfaPending: true, enrolling: true, amr: ['fed'] }
            const setup = await this.mfa.pendingSetup(user)
            return {
                id,
                result: {
                    kind: 'mfa-setup',
                    interaction: waiting,
                    client,
                    setup,
                    cookie: { id, value: this.seal(waiting) }
                }
            }
        }
        return {
            id,
            result: await this.authenticated(
                { ...interaction, userId: user.id, mfaPending: false, enrolling: false, amr: ['fed'] },
                user
            )
        }
    }

    /**
     * The account of a person of the other server: the one linked to its subject; at the first login the account with
     * the same (verified) email address, or a new account. Returns an error key when that is not possible.
     */
    private async externalAccount(
        identity: ExternalIdentity
    ): Promise<{ user: StoredUser; linkedNow: boolean } | string> {
        const hash = createHmac('sha256', deriveKey(this.config.masterKey(), 'oidc external subject v1'))
            .update(identity.issuer + '\n' + identity.subject)
            .digest('hex')
        const linked = await this.store.findUserByIdentifier('external', hash)
        if (linked) {
            await this.store.touchIdentifier('external', hash)
            return { user: linked, linkedNow: false }
        }
        // Only an address the other server verified says who someone is
        if (!identity.email) return 'oidc.EXTERNAL_NO_EMAIL'
        if (!identity.emailVerified) return 'oidc.EXTERNAL_EMAIL_UNVERIFIED'
        const settings = this.config.external
        const existing = await this.store.findUserByEmail(identity.email)
        if (existing) {
            // Never an account whose own address was not verified here (someone may have registered it first)
            if (!settings?.linkByEmail || !existing.emailVerified) return 'oidc.EXTERNAL_EMAIL_TAKEN'
            const result = await this.store.linkIdentifier(existing.id, 'external', hash)
            if (result !== 'ok') return 'oidc.EXTERNAL_OTHER_LINKED'
            await this.audit.record('account.external_linked', {
                tenantId: null,
                actorId: existing.id,
                target: { type: 'user', id: existing.id },
                details: { provider: settings.name }
            })
            return { user: existing, linkedNow: true }
        }
        const created = await this.store.createUser({
            email: identity.email,
            name: identity.name ?? identity.email,
            passwordHash: null,
            emailVerified: true,
            locale: null
        })
        if (!created) return 'oidc.EXTERNAL_EMAIL_TAKEN'
        if ((await this.store.linkIdentifier(created.id, 'external', hash)) !== 'ok')
            return 'oidc.EXTERNAL_OTHER_LINKED'
        await this.audit.record('account.registered', {
            tenantId: null,
            actorId: created.id,
            target: { type: 'user', id: created.id },
            details: { method: 'external', provider: settings?.name ?? null }
        })
        return { user: created, linkedNow: false }
    }

    /**
     * The login page of the frontend after the callback of the other server: goes on where this login is (the second
     * factor, setting it up, or the organisation).
     */
    async resume(id: string, sealed: string | undefined, form: Params): Promise<LoginResult> {
        const found = await this.findInteraction(id, sealed)
        if (!found || typeof form.csrf !== 'string' || !safeEqual(form.csrf, found.interaction.csrf))
            return { kind: 'expired' }
        const { interaction, client } = found
        const user = interaction.userId ? await this.store.findUserById(interaction.userId) : null
        if (user?.status !== 'active') return { kind: 'expired' }
        const cookie = { id, value: sealed ?? null }
        if (interaction.mfaPending && interaction.enrolling)
            return { kind: 'mfa-setup', interaction, client, setup: await this.mfa.pendingSetup(user), cookie }
        if (interaction.mfaPending) return { kind: 'mfa', interaction, client, cookie }
        return this.authenticated(interaction, user)
    }

    // ------------------------------------------------------------------ passkeys

    /** Logging in with a passkey, step 1: a challenge for navigator.credentials.get(), kept in the login cookie. */
    async passkeyChallenge(id: string, sealed: string | undefined, form: Params): Promise<LoginResult> {
        const found = await this.findInteraction(id, sealed)
        if (!found || typeof form.csrf !== 'string' || !safeEqual(form.csrf, found.interaction.csrf))
            return { kind: 'expired' }
        this.passkeys.assertEnabled()
        const challenge = this.passkeys.challenge()
        const next = { ...found.interaction, passkeyChallenge: challenge }
        return {
            kind: 'passkey-challenge',
            options: this.passkeys.loginOptions(challenge),
            cookie: { id, value: this.seal(next) }
        }
    }

    /**
     * Logging in with a passkey, step 2: the signed answer of the device. With user verification (PIN, fingerprint,
     * face) it counts as two-step verification: straight on to the organisation.
     */
    async passkeyLogin(id: string, sealed: string | undefined, form: Params, allowed: boolean): Promise<LoginResult> {
        const found = await this.findInteraction(id, sealed)
        if (!found || typeof form.csrf !== 'string' || !safeEqual(form.csrf, found.interaction.csrf))
            return { kind: 'expired' }
        this.passkeys.assertEnabled()
        const { client } = found
        // The challenge works once: the cookie forgets it, whatever the outcome
        const interaction = { ...found.interaction, passkeyChallenge: null }
        const cookie = { id, value: this.seal(interaction) }
        const refused = async (errorKey: string, userId: string | null = null): Promise<LoginResult> => {
            await this.loginFailed('passkey', errorKey.replace(/^oidc\./, '').toLowerCase(), null, userId)
            return { kind: 'form', interaction, client, errorKey, email: '', cookie }
        }
        if (!allowed) return refused('oidc.TOO_MANY_ATTEMPTS')
        if (!found.interaction.passkeyChallenge) return refused('oidc.PASSKEY_EXPIRED')
        const user = await this.passkeys.authenticate(form.credential, found.interaction.passkeyChallenge)
        if (typeof user === 'string') return refused(user)
        if (user.status !== 'active') return refused('oidc.ACCOUNT_DISABLED', user.id)
        return this.authenticated(
            { ...interaction, userId: user.id, mfaPending: false, enrolling: false, amr: ['pop', 'user', 'mfa'] },
            user
        )
    }

    /** The second factor: a code of the authenticator app or a recovery code, after the right password. */
    async verifyMfa(id: string, sealed: string | undefined, form: Params): Promise<LoginResult> {
        const found = await this.findInteraction(id, sealed)
        if (!found || typeof form.csrf !== 'string' || !safeEqual(form.csrf, found.interaction.csrf))
            return { kind: 'expired' }
        const { interaction, client } = found
        const user = interaction.userId ? await this.store.findUserById(interaction.userId) : null
        if (!interaction.mfaPending || user?.status !== 'active') return { kind: 'expired' }
        const cookie = { id, value: sealed ?? null }
        const code = typeof form.code === 'string' ? form.code.slice(0, 20) : ''
        if (interaction.enrolling) return this.enroll(interaction, client, user, code)
        let factor: SecondFactor | null
        try {
            factor = await this.mfa.check(user.id, typeof form.code === 'string' ? form.code.slice(0, 20) : '')
        } catch (error) {
            if (error instanceof AppException)
                return { kind: 'mfa', interaction, client, cookie, errorKey: 'oidc.TOO_MANY_ATTEMPTS' }
            throw error
        }
        if (!factor) {
            await this.audit.record('login.mfa_failed', {
                tenantId: null,
                actorId: user.id,
                target: { type: 'user', id: user.id }
            })
            return { kind: 'mfa', interaction, client, cookie, errorKey: 'oidc.MFA_INVALID_CODE' }
        }
        return this.authenticated(
            { ...interaction, mfaPending: false, amr: secondFactorAmr(interaction, factor) },
            user
        )
    }

    /** Setting up two-step verification during the login: the first code confirms it, then the recovery codes. */
    private async enroll(
        interaction: Interaction,
        client: OidcClient,
        user: StoredUser,
        code: string
    ): Promise<LoginResult> {
        const cookie = { id: interaction.id, value: this.seal(interaction) }
        try {
            const { recoveryCodes } = await this.mfa.enable(user.id, code)
            const next = {
                ...interaction,
                mfaPending: false,
                enrolling: false,
                amr: secondFactorAmr(interaction, 'totp')
            }
            return {
                kind: 'recovery-codes',
                interaction: next,
                recoveryCodes,
                cookie: { id: next.id, value: this.seal(next) }
            }
        } catch (error) {
            if (!(error instanceof AppException)) throw error
            const errorKey = error.key === 'oidc.TOO_MANY_ATTEMPTS' ? error.key : 'oidc.MFA_INVALID_CODE'
            return {
                kind: 'mfa-setup',
                interaction,
                client,
                setup: await this.mfa.pendingSetup(user),
                cookie,
                errorKey
            }
        }
    }

    /** After the recovery codes were shown: on to the organisation (choice) and back to the client. */
    async continueLogin(id: string, sealed: string | undefined, form: Params): Promise<LoginResult> {
        const found = await this.findInteraction(id, sealed)
        if (!found || typeof form.csrf !== 'string' || !safeEqual(form.csrf, found.interaction.csrf))
            return { kind: 'expired' }
        const { interaction } = found
        const user = interaction.userId ? await this.store.findUserById(interaction.userId) : null
        if (user?.status !== 'active' || interaction.mfaPending) return { kind: 'expired' }
        return this.authenticated(interaction, user)
    }

    /**
     * The user proved who they are: finish in their only (or the hinted) tenant, or let them choose one. A superadmin
     * needs no organisation: without any (a new server) the login goes straight to the platform; otherwise the choice
     * also offers "Platform" (tenant_hint=platform skips it).
     */
    private async authenticated(interaction: Interaction, user: StoredUser): Promise<LoginResult> {
        const id = interaction.id
        const hint = interaction.params.tenantHint
        if (user.isSuperadmin && hint === PLATFORM) return this.finish(interaction, user, null)
        const memberships = await this.memberships(user)
        const hinted = memberships.find(item => item.tenantId === hint || item.slug === hint)
        const only = memberships.length === 1 && !user.isSuperadmin ? memberships[0] : undefined
        const membership = hinted ?? only
        if (membership) return this.finish(interaction, user, membership)
        if (memberships.length === 0)
            return user.isSuperadmin
                ? this.finish(interaction, user, null)
                : { kind: 'no-tenant', cookie: { id, value: null } }
        // Remember the user in the cookie while they choose an organisation
        return {
            kind: 'choose-tenant',
            interaction,
            memberships,
            platform: user.isSuperadmin,
            cookie: { id, value: this.seal(interaction) }
        }
    }

    async chooseTenant(id: string, sealed: string | undefined, form: Params): Promise<LoginResult> {
        const found = await this.findInteraction(id, sealed)
        if (!found || typeof form.csrf !== 'string' || !safeEqual(form.csrf, found.interaction.csrf))
            return { kind: 'expired' }
        const { interaction } = found
        const user = interaction.userId ? await this.store.findUserById(interaction.userId) : null
        // Only after the password and (when it is on) the second factor
        if (user?.status !== 'active' || interaction.mfaPending) return { kind: 'expired' }
        if (form.tenant === PLATFORM && user.isSuperadmin) return this.finish(interaction, user, null)
        const memberships = await this.memberships(user)
        const membership = memberships.find(item => item.tenantId === form.tenant)
        if (!membership)
            return {
                kind: 'choose-tenant',
                interaction,
                memberships,
                platform: user.isSuperadmin,
                cookie: { id, value: sealed ?? null }
            }
        return this.finish(interaction, user, membership)
    }

    /**
     * Logged in: a new session (never reuse an old id), a code, and back to the client. The session remembers the
     * login, so a copy of the login cookie cannot log in a second time.
     */
    private async finish(
        interaction: Interaction,
        user: StoredUser,
        membership: Membership | null
    ): Promise<LoginResult> {
        const sessionId = randomToken()
        const now = new Date()
        const session: Session = {
            id: randomUUID(),
            idHash: sha256(sessionId),
            interactionHash: sha256(interaction.id),
            userId: user.id,
            tenantId: membership?.tenantId ?? null,
            authTime: now,
            acr: interaction.amr.includes('sc')
                ? OIDC.ACR_EID
                : interaction.amr.includes('mfa')
                  ? OIDC.ACR_MFA
                  : OIDC.ACR_PASSWORD,
            amr: interaction.amr.length ? interaction.amr : ['pwd'],
            expiresAt: new Date(now.getTime() + OIDC.SESSION_SECONDS * 1000),
            userAgent: interaction.userAgent || null
        }
        if (!(await this.store.createSession(session))) return { kind: 'expired' }
        await this.audit.record('login.succeeded', {
            tenantId: membership?.tenantId ?? null,
            actorId: user.id,
            target: { type: 'session', id: session.id },
            details: { method: session.amr.join(' '), acr: session.acr, client: interaction.params.clientId }
        })
        // Logged in: online for the admins of the tenant
        if (membership) await this.store.touchMember(membership.tenantId, user.id).catch(() => undefined)
        const result = await this.issueCode(interaction.params, session, user, membership)
        return {
            kind: 'done',
            location: result.kind === 'redirect' ? result.location : '',
            sessionId,
            cookie: { id: interaction.id, value: null }
        }
    }

    /**
     * A login that did not work. Not in any organisation (it is not known which one): superadmins see it, and the
     * account itself when the email address (or eID) belongs to one.
     */
    private async loginFailed(method: string, reason: string, email: string | null, userId: string | null) {
        await this.audit.record('login.failed', {
            tenantId: null,
            actorId: null,
            target: userId ? { type: 'user', id: userId } : null,
            details: { method, reason, ...(email ? { email } : {}) }
        })
    }

    private async issueCode(
        params: AuthorizationParams,
        session: Session,
        user: StoredUser,
        membership: Membership | null
    ): Promise<AuthorizeResult> {
        const code = randomToken()
        await this.store.createCode({
            codeHash: sha256(code),
            clientId: params.clientId,
            userId: user.id,
            tenantId: membership?.tenantId ?? null,
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

    // ------------------------------------------------------------------ userinfo

    /** Does a session with this acr still count? With OIDC_MFA=required only two-step logins (loa2) and the eID (loa4). */
    strongEnough(acr: string): boolean {
        return !this.config.mfaRequired || acr === OIDC.ACR_MFA || acr === OIDC.ACR_EID
    }

    /**
     * Verifies an access token of this server (signature, typ at+jwt, iss, aud, exp) and that its session (the sid
     * claim) is still active: after a logout the token stops at once, not only when it expires. Returns its claims, or
     * throws an OAuthError invalid_token (401). Used by userinfo, introspection and AccessGuard for the own API.
     */
    async verifyAccessToken(token: string | undefined): Promise<Record<string, unknown>> {
        await this.prepare()
        if (!token) throw new OAuthError('invalid_token', 'An access token is required', 401)
        let payload: Record<string, unknown>
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
        const session = typeof payload.sid === 'string' ? await this.store.findSessionById(payload.sid) : null
        if (session?.userId !== payload.sub)
            throw new OAuthError('invalid_token', 'The session of this token ended', 401)
        return payload
    }

    async userinfo(token: string | undefined): Promise<Record<string, unknown>> {
        const payload = await this.verifyAccessToken(token)
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
            ...(scope.includes('tenant')
                ? { tenant: payload.tenant, ...(user.isSuperadmin ? { superadmin: true } : {}) }
                : {})
        }
    }

    /**
     * The tenants a user can log in to, with the role there. A superadmin is admin of every active tenant (also new ones,
     * without a row in tenant_members); everybody else gets the rows of tenant_members.
     */
    async memberships(user: StoredUser): Promise<Membership[]> {
        if (!user.isSuperadmin) return this.store.listMemberships(user.id)
        return (await this.store.listTenants())
            .filter(tenant => tenant.status === 'active')
            .map(tenant => ({ tenantId: tenant.id, slug: tenant.slug, name: tenant.name, role: 'admin' as const }))
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
