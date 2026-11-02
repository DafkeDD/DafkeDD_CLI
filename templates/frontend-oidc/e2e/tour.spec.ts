import { expect, type Page, test } from '@playwright/test'
import en from '../messages/en.json'
import { TOUR_STEPS } from '../src/components/pasport/tour-steps'
import { ADMIN, logIn, MEMBER, opened, SUPERADMIN, tourKey, tourSeen } from './session'

/**
 * The first-login tour of the customer portal (src/components/pasport/tour.tsx, the steps in tour-steps.ts): every step
 * of an admin, the steps of a member, remembered per account, again from the user menu, none for a superadmin.
 */
const t = en.Portal.Tour
const shell = en.Portal.Shell
/** The title of a step, as the tour fills in the first name. */
const title = (id: string, name: string) =>
    (t[`${id}Title` as keyof typeof t] as string).replace('{name}', name.split(' ')[0])

/** Walks every step: its page, its title and the count, then "Next" (the last one: "Get started"). */
async function walk(page: Page, steps: { id: string; href: string }[], name: string) {
    const tip = page.locator('.tour-tip')
    for (const [index, step] of steps.entries()) {
        await expect(page).toHaveURL(url => url.pathname === step.href)
        await expect(tip.locator('h3')).toHaveText(title(step.id, name))
        await expect(tip.locator('.tour-count')).toHaveText(
            t.stepOf.replace('{step}', String(index + 1)).replace('{total}', String(steps.length))
        )
        await tip.getByRole('button', { name: index < steps.length - 1 ? t.next : t.finish, exact: true }).click()
    }
    await expect(tip).toHaveCount(0)
}

test('the first login of an admin shows every step of the tour, and remembers it', async ({
    page,
    context,
    baseURL
}) => {
    await logIn(context, baseURL!, ADMIN)
    await page.goto('/dashboard')
    await walk(page, TOUR_STEPS.admin, ADMIN.name)
    // Remembered for this account: not again after a reload
    await page.reload()
    await opened(page)
    await expect(page.locator('.tour-tip')).toHaveCount(0)
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('tour')))).toEqual([
        tourKey(ADMIN)
    ])
})

test('a member gets the tour of a member: no users and no invoices', async ({ page, context, baseURL }) => {
    await logIn(context, baseURL!, MEMBER)
    await page.goto('/dashboard')
    await walk(page, TOUR_STEPS.member, MEMBER.name)
    expect(TOUR_STEPS.member.map(step => step.href)).not.toContain('/users')
    expect(TOUR_STEPS.member.map(step => step.href)).not.toContain('/invoices')
})

test('the user menu starts the tour again', async ({ page, context, baseURL }) => {
    await logIn(context, baseURL!, ADMIN)
    await tourSeen(page, ADMIN)
    await page.goto('/support')
    await expect(page.locator('.tour-tip')).toHaveCount(0)
    await page.getByRole('button', { name: shell.userMenu }).click()
    await page.getByRole('menuitem', { name: shell.tour }).click()
    await expect(page.locator('.tour-tip h3')).toHaveText(title('welcome', ADMIN.name))
    await expect(page).toHaveURL(url => url.pathname === '/dashboard')
})

test('a superadmin gets no tour and no "Tour" in the menu', async ({ page, context, baseURL }) => {
    await logIn(context, baseURL!, SUPERADMIN)
    // On the platform the portal sends a superadmin to the panel
    await page.goto('/dashboard')
    await expect(page).toHaveURL(url => url.pathname.startsWith('/admin'))
    await opened(page)
    await expect(page.locator('.tour-tip')).toHaveCount(0)
    await page.getByRole('button', { name: shell.userMenu }).click()
    await expect(page.getByRole('menuitem').first()).toBeVisible()
    await expect(page.getByRole('menuitem', { name: shell.tour })).toHaveCount(0)
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('tour')))).toEqual([])
})
