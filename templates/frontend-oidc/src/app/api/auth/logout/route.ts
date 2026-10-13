import { type NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/oidc'

/**
 * Logs out of this frontend (POST, from the log out button). The session of the OIDC server stays: logging in again
 * then needs no password. Logging out of the OIDC server itself follows with the logout endpoint (next phase).
 */
export function POST(request: NextRequest) {
    const response = NextResponse.redirect(new URL('/', request.url), 303)
    response.cookies.delete(SESSION_COOKIE)
    return response
}
