import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { E2E_IGNORED, E2E_PACKAGES, hasBrowserTests, nextjs } from '../src/frontends/nextjs.js'
import { DESIGN_FILES, LINKED_FILES, oidcFrontendFiles } from '../src/frontends/oidc.js'
import { updatePackages } from '../src/update-code.js'
import { frontendReadme } from '../src/frontends/docs.js'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const server = oidcFrontendFiles()
const E2E = ['playwright.config.ts', 'e2e/session.ts', 'e2e/tour.spec.ts', 'e2e/pages.spec.ts', 'e2e/login.spec.ts']

test('the login server gets its browser tests, and the steps of its tour in a file of their own', () => {
    for (const rel of E2E) assert.equal(server[rel], read(`templates/frontend-oidc/${rel}`), rel)
    assert.equal(hasBrowserTests({ port: 4000, oidc: true }), true)
    // The steps of the tour without React: tour.tsx and the browser tests read the same ones
    const steps = server['src/components/pasport/tour-steps.ts']
    assert.match(steps, /export const TOUR_STEPS = \{ admin: ADMIN, member: MEMBER \}/)
    assert.ok(!/^import /m.test(steps))
    assert.match(
        server['src/components/pasport/tour.tsx'],
        /import \{ TOUR_STEPS, type TourStep \} from '\.\/tour-steps'/
    )
    assert.match(server['src/components/pasport/tour.tsx'], /\(admin \? TOUR_STEPS\.admin : TOUR_STEPS\.member\)/)
    // A design file: update keeps it in step, and a linked app has it too (its tour.tsx imports it)
    assert.ok(DESIGN_FILES.includes('src/components/pasport/tour-steps.ts'))
    assert.ok(LINKED_FILES.includes('src/components/pasport/tour-steps.ts'))
    assert.ok(oidcFrontendFiles({ linked: true, appName: 'Planner' })['src/components/pasport/tour-steps.ts'])
})

test('playwright.config.ts of the login server: its own server, without the API, a secret only for the tests', () => {
    const config = server['playwright.config.ts']
    assert.match(config, /createHash\('sha256'\)\.update\('dafkedd-e2e'\)\.digest\('hex'\)/)
    assert.match(config, /process\.env\.AUTH_SECRET = process\.env\.E2E_AUTH_SECRET \?\?/)
    assert.match(config, /process\.env\.E2E_TEST = '1'/)
    assert.match(
        config,
        /E2E_NO_BUILD \? `npx next start -p \$\{PORT\}` : `npm run build && npx next start -p \$\{PORT\}`/
    )
    assert.match(config, /reuseExistingServer: false/)
    assert.match(config, /timeout: 120_000/)
    const session = server['e2e/session.ts']
    assert.match(session, /import \{ seal, SESSION_COOKIE, type Session \} from '\.\.\/src\/lib\/oidc'/)
    assert.match(session, /tenant: \{ id: '[0-9a-f-]+', name: 'Acme', role: 'admin' \}/)
    assert.match(session, /tenant: \{ \.\.\.ADMIN\.tenant!, role: 'user' \}/)
    assert.match(session, /tenant: null,\n\s+superadmin: true/)
    assert.match(
        session,
        /export const tourKey = \(session: Session\) => `pp-tour:\$\{session\.email\.toLowerCase\(\)\}`/
    )
    // A page is there: its page head, or the message of LoadError (the API is not started)
    assert.match(session, /page\.locator\('\.page-head, \.card-pad > h3\.t-h3'\)\.first\(\)\)\.toBeVisible\(\)/)
    assert.match(
        server['src/components/pasport/page-state.tsx'],
        /<div className='card card-pad fade-in'[^>]*>\s+<Icon[^>]*\/>\s+<h3 className='t-h3'/
    )
})

test('the tour spec walks every step of an admin and of a member, remembered, from the menu, none for a superadmin', () => {
    const tour = server['e2e/tour.spec.ts']
    for (const line of [
        "import { TOUR_STEPS } from '../src/components/pasport/tour-steps'",
        'await walk(page, TOUR_STEPS.admin, ADMIN.name)',
        'await walk(page, TOUR_STEPS.member, MEMBER.name)',
        'await expect(page).toHaveURL(url => url.pathname === step.href)',
        "await expect(tip.locator('h3')).toHaveText(title(step.id, name))",
        "t.stepOf.replace('{step}', String(index + 1)).replace('{total}', String(steps.length))",
        'index < steps.length - 1 ? t.next : t.finish',
        "await expect(page.locator('.tour-tip')).toHaveCount(0)",
        'tourKey(ADMIN)',
        "page.getByRole('menuitem', { name: shell.tour }).click()",
        "await expect(page.getByRole('menuitem', { name: shell.tour })).toHaveCount(0)"
    ])
        assert.ok(tour.includes(line), line)
})

