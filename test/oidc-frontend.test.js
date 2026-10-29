import test from 'node:test'
import {
    AUTH_SCREEN_MESSAGES,
    INVITE_MESSAGES,
    EID_GATE_MESSAGES,
    PASSWORD_MESSAGES,
    PROFILE_MESSAGES,
    REGISTER_MESSAGES
} from '../src/frontends/pasport-messages.js'
import { PORTAL_MESSAGES } from '../src/frontends/portal-messages.js'
import assert from 'node:assert/strict'
import {
    files,
    ignoreUiInEslint,
    nextjs,
    sitePages,
    uiFiles,
    uiFor,
    withApi,
    LOCALES
} from '../src/frontends/nextjs.js'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
    APP_LICENSE_MESSAGES,
    AUDIT_MESSAGES,
    NOTES_MESSAGES,
    envLocal,
    LICENSE_MESSAGES,
    NAV_MESSAGES,
    OIDC_MESSAGES,
    oidcFrontendFiles,
    SHELL_MESSAGES
} from '../src/frontends/oidc.js'
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
        'src/components/oidc-login.tsx',
        'src/app/[locale]/register/page.tsx',
        'src/app/[locale]/verify-email/page.tsx',
        'src/app/[locale]/forgot-password/page.tsx',
        'src/app/[locale]/invite/page.tsx',
        'src/app/[locale]/reset-password/page.tsx',
        'src/app/[locale]/(portal)/layout.tsx',
        'src/app/[locale]/(portal)/apps/page.tsx',
        'src/app/[locale]/(portal)/dashboard/page.tsx',
        'src/app/[locale]/(portal)/users/page.tsx',
        'src/app/[locale]/(portal)/profile/page.tsx',
        'src/app/[locale]/(portal)/security/page.tsx',
        'src/app/[locale]/(portal)/support/page.tsx',
        'src/app/[locale]/(portal)/vault/page.tsx',
        'src/app/[locale]/admin/page.tsx',
        'src/app/[locale]/admin/(panel)/layout.tsx',
        'src/app/[locale]/admin/(panel)/tenants/page.tsx',
        'src/app/[locale]/admin/(panel)/tickets/page.tsx',
        'src/app/api/backend/[...path]/route.ts',
        'src/components/account-forms.tsx',
        'src/components/account-ui.tsx',
        'src/components/mfa-ui.tsx',
        'src/components/security.tsx',
        'src/lib/account.ts',
        'src/components/presence.tsx',
        'src/components/pasport/shell.tsx',
        'src/components/shell/start-login.tsx',
        'src/lib/brand.ts',
        'src/app/[locale]/layout.tsx',
        'src/app/[locale]/page.tsx'
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
    const namespaces = {
        Oidc: OIDC_MESSAGES,
        Licenses: LICENSE_MESSAGES,
        Audit: AUDIT_MESSAGES,
        Shell: SHELL_MESSAGES,
        Nav: NAV_MESSAGES,
        AuthScreen: AUTH_SCREEN_MESSAGES,
        Register: REGISTER_MESSAGES,
        Invite: INVITE_MESSAGES,
        Password: PASSWORD_MESSAGES,
        EidGate: EID_GATE_MESSAGES,
        Profile: PROFILE_MESSAGES,
        AppLicense: APP_LICENSE_MESSAGES,
        Notes: NOTES_MESSAGES,
        // The portal of the login server (useT('Shell') → Portal.Shell, src/components/pasport/i18n.ts)
        ...Object.fromEntries(
            Object.keys(PORTAL_MESSAGES.en).map(part => [
                `Portal.${part}`,
                Object.fromEntries(LOCALES.map(locale => [locale, PORTAL_MESSAGES[locale][part]]))
            ])
        )
    }
    // HomePage: the texts of the Next.js home page (nextjs.js); Nav: used with the label of APP_NAV as key
    const dynamic = new Set(['Nav'])
    const used = Object.fromEntries([...Object.keys(namespaces), 'HomePage'].map(name => [name, new Set()]))
    // The login server and a linked app: together they use every text
    for (const content of [...Object.values(templates), ...Object.values(oidcFrontendFiles({ linked: true }))]) {
        // const t = useTranslations('Oidc'), const l = await getTranslations('Licenses'), const t = useT('Shell'), ...
        // A name can stand for several namespaces in one file (t = useT('Catalog') in one component, t = useT('Codes')
        // in the next): a text it uses must exist in one of them, and counts as used in each
        const names = new Map()
        const bind = (name, namespace) => names.set(name, new Set([...(names.get(name) ?? []), namespace]))
        for (const match of content.matchAll(/\b(\w+) = (?:await )?(?:use|get)Translations\('([\w.]+)'\)/g))
            bind(match[1], match[2])
        for (const match of content.matchAll(/\b(\w+) = useT\('(\w+)'\)/g)) bind(match[1], `Portal.${match[2]}`)
        // helpers that are handed t, like roleLabel(t, role), use the Oidc texts
        if (!names.size) bind('t', 'Oidc')
        for (const [name, spaces] of names) {
            for (const namespace of spaces) assert.ok(used[namespace], `unknown namespace ${namespace}`)
            for (const match of content.matchAll(new RegExp(`\\b${name}\\('(\\w+)'(\\s*\\+)?`, 'g'))) {
                // t('kpi_' + key): every text that starts with kpi_
                const keys = space =>
                    Object.keys(namespaces[space]?.en ?? {}).filter(key =>
                        match[2] ? key.startsWith(match[1]) : key === match[1]
                    )
                const owners = [...spaces].filter(space => keys(space).length)
                if (!owners.length) used[[...spaces][0]].add(match[1])
                for (const space of owners) for (const key of keys(space)) used[space].add(key)
            }
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
        // The portal picks many texts by a value (the status, a step of the tour): those are not checked here
        if (!dynamic.has(namespace) && !namespace.startsWith('Portal.'))
            for (const key of keys) assert.ok(used[namespace].has(key), `unused text ${namespace}.${key}`)
    }
})

