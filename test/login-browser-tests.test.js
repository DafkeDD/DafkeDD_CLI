import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { authFiles, LOGIN_E2E_FILES } from '../src/frontends/auth.js'
import {
    E2E_IGNORED,
    E2E_PACKAGES,
    files as nextFiles,
    hasBrowserTests,
    nextjs,
    sitePages,
    uiFiles,
    withApi
} from '../src/frontends/nextjs.js'
import { oidcFrontendFiles } from '../src/frontends/oidc.js'
import { updatePackages } from '../src/update-code.js'
import { frontendReadme } from '../src/frontends/docs.js'
import { ciWorkflow, projectClaudeFiles, screenshotsWorkflow } from '../src/claude.js'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const site = () => sitePages({ ...nextFiles, ...uiFiles })
const login = withApi(site(), { port: 4000, auth: true }, { ui: true })

test('the simple login gets its browser tests; a site, an API, the login server and a linked app not these', () => {
    assert.deepEqual(LOGIN_E2E_FILES, [
        'playwright.config.ts',
        'e2e/env.ts',
        'e2e/account.ts',
        'e2e/global-teardown.ts',
        'e2e/login.spec.ts',
        'e2e/pages.spec.ts'
    ])
    for (const rel of LOGIN_E2E_FILES) {
        assert.equal(authFiles()[rel], read(`templates/frontend-login/${rel}`), rel)
        assert.equal(login[rel], read(`templates/frontend-login/${rel}`), rel)
    }
    assert.equal(withApi(site(), { port: 4000 }, { ui: true })['e2e/login.spec.ts'], undefined)
    assert.equal(oidcFrontendFiles()['e2e/login.spec.ts'], undefined)
    assert.equal(oidcFrontendFiles({ linked: true, appName: 'Planner' })['e2e/login.spec.ts'], undefined)
    assert.equal(hasBrowserTests(null), false)
    assert.equal(hasBrowserTests({ port: 4000 }), false)
    assert.equal(hasBrowserTests({ port: 4000, auth: true }), true)
    assert.equal(hasBrowserTests({ port: 4000, oidc: true }), false)
    assert.equal(hasBrowserTests({ port: 4000, oidc: true, linked: { name: 'Planner' } }), true)
})

