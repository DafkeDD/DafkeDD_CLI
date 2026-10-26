import { type NextRequest, NextResponse } from 'next/server'
import { cookieOptions, fromThisApp, SESSION_COOKIE, SESSION_SECONDS } from '@/lib/oidc'
import { freshSession } from '@/lib/refresh'

/**
 * New tokens now (POST, after a demo was started): the licence and the roles of the user are in the tokens, so the
 * page shows them at once instead of at the next refresh. 401 without a session.
 */
export async function POST(request: NextRequest) {
    // Only from a page of this app
    if (!fromThisApp(request)) return NextResponse.json({ error: 'origin' }, { status: 403 })
    const renewed = await freshSession(request.cookies.get(SESSION_COOKIE)?.value, { force: true })
    const response = NextResponse.json({ ok: Boolean(renewed.session) }, { status: renewed.session ? 200 : 401 })
    if (renewed.cookie === 'delete') response.cookies.delete(SESSION_COOKIE)
    else if (renewed.cookie) response.cookies.set(SESSION_COOKIE, renewed.cookie, cookieOptions(SESSION_SECONDS))
    return response
}