for (const ui of [true, false]) {
    test(`withApi with the OIDC server (${ui ? 'DafkeDD UI' : 'plain'}): login files, texts and the home page`, () => {
        const all = withApi({ ...files, ...(ui ? uiFiles : {}) }, API, { ui })
        assert.ok(all['src/app/api/auth/callback/route.ts'])
        assert.ok(!all['src/components/auth-links.tsx'], 'not the simple login')
        for (const locale of LOCALES) {
            const messages = JSON.parse(all[`messages/${locale}.json`])
            assert.deepEqual(messages.Oidc, OIDC_MESSAGES[locale])
            assert.deepEqual(messages.Licenses, LICENSE_MESSAGES[locale])
            assert.deepEqual(messages.Audit, AUDIT_MESSAGES[locale])
        }
        for (const locale of LOCALES) {
            const messages = JSON.parse(all[`messages/${locale}.json`])
            assert.deepEqual(messages.Shell, SHELL_MESSAGES[locale])
            assert.deepEqual(messages.Nav, NAV_MESSAGES[locale])
        }
        // The home page of the login server: the portal, the superadmin panel or the login
        const page = all['src/app/[locale]/page.tsx']
        assert.match(page, /<ClientRedirect to=\{!session \? '\/login'/)
        assert.match(all['src/components/api-status.tsx'], /<Icon name="server"/)
        // DafkeDD UI always: the theme script comes with it; the language is chosen in the shell
        assert.match(all['src/components/theme-script.tsx'], /lui-theme/)
        assert.ok(!all['src/components/locale-switcher.tsx'])
    })
}

test('withApi without the OIDC server adds none of it', () => {
    const all = withApi(sitePages({ ...files, ...uiFiles }), { port: 4000 }, { ui: true })
    assert.ok(!all['src/lib/oidc.ts'])
    assert.ok(!all['src/components/pasport/portal-shell.tsx'])
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
        askClaude: async () => false,
        askCloud: async () => false,
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
    // Only a page of this app may change something (the Origin of a POST, PUT, PATCH or DELETE)
    assert.match(route, /request\.method !== 'GET' && !fromThisApp\(request\)/)
    assert.match(templates['src/lib/oidc.ts'], /origin === new URL\(APP_URL\)\.origin/)
    const allowed = new RegExp(/const ALLOWED =\s+\/(.+)\/$/m.exec(route)[1])
    const notifications = new RegExp(/const NOTIFICATIONS = \/(.+)\/$/m.exec(route)[1])
    const allows = path => allowed.test(path) || notifications.test(path)
    for (const path of [
        'tenants/current/members',
        'admin/tenants',
        'me/mfa',
        'me/mfa/recovery-codes',
        'me/notifications',
        'me/notifications/read-all',
        'me/notifications/4b8e1f2a-6c3d-4e9f-8a7b-2d1c0e9f8a6b/read',
        'me/profile',
        'me/password',
        'me/vault',
        'me/vault/password',
        'me/vault/colleagues',
        'me/eid/back',
        'me/licenses/planner/trial',
        'me/heartbeat',
        'me/out-of-office',
        'me/status',
        'tenants/current/billing',
        'tenants/current/tickets'
    ])
        assert.ok(allows(path), path)
    for (const path of [
        'oidc/token',
        'health',
        'tenants/other/members',
        '../admin',
        'me/vaultx',
        'me/vault/colleagues/x',
        'me/profile/x',
        'me/notifications/../read',
        'me/notificationsx'
    ])
        assert.ok(!allows(path), path)
})

test('the QR code is shown as an image, never inserted as HTML', () => {
    for (const [rel, content] of Object.entries(templates)) assert.ok(!content.includes('dangerouslySetInnerHTML'), rel)
    assert.match(templates['src/components/mfa-ui.tsx'], /data:image\/svg\+xml/)
})

test('the Pasport design: one layout, the shell around every page and the login screen around the forms', () => {
    const layout = templates['src/app/[locale]/layout.tsx']
    assert.match(layout, /import '@fontsource-variable\/hanken-grotesk'/)
    assert.ok(!layout.includes('next/font'), 'no request to Google Fonts during the build')
    assert.match(layout, /<ThemeProvider>/)
    assert.match(layout, /<ToastProvider>\{children\}<\/ToastProvider>/)
    // The stylesheet of the design, after the DafkeDD UI styles of globals.css
    assert.ok(layout.indexOf("import '../globals.css'") < layout.indexOf("import '../../styles/pasport.css'"))
    const css = templates['src/styles/pasport.css']
    for (const part of ['.app-shell', '.sidebar', '.rail-item', '.topbar', '.tb-user-pop', '.auth-wrap', '.auth-aside'])
        assert.ok(css.includes(part), part)
    // The phone: the rail becomes a drawer behind the menu button, the login panel disappears
    assert.match(css, /@media \(max-width: 860px\)/)
    // The pages of the portal: marketplace, wizard, vault, tickets, tour, presence
    for (const part of ['.market-card', '.wizard-stepper', '.vault-widget', '.rte-bar', '.tour-tip', '.presence-dot'])
        assert.ok(css.includes(part), part)
    // The bell of the topbar: its popover, also on the phone
    assert.match(css, /\.notif-pop/)
    // The customer portal and the superadmin panel: route groups with the shell in their layout
    assert.match(templates['src/app/[locale]/(portal)/layout.tsx'], /<CustomerShell/)
    assert.match(templates['src/app/[locale]/admin/(panel)/layout.tsx'], /<AdminShell/)
    assert.match(
        templates['src/app/[locale]/admin/(panel)/layout.tsx'],
        /if \(!session\.superadmin\) return <ClientRedirect/
    )
    // The auth screens draw the login screen of the design themselves
    assert.match(templates['src/components/oidc-login.tsx'], /<AuthLayout>\{children\}<\/AuthLayout>/)
    for (const name of ['Register', 'ForgotPassword', 'ResetPassword', 'VerifyEmail', 'AcceptInvitation'])
        assert.match(templates['src/components/account-forms.tsx'], new RegExp(`export function ${name}\\(`), name)
    assert.equal(templates['src/components/account-forms.tsx'].match(/<AuthLayout/g).length >= 5, true)
    const shell = templates['src/components/pasport/shell.tsx'] + templates['src/components/pasport/portal-shell.tsx']
    for (const part of [
        "className={'app-shell'",
        "className={'sidebar'",
        "className='rail-nav'",
        "className='topbar'",
        "className='nav-toggle'",
        "className='rail-toggle'",
        "className='tb-search'",
        '<ThemeToggle',
        "className='user-pop-locales'",
        "className='user-pop-flyout-wrap'",
        '<OutOfOfficeDialog',
        '<Tour '
    ])
        assert.ok(shell.includes(part), part)
    // The pages of the organisation for its admins, the panel for superadmins
    assert.match(shell, /\.\.\.\(admin\s+\? \[/)
    assert.match(shell, /user\.superadmin \? \[\{ key: 'platform'/)
    assert.match(shell, /form\.action = '\/api\/auth\/logout'/)
    // A linked app: AppPage puts its own pages (APP_NAV) in the same shell, the rest on the login server
    const linked = oidcFrontendFiles({ linked: true, appName: 'Planner' })
    const appShell = linked['src/components/shell/app-shell.tsx']
    assert.match(appShell, /APP_NAV\.map/)
    assert.match(appShell, /security: ACCOUNT_URL \+ '\/security'/)
    assert.match(appShell, /if \(!session\) return <LoginRedirect \/>/)
    assert.match(linked['src/components/shell/shell-view.tsx'], /<PortalBell accountUrl=\{accountUrl\}/)
    assert.match(linked['src/components/shell/shell-view.tsx'], /<PortalShell\b/)
    assert.match(linked['src/lib/nav.ts'], /export const APP_NAV: NavItem\[\]/)
    assert.match(templates['src/components/presence.tsx'], /me\/heartbeat/)
    const screen = templates['src/components/pasport/auth-layout.tsx']
    assert.match(screen, /className='auth-wrap'/)
    assert.match(screen, /<LocaleFloat label=\{shell\('language'\)\} \/>/)
    // The login screen says which app asks (not for its own frontend), eID first, registering only here
    const login = templates['src/components/oidc-login.tsx']
    assert.match(login, /t\('loginTitleApp', \{ client: state\.clientName \}\)/)
    assert.match(login, /state\.clientId !== ownClient/)
    assert.match(templates['src/app/[locale]/login/page.tsx'], /ownClient=\{OIDC_CLIENT_ID\}/)
    assert.ok(login.indexOf("p('tabEid')") < login.indexOf("p('tabEmail')"), 'eID before the email tab')
    assert.match(login, /href='\/register'/)
    assert.match(templates['src/lib/brand.ts'], /export const APP_NAME: string \| null = null/)
    // No hard-coded colours from Tailwind: everything comes from the tokens of the design
    for (const [rel, content] of Object.entries(templates))
        if (rel.endsWith('.tsx'))
            assert.ok(!/(?:bg|text|border)-(?:black|white|red|green|amber)[-/]\d/.test(content), rel)
})

test('every page is protected: the proxy sends a browser without a session to /login and back afterwards', () => {
    const proxy = templates['src/proxy.ts']
    assert.match(proxy, /export const PUBLIC_PATHS = \[/)
    for (const path of ['/login', '/admin/login', '/register', '/forgot-password', '/reset-password', '/verify-email'])
        assert.ok(proxy.includes(`'${path}'`), path)
    assert.match(proxy, /if \(!session && !isPublic\(request\.nextUrl\.pathname\)\)/)
    assert.match(proxy, /new URL\('\/login', request\.url\)/)
    assert.match(proxy, /login\.searchParams\.set\('returnTo', back\)/)
    // /login hands returnTo on to the login (only a path of this app)
    const login = templates['src/app/[locale]/login/page.tsx']
    assert.match(login, /returnTo\?\.startsWith\('\/'\) && !returnTo\.startsWith\('\/\/'\)/)
    assert.match(templates['src/components/shell/start-login.tsx'], /name='returnTo'/)
    // One login screen for everybody: /admin/login (an old link) is /login, back to the platform
    assert.match(templates['src/app/[locale]/admin/login/page.tsx'], /redirect\('\/login\?returnTo=%2Fadmin'\)/)
    assert.ok(!/variant|pp-login-ui/.test(templates['src/components/shell/start-login.tsx']))
    assert.ok(!/variant=|admin/.test(templates['src/components/pasport/auth-layout.tsx']))
})

test('a superadmin on the platform (no organisation) goes to /admin instead of seeing an error', () => {
    assert.match(
        templates['src/app/[locale]/(portal)/layout.tsx'],
        /if \(!session\.tenant && session\.superadmin\) return <ClientRedirect to='\/admin' \/>/
    )
    assert.match(templates['src/app/[locale]/page.tsx'], /!session\.tenant && session\.superadmin \? '\/admin'/)
})

test('DafkeDD UI is always installed, with or without the OIDC login, whatever the answer; ESLint skips its folder', async () => {
    assert.equal(uiFor({ ui: 'none' }, { port: 4000, oidc: true }), 'all')
    assert.equal(uiFor({ ui: 'init' }, { port: 4000, oidc: true, linked: {} }), 'all')
    assert.equal(uiFor({ ui: 'none' }, { port: 4000 }), 'all')
    assert.equal(uiFor({}, null), 'all')
    const dir = await mkdtemp(path.join(tmpdir(), 'oidc-ui-'))
    try {
        const steps = await nextjs.steps({
            projectDir: dir,
            answers: { ui: 'none' },
            api: { port: 4000, oidc: true },
            exec: async () => {}
        })
        const titles = steps.map(step => step.title)
        assert.ok(titles.includes('DafkeDD UI ophalen'))
        assert.ok(titles.includes('DafkeDD UI installeren'))
        assert.ok(titles.some(title => title.startsWith('Lettertypen installeren')))
        await writeFile(
            path.join(dir, 'eslint.config.mjs'),
            "const c = defineConfig([...a, globalIgnores([\n        '.next/**'\n    ])])\n"
        )
        await ignoreUiInEslint(dir)
        await ignoreUiInEslint(dir)
        const config = await readFile(path.join(dir, 'eslint.config.mjs'), 'utf8')
        assert.equal(config.split('src/components/ui/**').length, 2, 'added once')
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
})

test('the bell: every kind of notification of the backend has a text and an icon in the frontend', async () => {
    const store = await readFile(
        new URL('../templates/backend-oidc/src/notifications/notifications.store.ts', import.meta.url),
        'utf8'
    )
    const kinds = [
        ...store
            .slice(store.indexOf('export type NotificationKind ='))
            .split('\n\n')[0]
            .matchAll(/\| '([a-z_.]+)'/g)
    ].map(match => match[1])
    assert.ok(kinds.length >= 10, kinds.join(' '))
    const bell = templates['src/components/pasport/portal-shell.tsx']
    for (const kind of kinds) assert.match(bell, new RegExp(`case '${kind.replace('.', '\\.')}':`), kind)
    // Polls the login server through the proxy of the frontend, and marks as read there
    assert.match(bell, /api<Notification\[\]>\('me\/notifications'\)/)
    assert.match(bell, /'me\/notifications\/read-all'/)
    // Every screen a notification can lead to has a page
    for (const screen of [
        'invoices',
        'ticket',
        'users',
        'admin-tenants',
        'admin-tenant',
        'admin-ticket',
        'admin-codes'
    ])
        assert.ok(bell.includes(`'${screen}'`), screen)
})

test('the design check of every project: the generated frontends pass, a page outside the design does not', async t => {
    const { execFileSync } = await import('node:child_process')
    const { mkdir } = await import('node:fs/promises')
    for (const linked of [null, { name: 'Planner', apiUrl: 'https://api.login.example.com' }]) {
        const dir = await mkdtemp(path.join(tmpdir(), 'dafkedd-design-'))
        t.after(() => rm(dir, { recursive: true, force: true }))
        const all = withApi(files, { oidc: true, port: 4000, linked }, { ui: true })
        // The Pasport design has its own icons: no react-icons in an OIDC frontend
        for (const [rel, content] of Object.entries(all))
            if (rel !== 'scripts/check-design.mjs') assert.ok(!/react-icons|lucide-react/.test(content), rel)
        all['package.json'] = JSON.stringify({ dependencies: { next: '16.0.0' } })
        for (const [rel, content] of Object.entries(all)) {
            await mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
            await writeFile(path.join(dir, rel), content)
        }
        const check = () =>
            execFileSync('node', ['scripts/check-design.mjs'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
        assert.match(check(), /The Pasport design: \d+ pages, \d+ files OK/)
        // A page without the shell, another icon set, a colour of its own, and a component library
        await mkdir(path.join(dir, 'src/app/[locale]/reports'), { recursive: true })
        await writeFile(
            path.join(dir, 'src/app/[locale]/reports/page.tsx'),
            "import { LuChart } from 'react-icons/lu'\nexport default function Reports() {\n    return <div style={{ color: '#ff0000' }}><LuChart /> Ticket #123</div>\n}\n"
        )
        await writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { '@mui/material': '7' } }))
        const failed = (() => {
            try {
                check()
                return null
            } catch (error) {
                return String(error.stderr)
            }
        })()
        assert.ok(failed, 'the check fails')
        assert.match(failed, /reports\/page\.tsx: imports react-icons\/lu/)
        assert.match(failed, /reports\/page\.tsx: the colour #ff0000/)
        assert.match(failed, /reports\/page\.tsx: every page sits in the shell: <AppPage>/)
        assert.match(failed, /package\.json: @mui\/material/)
        assert.ok(!failed.includes('#123'), 'a number in a text is not a colour')
    }
    // The script of the frontend
    assert.match(
        await readFile(new URL('../src/frontends/nextjs.js', import.meta.url), 'utf8'),
        /'check:design'\] = 'node scripts\/check-design\.mjs'/
    )
})

test('security and profile: change the password, edit the profile, also in the superadmin panel, and the eID screen', () => {
    const security = templates['src/app/[locale]/(portal)/security/page.tsx']
    assert.match(security, /<PasswordCard \/>/)
    assert.match(templates['src/components/pasport/password-card.tsx'], /'me\/password', 'POST'/)
    assert.match(templates['src/app/[locale]/admin/(panel)/security/page.tsx'], /<PasswordCard \/>/)
    assert.match(templates['src/app/[locale]/admin/(panel)/profile/page.tsx'], /<Profile variant='admin' \/>/)
    assert.match(templates['src/app/[locale]/(portal)/profile/page.tsx'], /<Profile \/>/)
    const profile = templates['src/components/pasport/customer/profile.tsx']
    assert.match(profile, /'me\/profile', 'PATCH'/)
    assert.match(profile, /'tenants\/current\/billing', 'PATCH'/)
    // The user menu of the superadmin panel opens its own profile and security pages
    const shell = templates['src/components/pasport/portal-shell.tsx']
    assert.match(shell, /href: '\/admin\/profile'/)
    assert.match(shell, /href: '\/admin\/security'/)
    // A linked app: its own profile page, security on the login server
    const linked = oidcFrontendFiles({ linked: true, appName: 'Planner' })
    assert.match(linked['src/app/[locale]/profile/page.tsx'], /<Profile \/>/)
    assert.match(linked['src/components/pasport/profile.tsx'], /'me\/profile', 'PATCH'/)
    // OIDC_EID_REQUIRED: GET /me/eid or a 403 oidc.EID_REQUIRED shows the eID screen instead of the page
    assert.match(
        templates['src/app/[locale]/(portal)/layout.tsx'],
        /if \(eid\?\.required && !eid\.linked\) return <EidRequired/
    )
    assert.match(shell, /if \(eidRequired\) return <EidRequired/)
    assert.match(linked['src/components/shell/shell-view.tsx'], /if \(eidRequired\) return <EidRequired/)
    assert.match(templates['src/lib/account.ts'], /result\.body\.error === 'oidc\.EID_REQUIRED'\) eidRequired\(\)/)
    assert.match(templates['src/components/pasport/eid-required.tsx'], /'\/api\/backend\/me\/eid'/)
    // The eID reminder is a tinted notice with an icon, never a card with a coloured left border (pasport.md)
    const reminder = templates['src/components/pasport/eid-required.tsx'].split('export function EidReminder')[1]
    assert.ok(!/borderLeft/.test(reminder.split('export function EidRequired')[0]), 'no coloured left border')
    assert.match(reminder, /background: 'var\(--accent-tint\)'/)
    assert.match(reminder, /borderColor: 'var\(--accent-border\)'/)
    // Nor the vault card of the dashboard
    assert.ok(!/borderLeft/.test(templates['src/components/pasport/customer/dashboard.tsx']), 'dashboard left border')
    // A new account of an invitation can read its eID first (required with OIDC_EID_REQUIRED)
    assert.match(templates['src/components/account-forms.tsx'], /api\('invitation\/eid'/)
})
