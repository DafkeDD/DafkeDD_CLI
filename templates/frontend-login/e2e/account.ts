import { type BrowserContext, request } from '@playwright/test'
import { accountPrefix } from './env'

/** The password of every test account (they only exist during a run). */
export const PASSWORD = 'correct horse battery staple'

let count = 0

/** A new email address for a test account of this run: e2e/global-teardown.ts removes every one of them. */
export const newEmail = () => `${accountPrefix()}${process.pid}-${++count}@example.com`

/** Makes a test account through /api of this frontend, as the registration page does; its session cookie comes back. */
export async function register(baseURL: string, email = newEmail()) {
    const api = await request.newContext({ baseURL })
    try {
        const answer = await api.post('/api/auth/register', {
            data: { name: 'Anna Peeters', email, password: PASSWORD },
            // A change through /api must come from a page of this app
            headers: { origin: baseURL }
        })
        if (answer.status() !== 201) throw new Error(`register: ${answer.status()} ${await answer.text()}`)
        return { email, cookies: (await api.storageState()).cookies }
    } finally {
        await api.dispose()
    }
}

/** Logs the browser of this test in with a new test account. */
export async function logIn(context: BrowserContext, baseURL: string) {
    const account = await register(baseURL)
    await context.addCookies(account.cookies)
    return account
}
