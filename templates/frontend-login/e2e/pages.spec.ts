import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import de from '../messages/de.json'
import en from '../messages/en.json'
import fr from '../messages/fr.json'
import nl from '../messages/nl.json'
import { APP_NAV } from '../src/lib/nav'
import { logIn } from './account'

/**
 * Every page: those of APP_NAV (src/lib/nav.ts) and the profile behind the login, the login and the registration
 * without it. In every language, in both themes and at phone width, without accessibility violations (WCAG 2.2 AA). A
 * new page in APP_NAV is tested here by itself.
 */
const MESSAGES = { en, nl, fr, de }
const PAGES = [...APP_NAV.map(item => item.href), '/profile']
/** PUBLIC_PATHS of src/proxy.ts, with the title of their screen. */
const PUBLIC = { '/login': 'loginTitle', '/register': 'registerTitle' } as const

/** No violation of WCAG 2.2 AA on the page as it is now. */
async function accessible(page: Page) {
    // AxeBuilder has the Page type of its own playwright-core: the same page at run time
    const { violations } = await new AxeBuilder({ page } as unknown as ConstructorParameters<typeof AxeBuilder>[0])
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
    expect(violations.map(v => `${v.id}: ${v.nodes.map(node => node.target.join(' ')).join(', ')}`)).toEqual([])
}

/** The same page in every language, both themes and at phone width; `opened` checks that it is the page asked for. */
function everyWay(path: string, opened: (page: Page, messages: typeof en) => Promise<void>) {
    for (const [locale, messages] of Object.entries(MESSAGES)) {
        test(`in ${locale}`, async ({ page, context, baseURL }) => {
            await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: baseURL! }])
            await page.goto(path)
            await expect(page.locator('html')).toHaveAttribute('lang', locale)
            await opened(page, messages)
        })
    }

    for (const theme of ['light', 'dark']) {
        test(`${theme}, accessible`, async ({ page }) => {
            await page.addInitScript(value => localStorage.setItem('lui-theme', value), theme)
            await page.goto(path)
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
            await opened(page, en)
            await accessible(page)
        })
    }

    test('at phone width (390px): nothing scrolls sideways, accessible', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto(path)
        await opened(page, en)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
        await accessible(page)
    })
}

for (const path of PAGES) {
    test.describe(`${path}, logged in`, () => {
        test.beforeEach(async ({ context, baseURL }) => {
            await logIn(context, baseURL!)
        })
        everyWay(path, async (page, messages) => {
            await expect(page).toHaveURL(url => url.pathname === path)
            await expect(page.locator('.page-head')).toBeVisible()
            // The rail names the pages in this language
            for (const item of APP_NAV)
                await expect(
                    page.getByRole('link', { name: messages.Nav[item.label as keyof typeof messages.Nav] }).first()
                ).toBeAttached()
        })
    })
}

for (const [path, title] of Object.entries(PUBLIC)) {
    test.describe(`${path}, without a login`, () => {
        everyWay(path, async (page, messages) => {
            await expect(page).toHaveURL(url => url.pathname === path)
            await expect(page.getByRole('heading', { name: messages.Auth[title], exact: true })).toBeVisible()
        })
    })
}
