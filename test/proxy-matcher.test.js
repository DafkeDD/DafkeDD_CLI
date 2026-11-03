// The matcher of every proxy (#59): which paths reach the proxy, and so its login. A matcher that skips a
// path by a prefix ("api") lets every page that starts with it (/apikeys) past the login.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { files, LOGIN_PROXY } from '../src/frontends/nextjs.js'
import { oidcFrontendFiles } from '../src/frontends/oidc.js'

/** The matcher of a proxy.ts as the regular expression Next.js makes of it (the whole path). */
function matcher(proxy) {
    const source = /matcher:\s*'([^']+)'/.exec(proxy)?.[1]
    assert.ok(source, 'a matcher')
    return new RegExp(`^${source.replaceAll('\\\\', '\\')}$`)
}

const PROXIES = {
    'login server': oidcFrontendFiles()['src/proxy.ts'],
    'linked app': oidcFrontendFiles({ linked: true, appName: 'Planner' })['src/proxy.ts'],
    'simple login': LOGIN_PROXY,
    // A site or an API frontend: no login, but every page gets its language
    site: files['src/proxy.ts']
}

test('every proxy sees every page, also one that starts with "api" or "trpc"', () => {
    for (const [name, proxy] of Object.entries(PROXIES)) {
        const reaches = matcher(proxy)
        for (const page of ['/', '/apikeys', '/api-docs', '/trpcs', '/admin/tenants', '/nl/apikeys'])
            assert.ok(reaches.test(page), `${name}: ${page}`)
        // Only the files of Next.js and a path with a dot (a file) never reach it
        for (const file of ['/_next/static/x.js', '/_vercel/insights', '/favicon.ico'])
            assert.ok(!reaches.test(file), `${name}: ${file}`)
    }
})

test('the routes of /api are let through by the proxy itself, never by a prefix of the matcher', () => {
    for (const [name, proxy] of Object.entries(PROXIES))
        assert.match(
            proxy,
            /if \(pathname === '\/api' \|\| pathname\.startsWith\('\/api\/'\)\) return NextResponse\.next\(\)/,
            name
        )
})

/** Runs the proxy of the login server (or of a linked app) for real, without a session: Node strips its types. */
function runOidcProxy(t, proxy, paths) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dafkedd-oidc-proxy-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const stubs = {
        'next-server.ts': `export class NextResponse extends Response {
    cookies = { delete() {}, set() {} }
    static redirect(url: URL | string) {
        return new NextResponse(null, { status: 307, headers: { location: String(url) } })
    }
    static next() {
        return new NextResponse(null, { status: 299 })
    }
}
`,
        'next-intl.ts': `export default function createMiddleware() {
    return () => Object.assign(new Response('page', { status: 200 }), { cookies: { delete() {}, set() {} } })
}
`,
        'routing.ts': 'export const routing = {}\n',
        'oidc.ts':
            "export const SESSION_COOKIE = 'pp_session'\nexport const SESSION_SECONDS = 1\nexport const cookieOptions = () => ({})\n",
        'refresh.ts': 'export async function freshSession() {\n    return { session: null, cookie: null }\n}\n'
    }
    for (const [name, content] of Object.entries(stubs)) writeFileSync(path.join(dir, name), content)
    writeFileSync(
        path.join(dir, 'proxy.ts'),
        proxy
            .replace("from 'next-intl/middleware'", "from './next-intl.ts'")
            .replace("from 'next/server'", "from './next-server.ts'")
            .replace("from './i18n/routing'", "from './routing.ts'")
            .replace("from './lib/oidc'", "from './oidc.ts'")
            .replace("from './lib/refresh'", "from './refresh.ts'")
    )
    writeFileSync(
        path.join(dir, 'run.ts'),
        `import proxy from './proxy.ts'
for (const path of ${JSON.stringify(paths)}) {
    const url = 'http://app.test' + path
    const request = Object.assign(new Request(url), {
        nextUrl: new URL(url),
        cookies: { get: () => undefined, delete() {}, set() {} }
    })
    const response = await proxy(request as never)
    console.log(JSON.stringify({ path, status: response.status, location: response.headers.get('location') }))
}
`
    )
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'run.ts'], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 20000
    })
    assert.equal(result.status, 0, result.stderr)
    return Object.fromEntries(
        result.stdout
            .trim()
            .split('\n')
            .map(line => JSON.parse(line))
            .map(entry => [entry.path, entry])
    )
}

test('the login server and a linked app send /apikeys without a session to /login, and let /api/ through', t => {
    for (const name of ['login server', 'linked app']) {
        const out = runOidcProxy(t, PROXIES[name], ['/apikeys', '/api-docs', '/api/auth/login', '/api', '/login'])
        assert.equal(out['/apikeys'].location, 'http://app.test/login?returnTo=%2Fapikeys', name)
        assert.equal(out['/api-docs'].location, 'http://app.test/login?returnTo=%2Fapi-docs', name)
        // The routes of /api check the session themselves: passed on, never sent to the login
        assert.equal(out['/api/auth/login'].status, 299, name)
        assert.equal(out['/api'].status, 299, name)
        // A public page is shown
        assert.equal(out['/login'].status, 200, name)
    }
})
