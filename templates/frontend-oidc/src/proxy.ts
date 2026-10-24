import createMiddleware from 'next-intl/middleware'
import { NextResponse, type NextRequest } from 'next/server'
import { routing } from './i18n/routing'
import { cookieOptions, SESSION_COOKIE, SESSION_SECONDS } from './lib/oidc'
import { freshSession } from './lib/refresh'

const intl = createMiddleware(routing)

/**
 * The pages anyone may open without a login: the login itself and what leads to an account. Every other page is
 * protected: without a session the browser goes to /login, and after the login back to the page it asked for.
 * A new public page goes in this list (and nowhere else).
 */
export const PUBLIC_PATHS = [
    '/login',
    '/admin/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/invite'
]

export const isPublic = (pathname: string) =>
    PUBLIC_PATHS.some(path => pathname === path || pathname.startsWith(path + '/'))

/**
 * Every page request: the login (protected by default, see PUBLIC_PATHS) and the language (next-intl). When the access
 * token of the session (almost) expired, it is renewed here with the refresh token, before the page renders: server
 * components then always see a valid one (they cannot set cookies themselves). When the login server ended the
 * session, the cookie is deleted.
 */
export default async function proxy(request: NextRequest) {
    const { session, cookie } = await freshSession(request.cookies.get(SESSION_COOKIE)?.value)
    if (!session && !isPublic(request.nextUrl.pathname)) {
        const login = new URL('/login', request.url)
        const back = request.nextUrl.pathname + request.nextUrl.search
        if (back !== '/') login.searchParams.set('returnTo', back)
        const response = NextResponse.redirect(login)
        if (cookie === 'delete') response.cookies.delete(SESSION_COOKIE)
        return response
    }
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
