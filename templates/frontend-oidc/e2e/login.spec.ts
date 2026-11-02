import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import de from '../messages/de.json'
import en from '../messages/en.json'
import fr from '../messages/fr.json'
import nl from '../messages/nl.json'

/**
 * The login screen of the login server (/login?interaction=<id>, src/components/oidc-login.tsx), with the answers the
 * API would give for a new login (the API itself is not started): in every language, both themes and at phone width,
 * without accessibility violations.
 */
const MESSAGES = { en, nl, fr, de }
const INTERACTION = 'e2e-interaction'

/** The API answers that a login is waiting, with every way to log in that the screen offers. */
async function waitingLogin(page: Page) {
    await page.route(`**/oidc/interaction/${INTERACTION}`, route =>
        route.fulfill({
            json: {
                csrf: 'e2e',
                clientId: 'frontend',
                clientName: 'Pasport',
                registration: true,
                eid: true,
                password: true
            }
        })
    )
}

/** No violation of WCAG 2.2 AA on the page as it is now. */
async function accessible(page: Page) {
    const { violations } = await new AxeBuilder({ page } as unknown as ConstructorParameters<typeof AxeBuilder>[0])
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
    expect(violations.map(v => `${v.id}: ${v.nodes.map(node => node.target.join(' ')).join(', ')}`)).toEqual([])
}

for (const [locale, messages] of Object.entries(MESSAGES)) {
    test(`the login screen in ${locale}`, async ({ page, context, baseURL }) => {
        await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: baseURL! }])
        await waitingLogin(page)
        await page.goto(`/login?interaction=${INTERACTION}`)
        await expect(page.locator('html')).toHaveAttribute('lang', locale)
        await expect(page.getByRole('heading', { name: messages.AuthScreen.welcome, exact: true })).toBeVisible()
    })
}

for (const theme of ['light', 'dark']) {
    test(`the login screen, ${theme}, accessible`, async ({ page }) => {
        await page.addInitScript(value => localStorage.setItem('lui-theme', value), theme)
        await waitingLogin(page)
        await page.goto(`/login?interaction=${INTERACTION}`)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(page.getByRole('heading', { name: en.AuthScreen.welcome, exact: true })).toBeVisible()
        await accessible(page)
    })
}

test('the login screen at phone width (390px): nothing scrolls sideways, accessible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await waitingLogin(page)
    await page.goto(`/login?interaction=${INTERACTION}`)
    await expect(page.getByRole('heading', { name: en.AuthScreen.welcome, exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await accessible(page)
})
