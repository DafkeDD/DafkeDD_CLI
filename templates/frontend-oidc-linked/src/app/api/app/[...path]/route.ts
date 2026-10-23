import { type NextRequest, NextResponse } from 'next/server'
import { API_URL } from '@/lib/api'
import { APP_URL, cookieOptions, SESSION_COOKIE, SESSION_SECONDS } from '@/lib/oidc'
import { freshSession } from '@/lib/refresh'

/** A path of the API of this app: letters, digits, -, _ and / (never .. or an empty segment). */
const PATH = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/
/** The headers of the answer of the API that reach the browser: the type, caching (ETag → 304) and downloads. */
const PASSED_HEADERS = [
    'content-type',
    'etag',
    'cache-control',
    'content-disposition',
    'content-security-policy',
    'x-content-type-options'
]

/**
 * Calls the API of THIS app (./backend, NEXT_PUBLIC_API_URL) for the browser: adds the access token of the session
 * (Authorization: Bearer) on the server, so the token never reaches the browser. That API checks the token itself
 * (the keys of the login server) and takes the organisation from it. Changes must come from a page of this app
 * (Origin check). Answers 401 { error: "session" } when the user is not logged in (any more).
 */
async function forward(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const path = (await params).path.join('/')
    if (!PATH.test(path)) return NextResponse.json({ error: 'not-found' }, { status: 404 })
    if (request.method !== 'GET' && request.headers.get('origin') !== new URL(APP_URL).origin)
        return NextResponse.json({ error: 'origin' }, { status: 403 })
    // Renews the access token with the refresh token when it (almost) expired
    const { session, cookie } = await freshSession(request.cookies.get(SESSION_COOKIE)?.value)
    const answer = (result: NextResponse) => {
        if (cookie === 'delete') result.cookies.delete(SESSION_COOKIE)
        else if (cookie) result.cookies.set(SESSION_COOKIE, cookie, cookieOptions(SESSION_SECONDS))
        return result
    }
    if (!session) return answer(NextResponse.json({ error: 'session' }, { status: 401 }))

    const hasBody = !['GET', 'DELETE'].includes(request.method)
    // The body and the answer are passed on as bytes, so uploads and downloads (images, PDFs …) work like JSON does
    const etag = request.headers.get('if-none-match')
    const response = await fetch(`${API_URL}/${path}${request.nextUrl.search}`, {
        method: request.method,
        headers: {
            Authorization: 'Bearer ' + session.accessToken,
            Accept: request.headers.get('accept') ?? 'application/json',
            'Accept-Language': request.headers.get('accept-language') ?? 'en',
            ...(etag ? { 'If-None-Match': etag } : {}),
            ...(hasBody ? { 'Content-Type': request.headers.get('content-type') ?? 'application/json' } : {})
        },
        body: hasBody ? await request.arrayBuffer() : undefined,
        cache: 'no-store'
    }).catch(() => null)
    if (!response) return answer(NextResponse.json({ error: 'offline' }, { status: 502 }))
    const headers: Record<string, string> = {}
    for (const name of PASSED_HEADERS) {
        const value = response.headers.get(name)
        if (value) headers[name] = value
    }
    if (response.status === 204 || response.status === 304)
        return answer(
            new NextResponse(null, { status: response.status, headers: response.status === 304 ? headers : {} })
        )
    headers['content-type'] ??= 'application/json'
    return answer(new NextResponse(await response.arrayBuffer(), { status: response.status, headers }))
}

export { forward as DELETE, forward as GET, forward as PATCH, forward as POST, forward as PUT }
