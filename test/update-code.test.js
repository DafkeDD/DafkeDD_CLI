import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
    answersOf,
    codeFiles,
    formatLike,
    frontendMessages,
    isStarter,
    moveReadmesToDocs,
    untouchedSinceFirstCommit,
    updateEnv,
    updatePackages
} from '../src/update-code.js'

async function tempDir(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-code-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    return dir
}

async function writeAll(dir, files) {
    for (const [rel, content] of Object.entries(files)) {
        await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
        await fs.writeFile(path.join(dir, rel), content)
    }
}

const PASPORT = {
    name: 'kids',
    frontend: true,
    backend: true,
    kind: 'pasport',
    database: 'dafkedd_kids',
    modules: null,
    link: null,
    claude: false,
    cloud: false
}

const APP = {
    ...PASPORT,
    name: 'planner',
    kind: 'app',
    database: 'planner',
    modules: { mail: true, files: false, isolation: 'database' },
    link: {
        issuer: 'http://localhost:4000/oidc',
        accountUrl: 'http://localhost:3000',
        clientId: 'planner',
        product: 'planner'
    }
}

const ENV = [
    'PORT=4000',
    'DATABASE_HOST=localhost',
    'DATABASE_PORT=5432',
    'DATABASE_USER=postgres',
    "DATABASE_PASSWORD='Zq7-only-in-env'",
    'DATABASE_NAME=dafkedd_kids',
    "OIDC_MASTER_KEY='0123'",
    'OIDC_EXTERNAL_ISSUER=https://accounts.google.com',
    'OIDC_EXTERNAL_CLIENT_ID=g-1',
    ''
].join('\n')

test('codeFiles: the code of the login server and its frontend, never .env, package.json or a password', async t => {
    const dir = await tempDir(t)
    await writeAll(dir, { 'backend/.env': ENV })
    const files = codeFiles(PASPORT, dir)
    for (const rel of [
        'backend/src/oidc/oidc.service.ts',
        'backend/src/database/migrations.ts',
        'backend/scripts/demo-data.mjs',
        'frontend/src/components/oidc-login.tsx',
        'frontend/src/components/pasport/customer/my-apps.tsx'
    ])
        assert.ok(files[rel], rel)
    for (const rel of [
        'backend/.env',
        'backend/.env.example',
        'backend/package.json',
        'backend/docker-compose.yml',
        'frontend/.env.local',
        'frontend/package.json'
    ])
        assert.equal(files[rel], undefined, rel)
    assert.ok(!Object.keys(files).some(rel => rel.startsWith('frontend/messages/')))
    assert.ok(!Object.values(files).some(content => content.includes('Zq7-only-in-env')))
    // The users table is named after the database, like when the project was made
    assert.match(files['backend/src/database/database.constants.ts'], /'dafkedd_kidsusers'/)
    // The starting points (your home page, pages in the rail, the example notes, the modules, the roles) are in the
    // code (and the manifest), update leaves them alone when they are there (see update.test.js)
    assert.ok(files['backend/src/app.module.ts'])
    assert.ok(isStarter('backend/src/app.module.ts', 'app'))
    // The login server: its module list is the CLI's (it adds modules), only the examples and config are yours
    assert.ok(!isStarter('backend/src/app.module.ts', 'pasport'))
    assert.ok(isStarter('backend/src/examples/examples.controller.ts', 'pasport'))
    assert.ok(isStarter('backend/config/app-roles.json', 'app'))
    assert.ok(!isStarter('backend/src/oidc/oidc.service.ts', 'pasport'))
    // The portal of the login server is the CLI's: its home page is kept in step, the one of an app is yours
    assert.equal(isStarter('frontend/src/app/[locale]/page.tsx', 'pasport'), false)
    assert.equal(isStarter('frontend/src/app/[locale]/page.tsx', 'app'), true)
    assert.equal(isStarter('backend/src/notes/notes.controller.ts', 'app'), true)
    // Without DATABASE_NAME the code of the login server is not known: left alone
    const empty = await tempDir(t)
    assert.ok(!Object.keys(codeFiles(PASPORT, empty)).some(rel => rel.startsWith('backend/')))
})

