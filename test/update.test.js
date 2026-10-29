import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describeProject, projectClaudeFiles } from '../src/claude.js'
import {
    buildManifest,
    inferProject,
    managedFiles,
    MANIFEST,
    manifestProject,
    manifestSteps,
    parseEnvFile,
    projectName,
    readManifest,
    sha
} from '../src/manifest.js'
import { addMissing, DESIGN_MESSAGES, NEW_SUFFIX, planUpdate, update } from '../src/update.js'
import { existsSync } from 'node:fs'
import { DESIGN_FILES, designFiles } from '../src/frontends/oidc.js'

const exists = async file => existsSync(file)

const project = {
    ...describeProject({
        name: 'planner',
        frontend: { id: 'nextjs' },
        backend: { id: 'linked' },
        answers: {
            database: { database: 'planner' },
            appOptions: { mail: true },
            link: {
                issuer: 'https://login.example.com/oidc',
                accountUrl: 'https://login.example.com',
                clientId: 'planner',
                clientSecret: 'secret-of-the-app',
                product: 'planner',
                apiUrl: 'https://api.login.example.com'
            }
        }
    }),
    claude: true,
    cloud: true
}

async function tempDir(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-update-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    return dir
}

async function writeAll(dir, files) {
    for (const [rel, content] of Object.entries(files)) {
        await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
        await fs.writeFile(path.join(dir, rel), content)
    }
}

const silent = () => {}

test('the manifest keeps what the project is made of, without secrets', () => {
    const kept = manifestProject(project)
    assert.deepEqual(kept.link, {
        issuer: 'https://login.example.com/oidc',
        accountUrl: 'https://login.example.com',
        clientId: 'planner',
        product: 'planner'
    })
    assert.ok(!JSON.stringify(kept).includes('secret'))
    assert.equal(kept.claude, true)
    assert.equal(kept.cloud, true)
    // The manifest describes the project well enough to make the same files again
    // Every file the same: the licence of the app (OIDC_PRODUCT) too
    assert.deepEqual(managedFiles(kept), managedFiles(project))
    assert.match(managedFiles(kept)['infra/terraform/main.tf'], /OIDC_PRODUCT += "planner"/)
})

test('the manifest step hashes the managed files as they are on disk', async t => {
    const dir = await tempDir(t)
    await writeAll(dir, projectClaudeFiles(project))
    await manifestSteps({ projectDir: dir, project, version: '1.0.0' })[0].run()
    const manifest = readManifest(dir)
    assert.equal(manifest.version, '1.0.0')
    assert.equal(manifest.files['CLAUDE.md'], sha(projectClaudeFiles(project)['CLAUDE.md']))
    // Only what exists: the Terraform files were not written here
    assert.ok(!manifest.files['infra/terraform/main.tf'])
    assert.equal(readManifest(path.join(dir, 'nothing-here')), null)
})

test('planUpdate: new, same, updated by the CLI, changed by you, no longer needed', () => {
    const wanted = { a: 'A2', b: 'B', c: 'C2', d: 'D2' }
    const plan = planUpdate({
        disk: { b: sha('B'), c: sha('C1'), d: sha('mine'), old: sha('x') },
        remembered: { b: sha('B'), c: sha('C1'), d: sha('D1'), old: sha('x') },
        wanted
    })
    assert.deepEqual(plan, [
        { rel: 'a', action: 'new' },
        { rel: 'b', action: 'same' },
        { rel: 'c', action: 'updated' },
        { rel: 'd', action: 'changed' },
        { rel: 'old', action: 'removed' }
    ])
    // Without a manifest, every file that differs is yours
    assert.deepEqual(planUpdate({ disk: { c: sha('C1') }, wanted: { c: 'C2' } }), [{ rel: 'c', action: 'changed' }])
})

