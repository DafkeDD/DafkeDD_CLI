import { expect, type Page, test } from '@playwright/test'
import en from '../messages/en.json'
import { ADMIN, tourSeen } from './session'

/**
 * The login server against the real API, with the demo data (npm run demo:data in ../backend): a real login through
 * the login screen (email and password, no two-step verification) as the admin of an organisation, a member and the
 * superadmin, then every page of the rail and the user menu, each with its page head, without LoadError, and rows
 * where the demo data has them. Only with E2E_API (the API, for example http://localhost:4000) and E2E_DEMO_PASSWORD
 * (the password of npm run demo:data -- --password <text>); without them it is skipped, and the other specs run with
 * the answers of the API given by the test. The API must know this frontend (APP_URL, OIDC_LOGIN_UI_URL and the
 * redirect of the client `frontend` on E2E_PORT) and run with OIDC_MFA=optional (else every account first sets up
 * two-step verification). Desktop and English only: the languages, the themes and the phone are in pages.spec.ts.
 */
const API = process.env.E2E_API ?? ''
const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? ''
test.skip(!API || !PASSWORD, 'needs the real API: E2E_API and E2E_DEMO_PASSWORD')
// A trace, a video or a screenshot of a failure would keep the password and the real tokens: none of them here
test.use({ trace: 'off', video: 'off', screenshot: 'off' })

/**
 * The accounts of the demo data (scripts/demo-data.mjs of the backend); the superadmin is made with
 * npm run oidc:user -- --superadmin, with the same password.
 */
const ACCOUNTS = [
    {
        name: 'admin of an organisation',
        email: 'an.peeters@demo.example.com',
        start: '/dashboard',
        rail: ['/apps', '/dashboard', '/marketplace', '/users', '/invoices', '/support'],
        menu: ['/profile', '/security', '/audit'],
        superadmin: false
    },
    {
        name: 'member of an organisation',
        email: 'bram.janssens@demo.example.com',
        start: '/dashboard',
        rail: ['/apps', '/dashboard', '/marketplace', '/support'],
        menu: ['/profile', '/security'],
        superadmin: false
    },
    {
        name: 'superadmin',
        email: process.env.E2E_SUPERADMIN_EMAIL ?? 'support@demo.example.com',
        start: '/admin/tenants',
        rail: [
            '/admin/tenants',
            '/admin/users',
            '/admin/tickets',
            '/admin/catalog',
            '/admin/codes',
            '/admin/audit',
            '/admin/ratings'
        ],
        menu: ['/admin/stats', '/admin/profile', '/admin/security'],
        superadmin: true
    }
]

/** The pages with a table that the demo data fills: at least one row that is not the empty row. */
const ROWS = [
    '/users',
    '/invoices',
    '/admin/tenants',
    '/admin/users',
    '/admin/tickets',
    '/admin/catalog',
    '/admin/codes',
    '/admin/ratings'
]
/** The pages of cards that the demo data fills: the heading of their empty state is not there. */
const NOT_EMPTY: Record<string, string> = { '/support': en.Portal.Tickets.noTickets }

/** Logs in through the real login screen: the email tab, email and password, and the organisation or the platform. */
async function logIn(page: Page, email: string, superadmin: boolean) {
    await expect(page).toHaveURL(url => url.pathname === '/login' && url.searchParams.has('interaction'))
    const emailTab = page.getByRole('tab', { name: en.AuthScreen.tabEmail, exact: true })
    const field = page.locator('input[name="email"]')
    await expect(emailTab.or(field).first()).toBeVisible()
    if (await emailTab.isVisible()) await emailTab.click()
    await field.fill(email)
    // Not with fill() or type(): their step title shows the value, and the report keeps every step title
    await page.locator('input[name="password"]').evaluate((input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
    }, PASSWORD)
    await page.getByRole('button', { name: en.AuthScreen.login, exact: true }).click()
    // More than one organisation (a superadmin is admin of every one): the platform, or the first organisation
    const choose = page.getByRole('heading', { name: en.Oidc.tenantTitle, exact: true })
    const shell = page.locator('nav.rail-nav')
    await expect(choose.or(shell).first()).toBeVisible()
    if (await choose.isVisible()) {
        if (superadmin) await page.getByRole('button', { name: en.Oidc.platformChoice }).click()
        else await page.locator('.step-row').first().click()
    }
    await expect(shell).toBeVisible()
}

/** The page shows real data: its page head, no LoadError, and rows where the demo data has them. */
async function realData(page: Page, path: string) {
    await page.goto(path)
    await expect(page).toHaveURL(url => url.pathname === path)
    await expect(page.locator('.page-head').first()).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: en.Shell.loadFailed })).toHaveCount(0)
    if (ROWS.includes(path)) await expect(page.locator('tbody tr:not(:has(.empty-row))').first()).toBeVisible()
    if (NOT_EMPTY[path]) await expect(page.getByRole('heading', { name: NOT_EMPTY[path] })).toHaveCount(0)
}

for (const account of ACCOUNTS) {
    test(`the ${account.name} logs in for real and opens every page with real data`, async ({ page }) => {
        // The tour was seen already, so it does not cover the pages (a superadmin has none)
        if (!account.superadmin) await tourSeen(page, { ...ADMIN, email: account.email })
        await page.goto(account.start)
        await logIn(page, account.email, account.superadmin)
        await expect(page).toHaveURL(url => url.pathname === account.start)

        // Every page of the rail is there, and every page the rail shows opens (also one only some accounts have)
        const rail = await page
            .locator('nav.rail-nav a[href^="/"]')
            .evaluateAll(links => links.map(link => new URL((link as HTMLAnchorElement).href).pathname))
        for (const href of account.rail) expect(rail).toContain(href)
        for (const path of [...new Set([...rail, ...account.menu])])
            await test.step(path, async () => {
                await realData(page, path)
            })
    })
}
