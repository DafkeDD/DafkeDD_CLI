// Runs the generated /api route of the frontend of the simple login (src/app/api/[[...path]]/route.ts) for real: Node
// strips its types, `next/server` and `@/lib/api` are small stand-ins, and `fetch` is the API.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { API_ROUTE } from '../src/frontends/nextjs.js'

const NEXT_SERVER = `export class NextResponse extends Response {
    static json(body, init = {}) {
        return new NextResponse(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json' } })
    }
}
`

/** A run of the route in a child process: the cases are a script that prints one JSON line per case. */
async function run(t, cases, env = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-route-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    await fs.writeFile(path.join(dir, 'next-server.ts'), NEXT_SERVER)
    await fs.writeFile(path.join(dir, 'api.ts'), "export const API_URL = 'http://api.test'\n")
    await fs.writeFile(
        path.join(dir, 'route.ts'),
        API_ROUTE.replace("from 'next/server'", "from './next-server.ts'").replace(
            "from '@/lib/api'",
            "from './api.ts'"
        )
    )
    await fs.writeFile(
        path.join(dir, 'run.ts'),
        `import { GET, POST } from './route.ts'
const calls: { url: string; headers: Record<string, string>; body: string | null }[] = []
let answer: () => Promise<Response> = async () => {
    const headers = new Headers({ 'content-type': 'application/json' })
    headers.append('set-cookie', 'session=a; Path=/; HttpOnly; SameSite=Lax')
    headers.append('set-cookie', 'other=b; Path=/')
    return new Response('{"ok":true}', { status: 200, headers })
}
globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = init.body ? new TextDecoder().decode(init.body as Uint8Array) : null
    calls.push({ url, headers: Object.fromEntries(new Headers(init.headers)), body })
    return answer()
}) as typeof fetch
const request = (method: string, url: string, headers: Record<string, string> = {}, body?: string) => {
    const result = new Request(url, { method, headers, body }) as Request & { nextUrl: URL }
    result.nextUrl = new URL(url)
    return result
}
const params = (path: string[]) => ({ params: Promise.resolve({ path }) })
const show = async (name: string, response: Response) => {
    const call = calls.pop() ?? null
    calls.length = 0
    console.log(JSON.stringify({
        name,
        status: response.status,
        body: await response.text(),
        cookies: response.headers.getSetCookie(),
        nosniff: response.headers.get('x-content-type-options'),
        csp: response.headers.get('content-security-policy'),
        call
    }))
}
${cases}
`
    )
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'run.ts'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, TRUSTED_PROXIES: '', API_PROXY_SECRET: '', ...env }
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

test('the /api route passes a call on to the API, with the cookie, and every Set-Cookie back', async t => {
    const out = await run(
        t,
        `await show('get', await GET(request('GET', '${APP}/api/auth/me?x=1', { cookie: 'session=a', 'accept-language': 'nl', 'x-forwarded-for': '6.6.6.6' }), params(['auth', 'me'])))
await show('post', await POST(request('POST', '${APP}/api/auth/login', { origin: '${APP}', 'content-type': 'application/json' }, '{"email":"a@b.c"}'), params(['auth', 'login'])))
await show('root', await GET(request('GET', '${APP}/api'), params([])))`
    )
    assert.equal(out.get.status, 200)
    assert.equal(out.get.call.url, 'http://api.test/auth/me?x=1')
    assert.equal(out.get.call.headers.cookie, 'session=a')
    assert.equal(out.get.call.headers['accept-language'], 'nl')
    // Never the X-Forwarded-For of the browser: it can write anything there
    assert.equal(out.get.call.headers['x-forwarded-for'], undefined)
    assert.equal(out.get.call.headers['x-client-address'], undefined)
    assert.deepEqual(out.get.cookies, ['session=a; Path=/; HttpOnly; SameSite=Lax', 'other=b; Path=/'])
    assert.equal(out.get.nosniff, 'nosniff')
    assert.equal(out.get.csp, "sandbox; default-src 'none'")
    assert.equal(out.post.status, 200)
    assert.equal(out.post.call.body, '{"email":"a@b.c"}')
    assert.equal(out.root.call.url, 'http://api.test/')
})

