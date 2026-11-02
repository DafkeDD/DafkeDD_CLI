import { expect, test } from '@playwright/test'
import en from '../messages/en.json'
import { logIn, newEmail, PASSWORD, register } from './account'

/** Register, log in and log out through the pages, against the real API: every page needs the login. */
const t = en.Auth

test('register, see the profile, log out, and log in again: back on the page asked for', async ({ page }) => {
    const email = newEmail()
    await page.goto('/register')
    await page.getByLabel(t.name).fill('Anna Peeters')
    await page.getByLabel(t.email).fill(email)
    await page.getByLabel(t.password, { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: t.register, exact: true }).click()
    await expect(page).toHaveURL(url => url.pathname === '/profile')
    await expect(page.locator('.card').getByText(email)).toBeVisible()

    await page.getByRole('button', { name: t.logout, exact: true }).click()
    await expect(page).toHaveURL(url => url.pathname === '/login')
    // Logged out: the profile needs the login again, and comes back after it
    await page.goto('/profile')
    await expect(page).toHaveURL(url => url.pathname === '/login' && url.searchParams.get('returnTo') === '/profile')
    await page.getByLabel(t.email).fill(email)
    await page.getByLabel(t.password, { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: t.login, exact: true }).click()
    await expect(page).toHaveURL(url => url.pathname === '/profile')
    await expect(page.locator('.card').getByText(email)).toBeVisible()
})

test('a wrong password is refused, and the page says so', async ({ page, baseURL }) => {
    const { email } = await register(baseURL!)
    await page.goto('/login')
    await page.getByLabel(t.email).fill(email)
    await page.getByLabel(t.password, { exact: true }).fill('not the password')
    await page.getByRole('button', { name: t.login, exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('alert')).not.toHaveText(t.offline)
    await expect(page).toHaveURL(url => url.pathname === '/login')
})

test('the login only sends you back to a page of this app, never to another site', async ({ page, baseURL }) => {
    const { email } = await register(baseURL!)
    await page.goto('/login?returnTo=' + encodeURIComponent('//evil.example.com'))
    await page.getByLabel(t.email).fill(email)
    await page.getByLabel(t.password, { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: t.login, exact: true }).click()
    await expect(page).toHaveURL(url => url.origin === new URL(baseURL!).origin && url.pathname === '/profile')
})

test('without a session every page goes to the login, with the page to come back to', async ({ request }) => {
    for (const [path, login] of [
        ['/', '/login'],
        ['/profile', '/login?returnTo=%2Fprofile']
    ]) {
        const answer = await request.get(path, { maxRedirects: 0 })
        expect(answer.status(), path).toBe(307)
        const to = new URL(answer.headers().location, 'http://x')
        expect(to.pathname + to.search, path).toBe(login)
    }
    for (const path of ['/login', '/register']) expect((await request.get(path)).status(), path).toBe(200)
})

test('logged in, the login and the registration send you on', async ({ page, context, baseURL }) => {
    await logIn(context, baseURL!)
    await page.goto('/login?returnTo=%2Fprofile')
    await expect(page).toHaveURL(url => url.pathname === '/profile')
    await page.goto('/register')
    await expect(page).toHaveURL(url => url.pathname === '/')
})
