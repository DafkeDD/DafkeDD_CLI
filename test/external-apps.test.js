import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFiles } from '../src/backends/nestjs.js'
import * as oidc from '../src/backends/oidc.js'
import { endpoints } from '../src/backends/docs.js'
import { frontendReadme } from '../src/frontends/docs.js'
import { AUDIT_MESSAGES, OIDC_MESSAGES, oidcFrontendFiles } from '../src/frontends/oidc.js'

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
const LANGUAGES = ['en', 'nl', 'fr', 'de']

test('the backend: consent, back-channel logout, migration 8 and their tests', () => {
    for (const rel of [
        'src/oidc/backchannel.service.ts',
        'src/oidc/consents.controller.ts',
        'test/external-apps.e2e-spec.ts'
    ])
        assert.ok(backend[rel], rel)
    const migrations = backend['src/database/migrations.ts']
    assert.match(migrations, /id: 8,\s+name: 'external applications: consent and back-channel logout'/)
    for (const table of ['oidc_consents', 'oidc_used_interactions', 'oidc_session_clients', 'oidc_logout_queue'])
        assert.match(migrations, new RegExp(`CREATE TABLE ${table} \\(`), table)
    // Whatever ends a session: a trigger, not every caller
    assert.match(migrations, /CREATE TRIGGER oidc_session_ended AFTER UPDATE OF expires_at ON oidc_sessions/)
    const service = backend['src/oidc/backchannel.service.ts']
    for (const part of [
        "typ: 'logout+jwt'",
        'http://schemas.openid.net/event/backchannel-logout',
        'sid: job.sessionId',
        "redirect: 'error'",
        'AbortSignal.timeout'
    ])
        assert.ok(service.includes(part), part)
    assert.ok(!/nonce/.test(service.replace(/no nonce/g, '')), 'never a nonce')
    const oidcService = backend['src/oidc/oidc.service.ts']
    assert.match(oidcService, /backchannel_logout_supported: true/)
    assert.match(oidcService, /'consent_required'/)
    assert.match(oidcService, /'access_denied'/)
    assert.match(oidcService, /if \(client\.firstParty\) return false/)
    assert.match(backend['src/oidc/store/pg-oidc.store.ts'], /FOR UPDATE SKIP LOCKED/)
    // Applications of others never call our own API as the user
    assert.match(backend['src/access/access.ts'], /if \(!\(await this\.firstParty\(claims\.client_id\)\)\)/)
    const clients = JSON.parse(backend['config/oidc-clients.json'])
    assert.equal(clients.clients[0].backchannelLogoutUri, 'http://localhost:3000/api/auth/backchannel-logout')
})

test('.env, the endpoints and the README', () => {
    assert.match(oidc.envLines(ANSWERS, { port: 4000 }), /^OIDC_BACKCHANNEL_INTERVAL=5$/m)
    const documented = endpoints({ database: DB, oidc: true }).map(e => `${e.method} ${e.path}`)
    for (const route of ['POST /oidc/interaction/:id/consent', 'GET /me/consents', 'DELETE /me/consents/:clientId'])
        assert.ok(documented.includes(route), route)
    const readme = backend['README.md']
    for (const text of [
        '### Applications of others: consent screen and back-channel logout',
        '"firstParty": false',
        'backchannelLogoutUri',
        'logout+jwt',
        '`oidc_logout_queue`',
        'OIDC_BACKCHANNEL_INTERVAL'
    ])
        assert.ok(readme.includes(text), text)
    for (const language of LANGUAGES) {
        const messages = JSON.parse(backend[`src/i18n/${language}/oidc.json`])
        for (const key of [
            'CONSENT_TITLE',
            'CONSENT_TEXT',
            'CONSENT_NOTE',
            'CONSENT_ALLOW',
            'CONSENT_DENY',
            'CONSENT_NOT_FOUND',
            'SCOPE_OPENID',
            'SCOPE_PROFILE',
            'SCOPE_EMAIL',
            'SCOPE_TENANT'
        ])
            assert.ok(messages[key], `${language} ${key}`)
    }
})

test('the frontend: the consent step, "Applications with access" and the back-channel logout route', () => {
    const login = frontend['src/components/oidc-login.tsx']
    assert.match(login, /submit\('\/consent', \{ csrf: state\.csrf, decision: 'allow' \}\)/)
    assert.match(login, /submit\('\/consent', \{ csrf: state\.csrf, decision: 'deny' \}\)/)
    assert.match(frontend['src/components/consents.tsx'], /'DELETE'/)
    assert.match(frontend['src/app/[locale]/(portal)/security/page.tsx'], /<ConsentsSecurity \/>/)
    const route = frontend['src/app/api/auth/backchannel-logout/route.ts']
    assert.match(route, /verifyLogoutToken/)
    assert.match(route, /export async function POST/)
    const lib = frontend['src/lib/oidc.ts']
    for (const part of ["head.typ !== 'logout+jwt'", 'A logout token has no nonce', 'Logout token used before'])
        assert.ok(lib.includes(part), part)
    assert.match(frontend['src/lib/session.ts'], /sessionEnded\(session\.sid\)/)
    assert.match(frontend['src/lib/refresh.ts'], /sessionEnded\(session\.sid\)/)

    // Client ids may contain dots, never a ".." segment
    const proxy = frontend['src/app/api/backend/[...path]/route.ts']
    const consents = new RegExp(/const CONSENTS = \/(.+)\/$/m.exec(proxy)[1])
    for (const path of ['me/consents', 'me/consents/partner.app', 'me/consents/frontend'])
        assert.ok(consents.test(path), path)
    for (const path of ['me/consents/..', 'me/consents/../../admin', 'me/consents/a..b', 'me/consents/.x'])
        assert.ok(!consents.test(path), path)

    const used = new Set(
        ['oidc-login.tsx', 'consents.tsx']
            .flatMap(file => [...frontend[`src/components/${file}`].matchAll(/t\('((?:consent|scope)[A-Za-z]*)'/g)])
            .map(match => match[1])
    )
    assert.ok(used.size >= 14, [...used].join(' '))
    for (const language of LANGUAGES) {
        for (const key of used) assert.ok(OIDC_MESSAGES[language][key], `${language} ${key}`)
        const audit = AUDIT_MESSAGES[language]
        for (const action of ['account_consent_granted', 'account_consent_revoked', 'login_backchannel_failed'])
            assert.ok(audit.actions[action], `${language} ${action}`)
        assert.ok(audit.details.scopes, language)
    }
    const readme = frontendReadme({ ui: 'none', api: { port: 4000, oidc: true } })
    for (const text of ['/api/auth/backchannel-logout', '**Back-channel logout**', '/me/consents'])
        assert.ok(readme.includes(text), text)
})
