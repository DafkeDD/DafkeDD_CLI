import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import de from '../messages/de.json'
import en from '../messages/en.json'
import fr from '../messages/fr.json'
import nl from '../messages/nl.json'
import { ADMIN, logIn, opened, SUPERADMIN, tourSeen } from './session'
import type { Session } from '../src/lib/oidc'

/**
 * Every page of the customer portal (as an admin of an organisation) and of the superadmin panel: in the shell with
 * its page head, in every language, in both themes and at phone width, without accessibility violations (WCAG 2.2 AA),
 * and none without a login. The rail and the user menu of src/components/pasport/portal-shell.tsx: a new page goes in
 * these lists too.
 */
const MESSAGES = { en, nl, fr, de }
type ShellKey = keyof typeof en.Portal.Shell

/** The rail of the customer portal (CustomerShell), by the key of its name in Portal.Shell. */
const PORTAL_RAIL: [string, ShellKey][] = [
    ['/apps', 'myApps'],
    ['/dashboard', 'dashboard'],
    ['/marketplace', 'marketplace'],
    ['/users', 'users'],
    ['/invoices', 'invoices'],
    ['/support', 'support']
]
/** The pages of its user menu. */
const PORTAL_MENU = ['/profile', '/security', '/audit']
/** The rail of the superadmin panel (AdminShell). */
const ADMIN_RAIL: [string, ShellKey][] = [
    ['/admin/tenants', 'tenants'],
    ['/admin/users', 'users'],
    ['/admin/tickets', 'tickets'],
    ['/admin/catalog', 'catalog'],
    ['/admin/codes', 'codes'],
    ['/admin/audit', 'activity'],
    ['/admin/ratings', 'ratings']
]
/** The pages of its user menu. */
const ADMIN_MENU = ['/admin/stats', '/admin/profile', '/admin/security']

const AREAS: { name: string; session: Session; rail: [string, ShellKey][]; pages: string[] }[] = [
    {
        name: 'customer portal',
        session: ADMIN,
        rail: PORTAL_RAIL,
        pages: [...PORTAL_RAIL.map(([href]) => href), ...PORTAL_MENU]
    },
    {
        name: 'superadmin panel',
        session: SUPERADMIN,
        rail: ADMIN_RAIL,
        pages: [...ADMIN_RAIL.map(([href]) => href), ...ADMIN_MENU]
    }
]

/** No violation of WCAG 2.2 AA on the page as it is now. */
async function accessible(page: Page) {
    // AxeBuilder has the Page type of its own playwright-core: the same page at run time
    const { violations } = await new AxeBuilder({ page } as unknown as ConstructorParameters<typeof AxeBuilder>[0])
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
    expect(violations.map(v => `${v.id}: ${v.nodes.map(node => node.target.join(' ')).join(', ')}`)).toEqual([])
}

for (const area of AREAS) {
    for (const path of area.pages) {
        test.describe(`${path} (${area.name})`, () => {
            test.beforeEach(async ({ page, context, baseURL }) => {
                await logIn(context, baseURL!, area.session)
                await tourSeen(page, area.session)
            })

            for (const [locale, messages] of Object.entries(MESSAGES)) {
                test(`in ${locale}`, async ({ page, context, baseURL }) => {
                    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: baseURL! }])
                    await page.goto(path)
                    await expect(page).toHaveURL(url => url.pathname === path)
                    await expect(page.locator('html')).toHaveAttribute('lang', locale)
                    await opened(page)
                    // The rail names its pages in this language
                    for (const [, key] of area.rail)
                        await expect(
                            page.getByRole('link', { name: messages.Portal.Shell[key] }).first()
                        ).toBeAttached()
                })
            }

            for (const theme of ['light', 'dark']) {
                test(`${theme}, accessible`, async ({ page }) => {
                    await page.addInitScript(value => localStorage.setItem('lui-theme', value), theme)
                    await page.goto(path)
                    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
                    await opened(page)
                    await accessible(page)
                })
            }

            test('at phone width (390px): nothing scrolls sideways, accessible', async ({ page }) => {
                await page.setViewportSize({ width: 390, height: 844 })
                await page.goto(path)
                await opened(page)
                expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
                await accessible(page)
            })
        })

        test(`${path} without a session goes to the login`, async ({ request }) => {
            const answer = await request.get(path, { maxRedirects: 0 })
            expect(answer.status()).toBe(307)
            const login = new URL(answer.headers().location, 'http://x')
            expect(login.pathname).toBe('/login')
            expect(login.searchParams.get('returnTo')).toBe(path)
        })
    }
}

test('a member of an organisation never opens the superadmin panel', async ({ page, context, baseURL }) => {
    await logIn(context, baseURL!, ADMIN)
    await tourSeen(page, ADMIN)
    await page.goto('/admin/tenants')
    await expect(page).toHaveURL(url => url.pathname === '/dashboard')
})
