import { HttpStatus, Injectable, Logger } from '@nestjs/common'
import { AppException } from '../../common/app.exception.js'
import { pkceChallenge, randomToken, safeEqual } from '../crypto.js'
import { JoseError, type JwtPayload } from '../jose.js'
import { type ExternalSettings, OidcConfig } from '../oidc.config.js'
import { type ExternalKey, importJwks, verifyExternalJwt } from './external-jwt.js'

/** What we need of the discovery document of the other server. */
interface Discovery {
    issuer: string
    authorization_endpoint: string
    token_endpoint: string
    jwks_uri: string
    userinfo_endpoint?: string
}

/** A login at the other server that is on its way (kept in an encrypted cookie until the callback). */
export interface ExternalAttempt {
    /** Which of the other servers (ExternalSettings.id); missing in a cookie of before: the first. */
    provider?: string
    state: string
    nonce: string
    verifier: string
}

/** Who the other server says logged in. */
export interface ExternalIdentity {
    issuer: string
    subject: string
    email: string | null
    emailVerified: boolean
    name: string | null
    /** RFC 8176, as the other server says it (for example ["pwd", "mfa"]). */
    amr: string[]
    acr: string | null
}

const CACHE_MS = 60 * 60 * 1000
/** An unknown key id: the JWKS is fetched again, at most this often (the other server rotated its keys). */
const REFETCH_MS = 5 * 60 * 1000
const TIMEOUT_MS = 10_000

