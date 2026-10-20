import {
    createCipheriv,
    createDecipheriv,
    createHash,
    createPublicKey,
    type JsonWebKey,
    randomBytes,
    verify
} from 'node:crypto'

/**
 * Login through the OpenID Connect server of the backend (authorization code flow with PKCE), on the server side of
 * Next.js only: the browser never sees a token. Tokens and the session live in an encrypted, httpOnly cookie.
 * Only node:crypto and fetch: no OIDC or JWT library.
 */
export const OIDC_ISSUER = (process.env.OIDC_ISSUER ?? 'http://localhost:__API_PORT__/oidc').replace(/\/+$/, '')
export const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID ?? 'frontend'
/**
 * Only for a confidential client (an app made on /admin of the login server as "confidential"): sent with
 * client_secret_post. Empty for a public client (PKCE only), like the frontend of the login server itself.
 */
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET ?? ''
const clientAuth = (): Record<string, string> =>
    OIDC_CLIENT_SECRET
        ? { client_id: OIDC_CLIENT_ID, client_secret: OIDC_CLIENT_SECRET }
        : { client_id: OIDC_CLIENT_ID }
export const APP_URL = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
export const REDIRECT_URI = APP_URL + '/api/auth/callback'
/**
 * The frontend of the login server, for the account pages (security, management, platform): the same app here, or the
 * frontend of the login server when this app is linked to it (OIDC_ACCOUNT_URL).
 */
export const ACCOUNT_URL = (process.env.OIDC_ACCOUNT_URL ?? '').replace(/\/+$/, '')

export const SESSION_COOKIE = 'app_session'
export const FLOW_COOKIE = 'app_oidc'
export const FLOW_SECONDS = 10 * 60
/**
 * How long the session cookie lives: as long as a session of the login server (12 hours). The access token inside is
 * renewed with the refresh token when it expires; when that fails (logged out, session ended), the user is logged out.
 */
export const SESSION_SECONDS = 12 * 60 * 60
/** The access token is renewed this long before it expires (milliseconds). */
export const RENEW_BEFORE_MS = 60_000

/** The tenant of the session, with the role of the user there: user or admin (a superadmin is admin everywhere). */
export interface Tenant {
    id: string
    name: string
    role: 'user' | 'admin'
}

/**
 * The licence of the user for the product of this app (the `license` claim of an app that sells one), in the
 * organisation of the session: a running trial (until endsAt), a seat, a superadmin, or none.
 */
export interface License {
    product: string
    status: 'trial' | 'seat' | 'superadmin' | 'none'
    /** Only for a trial: when it ends (milliseconds). */
    endsAt: number | null
}

/** The `license` claim, checked; null when there is none. */
function licenseOf(value: unknown): License | null {
    const claim = value as { product?: unknown; status?: unknown; ends_at?: unknown } | undefined
    if (!claim || typeof claim.product !== 'string') return null
    if (!['trial', 'seat', 'superadmin', 'none'].includes(String(claim.status))) return null
    return {
        product: claim.product,
        status: claim.status as License['status'],
        endsAt: typeof claim.ends_at === 'number' ? claim.ends_at * 1000 : null
    }
}

/** What the session cookie holds. */
export interface Session {
    sub: string
    name: string
    email: string
    /** null: a superadmin who logged in without an organisation (platform management). */
    tenant: Tenant | null
    /** Platform administrator: admin of every tenant. */
    superadmin: boolean
    accessToken: string
    /** When the access token expires (milliseconds). Before that, the proxy renews it with the refresh token. */
    expiresAt: number
    /** Renews the access token (rotated at every use); bound to the session of the login server. */
    refreshToken: string | null
    /** The last ID token: it tells the login server who logs out (id_token_hint). */
    idToken: string
    /** The session at the login server (sid): a back-channel logout of it ends this session too. */
    sid?: string
    /** The licence for the product this app sells (renewed with the tokens); null or missing: a free app. */
    license?: License | null
}