test('planUpdate: a starting point that is there is yours (skip): not compared, not "removed"; a deleted one stays deleted', () => {
    const wanted = {
        'backend/src/app.module.ts': 'new',
        'backend/src/notes/a.ts': 'new',
        'frontend/src/lib/nav.ts': 'new'
    }
    const plan = planUpdate({
        // app.module.ts changed by you, notes deleted by you, nav.ts never there
        disk: { 'backend/src/app.module.ts': sha('mine') },
        // A manifest of 0.54.0 or 0.54.1 knows the starting points
        remembered: { 'backend/src/app.module.ts': sha('old'), 'backend/src/notes/a.ts': sha('old') },
        wanted,
        skip: new Set(['backend/src/app.module.ts'])
    })
    assert.deepEqual(plan, [
        { rel: 'backend/src/notes/a.ts', action: 'deleted' },
        { rel: 'frontend/src/lib/nav.ts', action: 'new' }
    ])
})

test('update leaves the starting points of a project alone, and a deleted one does not come back', async t => {
    const dir = await tempDir(t)
    // A linked app of 0.54.1 with its code in the manifest, made in a git repository
    await writeAll(dir, {
        'backend/.env': 'DATABASE_NAME=planner\nOIDC_ISSUER=https://login.example.com/oidc\n',
        'backend/package.json': '{}',
        'frontend/package.json': '{}',
        'frontend/src/lib/brand.ts': "export const APP_NAME: string | null = 'Planner'\n",
        'backend/src/app.module.ts': 'mine, with my own modules\n',
        'backend/src/examples/examples.controller.ts': 'old example\n'
    })
    const manifest = {
        version: '0.54.1',
        project: manifestProject({ ...project, claude: false, cloud: false }),
        files: {
            'backend/src/app.module.ts': sha('as the CLI wrote it\n'),
            'backend/src/examples/examples.controller.ts': sha('old example\n'),
            'backend/src/notes/notes.controller.ts': sha('deleted by me\n')
        }
    }
    await fs.writeFile(path.join(dir, MANIFEST), JSON.stringify(manifest))
    const plan = await update({
        projectDir: dir,
        version: '0.54.3',
        log: silent,
        prompts: { confirm: async () => false }
    })
    const of = rel => plan.find(entry => entry.rel === rel)
    // Changed by you: not compared, not reported, not touched
    assert.equal(of('backend/src/app.module.ts'), undefined)
    assert.equal(await fs.readFile(path.join(dir, 'backend/src/app.module.ts'), 'utf8'), 'mine, with my own modules\n')
    assert.ok(!existsSync(path.join(dir, 'backend/src/app.module.ts' + NEW_SUFFIX)))
    // Still as the CLI wrote it once: left alone too (never "removed")
    assert.equal(of('backend/src/examples/examples.controller.ts'), undefined)
    assert.ok(!plan.some(entry => entry.action === 'removed'))
    // Deleted by you: stays deleted (here without Prettier in ./backend its code is not compared at all; with it the
    // plan says `deleted`, see planUpdate)
    assert.ok(!existsSync(path.join(dir, 'backend/src/notes/notes.controller.ts')))
    // The manifest still remembers your starting points, so the next update knows them too
    const next = readManifest(dir)
    assert.equal(next.files['backend/src/app.module.ts'], sha('mine, with my own modules\n'))
    assert.equal(next.files['backend/src/notes/notes.controller.ts'], sha('deleted by me\n'))
})

