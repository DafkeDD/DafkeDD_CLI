// Runs src/proxy.ts and src/lib/return-to.ts of the frontend of the simple login for real: Node strips their types,
// next-intl and next/server are small stand-ins, and `fetch` is the API (GET /auth/me).
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { files, LOGIN_PROXY, RETURN_TO, sitePages, uiFiles, withApi } from '../src/frontends/nextjs.js'
import { authFiles } from '../src/frontends/auth.js'

const STUBS = {
    'next-server.ts': `export class NextResponse extends Response {
    static redirect(url: URL | string) {
        return new NextResponse(null, { status: 307, headers: { location: String(url) } })
    }
    static next() {
        return new NextResponse(null, { status: 299 })
    }
}
`,
    'next-intl.ts': `export default function createMiddleware() {
    return () => new Response('page', { status: 200, headers: { 'x-intl': 'yes' } })
}
`,
    'routing.ts': 'export const routing = {}\n',
    'api.ts': "export const API_URL = 'http://api.test'\n"
}

async function run(t, cases) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-proxy-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    for (const [name, content] of Object.entries(STUBS)) await fs.writeFile(path.join(dir, name), content)
    await fs.writeFile(path.join(dir, 'return-to.ts'), RETURN_TO)
    await fs.writeFile(
        path.join(dir, 'proxy.ts'),
        LOGIN_PROXY.replace("from 'next-intl/middleware'", "from './next-intl.ts'")
            .replace("from 'next/server'", "from './next-server.ts'")
            .replace("from './i18n/routing'", "from './routing.ts'")
            .replace("from './lib/api'", "from './api.ts'")
            .replace("from './lib/return-to'", "from './return-to.ts'")
    )
    await fs.writeFile(
        path.join(dir, 'run.ts'),
        `import proxy from './proxy.ts'
import { safeReturn } from './return-to.ts'
let me: (init: RequestInit) => Promise<Response> = async () => new Response('{}', { status: 200 })
const asked: string[] = []
globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push(url + ' ' + (new Headers(init.headers).get('cookie') ?? '') + (init.signal ? '' : ' NO-TIMEOUT'))
    return me(init)
}) as typeof fetch
const request = (url: string, cookie?: string) => {
    const headers = new Headers(cookie ? { cookie } : {})
    const result = new Request(url, { headers }) as Request & { nextUrl: URL; cookies: { get(name: string): unknown } }
    result.nextUrl = new URL(url)
    result.cookies = { get: (name: string) => (cookie ?? '').split('; ').find(part => part.startsWith(name + '=')) }
    return result
}
const show = async (name: string, response: Response) => {
    console.log(JSON.stringify({ name, status: response.status, location: response.headers.get('location'), asked: asked.splice(0) }))
}
// A running server keeps the process alive (AbortSignal.timeout alone does not)
const alive = setInterval(() => {}, 1000)
${cases}
clearInterval(alive)
`
    )
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'run.ts'], {
        cwd: dir,
        encoding: 'utf8',
        // An API that never answers must end in the timeout of the proxy (3 s), never hang
        timeout: 20000
    })
    assert.equal(result.status, 0, result.stderr)
    return Object.fromEntries(
        result.stdout
            .trim()
            .split('\n')
            .map(line => JSON.parse(line))
            .map(entry => [entry.name, entry])
    )
}

const APP = 'http://app.test'

