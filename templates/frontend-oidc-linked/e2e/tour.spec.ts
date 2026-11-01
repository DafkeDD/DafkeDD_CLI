import { expect, test } from '@playwright/test'
import en from '../messages/en.json'
import { APP_NAV } from '../src/lib/nav'
import { logIn, SUPERADMIN, tourSeen, USER } from './session'

/**
 * The first-login tour (src/components/pasport/app-tour.tsx): a welcome, a step for every page of APP_NAV, the
 * notifications, the account menu and the end. A new page in APP_NAV is a new step here by itself.
 */
const STEPS = 1 + APP_NAV.length + 3
const t = en.AppTour

test('the first login shows the tour of every page, and remembers it', async ({ page, context, baseURL }) => {
    await logIn(context, baseURL!)
    await page.goto('/')
    const tip = page.locator('.tour-tip')
    for (let step = 1; step <= STEPS; step++) {
        await expect(tip.locator('.tour-count')).toHaveText(new RegExp(`\\b${step}\\b.*\\b${STEPS}\\b`))
        // A step of a page goes to that page and is called after it
        const item = APP_NAV[step - 2]
        if (item) {
            await expect(page).toHaveURL(url => url.pathname === item.href)
            await expect(tip.locator('h3')).toHaveText(en.Nav[item.label as keyof typeof en.Nav])
        }
        if (step < STEPS) await tip.getByRole('button', { name: t.next }).click()
    }
    await tip.getByRole('button', { name: t.finish }).click()
    await expect(tip).toHaveCount(0)
    // Remembered for this account (its opaque id, never the email address): not again after a reload
    await page.reload()
    await expect(page.locator('.page-head')).toBeVisible()
    await expect(tip).toHaveCount(0)
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('tour')))).toEqual([
        `app-tour:${USER.sub}`
    ])
})

test('the user menu starts the tour again, and it stays open on the next page', async ({ page, context, baseURL }) => {
    await logIn(context, baseURL!)
    await tourSeen(page)
    await page.goto('/')
    await expect(page.locator('.page-head')).toBeVisible()
    const tip = page.locator('.tour-tip')
    await expect(tip).toHaveCount(0)
    await page.getByRole('button', { name: en.Portal.Shell.userMenu }).click()
    await page.getByRole('menuitem', { name: t.menu }).click()
    await expect(tip).toBeVisible()
    // The welcome, then the first page of APP_NAV: still open there
    await tip.getByRole('button', { name: t.next }).click()
    await expect(page).toHaveURL(url => url.pathname === APP_NAV[0].href)
    await expect(tip.locator('h3')).toHaveText(en.Nav[APP_NAV[0].label as keyof typeof en.Nav])
    await page.keyboard.press('Escape')
    await expect(tip).toHaveCount(0)
})

test('a superadmin gets no tour and no "Tour" in the menu', async ({ page, context, baseURL }) => {
    await logIn(context, baseURL!, SUPERADMIN)
    await page.goto('/')
    await expect(page.locator('.page-head')).toBeVisible()
    await expect(page.locator('.tour-tip')).toHaveCount(0)
    await page.getByRole('button', { name: en.Portal.Shell.userMenu }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await expect(page.getByRole('menuitem', { name: t.menu })).toHaveCount(0)
})