test('update replaces what the CLI wrote, never what you changed, and remembers the new version', async t => {
    const dir = await tempDir(t)
    const files = managedFiles(project)
    await writeAll(dir, files)
    await fs.writeFile(path.join(dir, 'frontend', 'package.json'), '{}')
    // An older CLI: its manifest remembers an older reviewer and CLAUDE.md
    const manifest = await buildManifest({ projectDir: dir, project, version: '0.45.0' })
    await fs.writeFile(path.join(dir, '.claude/agents/reviewer.md'), 'old reviewer')
    manifest.files['.claude/agents/reviewer.md'] = sha('old reviewer')
    // ... and you changed CLAUDE.md yourself, and a pipeline is missing
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), 'my own rules')
    await fs.rm(path.join(dir, '.github/workflows/release.yml'))
    // ... and codeql.yml is new in this version (the old manifest does not know it)
    await fs.rm(path.join(dir, '.github/workflows/codeql.yml'))
    delete manifest.files['.github/workflows/codeql.yml']
    // Windows: a checkout with CRLF is still the same file
    const hook = path.join(dir, '.claude/hooks/guard-git.mjs')
    await fs.writeFile(hook, (await fs.readFile(hook, 'utf8')).replace(/\n/g, '\r\n'))
    await fs.writeFile(path.join(dir, MANIFEST), JSON.stringify(manifest))

    const plan = await update({ projectDir: dir, version: '0.46.0', log: silent })
    const action = rel => plan.find(entry => entry.rel === rel).action
    assert.equal(action('.claude/agents/reviewer.md'), 'updated')
    assert.equal(action('CLAUDE.md'), 'changed')
    // Deleted by you: it does not come back; new in this version: written
    assert.equal(action('.github/workflows/release.yml'), 'deleted')
    assert.equal(action('.github/workflows/codeql.yml'), 'new')
    assert.equal(action('.claude/hooks/guard-git.mjs'), 'same')
    assert.equal(
        await fs.readFile(path.join(dir, '.claude/agents/reviewer.md'), 'utf8'),
        files['.claude/agents/reviewer.md']
    )
    assert.equal(await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8'), 'my own rules')
    assert.equal(await fs.readFile(path.join(dir, 'CLAUDE.md' + NEW_SUFFIX), 'utf8'), files['CLAUDE.md'])
    await assert.rejects(fs.stat(path.join(dir, '.github/workflows/release.yml')))
    assert.equal(
        await fs.readFile(path.join(dir, '.github/workflows/codeql.yml'), 'utf8'),
        files['.github/workflows/codeql.yml']
    )
    const next = readManifest(dir)
    assert.equal(next.version, '0.46.0')
    // CLAUDE.md: the hash of the new version, so the next update replaces it only when you took it over
    assert.equal(next.files['CLAUDE.md'], sha(files['CLAUDE.md']))
    assert.match(await fs.readFile(path.join(dir, '.gitignore'), 'utf8'), /\*\.dafkedd-new/)
    // The knowledge base pages that were missing
    assert.ok(await fs.stat(path.join(dir, 'docs/kb/pages.json')))

    // Again: nothing changes but CLAUDE.md stays yours
    const again = await update({ projectDir: dir, version: '0.46.0', log: silent })
    assert.deepEqual(
        again.filter(entry => entry.action !== 'same'),
        [
            { rel: '.github/workflows/release.yml', action: 'deleted' },
            { rel: 'CLAUDE.md', action: 'changed' }
        ]
    )
})

test('update without a manifest reads the project from its folders and asks first', async t => {
    const dir = path.join(await tempDir(t), 'planner')
    await writeAll(dir, {
        'frontend/package.json': '{}',
        'frontend/.env.local': 'OIDC_ACCOUNT_URL=https://login.example.com\n',
        'backend/package.json': '{}',
        'backend/.env':
            "DATABASE_NAME=planner\nTENANT_ISOLATION=database\nOIDC_ISSUER=https://login.example.com/oidc\nOIDC_CLIENT_IDS=planner\nDATABASE_PASSWORD='x y'\n",
        'backend/src/files/files.module.ts': '',
        'CLAUDE.md': 'mine'
    })
    const inferred = inferProject(dir)
    assert.equal(inferred.kind, 'app')
    assert.equal(inferred.database, 'planner')
    assert.deepEqual(inferred.modules, { mail: false, files: true, isolation: 'database' })
    assert.deepEqual(inferred.link, {
        issuer: 'https://login.example.com/oidc',
        accountUrl: 'https://login.example.com',
        clientId: 'planner',
        product: null
    })
    assert.equal(inferred.claude, true)
    assert.equal(inferred.cloud, false)

    let asked = 0
    const no = { confirm: async () => (asked++, false) }
    assert.equal(await update({ projectDir: dir, version: '0.46.0', prompts: no, log: silent }), null)
    assert.equal(asked, 1)
    assert.equal(readManifest(dir), null)

    const yes = { confirm: async () => true }
    const plan = await update({ projectDir: dir, version: '0.46.0', prompts: yes, log: silent })
    assert.equal(plan.find(entry => entry.rel === 'CLAUDE.md').action, 'changed')
    assert.equal(readManifest(dir).project.kind, 'app')
})

