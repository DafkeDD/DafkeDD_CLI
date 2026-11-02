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
    PUBLIC_E2E_FILES,
    sitePages,
    uiFiles,
    withApi
} from '../src/frontends/nextjs.js'
import { updatePackages } from '../src/update-code.js'
import { frontendReadme } from '../src/frontends/docs.js'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const site = sitePages({ ...nextFiles, ...uiFiles })
const api = withApi(sitePages({ ...nextFiles, ...uiFiles }), { port: 4000 }, { ui: true })
const login = withApi(sitePages({ ...nextFiles, ...uiFiles }), { port: 4000, auth: true }, { ui: true })

test('a site and an API frontend get the browser tests of a frontend without a login; the simple login its own', () => {
    assert.deepEqual(PUBLIC_E2E_FILES, ['playwright.config.ts', 'e2e/pages.spec.ts'])
    for (const files of [site, api])
        for (const rel of PUBLIC_E2E_FILES) assert.equal(files[rel], read(`templates/frontend-public/${rel}`), rel)
    // The simple login keeps its own suite (it logs in through the real API)
    assert.equal(login['playwright.config.ts'], read('templates/frontend-login/playwright.config.ts'))
    assert.equal(login['e2e/pages.spec.ts'], read('templates/frontend-login/e2e/pages.spec.ts'))
    // The login server and a linked app get nothing of this (they have theirs)
    assert.deepEqual(sitePages({}, { api: { oidc: true } }), {})
})

test('the config starts the built frontend on its own port, without a secret or an API', () => {
    const config = site['playwright.config.ts']
    assert.match(
        config,
        /E2E_NO_BUILD \? `npx next start -p \$\{PORT\}` : `npm run build && npx next start -p \$\{PORT\}`/
    )
    assert.match(config, /reuseExistingServer: false/)
    assert.match(config, /locale: 'en'/)
    assert.ok(!/AUTH_SECRET|E2E_TEST/.test(config))
})

test('the page spec: every page of APP_NAV, four languages, both themes, 390px, axe, open without a login', () => {
    const pages = site['e2e/pages.spec.ts']
    for (const line of [
        'for (const item of APP_NAV)',
        'const MESSAGES = { en, nl, fr, de }',
        ".withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])",
        ".join(', ')}`)).toEqual([])",
        "toHaveAttribute('lang', locale)",
        "for (const theme of ['light', 'dark'])",
        "toHaveAttribute('data-theme', theme)",
        'setViewportSize({ width: 390, height: 844 })',
        'document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)',
        "await expect(page.locator('.page-head')).toBeVisible()",
        'await expect(page).toHaveURL(url => url.pathname === item.href)',
        'const answer = await request.get(item.href, { maxRedirects: 0 })',
        'expect(answer.status()).toBe(200)'
    ])
        assert.ok(pages.includes(line), line)
    assert.match(
        pages,
        /getByRole\('link', \{ name: messages\.Nav\[nav\.label as keyof typeof messages\.Nav\] \}\)\.first\(\)\s*\)\.toBeAttached\(\)/
    )
    assert.equal(pages.match(/await accessible\(page\)/g)?.length, 2)
    // A site has no login: no session, no proxy that sends to /login
    assert.ok(!/logIn|session|\/login/.test(pages))
})

test('every frontend installs Playwright and axe and has test:e2e; update brings them to a site', async t => {
    for (const projectApi of [null, { port: 4000 }]) {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-e2e-public-'))
        t.after(() => fs.rm(dir, { recursive: true, force: true }))
        const ran = []
        const steps = await nextjs.steps({
            projectDir: dir,
            answers: { ui: 'all' },
            api: projectApi,
            exec: async (command, args) => ran.push(`${command} ${args.join(' ')}`)
        })
        const step = steps.find(s => s.title === 'Browsertests installeren (Playwright, axe)')
        assert.ok(step, JSON.stringify(projectApi))
        await fs.mkdir(path.join(dir, 'frontend'), { recursive: true })
        await step.run()
        assert.ok(ran.includes(`npm install --save-dev ${E2E_PACKAGES.join(' ')}`))
    }
    assert.match(
        read('src/frontends/nextjs.js'),
        /\/\/ The browser tests \(e2e\/\): every frontend has them from the start\n\s+pkg\.scripts\['test:e2e'\] = 'playwright test'/
    )
    // update: an existing site (no backend) gets the script, the packages and the ignore lines
    const project = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-e2e-site-update-'))
    t.after(() => fs.rm(project, { recursive: true, force: true }))
    await fs.mkdir(path.join(project, 'frontend'), { recursive: true })
    await fs.writeFile(path.join(project, 'frontend', 'package.json'), '{ "name": "frontend", "scripts": {} }\n')
    const installed = []
    await updatePackages({
        projectDir: project,
        project: { name: 'site', frontend: true, backend: false, kind: null },
        exec: async (command, args) => installed.push(args.join(' '))
    })
    const pkg = JSON.parse(await fs.readFile(path.join(project, 'frontend', 'package.json'), 'utf8'))
    assert.equal(pkg.scripts['test:e2e'], 'playwright test')
    assert.ok(installed.includes(`install --save-dev ${E2E_PACKAGES.join(' ')}`))
    const ignore = await fs.readFile(path.join(project, 'frontend', '.gitignore'), 'utf8')
    for (const line of E2E_IGNORED) assert.match(ignore, new RegExp(`^${line}$`, 'm'))
})

test('verify has a site and an API variant, and a site has no backend steps', () => {
    const verify = read('scripts/verify-apps.mjs')
    assert.match(
        verify,
        /site: async \(\) => \(\{ frontend: \{ answers: \{ ui: 'all' \}, api: null \}, backend: null \}\)/
    )
    assert.match(
        verify,
        /api: async \(\) => \{\n\s+const answers = \{ database: db\('api'\), auth: false, oidc: null \}/
    )
    assert.match(verify, /if \(project\.backend\) await startsOnPort\(path\.join\(projectDir, 'backend'\)\)/)
    assert.match(verify, /for \(const dir of variant\.backend \? \[backend, frontend\] : \[frontend\]\)/)
    assert.match(verify, /if \(pkg\.scripts\?\.\['test:e2e'\] && !withApi\) await browserTests\(\)/)
})

test('the README of a site and of an API frontend explains their browser tests', () => {
    for (const projectApi of [null, { port: 4000 }]) {
        const readme = frontendReadme({ api: projectApi }).replace(/\s+/g, ' ')
        assert.ok(readme.includes('`e2e/pages.spec.ts` opens every page of `APP_NAV`'), JSON.stringify(projectApi))
        assert.ok(readme.includes('that it opens without a login'), JSON.stringify(projectApi))
    }
    for (const projectApi of [
        { port: 4000, auth: true },
        { port: 4000, oidc: true }
    ])
        assert.ok(
            !frontendReadme({ api: projectApi }).includes('that it opens without a login'),
            JSON.stringify(projectApi)
        )
})
