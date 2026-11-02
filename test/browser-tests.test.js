import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import {
    E2E_IGNORED,
    E2E_PACKAGES,
    files as nextFiles,
    nextjs,
    PLAYWRIGHT_VERSION,
    PRETTIERIGNORE,
    sitePages,
    uiFiles,
    withApi
} from '../src/frontends/nextjs.js'
import { designFiles, LINKED_FILES, oidcFrontendFiles } from '../src/frontends/oidc.js'
import { updatePackages } from '../src/update-code.js'
import { frontendReadme } from '../src/frontends/docs.js'
import { DOCKERIGNORE } from '../src/cloud.js'

const E2E = ['playwright.config.ts', 'e2e/session.ts', 'e2e/tour.spec.ts', 'e2e/pages.spec.ts']
const linked = oidcFrontendFiles({ linked: true, appName: 'Planner' })

test('a linked app gets its browser tests: the tour, every page of APP_NAV, languages, themes, the phone, axe', () => {
    for (const rel of E2E) {
        assert.ok(LINKED_FILES.includes(rel), rel)
        assert.ok(linked[rel], rel)
    }
    // The login server has a suite of its own (test/login-server-browser-tests.test.js), not that of a linked app
    assert.notEqual(oidcFrontendFiles()['e2e/tour.spec.ts'], linked['e2e/tour.spec.ts'])
    const config = linked['playwright.config.ts']
    // Its own server on its own port, without a login server, with a secret only for the tests
    assert.match(config, /createHash\('sha256'\)\.update\('dafkedd-e2e'\)\.digest\('hex'\)/)
    assert.match(config, /process\.env\.AUTH_SECRET = process\.env\.E2E_AUTH_SECRET \?\?/)
    assert.match(
        config,
        /E2E_NO_BUILD \? `npx next start -p \$\{PORT\}` : `npm run build && npx next start -p \$\{PORT\}`/
    )
    assert.match(config, /reuseExistingServer: false/)
    // A session as the app makes it, sealed with that secret: never a real account or token
    const session = linked['e2e/session.ts']
    assert.match(session, /import \{ seal, SESSION_COOKIE, type Session \} from '\.\.\/src\/lib\/oidc'/)
    assert.match(session, /export const SUPERADMIN: Session/)
    assert.match(session, /`app-tour:\$\{session\.sub\}`/)
    // The tour: a step for every page of APP_NAV, remembered, from the menu, none for a superadmin
    const tour = linked['e2e/tour.spec.ts']
    assert.match(tour, /const STEPS = 1 \+ APP_NAV\.length \+ 3/)
    assert.match(tour, /toEqual\(\[\s*`app-tour:\$\{USER\.sub\}`\s*\]\)/)
    assert.match(tour, /getByRole\('menuitem', \{ name: t\.menu \}\)\)\.toHaveCount\(0\)/)
    // Every page of APP_NAV: four languages, light and dark, 390px, axe on WCAG 2.2 AA, and no page without a login
    const pages = linked['e2e/pages.spec.ts']
    assert.match(pages, /for \(const item of APP_NAV\)/)
    assert.match(pages, /const MESSAGES = \{ en, nl, fr, de \}/)
    assert.match(pages, /for \(const theme of \['light', 'dark'\]\)/)
    assert.match(pages, /setViewportSize\(\{ width: 390, height: 844 \}\)/)
    assert.match(pages, /\.withTags\(\['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'\]\)/)
    assert.match(pages, /expect\(answer\.status\(\)\)\.toBe\(307\)/)
    // The assertions themselves: weakening one of them would let the suite pass without checking anything
    for (const line of [
        ".join(', ')}`)).toEqual([])",
        "toHaveAttribute('lang', locale)",
        "toHaveAttribute('data-theme', theme)",
        "getByRole('link', { name: messages.Nav[item.label as keyof typeof messages.Nav] }).first()",
        'document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)',
        "pathname).toBe('/login')"
    ])
        assert.ok(pages.includes(line), line)
    for (const line of [
        "tip.locator('h3')).toHaveText(en.Nav[item.label as keyof typeof en.Nav])",
        "await page.reload()\n    await expect(page.locator('.page-head')).toBeVisible()\n    await expect(tip).toHaveCount(0)"
    ])
        assert.ok(tour.includes(line), line)
    // Both themes and the phone run axe
    assert.equal(pages.match(/await accessible\(page\)/g)?.length, 2)
    // update brings them (generated code of a linked app), never as design files
    assert.equal(designFiles({ linked: true })['frontend/e2e/tour.spec.ts'], undefined)
})

