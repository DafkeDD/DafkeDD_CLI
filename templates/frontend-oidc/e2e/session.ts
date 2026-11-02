import { type BrowserContext, expect, type Page } from '@playwright/test'
import { seal, SESSION_COOKIE, type Session } from '../src/lib/oidc'

/**
 * Test sessions, without the API: the session cookie this frontend makes after a login, sealed with the AUTH_SECRET of
 * the tests (playwright.config.ts). Never a real account, token or secret.
 */
const IN_AN_HOUR = () => Date.now() + 60 * 60 * 1000

/** The admin of an organisation: the whole customer portal, and the tour of an admin. */
export const ADMIN: Session = {
    sub: 'e2e-admin-0001',
    name: 'Anna Peeters',
    email: 'anna@example.com',
    tenant: { id: '00000000-0000-4000-8000-000000000001', name: 'Acme', role: 'admin' },
    superadmin: false,
    accessToken: 'e2e',
    expiresAt: IN_AN_HOUR(),
    refreshToken: null,
    idToken: 'e2e'
}

/** A member of the organisation: the tour of a member (no users, no invoices). */
export const MEMBER: Session = {
    ...ADMIN,
    sub: 'e2e-member-0001',
    name: 'Bart Claes',
    email: 'bart@example.com',
    tenant: { ...ADMIN.tenant!, role: 'user' }
}

/** The support team on the platform: the superadmin panel, no tour, no "Tour" in the menu. */
export const SUPERADMIN: Session = {
    ...ADMIN,
    sub: 'e2e-superadmin',
    name: 'Support Team',
    email: 'support@example.com',
    tenant: null,
    superadmin: true
}

/** Logs the browser of this test in as `session`. */
export async function logIn(context: BrowserContext, baseURL: string, session: Session = ADMIN) {
    await context.addCookies([
        { name: SESSION_COOKIE, value: seal({ ...session, expiresAt: IN_AN_HOUR() }, SESSION_COOKIE), url: baseURL }
    ])
}

/** Where the tour remembers that this account saw it (src/components/pasport/tour.tsx). */
export const tourKey = (session: Session) => `pp-tour:${session.email.toLowerCase()}`

/** The tour was seen already (as after a first login), so it does not cover the page. */
export async function tourSeen(page: Page, session: Session = ADMIN) {
    await page.addInitScript(key => localStorage.setItem(key, 'done'), tourKey(session))
}

/**
 * The page is there: its page head, or (the API is not started) the message of LoadError (page-state.tsx) that its
 * data could not be loaded, in the content of the shell.
 */
export const opened = (page: Page) => expect(page.locator('.page-head, .card-pad > h3.t-h3').first()).toBeVisible()
