import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFiles } from '../src/backends/nestjs.js'
import { files, loginEnvLocal, uiFiles, sitePages, withApi } from '../src/frontends/nextjs.js'
import { frontendReadme } from '../src/frontends/docs.js'

const DB = {
    id: 'postgres',
    mode: 'docker',
    host: 'localhost',
    port: 5432,
    user: 'app',
    password: 'pw',
    database: 'demo',
    project: 'demo'
}
const SITE = sitePages({ ...files, ...uiFiles })
const ROUTE = 'src/app/api/[[...path]]/route.ts'
const login = withApi(SITE, { port: 4000, auth: true, oidc: false }, { ui: true })
const apiOnly = withApi(SITE, { port: 4000, auth: false, oidc: false }, { ui: true })

test('the frontend of the simple login calls its API through /api on its own host', () => {
    const api = login['src/lib/api.ts']
    // The server knows where the API is (API_URL, then the old NEXT_PUBLIC_API_URL, then the local API)
    assert.match(
        api,
        /export const API_URL = process\.env\.API_URL \?\? process\.env\.NEXT_PUBLIC_API_URL \?\? 'http:\/\/localhost:4000'/
    )
    // The browser calls /api of this frontend, so the session cookie belongs to the frontend
    assert.match(api, /const BASE = typeof window === 'undefined' \? API_URL : '\/api'/)
    assert.match(api, /fetch\(BASE \+ path, \{ \.\.\.init, headers, credentials: 'same-origin' \}\)/)
    // An answer of /api itself (offline, a refused origin, a path out of the API) is never shown as an English status
    // text: the screens show their own translated text
    assert.match(api, /const ROUTE_ERRORS = \['offline', 'origin', 'not-found', 'too-large'\]/)
    assert.match(
        api,
        /if \(typeof body\?\.error === 'string' && ROUTE_ERRORS\.includes\(body\.error\)\) throw new TypeError\(body\.error\)/
    )
    // ...and the route answers exactly those codes
    for (const code of ['offline', 'origin', 'not-found', 'too-large'])
        assert.match(login[ROUTE], new RegExp(`error: '${code}'`), code)
})