test('the /api route refuses a change from another site, and accepts the address of a proxy in front', async t => {
    const out = await run(
        t,
        `const login = (name: string, headers: Record<string, string>) => POST(request('POST', '${APP}/api/auth/login', headers, '{}'), params(['auth', 'login'])).then(r => show(name, r))
await login('none', {})
await login('foreign', { origin: 'https://evil.test' })
await login('own', { origin: '${APP}' })
await login('proxy', { origin: 'https://shop.example.com', 'x-forwarded-host': 'shop.example.com, inner.test', 'x-forwarded-proto': 'https' })
await login('proxy-last', { origin: 'https://inner.test', 'x-forwarded-host': 'shop.example.com, inner.test' })
await login('proxy-http', { origin: 'http://shop.example.com', 'x-forwarded-host': 'shop.example.com' })
await login('proxy-foreign', { origin: 'https://evil.test', 'x-forwarded-host': 'shop.example.com' })
await show('get-foreign', await GET(request('GET', '${APP}/api/health', { origin: 'https://evil.test' }), params(['health'])))`
    )
    for (const name of ['none', 'foreign', 'proxy-last', 'proxy-http', 'proxy-foreign']) {
        assert.equal(out[name].status, 403, name)
        assert.equal(out[name].call, null, `${name}: never reaches the API`)
        assert.deepEqual(JSON.parse(out[name].body), { error: 'origin' })
        assert.equal(out[name].nosniff, 'nosniff', name)
    }
    assert.equal(out.own.status, 200)
    assert.equal(out.proxy.status, 200)
    // Reading changes nothing: no Origin needed
    assert.equal(out['get-foreign'].status, 200)
})

test('the /api route never leaves the path of the API, nor serves its documentation page', async t => {
    const out = await run(
        t,
        `for (const [name, parts] of [['dotdot', ['..', 'etc']], ['dot', ['.', 'x']], ['empty', ['a', '', 'b']], ['backslash', ['a\\\\b']], ['docs', ['docs']], ['Docs', ['Docs']], ['docs-json', ['docs-json']], ['docs-yaml', ['DOCS-YAML']]] as [string, string[]][])
    await show(name, await GET(request('GET', '${APP}/api/x'), params(parts)))
await show('encoded', await GET(request('GET', '${APP}/api/x'), params(['a/b@evil.test:1'])))`
    )
    for (const name of ['dotdot', 'dot', 'empty', 'backslash', 'docs', 'Docs', 'docs-json', 'docs-yaml']) {
        assert.equal(out[name].status, 404, name)
        assert.equal(out[name].call, null, `${name}: never reaches the API`)
        assert.deepEqual(JSON.parse(out[name].body), { error: 'not-found' })
    }
    assert.equal(out.encoded.call.url, 'http://api.test/a%2Fb%40evil.test%3A1')
})

test('the /api route: offline when the API is down or slow, 413 for a body that is too large', async t => {
    const out = await run(
        t,
        `answer = async () => { throw new TypeError('fetch failed') }
await show('down', await GET(request('GET', '${APP}/api/health'), params(['health'])))
const big = 'x'.repeat(1_000_001)
await show('large', await POST(request('POST', '${APP}/api/auth/login', { origin: '${APP}' }, big), params(['auth', 'login'])))
await show('large-length', await POST(request('POST', '${APP}/api/auth/login', { origin: '${APP}', 'content-length': '5000000' }, '{}'), params(['auth', 'login'])))`
    )
    assert.equal(out.down.status, 502)
    assert.deepEqual(JSON.parse(out.down.body), { error: 'offline' })
    assert.equal(out.large.status, 413)
    assert.equal(out.large.call, null)
    assert.deepEqual(JSON.parse(out.large.body), { error: 'too-large' })
    assert.equal(out['large-length'].status, 413)
})

test('the /api route passes the address of the browser on only from a trusted proxy, with the secret', async t => {
    const cases = `await show('chain', await GET(request('GET', '${APP}/api/me', { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }), params(['me'])))
await show('none', await GET(request('GET', '${APP}/api/me'), params(['me'])))
await show('junk', await GET(request('GET', '${APP}/api/me', { 'x-forwarded-for': 'not an address' }), params(['me'])))`
    // One proxy in front (Cloud Run): the last address of the chain is the one it saw
    const trusted = await run(t, cases, { TRUSTED_PROXIES: '1', API_PROXY_SECRET: 'shared' })
    assert.equal(trusted.chain.call.headers['x-client-address'], '203.0.113.7')
    assert.equal(trusted.chain.call.headers['x-proxy-secret'], 'shared')
    assert.equal(trusted.chain.call.headers['x-forwarded-for'], undefined)
    assert.equal(trusted.none.call.headers['x-client-address'], undefined)
    assert.equal(trusted.junk.call.headers['x-client-address'], undefined)
    // No proxy in front (the default): nothing, the browser could have written the chain itself
    const direct = await run(t, cases, { API_PROXY_SECRET: 'shared' })
    assert.equal(direct.chain.call.headers['x-client-address'], undefined)
    assert.equal(direct.chain.call.headers['x-proxy-secret'], undefined)
    // Without the secret: nothing either
    const noSecret = await run(t, cases, { TRUSTED_PROXIES: '1' })
    assert.equal(noSecret.chain.call.headers['x-client-address'], undefined)
})