/** Only https; http only on this computer and not in production (development: a local Keycloak, or the tests). */
export function allowedUrl(value: string, production = false): boolean {
    try {
        const url = new URL(value)
        return (
            url.protocol === 'https:' ||
            (!production && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
        )
    } catch {
        return false
    }
}

/** For the log: no line breaks or other control characters from outside. */
const clean = (value: string) => value.replace(/\p{Cc}/gu, ' ').slice(0, 60)

/** A failing discovery is not asked again for this long (the login page must not wait every time). */
const FAILED_MS = 30_000

/**
 * Logging in at ANOTHER OpenID Connect server (federation: Microsoft Entra ID, Keycloak, Google, ...), one or several. It proves who
 * the user is; accounts, organisations, roles, licences and sessions stay in this server. Authorization code flow with
 * PKCE, state and nonce; the ID token is checked with the keys of that server (its JWKS). Our own code, no library.
 */
@Injectable()
export class ExternalService {
    private readonly logger = new Logger('ExternalLogin')
    /** Per other server (its id): its discovery document, when it last failed, and its keys. */
    private readonly discovery = new Map<string, { value: Discovery; until: number }>()
    private readonly failedUntil = new Map<string, number>()
    private readonly jwks = new Map<string, { keys: ExternalKey[]; fetchedAt: number }>()

    constructor(private readonly config: OidcConfig) {}

    get enabled(): boolean {
        return this.config.externals.length > 0
    }

    /** The other servers, in order (the buttons "Log in with ..."). */
    get providers(): ExternalSettings[] {
        return this.config.externals
    }

    /** One of them; 404 oidc.EXTERNAL_DISABLED for an id that is not configured. */
    settings(id = '1'): ExternalSettings {
        const settings = this.config.externals.find(item => item.id === id)
        if (!settings) throw new AppException('oidc.EXTERNAL_DISABLED', HttpStatus.NOT_FOUND)
        return settings
    }

    /** Our callback, registered at the other server as redirect URI. */
    get callbackUrl(): string {
        return this.config.issuer + '/external/callback'
    }

    private async get<T>(url: string): Promise<T> {
        if (!allowedUrl(url, this.config.production)) throw new Error(`Only https is allowed: ${url}`)
        // No redirects: the documents must be where the server says
        const response = await fetch(url, {
            headers: { Accept: 'application/json' },
            redirect: 'error',
            signal: AbortSignal.timeout(TIMEOUT_MS)
        })
        if (!response.ok) throw new Error(`${url} answered ${response.status}`)
        return (await response.json()) as T
    }

    /** The discovery document of the other server (cached for an hour); its issuer must be exactly the configured one. */
    async metadata(id = '1'): Promise<Discovery> {
        const cached = this.discovery.get(id)
        if (cached && cached.until > Date.now()) return cached.value
        if ((this.failedUntil.get(id) ?? 0) > Date.now())
            throw new Error('The other server was not reachable less than 30 s ago')
        const { issuer } = this.settings(id)
        try {
            const value = await this.get<Discovery>(issuer.replace(/\/+$/, '') + '/.well-known/openid-configuration')
            if (value.issuer !== issuer) throw new Error(`The discovery document is of ${value.issuer}, not ${issuer}`)
            for (const url of [value.authorization_endpoint, value.token_endpoint, value.jwks_uri])
                if (typeof url !== 'string' || !allowedUrl(url, this.config.production))
                    throw new Error('Incomplete discovery document')
            this.discovery.set(id, { value, until: Date.now() + CACHE_MS })
            return value
        } catch (error) {
            this.failedUntil.set(id, Date.now() + FAILED_MS)
            throw error
        }
    }

    private async keys(id: string, refresh = false): Promise<ExternalKey[]> {
        const known = this.jwks.get(id)
        if (known && Date.now() - known.fetchedAt < (refresh ? REFETCH_MS : CACHE_MS)) return known.keys
        const keys = importJwks(await this.get((await this.metadata(id)).jwks_uri))
        this.jwks.set(id, { keys, fetchedAt: Date.now() })
        return keys
    }

    /** Where the browser goes to log in at that server, and what to remember until it comes back. */
    async start(id = '1', loginHint?: string | null): Promise<{ location: string; attempt: ExternalAttempt }> {
        const settings = this.settings(id)
        const metadata = await this.metadata(id)
        const attempt: ExternalAttempt = {
            provider: id,
            state: randomToken(),
            nonce: randomToken(),
            verifier: randomToken(48)
        }
        const location = new URL(metadata.authorization_endpoint)
        location.searchParams.set('response_type', 'code')
        location.searchParams.set('client_id', settings.clientId)
        location.searchParams.set('redirect_uri', this.callbackUrl)
        location.searchParams.set('scope', settings.scopes)
        location.searchParams.set('state', attempt.state)
        location.searchParams.set('nonce', attempt.nonce)
        location.searchParams.set('code_challenge', pkceChallenge(attempt.verifier))
        location.searchParams.set('code_challenge_method', 'S256')
        if (loginHint) location.searchParams.set('login_hint', loginHint)
        return { location: location.toString(), attempt }
    }

    /**
     * The callback: checks the state, exchanges the code (with the PKCE verifier and, for a confidential client, the
     * secret) and checks the ID token (signature, issuer, audience, expiry, nonce). Throws an Error with the reason.
     */
    async finish(query: Record<string, unknown>, attempt: ExternalAttempt): Promise<ExternalIdentity> {
        // A cookie of before several servers: the first one
        const id = attempt.provider ?? '1'
        const settings = this.settings(id)
        const state = typeof query.state === 'string' ? query.state : ''
        if (!state || !safeEqual(state, attempt.state)) throw new Error('state does not match')
        if (typeof query.error === 'string') throw new Error('the other server answered ' + clean(query.error))
        const code = typeof query.code === 'string' ? query.code : ''
        if (!code) throw new Error('no code')
        const metadata = await this.metadata(id)

        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: this.callbackUrl,
            code_verifier: attempt.verifier
        })
        const headers: Record<string, string> = {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        if (settings.clientSecret) {
            // client_secret_basic (RFC 6749 2.3.1): both parts form-encoded
            const user = encodeURIComponent(settings.clientId)
            const password = encodeURIComponent(settings.clientSecret)
            headers.Authorization = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')
        } else body.set('client_id', settings.clientId)
        const response = await fetch(metadata.token_endpoint, {
            method: 'POST',
            redirect: 'error',
            headers,
            body,
            signal: AbortSignal.timeout(TIMEOUT_MS)
        })
        const tokens = (await response.json().catch(() => ({}))) as { id_token?: unknown; error?: unknown }
        if (!response.ok || typeof tokens.id_token !== 'string')
            throw new Error(
                `the token endpoint answered ${response.status} ${typeof tokens.error === 'string' ? clean(tokens.error) : ''}`.trim()
            )

        const claims = await this.verifyIdToken(id, tokens.id_token, attempt.nonce)
        const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null
        const given = [claims.given_name, claims.family_name].filter(part => typeof part === 'string').join(' ')
        const name =
            (typeof claims.name === 'string' && claims.name.trim()) ||
            given.trim() ||
            (typeof claims.preferred_username === 'string' ? claims.preferred_username : null) ||
            email
        return {
            issuer: metadata.issuer,
            subject: String(claims.sub),
            email,
            // Some servers send "true" as text
            emailVerified: claims.email_verified === true || claims.email_verified === 'true',
            name: name ? name.slice(0, 100) : null,
            amr: Array.isArray(claims.amr)
                ? claims.amr.filter((value): value is string => typeof value === 'string')
                : [],
            acr: typeof claims.acr === 'string' ? claims.acr : null
        }
    }

    private async verifyIdToken(id: string, token: string, nonce: string): Promise<JwtPayload> {
        const settings = this.settings(id)
        let verified
        try {
            verified = verifyExternalJwt(token, await this.keys(id))
        } catch (error) {
            // Their keys may have changed since we fetched them: once more with a fresh JWKS
            if (!(error instanceof JoseError) || error.message !== 'Unknown key') throw error
            verified = verifyExternalJwt(token, await this.keys(id, true))
        }
        const claims = verified.payload
        const now = Math.floor(Date.now() / 1000)
        const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
        if (claims.iss !== (await this.metadata(id)).issuer) throw new JoseError('Wrong issuer')
        if (!audiences.includes(settings.clientId)) throw new JoseError('Wrong audience')
        // With several audiences, the authorized party must be us (OpenID Connect Core 3.1.3.7)
        if ((audiences.length > 1 || claims.azp !== undefined) && claims.azp !== settings.clientId)
            throw new JoseError('Wrong authorized party')
        if (typeof claims.exp !== 'number' || claims.exp + 60 < now) throw new JoseError('Token expired')
        if (typeof claims.iat === 'number' && claims.iat - 60 > now) throw new JoseError('Token issued in the future')
        if (typeof claims.nonce !== 'string' || !safeEqual(claims.nonce, nonce)) throw new JoseError('Wrong nonce')
        if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255)
            throw new JoseError('Missing subject')
        return claims
    }

    /** For the log: why a login at the other server did not work (never tokens or secrets). */
    warn(reason: string, id = '1') {
        this.logger.warn(`Login at the other server failed${id === '1' ? '' : ` (${clean(id)})`}: ` + reason)
    }
}