test('playwright.config.ts starts the built API and frontend, with secrets of the run, and removes its accounts', () => {
    const config = login['playwright.config.ts']
    assert.match(config, /cwd: '\.\.\/backend'/)
    assert.match(config, /command: build\('node dist\/main'\)/)
    assert.match(config, /command: build\(`npx next start -p \$\{PORT\}`\)/)
    assert.match(config, /process\.env\.E2E_NO_BUILD \? start : `npm run build && \$\{start\}`/)
    // Secrets only for this run, made once (the workers inherit them), never those of .env
    // The run id goes into the LIKE pattern of the teardown: only 12 hex characters
    assert.match(
        config,
        /if \(!\/\^\[0-9a-f\]\{12\}\$\/\.test\(process\.env\.E2E_RUN \?\? ''\)\) process\.env\.E2E_RUN = randomBytes\(6\)\.toString\('hex'\)/
    )
    for (const name of ['E2E_JWT_SECRET', 'E2E_PROXY_SECRET'])
        assert.match(config, new RegExp(`process\\.env\\.${name} \\?\\?= randomBytes\\(\\d+\\)\\.toString\\('hex'\\)`))
    assert.match(config, /JWT_SECRET: env\.E2E_JWT_SECRET/)
    assert.equal(config.match(/API_PROXY_SECRET: env\.E2E_PROXY_SECRET/g)?.length, 2)
    assert.match(config, /API_URL: `http:\/\/127\.0\.0\.1:\$\{API_PORT\}`/)
    assert.match(config, /AUTH_RATE_LIMIT: '1000'/)
    assert.match(config, /globalTeardown: '\.\/e2e\/global-teardown\.ts'/)
    assert.equal(config.match(/reuseExistingServer: false/g)?.length, 2)
    // Every test account of the run, and only those, goes away again
    const teardown = login['e2e/global-teardown.ts']
    assert.match(teardown, /createRequire\(path\.resolve\('\.\.\/backend\/package\.json'\)\)\('pg'\)/)
    assert.match(teardown, /readEnv\('\.\.\/backend\/\.env'\), \.\.\.process\.env/)
    assert.match(teardown, /`\$\{env\.DATABASE_NAME\}users`/)
    assert.match(
        teardown,
        /DELETE FROM "\$\{table\}" WHERE lower\(email\) LIKE \$1`, \[`\$\{accountPrefix\(\)\}%@example\.com`\]/
    )
    assert.match(login['e2e/env.ts'], /export const accountPrefix = \(\) => `e2e-\$\{process\.env\.E2E_RUN\}-`/)
    assert.match(login['e2e/account.ts'], /export const newEmail = \(\) => `\$\{accountPrefix\(\)\}/)
    assert.match(login['e2e/account.ts'], /api\.post\('\/api\/auth\/register'/)
    assert.match(login['e2e/account.ts'], /headers: \{ origin: baseURL \}/)
})

test('the login specs: register, log out and in again, a wrong password, returnTo, every page needs the login', () => {
    const spec = login['e2e/login.spec.ts']
    for (const line of [
        "page.goto('/register')",
        "getByRole('button', { name: t.register, exact: true }).click()",
        "getByRole('button', { name: t.logout, exact: true }).click()",
        "url.pathname === '/login' && url.searchParams.get('returnTo') === '/profile'",
        "getByRole('button', { name: t.login, exact: true }).click()",
        "page.locator('.card').getByText(email)).toBeVisible()",
        "fill('not the password')",
        "page.getByRole('alert')).toBeVisible()",
        "page.getByRole('alert')).not.toHaveText(t.offline)",
        "encodeURIComponent('//evil.example.com')",
        "url.origin === new URL(baseURL!).origin && url.pathname === '/profile'",
        "['/', '/login'],",
        "['/profile', '/login?returnTo=%2Fprofile']",
        'expect(answer.status(), path).toBe(307)',
        'expect(to.pathname + to.search, path).toBe(login)',
        "for (const path of ['/login', '/register']) expect((await request.get(path)).status(), path).toBe(200)",
        "page.goto('/login?returnTo=%2Fprofile')",
        "url.pathname === '/')"
    ])
        assert.ok(spec.includes(line), line)
    assert.equal(spec.match(/toHaveURL\(url => url\.pathname === '\/profile'\)/g)?.length, 3)
})

test('the page specs: every page of APP_NAV, the profile, the login and the registration, four languages, themes, phone, axe', () => {
    const pages = login['e2e/pages.spec.ts']
    for (const line of [
        "const PAGES = [...APP_NAV.map(item => item.href), '/profile']",
        "const PUBLIC = { '/login': 'loginTitle', '/register': 'registerTitle' } as const",
        'const MESSAGES = { en, nl, fr, de }',
        ".withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])",
        ".join(', ')}`)).toEqual([])",
        "toHaveAttribute('lang', locale)",
        "for (const theme of ['light', 'dark'])",
        "toHaveAttribute('data-theme', theme)",
        'setViewportSize({ width: 390, height: 844 })',
        'document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)',
        'await logIn(context, baseURL!)',
        "page.locator('.page-head')).toBeVisible()",
        "getByRole('link', { name: messages.Nav[item.label as keyof typeof messages.Nav] }).first()",
        "getByRole('heading', { name: messages.Auth[title], exact: true })).toBeVisible()",
        'await expect(page).toHaveURL(url => url.pathname === path)'
    ])
        assert.ok(pages.includes(line), line)
    // Both themes and the phone run axe; every page and every open page goes through everyWay
    assert.equal(pages.match(/await accessible\(page\)/g)?.length, 2)
    assert.equal(pages.match(/everyWay\(path, /g)?.length, 2)
    // The open pages are PUBLIC_PATHS of the proxy
    const proxy = login['src/proxy.ts']
    assert.match(proxy, /export const PUBLIC_PATHS = \['\/login', '\/register'\]/)
})

test('the frontend steps of the simple login install Playwright and axe and add test:e2e', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-e2e-login-'))
    try {
        const ran = []
        const steps = await nextjs.steps({
            projectDir: dir,
            answers: { ui: 'all' },
            api: { port: 4000, auth: true, oidc: false, proxySecret: 'x'.repeat(64) },
            exec: async (command, args) => ran.push(`${command} ${args.join(' ')}`)
        })
        const step = steps.find(s => s.title === 'Browsertests installeren (Playwright, axe)')
        assert.ok(step, 'the step')
        await fs.mkdir(path.join(dir, 'frontend'), { recursive: true })
        await step.run()
        assert.ok(ran.includes(`npm install --save-dev ${E2E_PACKAGES.join(' ')}`))
        const ignore = await fs.readFile(path.join(dir, 'frontend', '.gitignore'), 'utf8')
        for (const line of E2E_IGNORED) assert.match(ignore, new RegExp(`^${line}$`, 'm'))
        // An API without the login has none
        const other = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-e2e-api-'))
        const api = await nextjs
            .steps({ projectDir: other, answers: { ui: 'all' }, api: { port: 4000 }, exec: async () => {} })
            .finally(() => fs.rm(other, { recursive: true, force: true }))
        assert.ok(!api.some(s => s.title.startsWith('Browsertests')))
    } finally {
        await fs.rm(dir, { recursive: true, force: true })
    }
})

test('update gives an existing simple login the packages, the script and the ignore lines', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-e2e-login-update-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    await fs.mkdir(path.join(dir, 'frontend'), { recursive: true })
    await fs.writeFile(
        path.join(dir, 'frontend', 'package.json'),
        JSON.stringify({ name: 'frontend', scripts: { build: 'next build' }, devDependencies: {} }, null, 4) + '\n'
    )
    const installed = []
    await updatePackages({
        projectDir: dir,
        project: { name: 'shop', frontend: true, backend: true, kind: 'login' },
        exec: async (command, args, options) => installed.push([command, args.join(' '), options.cwd])
    })
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'frontend', 'package.json'), 'utf8'))
    assert.equal(pkg.scripts['test:e2e'], 'playwright test')
    assert.ok(installed.some(([, args]) => args === `install --save-dev ${E2E_PACKAGES.join(' ')}`))
    const ignore = await fs.readFile(path.join(dir, 'frontend', '.gitignore'), 'utf8')
    for (const line of E2E_IGNORED) assert.match(ignore, new RegExp(`^${line}$`, 'm'))
    // An API without the login gets no browser tests
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-e2e-api-update-'))
    t.after(() => fs.rm(other, { recursive: true, force: true }))
    await fs.mkdir(path.join(other, 'frontend'), { recursive: true })
    await fs.writeFile(path.join(other, 'frontend', 'package.json'), '{ "name": "frontend", "scripts": {} }\n')
    await updatePackages({
        projectDir: other,
        project: { name: 'api', frontend: true, backend: true, kind: 'api' },
        exec: async () => {}
    })
    assert.equal(
        JSON.parse(await fs.readFile(path.join(other, 'frontend', 'package.json'), 'utf8')).scripts['test:e2e'],
        undefined
    )
})