test('/api of the frontend passes every call on to the API, with the cookie and its Set-Cookie', () => {
    const route = login[ROUTE]
    assert.ok(route, 'the route in the frontend of the simple login')
    assert.match(route, /import \{ API_URL \} from '@\/lib\/api'/)
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
        assert.match(route, new RegExp(`export const ${method} = forward`), method)
    // The cookie, the language and the body go along; the answer comes back with its Set-Cookie (the login)
    assert.match(route, /'cookie'/)
    assert.match(route, /'accept-language'/)
    assert.match(route, /getSetCookie\(\)/)
    assert.match(route, /result\.headers\.append\('set-cookie', cookie\)/)
    // Only the API itself: never another host, never a step out of its path
    assert.match(route, /part === '\.\.'/)
    assert.match(route, /encodeURIComponent/)
    assert.match(route, /redirect: 'manual'/)
    // A change (POST, PUT, PATCH, DELETE) comes from a page of this app: another site cannot use the cookie
    assert.match(route, /if \(origin === null\) return false/)
    assert.match(route, /if \(origin === new URL\(request\.url\)\.origin\) return true/)
    // Behind a reverse proxy: the address it passed on
    assert.match(route, /return Boolean\(host\) && origin === proto \+ ':\/\/' \+ host/)
    assert.match(route, /status: 403/)
    // Never the X-Forwarded-For of the browser (it can write anything there): only the address a trusted proxy in front
    // of the frontend saw (TRUSTED_PROXIES, default 0: none), with the secret shared with the API
    assert.ok(!/headers\.set\('x-forwarded-for'/.test(route), 'the X-Forwarded-For of the browser is not passed on')
    assert.ok(!/'x-forwarded-for'\]/.test(route))
    assert.match(
        route,
        /const TRUSTED_PROXIES = Math\.max\(0, Math\.floor\(Number\(process\.env\.TRUSTED_PROXIES \?\? 0\)\) \|\| 0\)/
    )
    assert.match(route, /if \(!TRUSTED_PROXIES\) return null/)
    assert.match(route, /const address = chain\[chain\.length - TRUSTED_PROXIES\]/)
    assert.match(
        route,
        /if \(address && PROXY_SECRET\) \{\n\s+headers\.set\('x-client-address', address\)\n\s+headers\.set\('x-proxy-secret', PROXY_SECRET\)/
    )
    // Never read as another type, never run as a page of this app; not the documentation page of the API
    assert.match(route, /result\.headers\.set\('x-content-type-options', 'nosniff'\)/)
    assert.match(route, /result\.headers\.set\('content-security-policy', "sandbox; default-src 'none'"\)/)
    assert.match(route, /\/\^docs\(-json\|-yaml\)\?\$\/i\.test\(parts\[0\] \?\? ''\)/)
    assert.equal(route.match(/return safe\(/g).length, 5, 'every answer is made safe')
    // At most MAX_BODY bytes (413), and an API that does not answer in time is offline
    assert.match(route, /const MAX_BODY = 1_000_000/)
    assert.match(route, /if \(size > MAX_BODY\) \{/)
    assert.match(route, /\{ error: 'too-large' \}, \{ status: 413 \}/)
    assert.match(route, /signal: AbortSignal\.timeout\(TIMEOUT_MS\)/)
    // Cache Components (Next.js 16) does not allow route segment config
    assert.ok(!/export const dynamic/.test(route), 'no dynamic config')
    // Without the API: 502 offline
    assert.match(route, /\{ error: 'offline' \}, \{ status: 502 \}/)
})

test('a frontend without the simple login keeps calling its API directly', () => {
    assert.equal(apiOnly[ROUTE], undefined)
    assert.match(apiOnly['src/lib/api.ts'], /fetch\(API_URL \+ path/)
    assert.ok(!apiOnly['src/lib/api.ts'].includes("'/api'"))
})

const AUTH = { jwtSecret: 'x'.repeat(64), proxySecret: 'p'.repeat(64) }

test('the API of the simple login reads TRUST_PROXY as Express means it', () => {
    const setup = buildFiles(DB, { auth: AUTH })['src/setup.ts']
    assert.match(setup, /\.set\('trust proxy', trustProxy\(config\.get<string>\('TRUST_PROXY'\)\)\)/)
    // Empty is loopback, true/false booleans, digits a number of proxies (Cloud Run: 1), the rest addresses
    assert.match(setup, /if \(!setting\) return 'loopback'/)
    assert.match(setup, /if \(setting === 'true' \|\| setting === 'false'\) return setting === 'true'/)
    assert.match(setup, /return \/\^\\d\+\$\/\.test\(setting\) \? Number\(setting\) : setting/)
    // The httpOnly, SameSite=Lax cookie and CORS for direct calls stay
    assert.match(setup, /app\.enableCors\(/)
    // Without the login nothing changes
    assert.ok(!buildFiles(DB)['src/setup.ts'].includes('trust proxy'))
})

test('the rate limit of the login counts per address and per account; the frontend address only with the secret', () => {
    const backend = buildFiles(DB, { auth: AUTH })
    const guard = backend['src/auth/auth-throttler.guard.ts']
    assert.ok(guard, 'the guard of the login')
    assert.match(guard, /export class AuthThrottlerGuard extends ThrottlerGuard/)
    // The address the frontend passes on counts only with the shared secret, compared in constant time
    assert.match(guard, /timingSafeEqual\(createHash\('sha256'\)/)
    assert.match(
        guard,
        /if \(secret && typeof given === 'string' && same\(given, secret\) && typeof address === 'string' && isIP\(address\)\)/
    )
    assert.match(guard, /return addressBucket\(String\(request\.ip \?\? ''\)\);/)
    // The placeholder of .env.example (or a short secret) is never a secret
    assert.match(guard, /return secret\.length >= 32 && secret !== EXAMPLE_SECRET \? secret : ''/)
    assert.match(guard, /const EXAMPLE_SECRET = 'change-me-to-a-long-random-string'/)
    // An IPv6 address counts by its /64
    assert.match(guard, /return groups\.slice\(0, 4\)/)
    // Per account: the email address, so another address never gives one account more tries
    assert.match(guard, /if \(name !== 'account'\) return super\.generateKey\(context, suffix, name\)/)
    assert.match(
        guard,
        /'account:' \+ \(typeof email === 'string' \? email\.trim\(\)\.toLowerCase\(\)\.slice\(0, 254\) : ''\)/
    )
    const module = backend['src/auth/auth.module.ts']
    assert.match(module, /\{ name: 'address', ttl: 60_000, limit \}/)
    // One address alone never locks an account out: the account limit is higher (five times by default)
    // An empty value (the line of .env uncommented) is the default, never 0
    assert.match(module, /return number > 0 \? number : fallback;/)
    assert.match(module, /const limit = positive\(config\.get<string>\('AUTH_RATE_LIMIT'\), 10\);/)
    assert.match(module, /const account = positive\(config\.get<string>\('AUTH_ACCOUNT_RATE_LIMIT'\), limit \* 5\);/)
    assert.match(module, /\{ name: 'account', ttl: 60_000, limit: account \}/)
    assert.match(module, /providers: \[AuthService, AuthGuard, AuthThrottlerGuard\]/)
    // The secret in .env (made by the CLI), a placeholder in .env.example, TRUST_PROXY commented out
    assert.match(backend['.env'], new RegExp(`^API_PROXY_SECRET='${'p'.repeat(64)}'$`, 'm'))
    assert.match(backend['.env.example'], /^API_PROXY_SECRET='change-me-to-a-long-random-string'$/m)
    assert.match(backend['.env'], /^# TRUST_PROXY=loopback$/m)
    // The generated tests check it in the running API
    const e2e = backend['test/auth.e2e-spec.ts']
    assert.match(e2e, /a forged X-Client-Address without the secret does not escape the limit/)
    assert.match(e2e, /another address never gives one account more tries/)
    assert.match(e2e, /the frontend with the secret: every browser its own limit/)
    assert.match(e2e, /the placeholder of \.env\.example is never a secret/)
    assert.match(e2e, /one address alone cannot lock an account out/)
    assert.match(e2e, /an IPv6 address counts by its \/64/)
    assert.match(e2e, /an empty or invalid limit is the default, never 0/)
    assert.match(e2e, /\['2001:db8::1', '2001:db8:0:0::\/64'\]/)
    assert.match(e2e, /describe\('TRUST_PROXY'/)
})

test('.env.local of the frontend of the simple login has the API, the shared secret and no trusted proxy', () => {
    const env = loginEnvLocal({ port: 4000, proxySecret: 'p'.repeat(64) })
    assert.match(env, /^API_URL=http:\/\/localhost:4000$/m)
    assert.match(env, new RegExp(`^API_PROXY_SECRET=${'p'.repeat(64)}$`, 'm'))
    assert.match(env, /^TRUSTED_PROXIES=0$/m)
})

test('the frontend docs of the simple login say the API is reached through /api', () => {
    const flat = frontendReadme({ api: { port: 4000, auth: true, oidc: false } }).replace(/\s+/g, ' ')
    assert.match(flat, /`\/api\/<path>` of this frontend/)
    assert.match(flat, /`API_URL`/)
    assert.match(flat, /\| `API_PROXY_SECRET` \|/)
    assert.match(flat, /\| `TRUSTED_PROXIES` \|/)
})

test('the API docs of the simple login describe /api of the frontend and TRUST_PROXY', async () => {
    const readme = buildFiles(DB, { auth: { jwtSecret: 'x'.repeat(64) } })['README.md'].replace(/\s+/g, ' ')
    assert.match(readme, /The frontend calls this API through `\/api` on its own host/)
    assert.match(readme, /\| `TRUST_PROXY` \| `?loopback`? \|/)
    assert.match(readme, /\| `API_PROXY_SECRET` \| `?\(generated\)`? \|/)
    assert.match(readme, /per address of the browser \(an IPv6 address by its \/64\)/)
    assert.match(readme, /\| `AUTH_ACCOUNT_RATE_LIMIT` \|/)
    // Never the advice to trust every proxy (true: the first address of the chain, which the browser chooses)
    assert.ok(!/`true` when only the frontend/.test(readme))
})
