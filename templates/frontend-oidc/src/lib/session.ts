import { cookies } from 'next/headers'
import { connection } from 'next/server'
import { type Session, SESSION_COOKIE, unseal } from './oidc'

/**
 * The logged in user (server components and route handlers), or null. The proxy (src/proxy.ts) renewed the access
 * token before the page renders; when that was not possible, an expired access token counts as logged out.
 */
export async function getSession(): Promise<Session | null> {
    // Always per request, never prerendered: the session depends on the cookie and on the current time.
    await connection()
    const session = unseal<Session>((await cookies()).get(SESSION_COOKIE)?.value, SESSION_COOKIE)
    return session && session.expiresAt > Date.now() ? session : null
}