/** A login in progress (between /api/auth/login and /api/auth/callback). */
export interface Flow {
    state: string
    nonce: string
    verifier: string
    returnTo: string
}

interface Discovery {
    issuer: string
    authorization_endpoint: string
    token_endpoint: string
    userinfo_endpoint: string
    jwks_uri: string
    end_session_endpoint: string
    revocation_endpoint: string
}

const b64url = (buffer: Buffer) => buffer.toString('base64url')

export const cookieOptions = (maxAgeSeconds: number, path = '/') => ({
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path,
    maxAge: maxAgeSeconds
})

/** The 32-byte key of AUTH_SECRET (.env.local) that encrypts the cookies. */
function secret(): Buffer {
    const hex = process.env.AUTH_SECRET ?? ''
    if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('AUTH_SECRET must be 64 hexadecimal characters (see .env.local)')
    return Buffer.from(hex, 'hex')
}

/** Encrypts (AES-256-GCM) a value for a cookie. `purpose` is bound to it, so a flow cookie is never a session. */
export function seal(value: object, purpose: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', secret(), iv)
    cipher.setAAD(Buffer.from(purpose))
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
    return [b64url(iv), b64url(cipher.getAuthTag()), b64url(data)].join('.')
}

/** Decrypts a cookie value; null when it is missing, changed or encrypted with another secret. */
export function unseal<T>(sealed: string | undefined, purpose: string): T | null {
    const [iv, tag, data] = (sealed ?? '').split('.')
    if (!iv || !tag || !data) return null
    try {
        const decipher = createDecipheriv('aes-256-gcm', secret(), Buffer.from(iv, 'base64url'))
        decipher.setAAD(Buffer.from(purpose))
        decipher.setAuthTag(Buffer.from(tag, 'base64url'))
        return JSON.parse(
            Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
        ) as T
    } catch {
        return null
    }
}

/** Only relative paths of this app, never another site (open redirect). */
export function safeReturnTo(value: string | null | undefined): string {
    return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/'
}

export function newFlow(returnTo: string): Flow & { challenge: string } {
    const verifier = b64url(randomBytes(32))
    return {
        state: b64url(randomBytes(16)),
        nonce: b64url(randomBytes(16)),
        verifier,
        challenge: b64url(createHash('sha256').update(verifier).digest()),
        returnTo: safeReturnTo(returnTo)
    }
}

let discovered: { at: number; value: Promise<Discovery> } | null = null

/** The discovery document of the issuer, cached for 5 minutes. */
export function discovery(): Promise<Discovery> {
    if (!discovered || Date.now() - discovered.at > 5 * 60_000) {
        const value = fetch(OIDC_ISSUER + '/.well-known/openid-configuration', { cache: 'no-store' }).then(
            async response => {
                if (!response.ok) throw new Error('Discovery failed: ' + response.status)
                const document = (await response.json()) as Discovery
                if (document.issuer !== OIDC_ISSUER) throw new Error('The discovery document is of another issuer')
                return document
            }
        )
        value.catch(() => {
            discovered = null
        })
        discovered = { at: Date.now(), value }
    }
    return discovered.value
}

/**
 * The login request. `tenant` (an id, a slug or "platform") picks the organisation: with an open session of the login
 * server that switches organisation without a new password or code.
 */
export async function authorizationUrl(
    flow: Flow & { challenge: string },
    locale: string,
    tenant?: string | null
): Promise<string> {
    const url = new URL((await discovery()).authorization_endpoint)
    url.search = new URLSearchParams({
        client_id: OIDC_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'openid profile email tenant',
        state: flow.state,
        nonce: flow.nonce,
        code_challenge: flow.challenge,
        code_challenge_method: 'S256',
        ui_locales: locale,
        ...(tenant ? { tenant_hint: tenant } : {})
    }).toString()
    return url.toString()
}

type Jwk = JsonWebKey & { kid?: string; alg?: string }
let keyCache: { at: number; keys: Jwk[] } | null = null

