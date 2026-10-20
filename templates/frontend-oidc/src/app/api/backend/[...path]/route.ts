import { type NextRequest, NextResponse } from 'next/server'
import { PASPORT_API_URL } from '@/lib/pasport'
import { APP_URL, cookieOptions, SESSION_COOKIE, SESSION_SECONDS } from '@/lib/oidc'
import { freshSession } from '@/lib/refresh'

/**
 * Only these parts of the API can be called through this route: members, the platform, the own two-step verification,
 * the eID, the own sessions, passkeys and allowed applications, licences and audit log, and the heartbeat (who is online).
 */
const ALLOWED =
    /^(tenants\/current\/|admin\/|me\/mfa|me\/eid|me\/sessions|me\/passkeys|me\/licenses(?:\/[a-z0-9-]+\/trial)?$|me\/audit$|me\/heartbeat$)[A-Za-z0-9/_-]*$/

/**
 * The IP address chain of the browser for the API (X-Forwarded-For): what a proxy in front of this app sent, and the
 * address Next.js saw. The API only believes it from the addresses in its TRUST_PROXY (default: this computer).
 */
function forwardedFor(request: NextRequest): string {
    return request.headers.get('x-forwarded-for')?.slice(0, 500) ?? ''
}

/**
 * Calls the protected API for the browser: adds the access token of the session (Authorization: Bearer) on the server.
 * Changes (POST, PATCH, PUT, DELETE) must come from a page of this app (Origin check), so another site cannot use the
 * session cookie. Answers 401 { error: "session" } when the user is not logged in (any more).
 */
/** The allowed applications: a client id may contain dots (com.example.app), never an empty or ".." segment. */
const CONSENTS = /^me\/consents(\/[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*)?$/
/** The roles per app of the organisation (its admins): a client id may contain dots too. */
const APP_ROLES = /^tenants\/current\/apps(\/[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\/members(\/[0-9a-f-]{36})?)?$/
/** The apps on /admin (superadmins), with the same rule for their client id. */
const APPS = /^admin\/clients(\/[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*(\/secret|\/link-code)?)?$/

async function forward(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const path = (await params).path.join('/')
    if (!ALLOWED.test(path) && !CONSENTS.test(path) && !APPS.test(path) && !APP_ROLES.test(path))
        return NextResponse.json({ error: 'not-found' }, { status: 404 })
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
    const response = await fetch(`${PASPORT_API_URL}/${path}${request.nextUrl.search}`, {
        method: request.method,
        headers: {
            Authorization: 'Bearer ' + session.accessToken,
            Accept: 'application/json',
            'Accept-Language': request.headers.get('accept-language') ?? 'en',
            // The audit log of the API records the browser and the IP address of the user, not those of this server
            'User-Agent': request.headers.get('user-agent') ?? '',
            ...(forwardedFor(request) ? { 'X-Forwarded-For': forwardedFor(request) } : {}),
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

export { forward as DELETE, forward as GET, forward as PATCH, forward as POST, forward as PUT }
