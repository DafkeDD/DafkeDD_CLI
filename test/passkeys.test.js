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

test('the backend: our own WebAuthn code, migration 7, the routes and their tests', () => {
    for (const rel of [
        'src/oidc/passkeys/cbor.ts',
        'src/oidc/passkeys/cbor.spec.ts',
        'src/oidc/passkeys/webauthn.ts',
        'src/oidc/passkeys/webauthn.spec.ts',
        'src/oidc/passkeys/passkey.service.ts',
        'src/oidc/passkeys/passkeys.controller.ts',
        'src/oidc/passkeys/passkeys.dto.ts',
        'test/passkeys.e2e-spec.ts',
        'test/virtual-authenticator.ts'
    ])
        assert.ok(backend[rel], rel)
    const migrations = backend['src/database/migrations.ts']
    assert.match(migrations, /id: 7,\s+name: 'passkeys'/)
    assert.match(migrations, /CREATE TABLE user_passkeys/)
    assert.match(migrations, /credential_id\s+text NOT NULL UNIQUE/)
    const webauthn = backend['src/oidc/passkeys/webauthn.ts']
    // Challenge, origin, domain, user verification, user handle and the counter against clones
    for (const part of [
        'Wrong challenge',
        'Wrong origin',
        'Wrong relying party',
        'User not verified',
        'Wrong user handle',
        'Signature counter did not increase',
        'Cross-origin is not allowed'
    ])
        assert.ok(webauthn.includes(part), part)
    assert.match(webauthn, /COSE_ALGORITHMS = \[-7, -257, -8\]/)
    assert.ok(!/from '@simplewebauthn|from 'cbor/.test(webauthn), 'no library')
    assert.ok(backend['src/oidc/oidc.module.ts'].includes('PasskeysController'))
    assert.match(backend['src/oidc/oidc.service.ts'], /amr: \['pop', 'user', 'mfa'\]/)
    assert.match(backend['src/audit/audit.actions.ts'], /'account\.passkey_added',\s+'account\.passkey_removed'/)
})

test('.env and the documentation: OIDC_PASSKEYS, the domain and the origins', () => {
    const env = oidc.envLines(ANSWERS, { port: 4000 })
    assert.match(env, /^OIDC_PASSKEYS=on$/m)
    assert.match(env, /^OIDC_PASSKEY_RP_ID=$/m)
    assert.match(env, /^OIDC_PASSKEY_ORIGINS=$/m)
    const documented = endpoints({ database: DB, oidc: true }).map(e => `${e.method} ${e.path}`)
    for (const route of [
        'POST /oidc/interaction/:id/passkey/challenge',
        'POST /oidc/interaction/:id/passkey',
        'GET /me/passkeys',
        'POST /me/passkeys/options',
        'POST /me/passkeys',
        'PATCH /me/passkeys/:id',
        'DELETE /me/passkeys/:id'
    ])
        assert.ok(documented.includes(route), route)
    const readme = backend['README.md']
    for (const text of [
        '### Passkeys',
        'OIDC_PASSKEY_RP_ID',
        'OIDC_PASSKEY_ORIGINS',
        '`user_passkeys`',
        'signature counter'
    ])
        assert.ok(readme.includes(text), text)
})

test('the error messages of the passkeys exist in every language', () => {
    for (const key of [
        'PASSKEYS_DISABLED',
        'PASSKEY_EXPIRED',
        'PASSKEY_INVALID',
        'PASSKEY_EXISTS',
        'PASSKEY_NOT_FOUND',
        'PASSKEY_LAST_LOGIN',
        'PASSKEY_UNKNOWN'
    ])
        for (const language of LANGUAGES) {
            const messages = JSON.parse(backend[`src/i18n/${language}/oidc.json`])
            assert.ok(messages[key], `${language} ${key}`)
        }
})

test('the frontend: "Log in with a passkey", the card on /security and the texts in four languages', () => {
    const login = frontend['src/components/oidc-login.tsx']
    assert.match(login, /call\('\/passkey\/challenge', \{ csrf: state\.csrf \}\)/)
    assert.match(login, /call\('\/passkey', \{ csrf: state\.csrf, credential \}\)/)
    assert.match(frontend['src/lib/webauthn.ts'], /navigator\.credentials\.get\(/)
    assert.match(frontend['src/lib/webauthn.ts'], /navigator\.credentials\.create\(/)
    assert.match(frontend['src/components/passkeys.tsx'], /backend\('me\/passkeys\/options', 'POST'\)/)
    assert.match(frontend['src/app/[locale]/(portal)/security/page.tsx'], /<PasskeysSecurity \/>/)
    const route = frontend['src/app/api/backend/[...path]/route.ts']
    const allowed = new RegExp(/const ALLOWED =\s+\/(.+)\/$/m.exec(route)[1])
    for (const path of ['me/passkeys', 'me/passkeys/options', 'me/passkeys/6a1d1f8e-3c55-4f7b-a1a8-0e2b1b9c2d11'])
        assert.ok(allowed.test(path), path)

    const used = new Set(
        ['oidc-login.tsx', 'passkeys.tsx', 'security.tsx']
            .flatMap(file => [
                ...frontend[`src/components/${file}`].matchAll(/t\('(passkey[A-Za-z]*|method_passkey)'/g)
            ])
            .map(match => match[1])
    )
    assert.ok(used.size >= 15, [...used].join(' '))
    for (const language of LANGUAGES) {
        for (const key of used) assert.ok(OIDC_MESSAGES[language][key], `${language} ${key}`)
        const audit = AUDIT_MESSAGES[language]
        assert.ok(audit.actions.account_passkey_added && audit.actions.account_passkey_removed, language)
        assert.ok(audit.methods.passkey && audit.reasons.passkey_invalid && audit.details.synced, language)
    }
    const readme = frontendReadme({ ui: 'none', api: { port: 4000, oidc: true } })
    assert.ok(readme.includes('**Passkeys**'))
    assert.ok(readme.includes('/me/passkeys'))
})
