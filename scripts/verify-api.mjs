// The browser tests of the login server against its real API (frontend/e2e/api.spec.ts), as `npm run verify` runs them
// for the variant `pasport` when its database can be reached: the demo data with a password of this run, a superadmin
// with the same password, the built API on the port the frontend was built for, then the spec.

/** The superadmin of the spec (e2e/api.spec.ts: E2E_SUPERADMIN_EMAIL, by default this one). */
export const SUPERADMIN_EMAIL = 'support@demo.example.com'
/** The port of the frontend of the browser tests (playwright.config.ts: E2E_PORT, 3199 by default). */
export const E2E_PORT = 3199

/**
 * config/oidc-clients.json with the frontend of the browser tests added to the client `frontend`: its callback, its
 * logout and its back-channel logout on E2E_PORT, next to those of `npm run dev`.
 */
export function e2eClients(json, port = E2E_PORT) {
    const app = `http://localhost:${port}`
    const clients = JSON.parse(json).clients.map(client =>
        client.clientId === 'frontend'
            ? {
                  ...client,
                  redirectUris: [...client.redirectUris, `${app}/api/auth/callback`],
                  postLogoutRedirectUris: [...(client.postLogoutRedirectUris ?? []), app],
                  backchannelLogoutUri: `${app}/api/auth/backchannel-logout`
              }
            : client
    )
    return JSON.stringify({ clients }, null, 4) + '\n'
}

/**
 * The settings of the API for the spec: on its own port (the one the frontend was built for), the login screen of the
 * frontend of the tests (and its origin for CORS), no two-step verification (the demo accounts have none), the
 * clients file of e2eClients.
 */
export const apiEnv = ({ apiPort, clientsFile, port = E2E_PORT }) => ({
    PORT: String(apiPort),
    OIDC_ISSUER: `http://localhost:${apiPort}/oidc`,
    OIDC_LOGIN_UI_URL: `http://localhost:${port}/login`,
    APP_URL: `http://localhost:${port}`,
    // The login screen asks the API from the browser: the frontend of the tests is another origin than npm run dev
    CORS_ORIGIN: `http://localhost:${port}`,
    OIDC_MFA: 'optional',
    OIDC_CLIENTS_FILE: clientsFile
})

/** The settings of the spec: the API on this machine, the demo password, the frontend built already. */
export const specEnv = ({ apiPort, password }) => ({
    E2E_API: `http://localhost:${apiPort}`,
    E2E_DEMO_PASSWORD: password,
    E2E_NO_BUILD: '1'
})

/** The commands in ./backend before the API starts: the demo data with this password, the superadmin with it too. */
export const backendSteps = password => [
    ['npm', ['run', 'demo:clear']],
    ['npm', ['run', 'demo:data', '--', '--password', password]],
    [
        'npm',
        [
            'run',
            'oidc:user',
            '--',
            '--superadmin',
            '--email',
            SUPERADMIN_EMAIL,
            '--name',
            'Support',
            '--password',
            password
        ]
    ]
]

/** The command in ./frontend that runs only this spec (in Chromium, as `npm run test:e2e`). */
export const SPEC_COMMAND = ['npx', ['--no-install', 'playwright', 'test', 'e2e/api.spec.ts']]

/**
 * The spec really ran: the list reporter counts its three tests (an admin, a member, the superadmin) as passed, none
 * skipped (without E2E_API it would be skipped and still exit 0), none flaky or failed.
 */
export function specRan(output) {
    const passed = Number(/(\d+) passed/.exec(output)?.[1] ?? 0)
    return passed >= 3 && !/\d+ (skipped|flaky|failed)/.test(output)
}
