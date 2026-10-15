import { type NextRequest, NextResponse } from 'next/server'
import { endSession } from '@/lib/ended'
import { verifyLogoutToken } from '@/lib/oidc'

/**
 * Back-channel logout (OpenID Connect Back-Channel Logout 1.0): the login server POSTs a signed logout token here when
 * a session ends there (logout elsewhere, ended on /security, password reset, member disabled). Every browser of that
 * session is logged out here at its next request. Registered as backchannelLogoutUri in config/oidc-clients.json of
 * the API.
 */
export async function POST(request: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' }
    let token: string | null = null
    try {
        token = (await request.formData()).get('logout_token')?.toString() ?? null
    } catch {
        token = null
    }
    if (!token) return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers })
    try {
        const { sid } = await verifyLogoutToken(token)
        endSession(sid)
        return new NextResponse(null, { status: 200, headers })
    } catch {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers })
    }
}