test('answersOf: a linked app from the manifest and its .env files, its name from src/lib/brand.ts', async t => {
    const dir = await tempDir(t)
    await writeAll(dir, {
        'backend/.env':
            'DATABASE_NAME=planner\nOIDC_AUDIENCE=http://localhost:4000\nCORS_ORIGIN=http://localhost:3005\n',
        'frontend/src/lib/brand.ts':
            "export const BRAND = 'Pasport'\nexport const APP_NAME: string | null = 'Plan\\'ner'\n"
    })
    const answers = answersOf(APP, dir)
    assert.deepEqual(
        {
            issuer: answers.link.issuer,
            apiUrl: answers.link.apiUrl,
            clientId: answers.link.clientId,
            product: answers.link.product,
            name: answers.link.name,
            port: answers.link.port
        },
        {
            issuer: 'http://localhost:4000/oidc',
            apiUrl: 'http://localhost:4000',
            clientId: 'planner',
            product: 'planner',
            name: "Plan'ner",
            port: 3005
        }
    )
    assert.equal(answers.api.linked, answers.link)
    const files = codeFiles(APP, dir)
    assert.match(files['frontend/src/lib/brand.ts'], /APP_NAME: string \| null = "Plan'ner"/)
    assert.ok(files['backend/src/pasport/pasport-vault.service.ts'])
    assert.ok(files['backend/src/mail/mail.service.ts'])
    // The texts of the frontend of this version, per language
    assert.ok(frontendMessages(APP, dir).nl.AppLicense)
    // ... and the texts of the first-login tour, which update adds to an older linked app
    for (const locale of ['en', 'nl', 'fr', 'de'])
        assert.ok(frontendMessages(APP, dir)[locale].AppTour.pages.home, locale)
})