test('verify plain runs the browser tests of the simple login after test:db and the login flow, with the database', () => {
    const verify = read('scripts/verify-apps.mjs')
    assert.match(verify, /const withApi = Boolean\(variant\.frontend\.api\.auth && !variant\.frontend\.api\.oidc\)/)
    assert.match(verify, /if \(pkg\.scripts\?\.\['test:e2e'\] && !withApi\) await browserTests\(\)/)
    const flow = verify.indexOf('await variant.flow(projectDir)')
    const after = verify.indexOf("if (pkg.scripts?.['test:e2e'] && withApi) await browserTests()")
    assert.ok(flow > 0 && after > flow && after < verify.indexOf("} else if (flags['require-db'])"))
})

test('the CI: the frontend job of the simple login has PostgreSQL and the built API; no frontend builds twice', () => {
    const project = { name: 'shop', frontend: true, backend: true, kind: 'login', database: 'shop', modules: null }
    const ci = ciWorkflow(project)
    const frontend = ci.slice(ci.indexOf('    frontend:'), ci.indexOf('    security:'))
    assert.match(frontend, /services:\n\s+postgres:\n\s+image: postgres:17/)
    assert.match(frontend, /DATABASE_NAME: shop/)
    assert.match(
        frontend,
        /- name: The API for the browser tests \(built, with its database\)\n\s+working-directory: backend\n\s+run: \|\n\s+npm ci\n\s+npm run build\n\s+npm run db:check/
    )
    // The frontend is built just before: the browser tests start it as it is
    assert.match(frontend, /- name: Browser tests \(Playwright\)\n\s+env:\n\s+E2E_NO_BUILD: '1'/)
    // An API without the login: no database in the frontend job
    const api = ciWorkflow({ ...project, kind: 'api' })
    const apiFrontend = api.slice(api.indexOf('    frontend:'), api.indexOf('    security:'))
    assert.ok(!apiFrontend.includes('postgres'))
    assert.match(apiFrontend, /E2E_NO_BUILD: '1'/)
})

