import { type NextRequest, NextResponse } from 'next/server'
import { API_URL } from '@/lib/api'
import { APP_URL, cookieOptions, SESSION_COOKIE, SESSION_SECONDS } from '@/lib/oidc'
import { freshSession } from '@/lib/refresh'

/**
 * Only these parts of the API can be called through this route: members, the platform, the own two-step verification,
 * the eID, the own sessions and licences, and the heartbeat (who is online).
 */
const ALLOWED =
    /^(tenants\/current\/|admin\/|me\/mfa|me\/eid|me\/sessions|me\/licenses$|me\/heartbeat$)[A-Za-z0-9/_-]*$/

/**
 * Calls the protected API for the browser: adds the access token of the session (Authorization: Bearer) on the server.
 * Changes (POST, PATCH, PUT, DELETE) must come from a page of this app (Origin check), so another site cannot use the
 * session cookie. Answers 401 { error: "session" } when the user is not logged in (any more).
 */
async function forward(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const path = (await params).path.join('/')
    if (!ALLOWED.test(path)) return NextResponse.json({ error: 'not-found' }, { status: 404 })
    if (request.method !== 'GET' && request.headers.get('origin') !== new URL(APP_URL).origin)
        return NextResponse.json({ error: 'origin' }, { status: 403 })
    // Renews the access token with the refresh token when it (almost) expired
    const { session, cookie } = await freshSession(request.cookies.get(SESSION_COOKIE)?.value)
    const answer = (result: NextResponse, ended = false) => {
        if (cookie === 'delete' || ended) result.cookies.delete(SESSION_COOKIE)
        else if (cookie) result.cookies.set(SESSION_COOKIE, cookie, cookieOptions(SESSION_SECONDS))
        return result
    }
    if (!session) return answer(NextResponse.json({ error: 'session' }, { status: 401 }))

    const hasBody = !['GET', 'DELETE'].includes(request.method)
    const response = await fetch(`${API_URL}/${path}${request.nextUrl.search}`, {
        method: request.method,
        headers: {
            Authorization: 'Bearer ' + session.accessToken,
            Accept: 'application/json',
            'Accept-Language': request.headers.get('accept-language') ?? 'en',
            ...(hasBody ? { 'Content-Type': 'application/json' } : {})
        },
        body: hasBody ? await request.text() : undefined,
        cache: 'no-store'
    }).catch(() => null)
    if (!response) return answer(NextResponse.json({ error: 'offline' }, { status: 502 }))
    if (response.status === 204) return answer(new NextResponse(null, { status: 204 }))
    // 401: the session ended at the login server (logged out elsewhere, ended on /security): forget it here too
    return answer(
        new NextResponse(await response.text(), {
            status: response.status,
            headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/json' }
        }),
        response.status === 401
    )
}

export { forward as DELETE, forward as GET, forward as PATCH, forward as POST }
