import createMiddleware from 'next-intl/middleware'
import type { NextRequest } from 'next/server'
import { routing } from './i18n/routing'
import { cookieOptions, SESSION_COOKIE, SESSION_SECONDS } from './lib/oidc'
import { freshSession } from './lib/refresh'

const intl = createMiddleware(routing)

/**
 * Every page request: the language (next-intl), and the login. When the access token of the session (almost) expired,
 * it is renewed here with the refresh token, before the page renders: server components then always see a valid one
 * (they cannot set cookies themselves). When the login server ended the session, the cookie is deleted.
 */
export default async function proxy(request: NextRequest) {
    const { cookie } = await freshSession(request.cookies.get(SESSION_COOKIE)?.value)
    // The page of this request already gets the new cookie, the browser gets it with the response
    if (cookie === 'delete') request.cookies.delete(SESSION_COOKIE)
    else if (cookie) request.cookies.set(SESSION_COOKIE, cookie)
    const response = intl(request)
    if (cookie === 'delete') response.cookies.delete(SESSION_COOKIE)
    else if (cookie) response.cookies.set(SESSION_COOKIE, cookie, cookieOptions(SESSION_SECONDS))
    return response
}

export const config = {
    matcher: '/((?!api|trpc|_next|_vercel|.*\\..*).*)'
}