test('the frontend steps of a linked app install Playwright and axe, pinned, and ignore their output', async () => {
    assert.equal(PLAYWRIGHT_VERSION, '1.56.0')
    assert.deepEqual(E2E_PACKAGES, ['@playwright/test@1.56.0', '@axe-core/playwright@4.14.0'])
    for (const line of ['playwright-report', 'test-results']) assert.match(PRETTIERIGNORE, new RegExp(`^${line}$`, 'm'))
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-e2e-'))
    try {
        const ran = []
        const steps = await nextjs.steps({
            projectDir: dir,
            answers: { ui: 'all' },
            api: { port: 4001, oidc: true, linked: { name: 'Planner', port: 3001 } },
            exec: async (command, args) => ran.push(`${command} ${args.join(' ')}`)
        })
        const step = steps.find(s => s.title === 'Browsertests installeren (Playwright, axe)')
        assert.ok(step, 'the step')
        await fs.mkdir(path.join(dir, 'frontend'), { recursive: true })
        await fs.writeFile(path.join(dir, 'frontend', '.gitignore'), 'node_modules\n')
        await step.run()
        await step.run()
        assert.ok(ran.includes(`npm install --save-dev ${E2E_PACKAGES.join(' ')}`))
        const ignore = await fs.readFile(path.join(dir, 'frontend', '.gitignore'), 'utf8')
        for (const line of E2E_IGNORED) assert.equal(ignore.split('\n').filter(l => l === line).length, 1, line)
        // A site (no API) has them too (test/site-browser-tests.test.js)
        const other = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-e2e-site-'))
        const site = await nextjs.steps({ projectDir: other, answers: { ui: 'all' }, api: null, exec: async () => {} })
        await fs.rm(other, { recursive: true, force: true })
        assert.ok(site.some(s => s.title === 'Browsertests installeren (Playwright, axe)'))
    } finally {
        await fs.rm(dir, { recursive: true, force: true })
    }
    // npm run test:e2e
    assert.match(
        readFileSync(new URL('../src/frontends/nextjs.js', import.meta.url), 'utf8'),
        /\/\/ The browser tests \(e2e\/\): every frontend has them from the start\n\s+pkg\.scripts\['test:e2e'\] = 'playwright test'/
    )
})

test('update gives an existing linked app the packages, the script and the ignore lines of its browser tests', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-e2e-update-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    await fs.mkdir(path.join(dir, 'frontend'), { recursive: true })
    await fs.writeFile(
        path.join(dir, 'frontend', 'package.json'),
        JSON.stringify({ name: 'frontend', scripts: { build: 'next build' }, devDependencies: {} }, null, 4) + '\n'
    )
    await fs.writeFile(path.join(dir, 'frontend', '.gitignore'), 'node_modules\n')
    const installed = []
    await updatePackages({
        projectDir: dir,
        project: { name: 'planner', frontend: true, backend: true, kind: 'app', link: { clientId: 'planner' } },
        exec: async (command, args, options) => installed.push([command, args.join(' '), options.cwd])
    })
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'frontend', 'package.json'), 'utf8'))
    assert.equal(pkg.scripts['test:e2e'], 'playwright test')
    assert.ok(installed.some(([, args]) => args === `install --save-dev ${E2E_PACKAGES.join(' ')}`))
    const ignore = await fs.readFile(path.join(dir, 'frontend', '.gitignore'), 'utf8')
    for (const line of E2E_IGNORED) assert.match(ignore, new RegExp(`^${line}$`, 'm'))
})

test('npm run verify runs the browser tests of every variant that has them, on the built frontend', () => {
    const verify = readFileSync(new URL('../scripts/verify-apps.mjs', import.meta.url), 'utf8')
    assert.match(verify, /if \(pkg\.scripts\?\.\['test:e2e'\] && !withApi\) await browserTests\(\)/)
    // The Chromium of the pinned Playwright, installed when it is missing
    assert.match(verify, /run\('npx', \['--no-install', 'playwright', 'install', 'chromium'\], \{ cwd: frontend \}\)/)
    assert.match(
        verify,
        /run\('npm', \['run', 'test:e2e'\], \{ cwd: frontend, env: \{ \.\.\.process\.env, E2E_NO_BUILD: '1' \} \}\)/
    )
})

/** The tokens of pasport.css for one theme (light: the first :root, dark: [data-theme='dark']). */
function tokens(css, selector) {
    const start = css.indexOf(selector + ' {')
    const block = css.slice(start, css.indexOf('\n}', start))
    return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(m => [m[1], m[2]]))
}
const luminance = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    const channel = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
const contrast = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
}