test('a server in production refuses the public test secrets of the tests and of the Lighthouse step', () => {
    const oidc = read('templates/frontend-oidc/src/lib/oidc.ts')
    const e2e = createHash('sha256').update('dafkedd-e2e').digest('hex')
    assert.match(oidc, new RegExp(`const TEST_SECRETS = \\['${e2e}', '0'\\.repeat\\(64\\)\\]`))
    assert.match(
        oidc,
        /process\.env\.NODE_ENV === 'production' &&\s+process\.env\.E2E_TEST !== '1' &&\s+TEST_SECRETS\.includes\(hex\.toLowerCase\(\)\)\s+\)\s+throw new Error/
    )
    // The test servers say they are: the browser tests of a linked app and the Lighthouse step of the CI
    assert.match(read('templates/frontend-oidc-linked/playwright.config.ts'), /process\.env\.E2E_TEST = '1'/)
    const ci = ciWorkflow({ name: 'p', frontend: true, backend: true, kind: 'pasport', database: 'p', modules: null })
    assert.match(ci, /AUTH_SECRET: 0{64}\n\s+E2E_TEST: '1'/)
})

test('the README of the simple login explains its browser tests', () => {
    const readme = frontendReadme({ api: { port: 4000, auth: true } })
    assert.match(
        readme,
        /\*\*Browser tests\*\* \(`npm run test:e2e`, Playwright, also in the CI\): `playwright\.config\.ts` starts the built API/
    )
    assert.match(readme, /`e2e\/global-teardown\.ts` removes every account of the run/)
    assert.ok(!frontendReadme({ api: { port: 4000 } }).includes('e2e/global-teardown.ts'))
})

test('the Screenshots workflow of the simple login has PostgreSQL and the built API; the others are unchanged', () => {
    const login = screenshotsWorkflow({ name: 'shop', frontend: true, backend: true, kind: 'login', database: 'shop' })
    assert.match(login, /services:\n\s+postgres:\n\s+image: postgres:17/)
    assert.match(login, /DATABASE_NAME: shop/)
    assert.match(
        login,
        /- run: npm ci\n\s+- name: The API for the browser tests \(built, with its database\)\n\s+working-directory: backend\n\s+run: \|\n\s+npm ci\n\s+npm run build\n\s+npm run db:check\n\s+- run: npx playwright install --with-deps chromium/
    )
    // The write token is never in .git/config while npm ci runs install scripts: only the commit step gets it
    for (const kind of ['login', 'api', 'app', 'pasport']) {
        const workflow = screenshotsWorkflow({ name: 'p', frontend: true, backend: true, kind, database: 'p' })
        assert.match(workflow, /- uses: actions\/checkout@v4\n\s+with:\n\s+persist-credentials: false\n/, kind)
        assert.ok(workflow.indexOf('gh auth setup-git') > workflow.lastIndexOf('npm ci'), kind)
        assert.match(workflow, /gh auth setup-git[\s\S]+git push[\s\S]+GH_TOKEN: \$\{\{ github\.token \}\}/, kind)
    }
    for (const kind of ['api', 'app', 'pasport']) {
        const other = screenshotsWorkflow({ name: 'p', frontend: true, backend: true, kind, database: 'p' })
        assert.ok(!other.includes('postgres'), kind)
        assert.ok(!other.includes('The API for the browser tests'), kind)
    }
    // Every project gets the workflow of its own kind
    assert.equal(
        projectClaudeFiles({ name: 'shop', frontend: true, backend: true, kind: 'login', database: 'shop' })[
            '.github/workflows/screenshots.yml'
        ],
        login
    )
})

test('the README of a frontend with the OpenID Connect login says production refuses the public test secrets', () => {
    for (const api of [
        { port: 4000, oidc: true },
        {
            port: 4001,
            oidc: true,
            linked: { name: 'Planner', issuer: 'https://auth.example.com/oidc', clientId: 'planner', port: 3001 }
        }
    ]) {
        const readme = frontendReadme({ api })
        assert.match(readme, /E2E_TEST/, JSON.stringify(api))
    }
    assert.match(
        frontendReadme({ api: { port: 4000, oidc: true } }),
        /A server\s+in production refuses the public secrets of the tests/
    )
    assert.match(frontendReadme({ api: { port: 4000, auth: true } }), /never run them against production/)
})
