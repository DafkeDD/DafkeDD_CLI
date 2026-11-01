import type { BrowserContext, Page } from '@playwright/test'
import { seal, SESSION_COOKIE, type Session } from '../src/lib/oidc'

/**
 * Test sessions, without a login server: the session cookie this app would make after a login, sealed with the
 * AUTH_SECRET of the tests (playwright.config.ts). Never a real account, token or secret.
 */
const IN_AN_HOUR = () => Date.now() + 60 * 60 * 1000

/** A member of an organisation: gets the first-login tour. */
export const USER: Session = {
    sub: 'e2e-user-0001',
    name: 'Anna Peeters',
    email: 'anna@example.com',
    tenant: { id: '00000000-0000-4000-8000-000000000001', name: 'Acme', role: 'user' },
    superadmin: false,
    accessToken: 'e2e',
    expiresAt: IN_AN_HOUR(),
    refreshToken: null,
    idToken: 'e2e',
    license: null,
    roles: null
}

/** The support team: no tour, no "Tour" in the menu. */
export const SUPERADMIN: Session = {
    ...USER,
    sub: 'e2e-superadmin',
    name: 'Support Team',
    email: 'support@example.com',
    tenant: null,
    superadmin: true
}

/** Logs the browser of this test in as `session`. */
export async function logIn(context: BrowserContext, baseURL: string, session: Session = USER) {
    await context.addCookies([
        { name: SESSION_COOKIE, value: seal({ ...session, expiresAt: IN_AN_HOUR() }, SESSION_COOKIE), url: baseURL }
    ])
}

/** The tour was seen already (as after a first login), so it does not cover the page. */
export async function tourSeen(page: Page, session: Session = USER) {
    await page.addInitScript(key => localStorage.setItem(key, 'done'), `app-tour:${session.sub}`)
}
