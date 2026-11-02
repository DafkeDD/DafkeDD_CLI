import { randomBytes } from 'node:crypto'
import { defineConfig, devices } from '@playwright/test'

/**
 * The browser tests of this frontend (e2e/, `npm run test:e2e`, also in the CI). They start the built API (../backend,
 * with the database of backend/.env, in the CI the DATABASE_* settings) and the built frontend, each on its own port,
 * and log in for real: every test account is made by a test and removed after the run (e2e/global-teardown.ts).
 */
const PORT = Number(process.env.E2E_PORT ?? 3199)
const API_PORT = Number(process.env.E2E_API_PORT ?? 4199)
// Made once by the main process; the test workers inherit them. Secrets only for this run, never the ones of .env.
// The run id goes into a LIKE pattern of the teardown: only 12 hex characters, else a new one
if (!/^[0-9a-f]{12}$/.test(process.env.E2E_RUN ?? '')) process.env.E2E_RUN = randomBytes(6).toString('hex')
process.env.E2E_JWT_SECRET ??= randomBytes(32).toString('hex')
process.env.E2E_PROXY_SECRET ??= randomBytes(32).toString('hex')
// E2E_NO_BUILD: the API and the frontend are built already (npm run build in both)
const build = (start: string) => (process.env.E2E_NO_BUILD ? start : `npm run build && ${start}`)
const env = process.env as Record<string, string>

export default defineConfig({
    testDir: 'e2e',
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    globalTeardown: './e2e/global-teardown.ts',
    use: {
        baseURL: `http://localhost:${PORT}`,
        locale: 'en',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: [
        {
            command: build('node dist/main'),
            cwd: '../backend',
            port: API_PORT,
            env: {
                ...env,
                PORT: String(API_PORT),
                JWT_SECRET: env.E2E_JWT_SECRET,
                API_PROXY_SECRET: env.E2E_PROXY_SECRET,
                // Every test logs in from the same address: the rate limit of the login is not what is tested here
                AUTH_RATE_LIMIT: '1000',
                AUTH_ACCOUNT_RATE_LIMIT: '1000'
            },
            reuseExistingServer: false,
            timeout: 180_000
        },
        {
            command: build(`npx next start -p ${PORT}`),
            port: PORT,
            env: { ...env, API_URL: `http://127.0.0.1:${API_PORT}`, API_PROXY_SECRET: env.E2E_PROXY_SECRET },
            reuseExistingServer: false,
            timeout: 180_000
        }
    ]
})
