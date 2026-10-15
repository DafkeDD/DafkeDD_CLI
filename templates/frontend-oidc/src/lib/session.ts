import { cookies } from 'next/headers'
import { connection } from 'next/server'
import { sessionEnded } from './ended'
import { type Session, SESSION_COOKIE, unseal } from './oidc'

/**
 * The logged in user (server components and route handlers), or null. The proxy (src/proxy.ts) renewed the access
 * token before the page renders; when that was not possible, an expired access token counts as logged out.
 */
export async function getSession(): Promise<Session | null> {
    // Always per request, never prerendered: the session depends on the cookie and on the current time.
    await connection()
    const session = unseal<Session>((await cookies()).get(SESSION_COOKIE)?.value, SESSION_COOKIE)
    // Ended at the login server (back-channel logout): logged out, even before the access token runs out
    return session && session.expiresAt > Date.now() && !sessionEnded(session.sid) ? session : null
}