test('inferProject knows the kinds by their settings; update refuses a folder without a project', async t => {
    const dir = await tempDir(t)
    const kind = async env => {
        await writeAll(dir, { 'backend/package.json': '{}', 'backend/.env': env })
        return inferProject(dir).kind
    }
    assert.equal(await kind('OIDC_MASTER_KEY=abc\n'), 'pasport')
    assert.equal(await kind("JWT_SECRET='x'\n"), 'login')
    assert.equal(await kind('PORT=3001\n'), 'api')
    const empty = await tempDir(t)
    await assert.rejects(update({ projectDir: empty, version: '1', log: silent }), /Geen project/)
    assert.deepEqual(parseEnvFile("A='a # b'\nB=c   # comment\n# C=d\n"), { A: 'a # b', B: 'c' })
})

test('the name of a project comes from CLAUDE.md or Terraform, not only from its folder', async t => {
    const dir = path.join(await tempDir(t), 'a-clone')
    await writeAll(dir, { 'infra/terraform/versions.tf': 'backend "gcs" {\n    prefix = "planner"\n  }\n' })
    assert.equal(projectName(dir), 'planner')
    await writeAll(dir, { 'CLAUDE.md': '# my-planner\n\nThis project ...' })
    assert.equal(projectName(dir), 'my-planner')
    assert.equal(projectName(path.join(dir, 'nothing')), 'nothing')
    await writeAll(dir, {
        'backend/package.json': '{}',
        'backend/.env': 'OIDC_ISSUER=https://login.example.com/oidc\nOIDC_CLIENT_IDS=planner\nOIDC_PRODUCT=planner\n'
    })
    assert.equal(inferProject(dir).link.product, 'planner')
    assert.equal(inferProject(dir).name, 'my-planner')
})

