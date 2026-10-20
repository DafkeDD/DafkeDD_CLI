import { type NextRequest, NextResponse } from 'next/server'
import {
    cookieOptions,
    exchangeCode,
    type Flow,
    FLOW_COOKIE,
    OIDC_ISSUER,
    type Session,
    SESSION_COOKIE,
    SESSION_SECONDS,
    seal,
    unseal,
    userinfo,
    verifyIdToken
} from '@/lib/oidc'

/**
 * The OIDC server sends the browser back here with a code. Checks state and iss, exchanges the code (with the PKCE
 * verifier), verifies the ID token and stores the session in an encrypted cookie.
 */
export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams
    const flow = unseal<Flow>(request.cookies.get(FLOW_COOKIE)?.value, FLOW_COOKIE)
    const fail = (reason: string) => {
        const response = NextResponse.redirect(new URL('/login?error=' + encodeURIComponent(reason), request.url))
        response.cookies.delete({ name: FLOW_COOKIE, path: '/api/auth' })
        return response
    }

    if (!flow || params.get('state') !== flow.state) return fail('state')
    if (params.get('error')) return fail(params.get('error') ?? 'error')
    if (params.get('iss') !== OIDC_ISSUER) return fail('issuer')
    const code = params.get('code')
    if (!code) return fail('code')

    try {
        const tokens = await exchangeCode(code, flow.verifier)
        const { sub, sid, tenant, superadmin, license } = await verifyIdToken(
            tokens.id_token,
            flow.nonce,
            tokens.access_token
        )
        const claims = (await userinfo(tokens.access_token)) ?? {}
        const session: Session = {
            sub,
            name: typeof claims.name === 'string' ? claims.name : '',
            email: typeof claims.email === 'string' ? claims.email : '',
            tenant,
            superadmin,
            accessToken: tokens.access_token,
            expiresAt: Date.now() + tokens.expires_in * 1000,
            refreshToken: tokens.refresh_token ?? null,
            idToken: tokens.id_token,
            sid,
            license
        }
        const response = NextResponse.redirect(new URL(flow.returnTo, request.url))
        // Lives as long as the session of the login server; the access token inside is renewed with the refresh token
        response.cookies.set(SESSION_COOKIE, seal(session, SESSION_COOKIE), cookieOptions(SESSION_SECONDS))
        response.cookies.delete({ name: FLOW_COOKIE, path: '/api/auth' })
        return response
    } catch {
        return fail('token')
    }
}
