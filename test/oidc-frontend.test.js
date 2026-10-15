import test from 'node:test'
import assert from 'node:assert/strict'
import { files, uiFiles, withApi, LOCALES } from '../src/frontends/nextjs.js'
import { AUDIT_MESSAGES, envLocal, LICENSE_MESSAGES, OIDC_MESSAGES, oidcFrontendFiles } from '../src/frontends/oidc.js'
import { frontendReadme } from '../src/frontends/docs.js'
import { main } from '../src/index.js'
import * as backendOidc from '../src/backends/oidc.js'

const templates = oidcFrontendFiles({ apiPort: 4000 })
const API = { port: 4000, oidc: true }

test('the frontend login files are copied with the API port filled in', () => {
    for (const rel of [
        'src/lib/oidc.ts',
        'src/lib/session.ts',
        'src/app/api/auth/login/route.ts',
        'src/app/api/auth/callback/route.ts',
        'src/app/api/auth/logout/route.ts',
        'src/app/[locale]/login/page.tsx',
        'src/app/[locale]/profile/page.tsx',
        'src/components/oidc-login.tsx',
        'src/components/session-links.tsx',
        'src/app/[locale]/register/page.tsx',
        'src/app/[locale]/verify-email/page.tsx',
        'src/app/[locale]/forgot-password/page.tsx',
        'src/app/[locale]/reset-password/page.tsx',
        'src/app/[locale]/invite/page.tsx',
        'src/app/[locale]/members/page.tsx',
        'src/app/[locale]/admin/page.tsx',
        'src/app/[locale]/security/page.tsx',
        'src/app/api/backend/[...path]/route.ts',
        'src/components/account-forms.tsx',
        'src/components/account-ui.tsx',
        'src/components/members.tsx',
        'src/components/platform.tsx',
        'src/components/mfa-ui.tsx',
        'src/components/security.tsx',
        'src/lib/account.ts',
        'src/components/header-nav.tsx',
        'src/components/presence.tsx'
    ]) {
        assert.ok(templates[rel], rel)
    }
    for (const [rel, content] of Object.entries(templates)) assert.ok(!/__[A-Z_]+__/.test(content), rel)
    assert.match(templates['src/lib/oidc.ts'], /http:\/\/localhost:4000\/oidc/)
})

test('the frontend uses no OIDC or JWT library and never sends tokens to the browser', () => {
    for (const [rel, content] of Object.entries(templates)) {
        const imports = [...content.matchAll(/from '([^']+)'/g)].map(match => match[1])
        for (const library of ['jose', 'openid-client', 'next-auth', 'jsonwebtoken', '@auth/core']) {
            assert.ok(!imports.includes(library), `${rel} imports ${library}`)
        }
    }
    // client components never touch the session or the tokens
    for (const rel of ['src/components/oidc-login.tsx']) {
        assert.ok(!templates[rel].includes('accessToken'), rel)
        assert.ok(!templates[rel].includes('@/lib/oidc'), rel)
    }
})

test('the login checks state, iss, nonce, at_hash and the ID token signature, with PKCE S256', () => {
    const lib = templates['src/lib/oidc.ts']
    const callback = templates['src/app/api/auth/callback/route.ts']
    assert.match(lib, /code_challenge_method: 'S256'/)
    assert.match(lib, /\(claims\.nonce \?\? null\) !== nonce/)
    assert.match(lib, /claims\.at_hash !== atHash/)
    assert.match(lib, /claims\.aud !== OIDC_CLIENT_ID/)
    assert.match(lib, /head\.alg !== 'RS256'/)
    assert.match(callback, /params\.get\('state'\) !== flow\.state/)
    assert.match(callback, /params\.get\('iss'\) !== OIDC_ISSUER/)
})

test('cookies are httpOnly and encrypted (AES-256-GCM, purpose bound), returnTo stays on this site', () => {
    const lib = templates['src/lib/oidc.ts']
    assert.match(lib, /httpOnly: true/)
    assert.match(lib, /aes-256-gcm/)
    assert.match(lib, /setAAD\(Buffer\.from\(purpose\)\)/)
    assert.match(lib, /!value\.startsWith\('\/\/'\)/)
    assert.match(templates['src/app/api/auth/logout/route.ts'], /export async function POST/)
})

