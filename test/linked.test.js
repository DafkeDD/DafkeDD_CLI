import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { main } from '../src/index.js'
import { backends } from '../src/backends/index.js'
import { linked, LINK_CODE, normalizeServer, projectUris, useLinkCode } from '../src/backends/linked.js'
import { DEFAULT_ROLES } from '../src/backends/app.js'
import { endpoints } from '../src/backends/docs.js'
import { buildFiles } from '../src/backends/nestjs.js'
import { files, setPort, withApi } from '../src/frontends/nextjs.js'
import { envLocal, LINKED_FILES, oidcFrontendFiles } from '../src/frontends/oidc.js'

const LINK = {
    issuer: 'http://localhost:4000/oidc',
    apiUrl: 'http://localhost:4000',
    accountUrl: 'http://localhost:3000',
    clientId: 'planner',
    clientSecret: null,
    name: 'Planner',
    firstParty: true,
    scopes: ['openid', 'profile', 'email', 'tenant'],
    product: null,
    port: 3001
}
const ANSWER = {
    issuer: LINK.issuer,
    apiUrl: LINK.apiUrl,
    accountUrl: LINK.accountUrl,
    client: { clientId: 'planner', name: 'Planner', type: 'public', scopes: LINK.scopes, firstParty: true },
    clientSecret: null
}

const DATABASE = {
    id: 'postgres',
    mode: 'local',
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'x',
    database: 'planner',
    project: 'shop'
}

/** A fake login server: answers POST /oidc/link like the real one, and remembers what it got. */
function fakeServer(status = 200, body = ANSWER) {
    const calls = []
    const fetchImpl = async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) })
        return { ok: status < 400, status, json: async () => body }
    }
    return { calls, fetchImpl }
}

test('the backend choice "app for an existing DafkeDD OIDC server" is registered, with its own API in ./backend', () => {
    assert.equal(backends.linked, linked)
    assert.equal(linked.dir, 'backend')
    assert.equal(linked.docsFile, 'api.md')
    assert.equal(linked.api.port, 4001)
    assert.match(linked.label, /App voor een bestaande DafkeDD OIDC-server \(koppelcode\)/)
})

test('server addresses are typed in many ways; link codes like K7QM-2XPD-9HRT-W4NB-C8ZF-3VJE (or 12 characters)', () => {
    for (const typed of [
        'http://localhost:4000',
        'http://localhost:4000/',
        'http://localhost:4000/oidc',
        'http://localhost:4000/oidc/.well-known/openid-configuration'
    ])
        assert.equal(normalizeServer(typed), 'http://localhost:4000', typed)
    assert.equal(normalizeServer('https://auth.example.com/api/oidc'), 'https://auth.example.com/api')
    for (const wrong of ['', 'localhost:4000', 'ftp://x', 'http://x/?a=1'])
        assert.equal(normalizeServer(wrong), null, wrong)
    // The codes of now (24 characters) and of servers before 0.39.1 (12 characters)
    assert.ok(LINK_CODE.test('RUNK-AQYQ-9R32-XQHL-UQ42-ZEB3'))
    assert.ok(LINK_CODE.test('RUNKAQYQ9R32XQHLUQ42ZEB3'))
    assert.ok(LINK_CODE.test('K7QM-2XPD-9HRT'))
    assert.ok(LINK_CODE.test('K7QM2XPD9HRT'))
    assert.ok(!LINK_CODE.test('K7QM-2XPD'))
    assert.ok(!LINK_CODE.test('K7QM-2XPD-9HRT-W4NB-C8ZF-3VJE-AAAA'))
    assert.ok(!LINK_CODE.test('K7QM-2XPD-9HR'))
})

