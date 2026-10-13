import { type NextRequest, NextResponse } from 'next/server'
import { authorizationUrl, cookieOptions, type Flow, FLOW_COOKIE, FLOW_SECONDS, newFlow, seal } from '@/lib/oidc'

/** Starts a login: remembers state, nonce and the PKCE verifier in an encrypted cookie, then goes to the OIDC server. */
export async function GET(request: NextRequest) {
    const flow = newFlow(request.nextUrl.searchParams.get('returnTo') ?? '/')
    const locale =
        request.cookies.get('NEXT_LOCALE')?.value ?? request.headers.get('accept-language')?.slice(0, 2) ?? 'en'
    let location: string
    try {
        location = await authorizationUrl(flow, locale)
    } catch {
        return NextResponse.redirect(new URL('/login?error=offline', request.url))
    }
    const response = NextResponse.redirect(location)
    const stored: Flow = { state: flow.state, nonce: flow.nonce, verifier: flow.verifier, returnTo: flow.returnTo }
    response.cookies.set(FLOW_COOKIE, seal(stored, FLOW_COOKIE), cookieOptions(FLOW_SECONDS, '/api/auth'))
    return response
}