test('moveReadmesToDocs: the READMEs go to ./docs like when the project was made, with the title they had', async t => {
    const dir = await tempDir(t)
    await writeAll(dir, {
        'docs/README.md': 'old',
        'backend/README.md': '# App voor een bestaande server\n\nThe documentation lives in one place.\n'
    })
    const moved = moveReadmesToDocs(dir, APP, {
        'backend/README.md': '# Backend\n\nAll of it.\n',
        'backend/src/a.ts': 'a'
    })
    assert.equal(moved['docs/api.md'], '# Backend\n\nAll of it.\n')
    assert.match(moved['backend/README.md'], /^# App voor een bestaande server\n/)
    assert.match(moved['backend/README.md'], /\.\.\/docs\/api\.md/)
    assert.match(moved['docs/README.md'], /http:\/\/localhost:4001\/docs/)
    assert.ok(moved['docs/index.html'])
    assert.equal(moved['backend/src/a.ts'], 'a')
    // Without ./docs: as they are
    const plain = await tempDir(t)
    assert.deepEqual(moveReadmesToDocs(plain, APP, { 'backend/README.md': 'x' }), { 'backend/README.md': 'x' })
})

test('updateEnv: the new settings with their comment at the end, never one that is there (also as a comment)', async t => {
    const dir = await tempDir(t)
    await writeAll(dir, {
        'backend/.env': ENV + '# OIDC_EID_REQUIRED=on\n',
        'backend/.env.example': 'DATABASE_NAME=dafkedd_kids\n'
    })
    const lines = await updateEnv({ projectDir: dir, project: PASPORT })
    assert.equal(lines.length, 2)
    const env = await fs.readFile(path.join(dir, 'backend/.env'), 'utf8')
    assert.ok(env.startsWith(ENV))
    assert.match(env, /# Added by DafkeDD_CLI update/)
    // Google is there already (OIDC_EXTERNAL_*): Microsoft is suggested as the second, with what to register
    assert.match(env, /^OIDC_EXTERNAL_2_ISSUER=https:\/\/login\.microsoftonline\.com\/organizations\/v2\.0$/m)
    assert.match(env, /xms_edov/)
    assert.equal(env.match(/^OIDC_EXTERNAL_ISSUER=/gm).length, 1)
    assert.ok(!/^OIDC_EID_REQUIRED=/m.test(env), 'a setting that is there as a comment stays yours')
    assert.ok(!env.includes('OIDC_MASTER_KEY=change-me'), 'never a placeholder over a secret')
    // Again: nothing more
    assert.deepEqual(await updateEnv({ projectDir: dir, project: PASPORT }), [])
    // A missing secret comes as a comment, never as a placeholder value the API would start with
    const bare = await tempDir(t)
    await writeAll(bare, { 'backend/.env': 'DATABASE_NAME=dafkedd_kids\n' })
    await updateEnv({ projectDir: bare, project: PASPORT })
    const added = await fs.readFile(path.join(bare, 'backend/.env'), 'utf8')
    assert.match(added, /^# OIDC_MASTER_KEY=change-me/m)
    assert.ok(!/^OIDC_MASTER_KEY=/m.test(added))
})

test('updatePackages: missing scripts with the indentation of the file, missing packages installed', async t => {
    const dir = await tempDir(t)
    const pkg = {
        name: 'backend',
        scripts: { 'demo:data': 'mine' },
        dependencies: { pg: '^8' },
        devDependencies: { '@types/pg': '^8' }
    }
    await writeAll(dir, {
        'backend/.env': ENV,
        'backend/package.json': JSON.stringify(pkg, null, 4) + '\n'
    })
    const installed = []
    const lines = await updatePackages({
        projectDir: dir,
        project: { ...PASPORT, frontend: false },
        exec: async (command, args, options) => installed.push([command, args.join(' '), options.cwd])
    })
    const after = await fs.readFile(path.join(dir, 'backend/package.json'), 'utf8')
    assert.match(after, /^ {4}"name": "backend"/m)
    const scripts = JSON.parse(after).scripts
    assert.equal(scripts['demo:data'], 'mine')
    assert.equal(scripts['demo:clear'], 'node scripts/demo-data.mjs --remove')
    assert.ok(lines.some(line => line.includes('demo:clear')))
    assert.ok(installed.some(([command, args]) => command === 'npm' && args.includes('cookie-parser@latest')))
    assert.ok(
        installed.every(([, args]) => !/(^| )pg@/.test(args)),
        'a package that is there is not installed again'
    )
})

test('untouchedSinceFirstCommit: only files of the first commit that never changed since', async t => {
    const dir = await tempDir(t)
    const git = (...args) =>
        execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=a', ...args], { cwd: dir, stdio: 'pipe' })
    await writeAll(dir, { 'a.ts': 'a', 'b.ts': 'b', 'c.ts': 'c', 'sub/d with space.ts': 'd' })
    git('init', '-q')
    git('add', '-A')
    git('commit', '-qm', 'first')
    await fs.writeFile(path.join(dir, 'b.ts'), 'mine')
    git('commit', '-qam', 'mine')
    await fs.writeFile(path.join(dir, 'c.ts'), 'not committed')
    // Added later by you: not of the first commit
    await writeAll(dir, { 'e.ts': 'e' })
    git('add', '-A')
    git('commit', '-qm', 'later')
    assert.deepEqual(
        [...(await untouchedSinceFirstCommit(dir, ['a.ts', 'b.ts', 'c.ts', 'sub/d with space.ts', 'e.ts']))].sort(),
        ['a.ts', 'sub/d with space.ts']
    )
    // Without git: nothing is known
    const plain = await tempDir(t)
    assert.equal((await untouchedSinceFirstCommit(plain, ['a.ts'])).size, 0)
})

test('formatLike: without Prettier in the project there is nothing to compare with', async t => {
    const dir = await tempDir(t)
    assert.equal(await formatLike(dir, 'backend', { 'backend/a.ts': 'a' }), null)
    assert.ok(!existsSync(path.join(dir, 'backend')))
})

test('codeFiles: update brings /api of the frontend and the rate limit of the login to a project with the simple login', async t => {
    const dir = await tempDir(t)
    await writeAll(dir, { 'backend/.env': 'PORT=4000\nDATABASE_NAME=shop\nCORS_ORIGIN=http://localhost:3000\n' })
    const login = { ...PASPORT, name: 'shop', kind: 'login', database: 'shop' }
    const files = codeFiles(login, dir)
    assert.ok(files['frontend/src/app/api/[[...path]]/route.ts'], 'the /api route')
    // The proxy that protects every page, and the check of returnTo
    assert.match(files['frontend/src/proxy.ts'], /export const PUBLIC_PATHS = \['\/login', '\/register'\]/)
    assert.ok(files['frontend/src/lib/return-to.ts'], 'safeReturn')
    assert.match(files['frontend/src/lib/api.ts'], /const BASE = typeof window === 'undefined' \? API_URL : '\/api'/)
    assert.ok(files['backend/src/auth/auth-throttler.guard.ts'], 'the guard of the rate limit')
    assert.match(files['backend/src/setup.ts'], /trustProxy\(config\.get<string>\('TRUST_PROXY'\)\)/)
    // Never a secret or an .env
    assert.ok(!Object.keys(files).some(rel => /\.env/.test(rel)))
    // A project with an API without login keeps calling it directly
    const api = codeFiles({ ...login, kind: 'api', database: null }, dir)
    assert.equal(api['frontend/src/app/api/[[...path]]/route.ts'], undefined)
    assert.ok(!api['frontend/src/proxy.ts'].includes('PUBLIC_PATHS'), 'a site without a login stays public')
    assert.match(api['frontend/src/lib/api.ts'], /fetch\(API_URL \+ path/)
})

test('updateEnv adds API_PROXY_SECRET only as a comment: never the placeholder of .env.example as a secret', async t => {
    const dir = await tempDir(t)
    await writeAll(dir, { 'backend/.env': 'PORT=4000\nDATABASE_NAME=shop\n' })
    const login = { ...PASPORT, name: 'shop', kind: 'login', database: 'shop' }
    await updateEnv({ projectDir: dir, project: login })
    const env = await fs.readFile(path.join(dir, 'backend', '.env'), 'utf8')
    assert.match(env, /^# API_PROXY_SECRET=/m)
    assert.ok(!/^API_PROXY_SECRET=/m.test(env), 'never an active API_PROXY_SECRET')
})