test('the page spec opens every page of the rail and the user menu of the portal and of the superadmin panel', () => {
    const pages = server['e2e/pages.spec.ts']
    // The lists of the spec are those of the shells (portal-shell.tsx): the vault is only for doctors,
    // the platform (/admin) only for a superadmin in the portal
    const shell = server['src/components/pasport/portal-shell.tsx']
    const part = (from, to) => shell.slice(shell.indexOf(from), shell.indexOf(to, shell.indexOf(from)))
    const hrefs = text => [...text.matchAll(/href: '(\/[a-z/]*)'/g)].map(m => m[1])
    const customer = hrefs(part('export function CustomerShell', 'if (eidRequired)')).filter(
        href => !['/vault', '/admin'].includes(href)
    )
    const admin = hrefs(part('export function AdminShell', '<PortalShell')).filter(href => href !== '/dashboard')
    const listed = name => {
        const list = new RegExp(`const ${name}[^=]*= \\[([\\s\\S]*?)\\]\\n`).exec(pages)[1]
        return [...list.matchAll(/'(\/[a-z/]*)'/g)].map(m => m[1])
    }
    assert.deepEqual([...listed('PORTAL_RAIL'), ...listed('PORTAL_MENU')].sort(), [...customer].sort())
    assert.deepEqual([...listed('ADMIN_RAIL'), ...listed('ADMIN_MENU')].sort(), [...admin].sort())
    for (const line of [
        'const MESSAGES = { en, nl, fr, de }',
        ".withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])",
        ".join(', ')}`)).toEqual([])",
        "toHaveAttribute('lang', locale)",
        "for (const theme of ['light', 'dark'])",
        "toHaveAttribute('data-theme', theme)",
        'setViewportSize({ width: 390, height: 844 })',
        'document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)',
        'expect(answer.status()).toBe(307)',
        "expect(login.pathname).toBe('/login')",
        "expect(login.searchParams.get('returnTo')).toBe(path)",
        "await page.goto('/admin/tenants')"
    ])
        assert.ok(pages.includes(line), line)
    // The rail names its pages in this language
    assert.match(
        pages,
        /getByRole\('link', \{ name: messages\.Portal\.Shell\[key\] \}\)\s*\.first\(\)\s*\)\.toBeAttached\(\)/
    )
    assert.equal(pages.match(/await accessible\(page\)/g)?.length, 2)
    assert.equal(pages.match(/await opened\(page\)/g)?.length, 3)
    assert.equal(pages.match(/await tourSeen\(page, /g)?.length, 2)
})

test('the login spec shows the login screen with the answers of the API given by the test', () => {
    const login = server['e2e/login.spec.ts']
    for (const line of [
        'page.route(`**/oidc/interaction/${INTERACTION}`',
        "page.getByRole('heading', { name: messages.AuthScreen.welcome, exact: true })).toBeVisible()",
        "toHaveAttribute('lang', locale)",
        "toHaveAttribute('data-theme', theme)",
        'document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)',
        ".join(', ')}`)).toEqual([])"
    ])
        assert.ok(login.includes(line), line)
    assert.match(
        login,
        /json: \{\s+csrf: 'e2e',\s+clientId: 'frontend',\s+clientName: 'Pasport',\s+registration: true,\s+eid: true,\s+password: true\s+\}/
    )
    assert.equal(login.match(/await accessible\(page\)/g)?.length, 2)
})

test('the frontend steps of the login server install Playwright and axe and add test:e2e; update brings them', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-e2e-pasport-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    const ran = []
    const steps = await nextjs.steps({
        projectDir: dir,
        answers: { ui: 'all' },
        api: { port: 4000, oidc: true },
        exec: async (command, args) => ran.push(`${command} ${args.join(' ')}`)
    })
    const step = steps.find(s => s.title === 'Browsertests installeren (Playwright, axe)')
    assert.ok(step, 'the step')
    await fs.mkdir(path.join(dir, 'frontend'), { recursive: true })
    await step.run()
    assert.ok(ran.includes(`npm install --save-dev ${E2E_PACKAGES.join(' ')}`))
    // update: an existing login server gets the script, the packages and the ignore lines (eid:mock stays)
    const project = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-e2e-pasport-update-'))
    t.after(() => fs.rm(project, { recursive: true, force: true }))
    await fs.mkdir(path.join(project, 'frontend'), { recursive: true })
    await fs.writeFile(
        path.join(project, 'frontend', 'package.json'),
        JSON.stringify({ name: 'frontend', scripts: {}, devDependencies: {} }, null, 4) + '\n'
    )
    const installed = []
    await updatePackages({
        projectDir: project,
        project: { name: 'pasport', frontend: true, backend: true, kind: 'pasport' },
        exec: async (command, args) => installed.push(args.join(' '))
    })
    const pkg = JSON.parse(await fs.readFile(path.join(project, 'frontend', 'package.json'), 'utf8'))
    assert.equal(pkg.scripts['test:e2e'], 'playwright test')
    assert.ok(pkg.scripts['eid:mock'])
    assert.ok(installed.includes(`install --save-dev ${E2E_PACKAGES.join(' ')}`))
    const ignore = await fs.readFile(path.join(project, 'frontend', '.gitignore'), 'utf8')
    for (const line of E2E_IGNORED) assert.match(ignore, new RegExp(`^${line}$`, 'm'))
})

test('the README of the login server explains its browser tests; a linked app keeps its own', () => {
    const readme = frontendReadme({ api: { port: 4000, oidc: true } })
    assert.match(readme, /`e2e\/tour\.spec\.ts` walks the first-login tour of an admin and of a member/)
    assert.match(readme, /`e2e\/login\.spec\.ts` shows the login screen/)
    const linked = frontendReadme({
        api: {
            port: 4001,
            oidc: true,
            linked: { name: 'Planner', issuer: 'https://auth.example.com/oidc', clientId: 'planner', port: 3001 }
        }
    })
    assert.ok(!linked.includes('`e2e/login.spec.ts` shows the login screen'))
    assert.match(linked, /`e2e\/session\.ts` logs a test in/)
})
