import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { main } from '../src/index.js'
import { backends } from '../src/backends/index.js'
import { linked, LINK_CODE, normalizeServer, projectUris, useLinkCode } from '../src/backends/linked.js'
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
    port: 3001
}
const ANSWER = {
    issuer: LINK.issuer,
    apiUrl: LINK.apiUrl,
    accountUrl: LINK.accountUrl,
    client: { clientId: 'planner', name: 'Planner', type: 'public', scopes: LINK.scopes, firstParty: true },
    clientSecret: null
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

test('the backend choice "existing DafkeDD OIDC server" is registered, without a folder of its own', () => {
    assert.equal(backends.linked, linked)
    assert.equal(linked.dir, null)
    assert.match(linked.label, /Bestaande DafkeDD OIDC-server \(koppelcode\)/)
})

test('server addresses are typed in many ways; link codes like K7QM-2XPD-9HRT', () => {
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
    assert.ok(LINK_CODE.test('K7QM-2XPD-9HRT'))
    assert.ok(LINK_CODE.test('K7QM2XPD9HRT'))
    assert.ok(!LINK_CODE.test('K7QM-2XPD'))
})

test('the link code goes to POST /oidc/link with the addresses of the new frontend', async () => {
    const server = fakeServer()
    const link = await useLinkCode({ server: 'http://localhost:4000', code: 'K7QM-2XPD-9HRT', port: 3001, ...server })
    assert.equal(server.calls[0].url, 'http://localhost:4000/oidc/link')
    assert.deepEqual(server.calls[0].body, { code: 'K7QM-2XPD-9HRT', ...projectUris(3001) })
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

test('ask: server, port and the code; a wrong code is asked again with the reason', async () => {
    let tries = 0
    const fetchImpl = async () => {
        tries++
        return tries === 1
            ? { ok: false, status: 400, json: async () => ({ message: 'Deze koppelcode is onbekend' }) }
            : { ok: true, status: 200, json: async () => ANSWER }
    }
    const asked = []
    const prompts = {
        input: async config => {
            asked.push(config.message)
            if (config.message.startsWith('Adres')) return 'http://localhost:4000/oidc'
            if (config.message.startsWith('Op welke poort')) {
                assert.notEqual(await config.validate('4000'), true)
                return '3001'
            }
            // The prompt keeps asking until validate says yes
            assert.match(await config.validate('nonsense'), /K7QM-2XPD-9HRT/)
            assert.equal(await config.validate('aaaa-bbbb-cccc'), 'Deze koppelcode is onbekend')
            assert.equal(await config.validate('K7QM-2XPD-9HRT'), true)
            return 'K7QM-2XPD-9HRT'
        }
    }
    const answers = await linked.ask({ hasFrontend: true, prompts, fetchImpl })
    assert.equal(asked.length, 3)
    assert.deepEqual(answers.link, LINK)
    assert.deepEqual(linked.apiFor(answers), { port: 4000, url: 'http://localhost:4000', oidc: true, linked: LINK })
    assert.ok(linked.summary(answers)[0].text.includes('Gekoppeld aan http://localhost:4000/oidc'))
    // Without a frontend there is nothing to link
    const none = await linked.ask({ hasFrontend: false, prompts })
    assert.equal(none.link, null)
    assert.equal(linked.summary(none)[0].ok, false)
})

test('the linked frontend: login, session and profile only; account pages are on the frontend of the server', () => {
    const own = oidcFrontendFiles({ linked: true })
    assert.deepEqual(Object.keys(own).sort(), [...LINKED_FILES].sort())
    for (const page of ['register', 'security', 'members', 'admin', 'licenses', 'audit'])
        assert.ok(!Object.keys(own).some(rel => rel.includes(`/${page}/`)), page)
    assert.match(own['src/components/header-nav.tsx'], /ACCOUNT_URL \+ '\/security'/)
    assert.match(own['src/app/[locale]/profile/page.tsx'], /ACCOUNT_URL \+ '\/members'/)
    assert.ok(!own['src/app/[locale]/login/page.tsx'].includes('OidcLogin'))
    assert.match(own['src/lib/oidc.ts'], /OIDC_CLIENT_SECRET/)
    // The full frontend of the server itself is unchanged
    assert.ok(oidcFrontendFiles()['src/components/header-nav.tsx'].includes("href='/members'"))

    const all = withApi(
        { ...files },
        { port: 4000, url: 'http://localhost:4000', oidc: true, linked: LINK },
        { ui: false }
    )
    const page = all['src/app/[locale]/page.tsx']
    assert.ok(!page.includes('<ApiStatus />'), 'no status card of an API of its own (another origin)')
    assert.match(page, /<SessionLinks \/>/)
    assert.match(all['src/app/[locale]/layout.tsx'], /<HeaderNav \/>/)
    assert.match(all['src/lib/api.ts'], /'http:\/\/localhost:4000'/)
})

test('.env.local of a linked frontend: issuer, app, secret only when there is one, account pages, its own port', () => {
    const env = envLocal({ linked: LINK, secret: 'x'.repeat(64) })
    for (const line of [
        'OIDC_ISSUER=http://localhost:4000/oidc',
        'OIDC_CLIENT_ID=planner',
        'OIDC_ACCOUNT_URL=http://localhost:3000',
        'NEXT_PUBLIC_API_URL=http://localhost:4000',
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

test('main: a linked backend gives the frontend its API and logs no folder of its own', async () => {
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
        backendRegistry: { linked: { ...linked, ask: async () => ({ link: LINK }) } },
        execute: async () => {},
        log: line => logs.push(String(line))
    })
    assert.deepEqual(events[0], { port: 4000, url: 'http://localhost:4000', oidc: true, linked: LINK })
    assert.ok(!logs.some(line => line.includes('geïnstalleerd in ./null')))
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
    for (const text of ['## Login (linked to an existing login server)', 'OIDC_ACCOUNT_URL', 'http://localhost:3001'])
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
