import { type NextRequest, NextResponse } from 'next/server'
import { API_URL } from '@/lib/api'
import { APP_URL } from '@/lib/oidc'
import { getSession } from '@/lib/session'

/** Only these parts of the API can be called through this route: members, the platform, the own two-step verification, the eID
 * and the heartbeat (who is online). */
const ALLOWED = /^(tenants\/current\/|admin\/|me\/mfa|me\/eid|me\/heartbeat$)[A-Za-z0-9/_-]*$/

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
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'session' }, { status: 401 })

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
    if (!response) return NextResponse.json({ error: 'offline' }, { status: 502 })
    if (response.status === 204) return new NextResponse(null, { status: 204 })
    return new NextResponse(await response.text(), {
        status: response.status,
        headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/json' }
    })
}

export { forward as DELETE, forward as GET, forward as PATCH, forward as POST }