test('update keeps the Pasport design of the frontend in step: styles, components, shell, protected routes', async t => {
    const files = managedFiles(project)
    // A linked app has every design file (the login server all but the shell of AppPage)
    for (const rel of DESIGN_FILES) assert.ok(files[`frontend/${rel}`], rel)
    assert.ok(Object.keys(designFiles()).length < Object.keys(designFiles({ linked: true })).length)
    for (const rel of ['frontend/src/proxy.ts', 'frontend/src/styles/pasport.css', 'frontend/scripts/check-design.mjs'])
        assert.ok(files[rel], rel)
    // The pages and APP_NAV are yours: never managed
    for (const rel of ['frontend/src/app/[locale]/page.tsx', 'frontend/src/lib/nav.ts', 'frontend/src/lib/brand.ts'])
        assert.ok(!files[rel], rel)
    // Every other frontend has the design too (a site, an API, the simple login), but not its pages, rail or name
    const api = { ...project, kind: 'api', link: null }
    const site = Object.keys(managedFiles(api)).filter(rel => rel.startsWith('frontend/'))
    for (const rel of [
        'frontend/src/components/pasport/shell.tsx',
        'frontend/src/styles/pasport.css',
        'frontend/scripts/check-design.mjs'
    ])
        assert.ok(site.includes(rel), rel)
    for (const rel of ['frontend/src/app/[locale]/page.tsx', 'frontend/src/lib/nav.ts', 'frontend/src/lib/brand.ts'])
        assert.ok(!site.includes(rel), rel)
    assert.ok(!site.some(rel => rel.includes('portal-shell') || rel.includes('/lib/oidc')))

    // An older project: the shell it has is yours (no manifest entry), the new one comes next to it; the missing
    // design files and texts are added, your texts stay
    const dir = await tempDir(t)
    await writeAll(dir, files)
    await fs.writeFile(path.join(dir, 'frontend', 'package.json'), '{}')
    await fs.writeFile(path.join(dir, 'frontend/src/components/shell/shell-view.tsx'), 'my old shell')
    await fs.rm(path.join(dir, 'frontend/src/components/pasport/tour.tsx'))
    const manifest = await buildManifest({ projectDir: dir, project, version: '0.46.0' })
    delete manifest.files['frontend/src/components/shell/shell-view.tsx']
    delete manifest.files['frontend/src/components/pasport/tour.tsx']
    await fs.writeFile(path.join(dir, MANIFEST), JSON.stringify(manifest))
    await fs.mkdir(path.join(dir, 'frontend/messages'), { recursive: true })
    const old = { Shell: { logout: 'Bye', mine: 'Mine' }, Nav: { home: 'Home' } }
    for (const locale of ['en', 'nl', 'fr', 'de'])
        await fs.writeFile(path.join(dir, `frontend/messages/${locale}.json`), JSON.stringify(old))

    const lines = []
    const plan = await update({ projectDir: dir, version: '0.47.1', log: line => lines.push(line) })
    const action = rel => plan.find(entry => entry.rel === rel).action
    assert.equal(action('frontend/src/components/shell/shell-view.tsx'), 'changed')
    assert.equal(action('frontend/src/components/pasport/tour.tsx'), 'new')
    assert.equal(
        await fs.readFile(path.join(dir, 'frontend/src/components/shell/shell-view.tsx'), 'utf8'),
        'my old shell'
    )
    assert.equal(
        await fs.readFile(path.join(dir, 'frontend/src/components/shell/shell-view.tsx' + NEW_SUFFIX), 'utf8'),
        files['frontend/src/components/shell/shell-view.tsx']
    )
    const nl = JSON.parse(await fs.readFile(path.join(dir, 'frontend/messages/nl.json'), 'utf8'))
    assert.equal(nl.Shell.logout, 'Bye')
    assert.equal(nl.Shell.mine, 'Mine')
    assert.equal(nl.Shell.notifications, DESIGN_MESSAGES.Shell.nl.notifications)
    assert.deepEqual(nl.Portal, DESIGN_MESSAGES.Portal.nl)
    assert.deepEqual(nl.Nav, { home: 'Home' })
    assert.ok(lines.some(line => /messages\/nl\.json.*teksten van het design/.test(line)))
    assert.ok(lines.some(line => /check:design/.test(line)))

    // Again: only your shell stays different, the texts are complete
    const again = await update({ projectDir: dir, version: '0.47.1', log: silent })
    assert.deepEqual(
        again.filter(entry => entry.action !== 'same').map(entry => entry.rel),
        ['frontend/src/components/shell/shell-view.tsx']
    )
})

test('addMissing adds missing texts, also nested ones, and never changes one that is there', () => {
    const into = { a: 'mine', b: { c: 'mine' } }
    assert.deepEqual(addMissing(into, { a: 'new', b: { c: 'new', d: 'new' }, e: { f: 'new' } }), ['b.d', 'e'])
    assert.deepEqual(into, { a: 'mine', b: { c: 'mine', d: 'new' }, e: { f: 'new' } })
})