async function signingKey(kid: string) {
    for (const fresh of [false, true]) {
        // An unknown key id fetches the keys again (a new key), at most every 30 seconds: anyone can POST a logout
        // token with a made-up key id, that must not make this server hammer the login server
        if (fresh && keyCache && Date.now() - keyCache.at < 30_000) break
        if (fresh || !keyCache || Date.now() - keyCache.at > 5 * 60_000) {
            const response = await fetch((await discovery()).jwks_uri, { cache: 'no-store' })
            if (!response.ok) throw new Error('JWKS failed: ' + response.status)
            keyCache = { at: Date.now(), keys: ((await response.json()) as { keys: Jwk[] }).keys }
        }
        const key = keyCache.keys.find(candidate => candidate.kid === kid)
        if (key) return key
    }
    throw new Error('Unknown signing key')
}

/**
 * Checks the ID token: RS256 signature with the JWKS, issuer, audience, expiry, nonce and at_hash. After a refresh
 * there is no nonce (`null`): then the ID token must not have one either.
 */
export async function verifyIdToken(
    idToken: string,
    nonce: string | null,
    accessToken: string
): Promise<{
    sub: string
    sid: string | undefined
    tenant: Tenant | null
    superadmin: boolean
    license: License | null
}> {
    const [header, payload, signature] = idToken.split('.')
    if (!header || !payload || !signature) throw new Error('Malformed ID token')
    const head = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as { alg?: string; kid?: string }
    if (head.alg !== 'RS256' || !head.kid) throw new Error('Unexpected ID token algorithm')
    const jwk = await signingKey(head.kid)
    if (jwk.alg !== 'RS256') throw new Error('The key does not fit the ID token')
    const valid = verify(
        'sha256',
        Buffer.from(header + '.' + payload),
        createPublicKey({ key: jwk, format: 'jwk' }),
        Buffer.from(signature, 'base64url')
    )
    if (!valid) throw new Error('Invalid ID token signature')
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    const now = Math.floor(Date.now() / 1000)
    if (claims.iss !== OIDC_ISSUER) throw new Error('Wrong issuer')
    if (claims.aud !== OIDC_CLIENT_ID) throw new Error('Wrong audience')
    if (typeof claims.exp !== 'number' || claims.exp < now - 30) throw new Error('ID token expired')
    if ((claims.nonce ?? null) !== nonce) throw new Error('Wrong nonce')
    const atHash = b64url(createHash('sha256').update(accessToken).digest().subarray(0, 16))
    if (claims.at_hash !== atHash) throw new Error('The access token does not belong to the ID token')
    if (typeof claims.sub !== 'string') throw new Error('Missing subject')
    const tenant = (claims.tenant as Tenant | undefined) ?? null
    return {
        sub: claims.sub,
        sid: typeof claims.sid === 'string' ? claims.sid : undefined,
        tenant,
        superadmin: claims.superadmin === true,
        license: licenseOf(claims.license)
    }
}

const BACKCHANNEL_EVENT = 'http://schemas.openid.net/event/backchannel-logout'
/** Logout tokens seen (jti), so a copy cannot be sent twice; on globalThis, shared by all route handlers. */
const seenLogouts = ((globalThis as typeof globalThis & { __oidcLogoutJti?: Map<string, number> }).__oidcLogoutJti ??=
    new Map<string, number>())

/**
 * Checks a logout token of the login server (OpenID Connect Back-Channel Logout 1.0): RS256 signature with the JWKS,
 * typ logout+jwt, issuer, audience, issued within the last 5 minutes, the logout event, a session id (sid), no nonce,
 * and never the same token twice. Returns the session and the user.
 */
