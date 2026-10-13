import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFiles, LOCALES } from '../src/backends/nestjs.js'
import * as oidc from '../src/backends/oidc.js'
import { endpoints } from '../src/backends/docs.js'
import { files, withApi } from '../src/frontends/nextjs.js'
import { OIDC_MESSAGES, oidcFrontendFiles } from '../src/frontends/oidc.js'
import { frontendReadme } from '../src/frontends/docs.js'

const DB = {
    id: 'postgres',
    mode: 'docker',
    host: 'localhost',
    port: 5432,
    user: 'app',
    password: 'x',
    database: 'shop',
    project: 'shop'
}
const ANSWERS = {
    adminEmail: 'admin@example.com',
    adminPassword: 'x',
    adminPasswordHash: 'scrypt$1$a$b',
    masterKey: 'ab'.repeat(32)
}
const backend = buildFiles(DB, { oidc: ANSWERS })
const frontend = oidcFrontendFiles({ apiPort: 4000 })

// ---------------------------------------------------------------- backend

test('refresh tokens: a table with Row-Level Security, bound to the session, rotated, reuse ends everything', () => {
    const migrations = backend['src/database/migrations.ts']
    assert.match(migrations, /id: 3,\s+name: 'sessions you can see, refresh tokens'/)
    assert.match(migrations, /CREATE TABLE oidc_refresh_tokens \(/)
    assert.match(migrations, /session_id uuid NOT NULL REFERENCES oidc_sessions \(id\) ON DELETE CASCADE/)
    assert.match(migrations, /isolate\('oidc_refresh_tokens', 'tenant_id'\)/)
    assert.match(backend['src/database/database.constants.ts'], /'oidc_refresh_tokens'/)
    const tokens = backend['src/oidc/tokens.service.ts']
    assert.match(tokens, /rotateRefreshToken\(/)
    // Two requests with the same token get the same successor: never a second chain
    assert.match(tokens, /deriveKey\(this\.config\.masterKey\(\), 'oidc refresh successor v1'\)/)
    assert.match(tokens, /usedCodeRefreshFamily/)
    assert.match(tokens, /result\.status === 'reused'/)
    assert.match(tokens, /await this\.store\.endSession\(session\.idHash\)/)
    // The account, organisation and role are checked again at every refresh
    assert.match(
        tokens,
        /const \{ user, membership \} = await this\.account\(stored\.userId, stored\.tenantId, invalid\)/
    )
    assert.match(backend['src/oidc/oidc.config.ts'], /REFRESH_REUSE_GRACE_SECONDS: 30/)
})

test('every token carries its session, and the API checks that session on every request', () => {
    const tokens = backend['src/oidc/tokens.service.ts']
    assert.equal((tokens.match(/sid: grant\.session\.id/g) ?? []).length, 2)
    assert.match(backend['src/oidc/oidc.service.ts'], /The session of this token ended/)
    assert.match(backend['src/access/access.ts'], /this\.store\.touchSession\(sessionId\)/)
})

test('logout, revocation and introspection are announced in discovery and documented', () => {
    const service = backend['src/oidc/oidc.service.ts']
    for (const name of ['end_session_endpoint', 'revocation_endpoint', 'introspection_endpoint'])
        assert.match(service, new RegExp(name))
    assert.match(service, /grant_types_supported: \['authorization_code', 'refresh_token'\]/)
    const documented = endpoints({ database: DB, oidc: true }).map(e => `${e.method} ${e.path}`)
    for (const route of [
        'POST /oidc/revoke',
        'POST /oidc/introspect',
        'GET /oidc/logout',
        'POST /oidc/logout',
        'GET /me/sessions',
        'DELETE /me/sessions',
        'DELETE /me/sessions/:id'
    ])
        assert.ok(documented.includes(route), route)
    const readme = backend['README.md']
    assert.match(readme, /### Sessions, refresh tokens and logout/)
    assert.match(readme, /\*\*Refresh \(grant_type=refresh_token\)\*\*/)
    assert.match(readme, /\| `oidc_refresh_tokens` \|/)
    assert.doesNotMatch(readme, /Refresh tokens, logout, token revocation and introspection, passkeys/)
})

test('the logout page asks first without an id_token_hint, with a CSRF token bound to the session cookie', () => {
    const sessions = backend['src/oidc/sessions.service.ts']
    assert.match(sessions, /deriveKey\(this\.config\.masterKey\(\), 'oidc logout v1'\)/)
    assert.match(sessions, /ignoreExpiry: true/)
    assert.match(sessions, /hinted\.sid === session\.id/)
    assert.match(sessions, /client\?\.postLogoutRedirectUris\.includes\(redirect\)/)
    for (const locale of LOCALES)
        for (const key of [
            'LOGOUT_TITLE',
            'LOGOUT_TEXT',
            'LOGOUT_TEXT_CLIENT',
            'LOGOUT_SUBMIT',
            'LOGGED_OUT',
            'SESSION_NOT_FOUND'
        ])
            assert.ok(oidc.MESSAGES[locale][key]?.trim(), `${locale} ${key}`)
})

test('the frontend client gets refresh tokens and may come back after logout', () => {
    const clients = JSON.parse(backend['config/oidc-clients.json']).clients
    const frontendClient = clients.find(client => client.clientId === 'frontend')
    assert.deepEqual(frontendClient.grantTypes, ['authorization_code', 'refresh_token'])
    assert.deepEqual(frontendClient.postLogoutRedirectUris, ['http://localhost:3000'])
})

test('the backend tests cover refresh, reuse, logout, revocation, introspection and /me/sessions', () => {
    const spec = backend['test/sessions.e2e-spec.ts']
    for (const text of [
        'refresh tokens',
        'revocation and introspection',
        'logout (end_session_endpoint)',
        '/me/sessions'
    ])
        assert.ok(spec.includes(text), text)
    assert.match(
        backend['test/tenant-isolation.db-spec.ts'],
        /rotates refresh tokens once \(also two at the same moment\)/
    )
})

// ---------------------------------------------------------------- frontend

test('the proxy renews the access token before a page renders, and passes the new cookie on', () => {
    const proxy = frontend['src/proxy.ts']
    assert.match(proxy, /freshSession\(request\.cookies\.get\(SESSION_COOKIE\)\?\.value\)/)
    assert.match(proxy, /request\.cookies\.set\(SESSION_COOKIE, cookie\)/)
    assert.match(proxy, /response\.cookies\.set\(SESSION_COOKIE, cookie, cookieOptions\(SESSION_SECONDS\)\)/)
    // It replaces the plain next-intl proxy of the frontend
    const all = withApi(files, { port: 4000, oidc: true }, { ui: false })
    assert.equal(all['src/proxy.ts'], proxy)
    const refresh = frontend['src/lib/refresh.ts']
    assert.match(refresh, /const running = \(shared\.__oidcRefreshes \?\?= new Map/)
    assert.match(refresh, /await revokeRefreshToken\(tokens\.refresh_token\)/)
    assert.match(frontend['src/lib/oidc.ts'], /export const SESSION_SECONDS = 12 \* 60 \* 60/)
    assert.match(frontend['src/app/api/auth/callback/route.ts'], /cookieOptions\(SESSION_SECONDS\)/)
})

test('logging out revokes the refresh token and ends the session of the login server', () => {
    const logout = frontend['src/app/api/auth/logout/route.ts']
    assert.match(logout, /await revokeRefreshToken\(session\.refreshToken\)/)
    assert.match(logout, /await endSessionUrl\(session\.idToken\)/)
    assert.match(logout, /response\.cookies\.delete\(SESSION_COOKIE\)/)
    assert.match(logout, /request\.headers\.get\('origin'\) !== new URL\(APP_URL\)\.origin/)
    const route = frontend['src/app/api/backend/[...path]/route.ts']
    const allowed = new RegExp(/const ALLOWED = \/(.+)\/$/m.exec(route)[1])
    for (const path of ['me/sessions', 'me/sessions/0f8f8a52-55a3-4b8e-9d55-3f1f2f8b1c10'])
        assert.ok(allowed.test(path), path)
    assert.match(route, /response\.status === 401/)
})

test('/security lists the sessions; every text exists in all four languages', () => {
    assert.match(frontend['src/components/security.tsx'], /export function SessionsSecurity\(\)/)
    assert.match(frontend['src/app/[locale]/security/page.tsx'], /<SessionsSecurity \/>/)
    for (const locale of ['en', 'nl', 'fr', 'de'])
        for (const key of [
            'sessionsTitle',
            'thisDevice',
            'sessionEnd',
            'sessionsEndOthers',
            'sessionsEnded',
            'method_eid'
        ])
            assert.ok(OIDC_MESSAGES[locale][key]?.trim(), `${locale} ${key}`)
    const readme = frontendReadme({ ui: 'none', api: { port: 4000, oidc: true }, apiPort: 4000 })
    assert.match(readme, /`src\/proxy\.ts` renews the\s+access token/)
})
