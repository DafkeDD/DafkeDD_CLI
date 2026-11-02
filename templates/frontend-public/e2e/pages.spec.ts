import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import de from '../messages/de.json'
import en from '../messages/en.json'
import fr from '../messages/fr.json'
import nl from '../messages/nl.json'
import { APP_NAV } from '../src/lib/nav'

/**
 * Every page of APP_NAV (src/lib/nav.ts), the home page first: in the shell with its page head, in every language, in
 * both themes and at phone width, without accessibility violations (WCAG 2.2 AA). This frontend has no login: every
 * page is open. A new page in APP_NAV is tested here by itself.
 */
const MESSAGES = { en, nl, fr, de }

/** No violation of WCAG 2.2 AA on the page as it is now. */
async function accessible(page: Page) {
    // AxeBuilder has the Page type of its own playwright-core: the same page at run time
    const { violations } = await new AxeBuilder({ page } as unknown as ConstructorParameters<typeof AxeBuilder>[0])
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
    expect(violations.map(v => `${v.id}: ${v.nodes.map(node => node.target.join(' ')).join(', ')}`)).toEqual([])
}

for (const item of APP_NAV) {
    test.describe(`${item.href} (${item.label})`, () => {
        for (const [locale, messages] of Object.entries(MESSAGES)) {
            test(`in ${locale}`, async ({ page, context, baseURL }) => {
                await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: baseURL! }])
                await page.goto(item.href)
                await expect(page).toHaveURL(url => url.pathname === item.href)
                await expect(page.locator('html')).toHaveAttribute('lang', locale)
                await expect(page.locator('.page-head')).toBeVisible()
                // The rail names the pages in this language
                for (const nav of APP_NAV)
                    await expect(
                        page.getByRole('link', { name: messages.Nav[nav.label as keyof typeof messages.Nav] }).first()
                    ).toBeAttached()
            })
        }

        for (const theme of ['light', 'dark']) {
            test(`${theme}, accessible`, async ({ page }) => {
                await page.addInitScript(value => localStorage.setItem('lui-theme', value), theme)
                await page.goto(item.href)
                await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
                await expect(page.locator('.page-head')).toBeVisible()
                await accessible(page)
            })
        }

        test('at phone width (390px): nothing scrolls sideways, accessible', async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 })
            await page.goto(item.href)
            await expect(page.locator('.page-head')).toBeVisible()
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
            await accessible(page)
        })
    })

    test(`${item.href} is open: no login`, async ({ request }) => {
        const answer = await request.get(item.href, { maxRedirects: 0 })
        expect(answer.status()).toBe(200)
    })
}
