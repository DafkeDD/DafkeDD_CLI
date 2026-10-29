import {
    RENEW_BEFORE_MS,
    refreshTokens,
    revokeRefreshToken,
    type Session,
    SESSION_COOKIE,
    seal,
    unseal,
    verifyIdToken
} from './oidc'
import { sessionEnded } from './ended'

/** What to do with the session cookie after renewing: keep it, replace it, or delete it (logged out). */
export type Renewed = { session: Session; cookie: string | null } | { session: null; cookie: 'delete' | null }

/**
 * Refreshes running at this moment, per refresh token: requests at the same time share one refresh. On globalThis, so
 * the proxy and the route handlers (separate bundles in the same server) share it too.
 */
const shared = globalThis as typeof globalThis & { __oidcRefreshes?: Map<string, Promise<Session | null>> }
const running = (shared.__oidcRefreshes ??= new Map<string, Promise<Session | null>>())

async function renew(session: Session): Promise<Session | null> {
    if (!session.refreshToken) return null
    const tokens = await refreshTokens(session.refreshToken)
    if (!tokens) return null
    // From here on the old refresh token is used up: never keep it. When the new tokens cannot be checked, revoke them
    // and log out (keeping the old one would later look like a stolen token and end the session anyway).
    let claims: Awaited<ReturnType<typeof verifyIdToken>> | null = null
    try {
        claims = await verifyIdToken(tokens.id_token, null, tokens.access_token)
    } catch {
        claims = null
    }
    if (!claims || claims.sub !== session.sub) {
        if (tokens.refresh_token) await revokeRefreshToken(tokens.refresh_token)
        return null
    }
    const { tenant, superadmin, sid, license, roles } = claims
    return {
        ...session,
        // The role (and organisation name) as the login server knows it now
        tenant,
        superadmin,
        accessToken: tokens.access_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        refreshToken: tokens.refresh_token ?? session.refreshToken,
        idToken: tokens.id_token,
        sid: sid ?? session.sid,
        // Bought or given meanwhile, or the trial ended: as the login server says now
        license,
        // Given or taken away by an admin meanwhile
        roles
    }
}

/**
 * The session of a cookie, with an access token that is valid for at least another minute: renewed with the refresh
 * token when needed (or now, with `force`). `cookie` is the new cookie value to set (or "delete" when the login server ended the session).
 * Only for the proxy and route handlers: they can set cookies, server components cannot.
 */
export async function freshSession(sealed: string | undefined, { force = false } = {}): Promise<Renewed> {
    const session = unseal<Session>(sealed, SESSION_COOKIE)
    if (!session) return { session: null, cookie: sealed ? 'delete' : null }
    // The login server ended this session (back-channel logout): logged out here too
    if (sessionEnded(session.sid)) return { session: null, cookie: 'delete' }
    // `force`: new tokens now (a demo just started: its licence and roles are in the next tokens)
    if (!force && session.expiresAt - RENEW_BEFORE_MS > Date.now()) return { session, cookie: null }
    const key = session.refreshToken ?? ''
    let pending = running.get(key)
    if (!pending) {
        pending = renew(session).finally(() => running.delete(key))
        if (key) running.set(key, pending)
    }
    const renewed = await pending.catch(() => undefined)
    // The login server could not be reached: keep the cookie, try again at the next request
    if (renewed === undefined) return { session: session.expiresAt > Date.now() ? session : null, cookie: null }
    if (!renewed) return { session: null, cookie: 'delete' }
    return { session: renewed, cookie: seal(renewed, SESSION_COOKIE) }
}