test('the link code goes to POST /oidc/link with the addresses of the new frontend', async () => {
    const server = fakeServer()
    const link = await useLinkCode({ server: 'http://localhost:4000', code: 'K7QM-2XPD-9HRT', port: 3001, ...server })
    assert.equal(server.calls[0].url, 'http://localhost:4000/oidc/link')
    assert.deepEqual(server.calls[0].body, { code: 'K7QM-2XPD-9HRT', ...projectUris(3001), roles: DEFAULT_ROLES })
    assert.deepEqual(server.calls[0].body.redirectUris, ['http://localhost:3001/api/auth/callback'])
    assert.deepEqual(link, LINK)

    // The message of the server, translated, comes back to the prompt
    const refused = fakeServer(400, { message: 'Deze koppelcode is onbekend, al gebruikt of verlopen' })
    await assert.rejects(
        useLinkCode({ server: 'http://localhost:4000', code: 'AAAA-BBBB-CCCC', port: 3001, ...refused }),
        /koppelcode is onbekend/
    )
    const offline = async () => {
        throw new Error('ECONNREFUSED')
    }
    await assert.rejects(
        useLinkCode({ server: 'http://localhost:4000', code: 'AAAA-BBBB-CCCC', port: 3001, fetchImpl: offline }),
        /niet bereikbaar/
    )
})

test('ask: server, port, the code and the own database; a wrong code is asked again with the reason', async () => {
    let tries = 0
    const fetchImpl = async () => {
        tries++
        return tries === 1
            ? { ok: false, status: 400, json: async () => ({ message: 'Deze koppelcode is onbekend' }) }
            : { ok: true, status: 200, json: async () => ANSWER }
    }
    const asked = []
    const prompts = {
        // No Docker question (the database is on the server of the login server): only how the data is kept apart
        select: async config => {
            asked.push(config.message)
            assert.match(config.message, /gescheiden/)
            assert.equal(config.default, 'rls')
            assert.deepEqual(
                config.choices.map(choice => choice.value),
                ['rls', 'database']
            )
            return 'database'
        },
        checkbox: async config => {
            asked.push(config.message)
            assert.deepEqual(
                config.choices.map(choice => choice.value),
                ['mail', 'files']
            )
            return ['mail']
        },
        password: async config => {
            asked.push(config.message)
            return 'geheim'
        },
        input: async config => {
            asked.push(config.message)
            if (config.message.startsWith('Adres')) return 'http://localhost:4000/oidc'
            if (config.message.startsWith('Op welke poort')) {
                assert.notEqual(await config.validate('4000'), true)
                assert.notEqual(await config.validate('4001'), true, 'the API of the app')
                return '3001'
            }
            if (config.message.startsWith('Host')) {
                assert.match(config.message, /login server/)
                return config.default
            }
            if (config.message.startsWith('Poort')) return config.default
            if (config.message.startsWith('Gebruikersnaam')) return config.default
            if (config.message.startsWith('Naam van de eigen database')) {
                assert.equal(config.default, 'planner', 'named after the app')
                return config.default
            }
            // The prompt keeps asking until validate says yes
            assert.match(await config.validate('nonsense'), /K7QM-2XPD-9HRT-W4NB-C8ZF-3VJE/)
            assert.equal(await config.validate('aaaa-bbbb-cccc'), 'Deze koppelcode is onbekend')
            assert.equal(await config.validate('K7QM-2XPD-9HRT'), true)
            return 'K7QM-2XPD-9HRT'
        }
    }
    const answers = await linked.ask({ hasFrontend: true, prompts, fetchImpl, projectDir: '/tmp/shop' })
    assert.equal(asked.length, 10)
    assert.deepEqual(answers.link, LINK)
    assert.deepEqual(answers.appOptions, { mail: true, files: false, isolation: 'database' })
    assert.deepEqual(answers.database, {
        id: 'postgres',
        mode: 'local',
        host: 'localhost',
        port: 5432,
        user: 'postgres',
        password: 'geheim',
        database: 'planner',
        project: 'shop'
    })
    assert.deepEqual(linked.apiFor(answers), { port: 4001, url: 'http://localhost:4001', oidc: true, linked: LINK })
    const summary = linked.summary(answers).map(line => line.text)
    assert.ok(summary[0].includes('Gekoppeld aan http://localhost:4000/oidc'))
    assert.ok(summary.some(line => line.includes('Verbonden met PostgreSQL op localhost:5432/planner')))
    assert.ok(summary.some(line => line.includes('een eigen database (planner_t_<id>)')))
    assert.ok(summary.some(line => line.startsWith('Mail: MailService')))
    assert.ok(!summary.some(line => line.startsWith('Bestanden')))
    assert.ok(linked.next(answers).includes('npm run start:dev'))
    assert.ok(linked.next(answers).some(line => line.startsWith('npm run mail:dev')))
    const rls = linked.summary({ ...answers, appOptions: { mail: false, files: false, isolation: 'rls' } })
    assert.ok(rls.some(line => line.text.includes('Row-Level Security')))
    // Without a frontend there is nothing to link
    const none = await linked.ask({ hasFrontend: false, prompts })
    assert.equal(none.link, null)
    assert.equal(linked.summary(none)[0].ok, false)
})