export async function verifyLogoutToken(token: string): Promise<{ sid: string; sub: string | undefined }> {
    const [header, payload, signature] = token.split('.')
    if (!header || !payload || !signature || token.length > 8000) throw new Error('Malformed logout token')
    const head = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as {
        alg?: string
        kid?: string
        typ?: string
    }
    if (head.alg !== 'RS256' || !head.kid || head.typ !== 'logout+jwt') throw new Error('Unexpected logout token')
    const jwk = await signingKey(head.kid)
    if (jwk.alg !== 'RS256') throw new Error('The key does not fit the logout token')
    const valid = verify(
        'sha256',
        Buffer.from(header + '.' + payload),
        createPublicKey({ key: jwk, format: 'jwk' }),
        Buffer.from(signature, 'base64url')
    )
    if (!valid) throw new Error('Invalid logout token signature')
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    const now = Math.floor(Date.now() / 1000)
    if (claims.iss !== OIDC_ISSUER) throw new Error('Wrong issuer')
    if (claims.aud !== OIDC_CLIENT_ID && !(Array.isArray(claims.aud) && claims.aud.includes(OIDC_CLIENT_ID)))
        throw new Error('Wrong audience')
    if (typeof claims.iat !== 'number' || claims.iat < now - 300 || claims.iat > now + 60) throw new Error('Too old')
    if (typeof claims.exp === 'number' && claims.exp < now - 30) throw new Error('Expired')
    const events = claims.events as Record<string, unknown> | undefined
    if (!events || typeof events[BACKCHANNEL_EVENT] !== 'object') throw new Error('Not a logout event')
    if (claims.nonce !== undefined) throw new Error('A logout token has no nonce')
    if (typeof claims.sid !== 'string' || !claims.sid) throw new Error('No session id')
    if (typeof claims.jti !== 'string' || !claims.jti) throw new Error('No jti')
    for (const [jti, until] of seenLogouts) if (until < Date.now()) seenLogouts.delete(jti)
    if (seenLogouts.has(claims.jti)) throw new Error('Logout token used before')
    seenLogouts.set(claims.jti, Date.now() + 10 * 60_000)
    return { sid: claims.sid, sub: typeof claims.sub === 'string' ? claims.sub : undefined }
}

/** Exchanges the code for tokens (public client: client_id + code_verifier, no secret). */
export async function exchangeCode(code: string, verifier: string) {
    const response = await fetch((await discovery()).token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
            ...clientAuth(),
            code_verifier: verifier
        }),
        cache: 'no-store'
    })
    const body = (await response.json()) as Record<string, unknown>
    if (!response.ok) throw new Error(`Token request failed: ${String(body.error)}`)
    return body as unknown as TokenSet
}

export interface TokenSet {
    access_token: string
    id_token: string
    expires_in: number
    refresh_token?: string
}

/** New tokens for a refresh token. null when the login server refuses it (logged out, session ended, reused). */
export async function refreshTokens(refreshToken: string): Promise<TokenSet | null> {
    const response = await fetch((await discovery()).token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            ...clientAuth()
        }),
        cache: 'no-store'
    })
    if (response.status === 400 || response.status === 401) return null
    if (!response.ok) throw new Error('Refresh failed: ' + response.status)
    return (await response.json()) as TokenSet
}

/** Revokes the refresh token at the login server (logout). Never fails: the session cookie is deleted anyway. */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
    await fetch((await discovery()).revocation_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token', ...clientAuth() }),
        cache: 'no-store'
    }).catch(() => undefined)
}

/**
 * Where the browser goes to log out of the login server too (end_session_endpoint): the ID token says who, and the
 * login server sends the browser back to this app.
 */
export async function endSessionUrl(idToken: string): Promise<string> {
    const url = new URL((await discovery()).end_session_endpoint)
    url.search = new URLSearchParams({
        id_token_hint: idToken,
        client_id: OIDC_CLIENT_ID,
        post_logout_redirect_uri: APP_URL
    }).toString()
    return url.toString()
}

/** Claims of the user from the userinfo endpoint (also proves the access token works). */
export async function userinfo(accessToken: string): Promise<Record<string, unknown> | null> {
    const response = await fetch((await discovery()).userinfo_endpoint, {
        headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' },
        cache: 'no-store'
    })
    return response.ok ? ((await response.json()) as Record<string, unknown>) : null
}
