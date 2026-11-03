import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { E2E_IGNORED, E2E_PACKAGES, nextjs } from '../src/frontends/nextjs.js'
import { DESIGN_FILES, LINKED_FILES, oidcFrontendFiles } from '../src/frontends/oidc.js'
import { updatePackages } from '../src/update-code.js'
import { frontendReadme } from '../src/frontends/docs.js'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
/** `line` is a whole line of `text` (only indented): not in a comment, not behind an `if (false)` or a `.catch`. */
const hasLine = (text, line) => text.split('\n').some(row => row.trim() === line)
const server = oidcFrontendFiles()
const E2E = [
    'playwright.config.ts',
    'e2e/session.ts',
    'e2e/tour.spec.ts',
    'e2e/pages.spec.ts',
    'e2e/login.spec.ts',
    'e2e/api.spec.ts'
]

test('the login server gets its browser tests, and the steps of its tour in a file of their own', () => {
    for (const rel of E2E) assert.equal(server[rel], read(`templates/frontend-oidc/${rel}`), rel)
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

test('the api spec logs in for real with the demo data and opens every page of the shells, skipped without the API', () => {
    const spec = server['e2e/api.spec.ts']
    // Skipped without the real API: the other specs keep running alone
    assert.ok(hasLine(spec, "test.skip(!API || !PASSWORD, 'needs the real API: E2E_API and E2E_DEMO_PASSWORD')"))
    assert.match(spec, /const API = process\.env\.E2E_API \?\? ''/)
    assert.match(spec, /const PASSWORD = process\.env\.E2E_DEMO_PASSWORD \?\? ''/)
    // The accounts are those of the demo data of the backend (and the superadmin made with `npm run oidc:user -- --superadmin`)
    const demo = read('templates/backend-oidc/scripts/demo-data.mjs')
    assert.match(demo, /const DOMAIN = 'demo\.example\.com'/)
    assert.match(demo, /first: 'An', last: 'Peeters', tenant: 'demo-de-linde', role: 'admin'/)
    assert.match(demo, /first: 'Bram', last: 'Janssens', tenant: 'demo-de-linde', role: 'user'/)
    assert.ok(spec.includes("email: 'an.peeters@demo.example.com'"))
    assert.ok(spec.includes("email: 'bram.janssens@demo.example.com'"))
    assert.ok(spec.includes("email: process.env.E2E_SUPERADMIN_EMAIL ?? 'support@demo.example.com'"))
    // Its lists are those of pages.spec.ts (the shells): the admin and the superadmin see all, a member no admin pages
    const lists = text => {
        const found = {}
        for (const m of text.matchAll(/(rail|menu): \[([^\]]*)\]/g)) (found[m[1]] ??= []).push(m[2])
        return found
    }
    const paths = text => [...text.matchAll(/'(\/[a-z/]*)'/g)].map(m => m[1])
    const pages = server['e2e/pages.spec.ts']
    const listed = name => paths(new RegExp(`const ${name}[^=]*= \\[([\\s\\S]*?)\\]\\n`).exec(pages)[1])
    const { rail, menu } = lists(spec)
    assert.equal(rail.length, 3)
    assert.deepEqual(paths(rail[0]), listed('PORTAL_RAIL'))
    assert.deepEqual(paths(menu[0]), listed('PORTAL_MENU'))
    assert.deepEqual(
        paths(rail[1]),
        listed('PORTAL_RAIL').filter(href => !['/users', '/invoices'].includes(href))
    )
    assert.deepEqual(
        paths(menu[1]),
        listed('PORTAL_MENU').filter(href => href !== '/audit')
    )
    assert.deepEqual(paths(rail[2]), listed('ADMIN_RAIL'))
    assert.deepEqual(paths(menu[2]), listed('ADMIN_MENU'))
    // ... which the shell shows only to an admin of the organisation
    const shell = server['src/components/pasport/portal-shell.tsx']
    assert.match(shell, /\.\.\.\(admin\s+\?\s+\[\s+\{ key: 'users'[^\n]+\n\s+\{ key: 'invoices'/)
    assert.match(shell, /\.\.\.\(admin \? \[\{ key: 'audit'/)
    // The real login screen, then every page of the live rail and the menu with real data
    for (const line of [
        "const emailTab = page.getByRole('tab', { name: en.AuthScreen.tabEmail, exact: true })",
        "Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)",
        '}, PASSWORD)',
        "await page.getByRole('button', { name: en.AuthScreen.login, exact: true }).click()",
        "if (superadmin) await page.getByRole('button', { name: en.Oidc.platformChoice }).click()",
        'for (const href of account.rail) expect(rail).toContain(href)',
        'for (const path of [...new Set([...rail, ...account.menu])])',
        "await expect(page.locator('.page-head').first()).toBeVisible()",
        "await expect(page.getByRole('heading', { name: en.Shell.loadFailed })).toHaveCount(0)",
        "if (ROWS.includes(path)) await expect(page.locator('tbody tr:not(:has(.empty-row))').first()).toBeVisible()",
        "if (NOT_EMPTY[path]) await expect(page.getByRole('heading', { name: NOT_EMPTY[path] })).toHaveCount(0)",
        'if (!account.superadmin) await tourSeen(page, { ...ADMIN, email: account.email })'
    ])
        assert.ok(hasLine(spec, line), line)
    // Every table and list the demo data fills (organisations, users, invoices, apps, tickets, the code, a rating)
    const rows = /const ROWS = \[([\s\S]*?)\]\n/.exec(spec)[1]
    assert.deepEqual(
        [...rows.matchAll(/'(\/[a-z/]*)'/g)].map(m => m[1]),
        [
            '/users',
            '/invoices',
            '/admin/tenants',
            '/admin/users',
            '/admin/tickets',
            '/admin/catalog',
            '/admin/codes',
            '/admin/ratings'
        ]
    )
    assert.ok(spec.includes("const NOT_EMPTY: Record<string, string> = { '/support': en.Portal.Tickets.noTickets }"))
    for (const file of ['tickets/admin-tickets.tsx', 'admin/catalog.tsx', 'admin/ratings.tsx'])
        assert.ok(server[`src/components/pasport/${file}`].includes("className='empty-row'"), file)
    assert.match(server['src/components/pasport/tickets/customer-tickets.tsx'], /\{t\('noTickets'\)\}/)
    const demo2 = read('templates/backend-oidc/scripts/demo-data.mjs')
    for (const table of ['tickets', 'discount_codes', 'invoices'])
        assert.match(demo2, new RegExp(`INSERT INTO ${table} `), table)
    // The empty row of a table and the message of LoadError are what the spec looks for
    assert.match(server['src/components/pasport/admin/tenants.tsx'], /<td colSpan=\{8\} className='empty-row'>/)
    assert.match(server['src/components/pasport/page-state.tsx'], /\{t\('loadFailed'\)\}/)
    // ... and the login screen and the pages talk to the same API (src/lib/api.ts and src/lib/pasport.ts)
    const built = server['playwright.config.ts']
    for (const name of ['API_URL', 'NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_PASPORT_API_URL'])
        assert.ok(hasLine(built, `process.env.${name} = api`), name)
    assert.ok(built.includes('\nif (process.env.E2E_API) {\n    const api = localApi(process.env.E2E_API)\n'))
    assert.ok(hasLine(built, 'process.env.OIDC_ISSUER = `${api}/oidc`'))
    assert.match(server['src/lib/pasport.ts'], /process\.env\.NEXT_PUBLIC_PASPORT_API_URL \?\? API_URL/)
    // How to run it: no two-step verification at the API, the superadmin made with oidc:user (a script that exists)
    assert.ok(spec.includes('OIDC_MFA=optional'))
    assert.ok(spec.includes('OIDC_LOGIN_UI_URL'))
    assert.ok(spec.includes('npm run oidc:user --'))
    const readme = frontendReadme({ ui: 'all', api: { port: 4000, oidc: true }, locales: ['en', 'nl', 'fr', 'de'] })
    assert.ok(readme.includes('OIDC_MFA=optional'))
    for (const text of [spec, readme, read('templates/backend-oidc/scripts/oidc-user.mjs'), read('README.md')])
        assert.ok(!text.includes('oidc:superadmin'))
    // The password is never the value of a step (fill, type, ...): the report keeps the title of every step
    assert.doesNotMatch(spec, /\.(fill|type|pressSequentially|insertText)\(\s*PASSWORD/)
    assert.doesNotMatch(spec, /\.(type|pressSequentially|insertText)\(/)
    // One fill only, the email: none on the password field, whatever value it gets
    assert.deepEqual(spec.match(/\.fill\(/g), ['.fill('])
    assert.ok(hasLine(spec, 'await field.fill(email)'))
    // A failure keeps no trace, video or screenshot: they would hold the password and the real tokens
    assert.ok(hasLine(spec, "test.use({ trace: 'off', video: 'off', screenshot: 'off' })"))
    // E2E_API is only an API on this machine: the test server seals its sessions with a public secret
    const config = server['playwright.config.ts']
    const source = /function localApi\(url: string\): string \{[\s\S]*?\n\}/.exec(config)[0].replace(/: string/g, '')
    const localApi = new Function(`${source}; return localApi`)()
    assert.equal(localApi('http://localhost:4000/'), 'http://localhost:4000')
    assert.equal(localApi('http://127.0.0.1:4000'), 'http://127.0.0.1:4000')
    assert.equal(localApi('http://[::1]:4000'), 'http://[::1]:4000')
    for (const url of [
        'https://login.example.com',
        'http://localhost.example.com:4000',
        'http://10.0.0.5:4000',
        'ftp://localhost/',
        'file://localhost/etc'
    ])
        assert.throws(() => localApi(url), /E2E_API must be an API on this machine/, url)
    // With E2E_API the frontend of the tests logs in at that API
    assert.ok(server['playwright.config.ts'].includes('process.env.OIDC_ISSUER = `${api}/oidc`'))
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