test('the frontend of the simple login gets the proxy that protects every page, and the login goes back', () => {
    const all = withApi(sitePages({ ...files, ...uiFiles }), { port: 4000, auth: true, oidc: false }, { ui: true })
    assert.equal(all['src/proxy.ts'], LOGIN_PROXY)
    assert.equal(all['src/lib/return-to.ts'], RETURN_TO)
    assert.match(LOGIN_PROXY, /export const PUBLIC_PATHS = \['\/login', '\/register'\]/)
    // The login form goes back to the page that asked for it (only a page of this app), else the profile
    assert.match(authFiles()['src/components/auth-form.tsx'], /^import \{ safeReturn \} from '@\/lib\/return-to'$/m)
    assert.match(
        authFiles()['src/components/auth-form.tsx'],
        /router\.push\(safeReturn\(new URLSearchParams\(window\.location\.search\)\.get\('returnTo'\)\) \?\? '\/profile'\)/
    )
    // A site without a login stays open: the plain next-intl proxy
    const site = withApi(sitePages({ ...files, ...uiFiles }), { port: 4000, auth: false, oidc: false }, { ui: true })
    assert.ok(!site['src/proxy.ts'].includes('PUBLIC_PATHS'))
    assert.equal(site['src/lib/return-to.ts'], undefined)
})

test('the proxy sends a page without a session to /login and back, and lets a logged in user in', async t => {
    const out = await run(
        t,
        `await show('home', await proxy(request('${APP}/')))
await show('apikeys', await proxy(request('${APP}/apikeys')))
await show('registerx', await proxy(request('${APP}/registerx')))
await show('login-help', await proxy(request('${APP}/login-help')))
await show('unsafe-page', await proxy(request('${APP}//evil.test')))
await show('api', await proxy(request('${APP}/api/health')))
await show('page', await proxy(request('${APP}/profile?tab=2')))
await show('logged-in', await proxy(request('${APP}/profile', 'session=abc; other=1')))
me = async () => new Response('{}', { status: 401 })
await show('expired', await proxy(request('${APP}/profile', 'session=old')))
me = async () => { throw new TypeError('fetch failed') }
await show('api-down', await proxy(request('${APP}/profile', 'session=abc')))
me = async () => new Response(null, { status: 302, headers: { location: '/elsewhere' } })
await show('redirected', await proxy(request('${APP}/profile', 'session=abc')))`
    )
    assert.equal(out.home.status, 307)
    assert.equal(out.home.location, `${APP}/login`)
    // Without a session cookie the API is not even asked
    assert.deepEqual(out.home.asked, [])
    assert.equal(out.page.location, `${APP}/login?returnTo=%2Fprofile%3Ftab%3D2`)
    // A page whose name starts with "api" is a page: protected; /api itself has its own checks (passed on)
    assert.equal(out.apikeys.location, `${APP}/login?returnTo=%2Fapikeys`)
    assert.equal(out.api.status, 299)
    // Only /login and /register themselves (and below them) are public, not a page that starts with their name
    assert.equal(out.registerx.location, `${APP}/login?returnTo=%2Fregisterx`)
    assert.equal(out['login-help'].location, `${APP}/login?returnTo=%2Flogin-help`)
    // A page path that would lead elsewhere is never put in returnTo
    assert.equal(out['unsafe-page'].location, `${APP}/login`)
    assert.deepEqual(out.api.asked, [])
    assert.equal(out['logged-in'].status, 200)
    // GET /auth/me with the cookie of the request
    assert.deepEqual(out['logged-in'].asked, ['http://api.test/auth/me session=abc; other=1'])
    // Fails closed: an expired session, an API that is down or answers anything but 200 is no login
    for (const name of ['expired', 'api-down', 'redirected']) {
        assert.equal(out[name].status, 307, name)
        assert.equal(out[name].location, `${APP}/login?returnTo=%2Fprofile`, name)
    }
})

