import { defineConfig, devices } from '@playwright/test'

/**
 * The browser tests of this frontend (e2e/, `npm run test:e2e`, also in the CI). They start the built frontend on its
 * own port; a page that calls the API (the status card) shows what it shows when the API is not there.
 */
const PORT = Number(process.env.E2E_PORT ?? 3199)

export default defineConfig({
    testDir: 'e2e',
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
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
        reuseExistingServer: false,
        timeout: 180_000
    }
})