test('every text colour of the Pasport design is at least 4.5:1 (WCAG 2.2 AA) in both themes', () => {
    const css = readFileSync(new URL('../templates/frontend-oidc/src/styles/pasport.css', import.meta.url), 'utf8')
    for (const [theme, selector] of [
        ['light', ':root'],
        ['dark', "[data-theme='dark']"]
    ]) {
        const t = { ...tokens(css, ':root'), ...(theme === 'dark' ? tokens(css, selector) : {}) }
        const grounds = ['surface', 'surface-2', 'surface-3', 'bg']
        for (const text of ['text', 'text-2', 'text-3', 'accent'])
            for (const ground of grounds)
                assert.ok(
                    contrast(t[text], t[ground]) >= 4.5,
                    `${theme}: ${text} on ${ground} ${contrast(t[text], t[ground])}`
                )
        assert.ok(contrast(t['accent-fg'], t.accent) >= 4.5, `${theme}: a primary button`)
        assert.ok(contrast(t['accent-fg'], t['avatar-bg']) >= 4.5, `${theme}: the initials of an avatar`)
        assert.ok(contrast(t.red, t['red-tint']) >= 4.5, `${theme}: an error message`)
        // The status colours are text too (a badge on its tint, "Connected" on a card)
        for (const status of ['green', 'amber', 'red', 'blue', 'violet'])
            for (const ground of [...grounds, `${status}-tint`])
                assert.ok(
                    contrast(t[status], t[ground]) >= 4.5,
                    `${theme}: ${status} on ${ground} ${contrast(t[status], t[ground])}`
                )
    }
    // The tokens of the brand book say the same
    const json = JSON.parse(
        readFileSync(new URL('../templates/project-claude/.claude/design/pasport-tokens.json', import.meta.url), 'utf8')
    )
    const flat = JSON.stringify(json)
    assert.match(flat, /"name":"text-3","value":\{"light":"#646d80","dark":"#858e9f"\}/)
    assert.match(flat, /"name":"green","value":\{"light":"#15803d","dark":"#4ade80"\}/)
    assert.match(flat, /"name":"amber","value":\{"light":"#b45309","dark":"#fbbf24"\}/)
    assert.match(flat, /"name":"accent","value":\{"light":"#0f766e"/)
    assert.match(flat, /"name":"avatar-bg"/)
    // The account menu says the visible name of the user too (WCAG 2.5.3 label in name)
    const shell = readFileSync(
        new URL('../templates/frontend-oidc/src/components/pasport/shell.tsx', import.meta.url),
        'utf8'
    )
    assert.match(shell, /<span className='sr-only'>\{t\('userMenu'\)\}<\/span>/)
    assert.ok(!/aria-label=\{t\('userMenu'\)\}/.test(shell))
})

test('the browser tests never end up in an image', () => {
    for (const line of ['e2e', 'playwright.config.ts', 'playwright-report', 'test-results'])
        assert.match(DOCKERIGNORE, new RegExp(`^${line.replace('.', '\\.')}$`, 'm'), line)
})

test('the frontend docs of a linked app describe its browser tests; the login server its own', () => {
    const flat = text => text.replace(/\s+/g, ' ')
    const app = flat(frontendReadme({ api: { port: 4001, oidc: true, linked: { name: 'Planner', port: 3001 } } }))
    assert.match(app, /\*\*Browser tests\*\* \(`npm run test:e2e`, Playwright, also in the CI\)/)
    assert.match(app, /`E2E_NO_BUILD=1 npm run test:e2e`/)
    assert.ok(
        app.includes(
            '`e2e/session.ts` logs a test in with a session cookie sealed with a secret only for the tests (`USER`'
        )
    )
    const server = flat(frontendReadme({ api: { port: 4000, oidc: true } }))
    assert.ok(server.includes('(`ADMIN`, `MEMBER`, `SUPERADMIN`)'))
    assert.ok(!server.includes('(`USER`, `SUPERADMIN`)'))
})

test('what axe found stays fixed: the API hint is not faded, the screen reader text is hidden', () => {
    const all = withApi(sitePages({ ...nextFiles, ...uiFiles }), { port: 4000, auth: false }, { ui: true })
    const status = all['src/components/api-status.tsx']
    assert.ok(!/opacity-\d+/.test(status), 'no faded text')
    assert.match(status, /<p className="text-xs text-\[var\(--text-3\)\]">\{t\('hint'\)\}<\/p>/)
    const css = readFileSync(new URL('../templates/frontend-oidc/src/styles/pasport.css', import.meta.url), 'utf8')
    assert.match(css, /\.sr-only \{[^}]*position: absolute;[^}]*clip: rect\(0, 0, 0, 0\);/)
})
