import { type NextRequest, NextResponse } from 'next/server'
import { endSessionUrl, fromThisApp, revokeRefreshToken, type Session, SESSION_COOKIE, unseal } from '@/lib/oidc'

/**
 * Logs out (POST, from the log out button): forgets the session of this app, revokes its refresh token, and sends the
 * browser to the login server (end_session_endpoint) so that its session ends too: the next login asks the password
 * (or the eID) again. The login server sends the browser back to the home page.
 */
export async function POST(request: NextRequest) {
    // Only from a page of this app: another site cannot log the user out
    if (!fromThisApp(request)) return NextResponse.json({ error: 'origin' }, { status: 403 })
    const session = unseal<Session>(request.cookies.get(SESSION_COOKIE)?.value, SESSION_COOKIE)
    let location = new URL('/', request.url).toString()
    if (session) {
        if (session.refreshToken) await revokeRefreshToken(session.refreshToken)
        location = await endSessionUrl(session.idToken).catch(() => location)
    }
    const response = NextResponse.redirect(location, 303)
    response.cookies.delete(SESSION_COOKIE)
    return response
}