test('the login and the registration are open, and send a logged in user on, only to a page of this app', async t => {
    const out = await run(
        t,
        `me = async () => new Response('{}', { status: 401 })
await show('login', await proxy(request('${APP}/login')))
await show('register', await proxy(request('${APP}/register', 'session=old')))
me = async () => new Response('{}', { status: 200 })
await show('back', await proxy(request('${APP}/login?returnTo=%2Fprofile%3Ftab%3D2', 'session=abc')))
await show('home', await proxy(request('${APP}/register', 'session=abc')))
for (const [name, value] of [['scheme', '//evil.test/x'], ['backslash', '/\\\\evil.test'], ['absolute', 'https://evil.test'], ['script', 'javascript:alert(1)'], ['tab', '/\\t/evil.test'], ['dots', '/..//evil.test'], ['encoded-dots', '/%2e%2e//evil.test'], ['mixed-dots', '/a/../..//evil.test']])
    await show(name, await proxy(request('${APP}/login?returnTo=' + encodeURIComponent(value), 'session=abc')))`
    )
    assert.equal(out.login.status, 200)
    assert.equal(out.register.status, 200)
    assert.equal(out.back.location, `${APP}/profile?tab=2`)
    assert.equal(out.home.location, `${APP}/`)
    for (const name of ['scheme', 'backslash', 'absolute', 'script', 'tab', 'dots', 'encoded-dots', 'mixed-dots'])
        assert.equal(out[name].location, `${APP}/`, name)
})

test('safeReturn: only a path of this app', async t => {
    const out = await run(
        t,
        `for (const [name, value] of [['path', '/profile?x=1'], ['empty', ''], ['none', null], ['double', '//evil.test'], ['backslash', '/\\\\evil.test'], ['absolute', 'https://evil.test'], ['relative', 'profile'], ['newline', '/\\n/evil.test'], ['long', '/' + 'a'.repeat(2001)], ['dots', '/..//evil.test'], ['encoded-dots', '/.%2e//evil.test'], ['normalised', '/a/../profile?x=1#top']] as [string, string | null][])
    console.log(JSON.stringify({ name, status: 0, location: safeReturn(value), asked: [] }))`
    )
    assert.equal(out.path.location, '/profile?x=1')
    // Resolved as the browser will: what stays in this app comes back normalised
    assert.equal(out.normalised.location, '/profile?x=1#top')
    for (const name of [
        'empty',
        'none',
        'double',
        'backslash',
        'absolute',
        'relative',
        'newline',
        'long',
        'dots',
        'encoded-dots'
    ])
        assert.equal(out[name].location, null, name)
})

test('the docs and CLAUDE.md of a project with the simple login say every page is protected', async () => {
    const { frontendReadme } = await import('../src/frontends/docs.js')
    const { describeProject, projectClaudeMd } = await import('../src/claude.js')
    const docs = frontendReadme({ api: { port: 4000, auth: true, oidc: false } }).replace(/\s+/g, ' ')
    assert.match(docs, /\*\*Every page is protected\*\*: `src\/proxy\.ts` asks `GET \/auth\/me` of the API/)
    assert.match(docs, /Only `PUBLIC_PATHS` \(`\/login`, `\/register`\) are open/)
    const login = describeProject({
        name: 'shop',
        frontend: { id: 'nextjs' },
        backend: { id: 'nestjs' },
        answers: { auth: true, database: { database: 'shop' } }
    })
    assert.match(
        projectClaudeMd(login).replace(/\s+/g, ' '),
        /\*\*Protected by default\*\*: every page needs a login; `frontend\/src\/proxy\.ts` asks `GET \/auth\/me` of the API/
    )
    // A site without a login: no such rule
    const site = describeProject({ name: 'site', frontend: { id: 'nextjs' } })
    assert.ok(!projectClaudeMd(site).includes('Protected by default'))
})

test('the proxy gives the API 3 seconds: an API that never answers is no login', async t => {
    const started = Date.now()
    const out = await run(
        t,
        `me = (init) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('timeout'))))
await show('hangs', await proxy(request('${APP}/profile', 'session=abc')))`
    )
    assert.equal(out.hangs.status, 307)
    assert.equal(out.hangs.location, `${APP}/login?returnTo=%2Fprofile`)
    assert.ok(!out.hangs.asked[0].includes('NO-TIMEOUT'), 'the call has a timeout')
    assert.ok(Date.now() - started < 15000, 'about 3 seconds, not more')
})