test('the linked frontend: login, session, profile and the notes of its own API; account pages are on the server', () => {
    const own = oidcFrontendFiles({ linked: true, appName: 'Planner' })
    assert.deepEqual(Object.keys(own).sort(), [...LINKED_FILES].sort())
    // Every file the linked frontend imports (@/...) is generated too (regression: ask-demo was missing). DafkeDD UI
    // (src/components/ui) is installed by its own step.
    const generated = withApi(
        { ...files },
        { port: 4001, url: 'http://localhost:4001', oidc: true, linked: LINK },
        { ui: false }
    )
    for (const [rel, content] of Object.entries(generated))
        for (const [, target] of content.matchAll(/from '@\/([^']+)'/g))
            assert.ok(
                ['.ts', '.tsx'].some(ext => generated[`src/${target}${ext}`] !== undefined) ||
                    target === 'components/ui' ||
                    target.startsWith('components/ui/'),
                `${rel} imports @/${target}`
            )
    for (const page of ['register', 'security', 'members', 'admin', 'licenses', 'audit'])
        assert.ok(!Object.keys(own).some(rel => rel.includes(`/${page}/`)), page)
    // The same shell as the login server: its account pages through OIDC_ACCOUNT_URL, this app's name in the sidebar
    assert.match(own['src/components/shell/app-shell.tsx'], /ACCOUNT_URL \+ path/)
    assert.match(own['src/app/[locale]/profile/page.tsx'], /ACCOUNT_URL \+ '\/members'/)
    assert.match(own['src/lib/brand.ts'], /export const APP_NAME: string \| null = "Planner"/)
    // No login form of its own: /login starts the login at the login server at once
    const login = own['src/app/[locale]/login/page.tsx']
    assert.ok(!login.includes('OidcLogin'))
    assert.match(login, /<StartLogin error=\{error\} \/>/)
    assert.match(own['src/lib/oidc.ts'], /OIDC_CLIENT_SECRET/)
    // The full frontend of the server itself is unchanged
    assert.match(oidcFrontendFiles()['src/lib/brand.ts'], /= null/)

    const all = withApi(
        { ...files },
        { port: 4001, url: 'http://localhost:4001', oidc: true, linked: LINK },
        { ui: false }
    )
    const page = all['src/app/[locale]/page.tsx']
    assert.match(page, /<ApiStatus \/>/, 'the status card of the API of this app')
    assert.match(all['src/components/api-status.tsx'], /className="lui-card /)
    assert.match(page, /<Notes\s+admin=/)
    assert.match(page, /<SessionLinks \/>/)
    assert.match(page, /<AppPage>/)
    assert.match(all['src/app/[locale]/layout.tsx'], /<ThemeProvider>/)
    assert.match(all['src/lib/brand.ts'], /"Planner"/)
    // Two APIs: the own one (notes) and the one of the login server (members, licences, heartbeat)
    assert.match(all['src/lib/api.ts'], /'http:\/\/localhost:4001'/)
    assert.match(all['src/lib/pasport.ts'], /\?\? 'http:\/\/localhost:4000'\)/)
    assert.match(all['src/app/api/backend/[...path]/route.ts'], /\$\{PASPORT_API_URL\}\//)
    const proxy = all['src/app/api/app/[...path]/route.ts']
    assert.match(proxy, /\$\{API_URL\}\//)
    assert.match(proxy, /Authorization: 'Bearer ' \+ session\.accessToken/)
    assert.match(proxy, /request\.headers\.get\('origin'\) !== new URL\(APP_URL\)\.origin/)
    assert.match(all['src/components/notes.tsx'], /fetch\('\/api\/app\/notes'/)
    // Uploads and downloads pass as bytes, with the headers for caching (ETag → 304) and downloads
    assert.match(proxy, /body: hasBody \? await request\.arrayBuffer\(\) : undefined/)
    assert.match(proxy, /new NextResponse\(await response\.arrayBuffer\(\)/)
    assert.match(proxy, /'Content-Type': request\.headers\.get\('content-type'\) \?\? 'application\/json'/)
    assert.match(proxy, /'If-None-Match': etag/)
    for (const header of ['etag', 'cache-control', 'content-disposition'])
        assert.ok(proxy.includes(`'${header}'`), header)
    assert.match(proxy, /response\.status === 304/)
    // Named after the client id: the portal of the login server on another port of localhost never shares them
    assert.match(all['src/lib/oidc.ts'], /export const SESSION_COOKIE = `\$\{COOKIE_PREFIX\}_session`/)
    assert.match(all['src/lib/oidc.ts'], /export const FLOW_COOKIE = `\$\{COOKIE_PREFIX\}_oidc`/)
    assert.doesNotMatch(all['src/lib/oidc.ts'], /'app_session'/)
    // Every page of the linked app is protected: without a session the shell starts a login that comes back here
    const shell = all['src/components/shell/app-shell.tsx']
    assert.match(shell, /if \(!session && external\) return <LoginRedirect \/>/)
    const redirect = all['src/components/shell/login-redirect.tsx']
    assert.match(redirect, /<form ref=\{form\} action='\/api\/auth\/login' method='get'/)
    assert.match(redirect, /returnTo\.current\.value = window\.location\.pathname \+ window\.location\.search/)
    assert.match(redirect, /Date\.now\(\) - last < RETRY_MS/)
    for (const locale of ['en', 'nl', 'fr', 'de'])
        assert.ok(JSON.parse(all[`messages/${locale}.json`]).Oidc.loginStuck, locale)
    // The licence for the product of the app: kept in the session, shown on the home page
    assert.match(all['src/lib/oidc.ts'], /license: licenseOf\(claims\.license\)/)
    assert.match(all['src/lib/refresh.ts'], /\blicense,\n[^}]*\broles\n/)
    assert.match(page, /<AppLicense license=\{license\} admin=\{admin\} \/>/)
    assert.match(page, /license\?\.status !== 'none' && \(\s+<Notes/)
    assert.match(all['src/components/app-license.tsx'], /ACCOUNT_URL \+ '\/licenses'/)
    for (const locale of ['en', 'nl', 'fr', 'de']) {
        const messages = JSON.parse(all[`messages/${locale}.json`])
        assert.deepEqual(
            Object.keys(messages.Notes).sort(),
            Object.keys(JSON.parse(all['messages/en.json']).Notes).sort()
        )
        assert.ok(messages.Notes.title)
        assert.deepEqual(
            Object.keys(messages.AppLicense).sort(),
            Object.keys(JSON.parse(all['messages/en.json']).AppLicense).sort()
        )
    }
    // The login server itself has no notes
    const server = withApi({ ...files }, { port: 4000, oidc: true }, { ui: false })
    assert.ok(!server['src/components/notes.tsx'])
    assert.ok(!JSON.parse(server['messages/en.json']).Notes)
    assert.ok(!server['src/components/app-license.tsx'])
    assert.match(server['src/lib/pasport.ts'], /\?\? API_URL\)/)
})

test('.env.local of a linked frontend: issuer, app, secret only when there is one, account pages, its own port', () => {
    const env = envLocal({ apiPort: 4001, linked: LINK, secret: 'x'.repeat(64) })
    for (const line of [
        'OIDC_ISSUER=http://localhost:4000/oidc',
        'OIDC_CLIENT_ID=planner',
        'OIDC_ACCOUNT_URL=http://localhost:3000',
        'NEXT_PUBLIC_API_URL=http://localhost:4001',
        'NEXT_PUBLIC_PASPORT_API_URL=http://localhost:4000',
        'APP_URL=http://localhost:3001'
    ])
        assert.ok(env.split('\n').includes(line), line)
    assert.ok(!env.includes('OIDC_CLIENT_SECRET'))
    assert.match(envLocal({ linked: { ...LINK, clientSecret: 's3cret' } }), /^OIDC_CLIENT_SECRET=s3cret$/m)
})

test('the linked frontend runs on its own port', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'linked-'))
    try {
        await writeFile(
            path.join(dir, 'package.json'),
            JSON.stringify({ scripts: { dev: 'next dev', start: 'next start' } })
        )
        await setPort(dir, 3001)
        await setPort(dir, 3001)
        const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
        assert.deepEqual(pkg.scripts, { dev: 'next dev -p 3001', start: 'next start -p 3001' })
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
})

test('main: a linked app gives the frontend its own API and the login server, and installs ./backend', async () => {
    const events = []
    const logs = []
    await main({
        projectDir: '/tmp/project',
        prompts: { select: async config => (config.message.includes('frontend') ? 'fe' : 'linked') },
        ask: async () => null,
        registry: {
            fe: {
                id: 'fe',
                label: 'FE',
                description: 'FE',
                dir: 'frontend',
                ask: async () => ({}),
                steps: async ctx => {
                    events.push(ctx.api)
                    return [{ title: 'fe', run: async () => {} }]
                }
            }
        },
        backendRegistry: {
            linked: { ...linked, ask: async () => ({ link: LINK, database: DATABASE }), steps: async () => [] }
        },
        execute: async () => {},
        log: line => logs.push(stripVTControlCharacters(String(line)))
    })
    assert.deepEqual(events[0], { port: 4001, url: 'http://localhost:4001', oidc: true, linked: LINK })
    assert.ok(logs.some(line => line.includes('geïnstalleerd in ./backend')))
    assert.ok(logs.some(line => line.includes('Gekoppeld aan')))
})

test('the server: link codes on /admin and POST /oidc/link, documented', () => {
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
    const backend = buildFiles(DB, {
        oidc: {
            adminEmail: 'a@example.com',
            adminPassword: 'x',
            adminPasswordHash: 'scrypt$1$a$b',
            masterKey: 'ab'.repeat(32)
        }
    })
    assert.ok(backend['src/oidc/clients/link.controller.ts'])
    assert.match(backend['src/database/migrations.ts'], /id: 10,\s+name: 'link codes for apps'/)
    const service = backend['src/oidc/clients/clients.service.ts']
    assert.match(service, /sha256\(normalizeLinkCode\(code\)\)/)
    assert.match(backend['src/oidc/store/pg-oidc.store.ts'], /l\.used_at IS NULL AND l\.expires_at > now\(\)/)
    const documented = endpoints({ database: DB, oidc: true }).map(e => `${e.method} ${e.path}`)
    for (const route of ['POST /admin/clients/:clientId/link-code', 'POST /oidc/link'])
        assert.ok(documented.includes(route), route)
})

test('the READMEs explain the link code and the linked frontend', async () => {
    const { frontendReadme } = await import('../src/frontends/docs.js')
    const readme = frontendReadme({ api: { port: 4000, url: LINK.apiUrl, oidc: true, linked: LINK } })
    for (const text of [
        '## Login (linked to an existing login server)',
        'OIDC_ACCOUNT_URL',
        'http://localhost:3001',
        '`/api/app/...`',
        'NEXT_PUBLIC_PASPORT_API_URL',
        'notes of the organisation',
        '**Licence.**',
        'errors.NO_LICENSE'
    ])
        assert.ok(readme.includes(text), text)
    assert.ok(!readme.includes('eid:mock'))
    assert.ok(!readme.includes('## Login (OpenID Connect)'))
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
    const backend = buildFiles(DB, {
        oidc: {
            adminEmail: 'a@example.com',
            adminPassword: 'x',
            adminPasswordHash: 'scrypt$1$a$b',
            masterKey: 'ab'.repeat(32)
        }
    })
    assert.ok(backend['README.md'].includes('**Link a new project to an app with a link code**'))
    assert.ok(backend['README.md'].includes('`oidc_link_codes`'))
})