test('every text exists in all four languages, and every text the code uses exists', () => {
    const namespaces = { Oidc: OIDC_MESSAGES, Licenses: LICENSE_MESSAGES, Audit: AUDIT_MESSAGES }
    const used = { Oidc: new Set(), Licenses: new Set(), Audit: new Set() }
    for (const content of Object.values(templates)) {
        // const t = useTranslations('Oidc'), const l = await getTranslations('Licenses'), ...
        const names = new Map()
        for (const match of content.matchAll(/\b(\w+) = (?:await )?(?:use|get)Translations\('(\w+)'\)/g)) {
            names.set(match[1], match[2])
        }
        // helpers that are handed t, like roleLabel(t, role), use the Oidc texts
        if (!names.size) names.set('t', 'Oidc')
        for (const [name, namespace] of names) {
            assert.ok(used[namespace], `unknown namespace ${namespace}`)
            for (const match of content.matchAll(new RegExp(`\\b${name}\\('(\\w+)'`, 'g')))
                used[namespace].add(match[1])
        }
    }
    // Every key, also nested ones (Audit.actions.login_succeeded), in every language
    const flat = (messages, prefix = '') =>
        Object.entries(messages).flatMap(([key, value]) =>
            typeof value === 'object' ? flat(value, prefix + key + '.') : [prefix + key]
        )
    for (const [namespace, messages] of Object.entries(namespaces)) {
        const all = flat(messages.en).sort()
        for (const locale of LOCALES) assert.deepEqual(flat(messages[locale]).sort(), all, `${namespace} ${locale}`)
        // Groups of texts (Audit.actions, .details, ...) are used with a variable key: only plain texts are checked here
        const keys = Object.keys(messages.en).filter(key => typeof messages.en[key] === 'string')
        for (const key of used[namespace]) assert.ok(keys.includes(key), `missing text ${namespace}.${key}`)
        for (const key of keys) assert.ok(used[namespace].has(key), `unused text ${namespace}.${key}`)
    }
})

for (const ui of [true, false]) {
    test(`withApi with the OIDC server (${ui ? 'DafkeDD UI' : 'plain'}): login files, texts and session links`, () => {
        const all = withApi({ ...files, ...(ui ? uiFiles : {}) }, API, { ui })
        assert.ok(all['src/app/api/auth/callback/route.ts'])
        assert.ok(!all['src/components/auth-links.tsx'], 'not the simple login')
        for (const locale of LOCALES) {
            const messages = JSON.parse(all[`messages/${locale}.json`])
            assert.deepEqual(messages.Oidc, OIDC_MESSAGES[locale])
            assert.deepEqual(messages.Licenses, LICENSE_MESSAGES[locale])
            assert.deepEqual(messages.Audit, AUDIT_MESSAGES[locale])
        }
        const page = all['src/app/[locale]/page.tsx']
        assert.match(page, /import \{ Suspense, use \} from 'react'/)
        assert.match(page, /<Suspense fallback=\{null\}>\s*<SessionLinks \/>\s*<\/Suspense>/)
    })
}

test('withApi without the OIDC server adds none of it', () => {
    const all = withApi({ ...files }, { port: 4000 }, { ui: false })
    assert.ok(!all['src/lib/oidc.ts'])
    assert.ok(!JSON.parse(all['messages/en.json']).Oidc)
})

test('.env.local: issuer, client and a random 64-hex AUTH_SECRET', () => {
    const one = envLocal({ apiPort: 4000 })
    const two = envLocal({ apiPort: 4000 })
    assert.match(one, /^OIDC_ISSUER=http:\/\/localhost:4000\/oidc$/m)
    assert.match(one, /^OIDC_CLIENT_ID=frontend$/m)
    assert.match(one, /^AUTH_SECRET=[0-9a-f]{64}$/m)
    assert.notEqual(one, two)
})

test('the frontend client and its callback match what the backend registers', () => {
    const clients = JSON.parse(
        backendOidc.oidcFiles({ usersTable: 'shopusers', database: 'shop', port: 4000 })['config/oidc-clients.json']
    ).clients
    const frontend = clients.find(client => client.clientId === 'frontend')
    assert.deepEqual(frontend.redirectUris, ['http://localhost:3000/api/auth/callback'])
    assert.equal(frontend.type, 'public')
    assert.match(templates['src/lib/oidc.ts'], /'\/api\/auth\/callback'/)
    assert.ok(!clients.some(client => client.clientId === 'demo'), 'no demo client on another port')
})

