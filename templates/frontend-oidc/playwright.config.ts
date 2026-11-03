import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

/**
 * The browser tests of the login server's frontend (e2e/, `npm run test:e2e`, also in the CI). They start the built
 * frontend on its own port, without the API: a test logs in with a session cookie that e2e/session.ts seals with the
 * AUTH_SECRET below, a secret only for the tests (never the one of .env.local). The pages then show what they show when
 * the API cannot be reached; the login screen gets the answers of the API from the test itself (e2e/login.spec.ts).
 * Only e2e/api.spec.ts logs in at the real API, with the demo data: with E2E_API and E2E_DEMO_PASSWORD, else skipped.
 */

/** The settings of .env.local (where the API is), when the file is there; the CI has none. */
function envLocal(): Record<string, string> {
    if (!existsSync('.env.local')) return {}
    return Object.fromEntries(
        readFileSync('.env.local', 'utf8')
            .split('\n')
            .filter(line => /^[A-Z0-9_]+=/.test(line))
            .map(line => [
                line.slice(0, line.indexOf('=')),
                line.slice(line.indexOf('=') + 1).replace(/^['"]|['"]$/g, '')
            ])
    )
}

/**
 * The API of e2e/api.spec.ts: only one on this machine (localhost, 127.0.0.1 or [::1]), never production. The test
 * server seals its sessions with a secret anyone can read, so it never gets the tokens of a real login server.
 */
function localApi(url: string): string {
    const { protocol, hostname } = new URL(url)
    if (!['http:', 'https:'].includes(protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(hostname))
        throw new Error(`E2E_API must be an API on this machine (localhost), not ${hostname}`)
    return url.replace(/\/+$/, '')
}

const PORT = Number(process.env.E2E_PORT ?? 3199)
for (const [key, value] of Object.entries(envLocal())) process.env[key] ??= value
// The server below and the sessions of the tests share these (the config is read by every test worker too)
process.env.AUTH_SECRET = process.env.E2E_AUTH_SECRET ?? createHash('sha256').update('dafkedd-e2e').digest('hex')
process.env.APP_URL = `http://localhost:${PORT}`
// The server below is a test server: it may use the public test secret above (src/lib/oidc.ts)
process.env.E2E_TEST = '1'
// e2e/api.spec.ts: with E2E_API the frontend logs in at that API for real (its OpenID Connect server), and the login
// screen and the pages talk to it too. NEXT_PUBLIC_* are built in: with E2E_NO_BUILD the build must have had them.
if (process.env.E2E_API) {
    const api = localApi(process.env.E2E_API)
    process.env.OIDC_ISSUER = `${api}/oidc`
    process.env.API_URL = api
    process.env.NEXT_PUBLIC_API_URL = api
    process.env.NEXT_PUBLIC_PASPORT_API_URL = api
}

export default defineConfig({
    testDir: 'e2e',
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    // The tour waits up to 4 seconds per step for what it points at (the API is not there): more time per test
    timeout: 120_000,
    expect: { timeout: 10_000 },
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: `http://localhost:${PORT}`,
        locale: 'en',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        // E2E_NO_BUILD: the frontend is built already (npm run build)
        command: process.env.E2E_NO_BUILD ? `npx next start -p ${PORT}` : `npm run build && npx next start -p ${PORT}`,
        port: PORT,
        env: { ...(process.env as Record<string, string>) },
        reuseExistingServer: false,
        timeout: 180_000
    }
})