test('update brings an older frontend without the OpenID Connect login into the Pasport design', async t => {
    const dir = await tempDir(t)
    const site = {
        name: 'shop',
        frontend: true,
        backend: true,
        kind: 'login',
        database: 'shop',
        claude: false,
        cloud: false
    }
    // A frontend of 0.49: its own home page without the shell, the old switchers, no DafkeDD UI, no fonts
    const root = path.join(dir, 'frontend')
    await fs.mkdir(path.join(root, 'src/app/[locale]'), { recursive: true })
    await fs.mkdir(path.join(root, 'src/components'), { recursive: true })
    await fs.mkdir(path.join(root, 'messages'), { recursive: true })
    await fs.writeFile(path.join(root, 'src/app/[locale]/page.tsx'), 'export default function Home() { return null }\n')
    await fs.writeFile(path.join(root, 'src/components/locale-switcher.tsx'), 'old')
    await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ scripts: { dev: 'next dev' }, dependencies: { 'react-icons': '^5.0.0' } })
    )
    await fs.writeFile(path.join(root, 'messages/en.json'), JSON.stringify({ HomePage: { title: 'Mine' } }))
    await fs.writeFile(path.join(dir, MANIFEST), JSON.stringify({ version: '0.49.0', project: site, files: {} }))

    const calls = []
    const exec = async (cmd, args) => calls.push([cmd, ...args].join(' '))
    const dafkeUi = {
        clone: async () => fs.mkdtemp(path.join(os.tmpdir(), 'ui-')),
        setup: async ({ root: where }) => fs.mkdir(path.join(where, 'src/components/ui'), { recursive: true })
    }
    const lines = []
    await update({ projectDir: dir, version: '0.51.0', log: line => lines.push(String(line)), exec, dafkeUi })

    // The design itself is written; the home page you have gets the new one next to it
    assert.ok(await exists(path.join(root, 'src/components/pasport/shell.tsx')))
    assert.ok(await exists(path.join(root, 'src/styles/pasport.css')))
    assert.equal(
        await fs.readFile(path.join(root, 'src/app/[locale]/page.tsx'), 'utf8'),
        'export default function Home() { return null }\n'
    )
    assert.match(await fs.readFile(path.join(root, `src/app/[locale]/page.tsx${NEW_SUFFIX}`), 'utf8'), /<AppPage>/)
    // The starters that were missing: the rail, the account of the simple login, the login pages
    assert.match(await fs.readFile(path.join(root, 'src/lib/nav.ts'), 'utf8'), /APP_NAV/)
    assert.match(await fs.readFile(path.join(root, 'src/components/shell/account.ts'), 'utf8'), /\/auth\/me/)
    assert.match(await fs.readFile(path.join(root, 'src/app/[locale]/login/page.tsx'), 'utf8'), /AuthForm/)
    // The old switchers are left alone and reported; the check, the fonts and DafkeDD UI come with it
    assert.ok(await exists(path.join(root, 'src/components/locale-switcher.tsx')))
    assert.ok(lines.some(line => line.includes('locale-switcher.tsx: niet meer nodig')))
    assert.ok(lines.some(line => line.includes('npm uninstall react-icons')))
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
    assert.equal(pkg.scripts['check:design'], 'node scripts/check-design.mjs')
    assert.equal(pkg.scripts.dev, 'next dev')
    assert.ok(calls.some(call => call.startsWith('npm install @fontsource-variable/hanken-grotesk@latest')))
    assert.ok(await exists(path.join(root, 'src/components/ui')))
    // The texts of the design are added, yours stay
    const en = JSON.parse(await fs.readFile(path.join(root, 'messages/en.json'), 'utf8'))
    assert.equal(en.HomePage.title, 'Mine')
    assert.ok(en.Shell && en.Nav && en.Auth)

    // Once in the design (<AppPage> on the home page) the starters are yours: no new .dafkedd-new next time
    await fs.rename(
        path.join(root, `src/app/[locale]/page.tsx${NEW_SUFFIX}`),
        path.join(root, 'src/app/[locale]/page.tsx')
    )
    await fs.rm(path.join(root, `src/app/[locale]/login/page.tsx`))
    await update({ projectDir: dir, version: '0.51.0', log: () => {}, exec, dafkeUi })
    assert.ok(!(await exists(path.join(root, 'src/app/[locale]/login/page.tsx'))), 'a page you removed stays away')
})