test('the backend sends the browser to the login page of the frontend only when there is a frontend', () => {
    const answers = { adminEmail: 'a@b.co', adminPasswordHash: 'x', masterKey: 'ab'.repeat(32) }
    assert.match(
        backendOidc.envLines({ ...answers, loginUi: true }, { port: 4000 }),
        /^OIDC_LOGIN_UI_URL=http:\/\/localhost:3000\/login$/m
    )
    assert.ok(!backendOidc.envLines({ ...answers, loginUi: false }, { port: 4000 }).includes('OIDC_LOGIN_UI_URL'))
})

test('the frontend README documents the OIDC login only when it is installed', () => {
    const readme = frontendReadme({ ui: 'none', api: API })
    for (const text of [
        '## Login (OpenID Connect)',
        '/api/auth/login',
        '/api/auth/callback',
        '/profile',
        'AUTH_SECRET',
        'getSession()'
    ])
        assert.ok(readme.includes(text), text)
    assert.ok(!frontendReadme({ ui: 'none', api: { port: 4000 } }).includes('OpenID Connect'))
})

test('index: the frontend learns that the backend is an OIDC server', async () => {
    const events = []
    const item = (id, dir, answers) => ({
        id,
        label: id,
        dir,
        ask: async () => answers,
        steps: async ctx => {
            events.push(ctx.api)
            return []
        }
    })
    await main({
        projectDir: '/tmp/none',
        prompts: { select: async c => (c.message.includes('frontend') ? 'fe' : 'be') },
        ask: async () => null,
        registry: { fe: item('fe', 'frontend', { ui: 'none' }) },
        backendRegistry: {
            be: { ...item('be', 'backend', { auth: false, oidc: { adminEmail: 'a@b.co' } }), api: { port: 4000 } }
        },
        execute: async () => {},
        log: () => {}
    })
    assert.deepEqual(events[0], { port: 4000, auth: false, oidc: true })
})

test('the API proxy only forwards members, platform and two-step calls, with the token added on the server', () => {
    const route = templates['src/app/api/backend/[...path]/route.ts']
    assert.match(route, /Authorization: 'Bearer ' \+ session\.accessToken/)
    assert.match(route, /request\.headers\.get\('origin'\) !== new URL\(APP_URL\)\.origin/)
    const allowed = new RegExp(/const ALLOWED =\s+\/(.+)\/$/m.exec(route)[1])
    for (const path of ['tenants/current/members', 'admin/tenants', 'me/mfa', 'me/mfa/recovery-codes'])
        assert.ok(allowed.test(path), path)
    for (const path of ['oidc/token', 'health', 'tenants/other/members', '../admin', 'me/profile'])
        assert.ok(!allowed.test(path), path)
})

test('the QR code is shown as an image, never inserted as HTML', () => {
    for (const [rel, content] of Object.entries(templates)) assert.ok(!content.includes('dangerouslySetInnerHTML'), rel)
    assert.match(templates['src/components/mfa-ui.tsx'], /data:image\/svg\+xml/)
})

for (const ui of [true, false]) {
    test(`the layout gets the header navigation with the heartbeat, inside Suspense (${ui ? 'DafkeDD UI' : 'plain'})`, () => {
        const layout = withApi({ ...files, ...(ui ? uiFiles : {}) }, API, { ui })['src/app/[locale]/layout.tsx']
        assert.match(layout, /import \{ HeaderNav \} from '@\/components\/header-nav';/)
        assert.match(layout, /<Suspense fallback=\{null\}>\s*<HeaderNav \/>\s*<\/Suspense>/)
        assert.match(templates['src/components/header-nav.tsx'], /<Presence \/>/)
        assert.match(templates['src/components/presence.tsx'], /me\/heartbeat/)
    })
}

test('a superadmin on the platform (no organisation) goes to /admin instead of seeing an error', () => {
    for (const page of ['src/app/[locale]/members/page.tsx', 'src/app/[locale]/licenses/page.tsx'])
        assert.match(templates[page], /if \(!session\.tenant && session\.superadmin\) redirect\('\/admin'\)/, page)
})
