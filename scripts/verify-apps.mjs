#!/usr/bin/env node
// Generates real projects with the steps of the CLI (no questions: fixed answers) and checks every one of them: the
// build, lint and tests the CLI runs itself, plus Prettier, TypeScript and, with a database, the tests against a real
// PostgreSQL. Used by the tester agent (.claude/agents/tester.md) before a commit that touches what the CLI generates.
//
//   npm run verify                         every variant
//   npm run verify -- --only app-full      one variant (pasport, plain, app, app-full)
//   npm run verify -- --keep               keep the projects (the folder is printed)
//   npm run verify -- --require-db         fail when the database cannot be reached (instead of skipping test:db)
//   npm run verify -- --lighthouse         also Lighthouse as in the CI (needs Chrome; CHROME_PATH for another one)
//   VERIFY_GITLEAKS=<path to gitleaks>     also gitleaks over a first commit of every project, as in the CI
//
// The database: VERIFY_DB_HOST, VERIFY_DB_PORT, VERIFY_DB_USER, VERIFY_DB_PASSWORD (default localhost:5432, postgres,
// postgres). The user needs CREATEDB (the tests make and remove their own databases).
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { nextjs } from '../src/frontends/nextjs.js'
import { nestjs } from '../src/backends/nestjs.js'
import { linked } from '../src/backends/linked.js'
import { hashPassword } from '../src/backends/oidc.js'
import { usersTable } from '../src/backends/auth.js'
import { run } from '../src/runner.js'
import { claudeSteps, describeProject, LHCI_VERSION, lighthouseUrls, projectClaudeFiles } from '../src/claude.js'
import { MANIFEST, manifestSteps, readManifest } from '../src/manifest.js'
import { update } from '../src/update.js'
import { checks, FAIL } from '../src/doctor.js'
import { cloudFiles, cloudSteps } from '../src/cloud.js'
import { docsStep } from '../src/docs.js'
import { kbFiles, kbSteps } from '../src/kb.js'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const { values: flags } = parseArgs({
    options: {
        only: { type: 'string' },
        keep: { type: 'boolean', default: false },
        'require-db': { type: 'boolean', default: false },
        lighthouse: { type: 'boolean', default: false }
    }
})

const db = name => ({
    id: 'postgres',
    mode: 'local',
    host: process.env.VERIFY_DB_HOST ?? 'localhost',
    port: Number(process.env.VERIFY_DB_PORT ?? 5432),
    user: process.env.VERIFY_DB_USER ?? 'postgres',
    password: process.env.VERIFY_DB_PASSWORD ?? 'postgres',
    // Unique per run: two runs never share a database
    database: `${name}_${randomBytes(3).toString('hex')}`,
    project: name
})

/** What a link code answers (the login server is not needed to generate the app). */
const LINK = {
    issuer: 'http://localhost:4000/oidc',
    apiUrl: 'http://localhost:4000',
    accountUrl: 'http://localhost:3000',
    clientId: 'verify',
    clientSecret: null,
    name: 'Verify',
    firstParty: true,
    scopes: ['openid', 'profile', 'email', 'tenant'],
    product: 'verify',
    port: 3001
}

const VARIANTS = {
    // The login server itself: Next.js + NestJS with the OpenID Connect server
    pasport: async () => {
        const adminPassword = randomBytes(12).toString('base64url')
        const oidc = {
            adminEmail: 'admin@example.com',
            adminPassword,
            adminPasswordHash: await hashPassword(adminPassword),
            masterKey: randomBytes(32).toString('hex'),
            loginUi: true,
            appName: 'verify',
            externals: [],
            // The demo data too (the question of the CLI): added during the install, checked below
            demo: { password: randomBytes(12).toString('base64url') }
        }
        const answers = { database: db('pasport'), auth: false, oidc }
        return {
            frontend: { answers: { ui: 'all' }, api: { ...nestjs.api, auth: false, oidc: true } },
            backend: { part: nestjs, answers }
        }
    },
    // Without the OpenID Connect server: Next.js + NestJS + PostgreSQL with the simple login, in the Pasport design too
    plain: async () => {
        const answers = { database: db('plain'), auth: true, oidc: null }
        // Shared by the frontend and the API, as the CLI does (API_PROXY_SECRET)
        const proxy = randomBytes(32).toString('hex')
        return {
            frontend: { answers: { ui: 'all' }, api: { ...nestjs.api, auth: true, oidc: false, proxySecret: proxy } },
            backend: { part: nestjs, answers, secrets: { proxy } },
            // The login through /api of the frontend, with the built API and frontend running
            flow: loginThroughFrontend
        }
    },
    // An app for an existing login server, without modules (one database, Row-Level Security)
    app: async () => {
        const answers = {
            link: LINK,
            database: db('app'),
            appOptions: { mail: false, files: false, isolation: 'rls' }
        }
        return { frontend: { answers: { ui: 'all' }, api: linked.apiFor(answers) }, backend: { part: linked, answers } }
    },
    // The same app with every module and a database per organisation
    'app-full': async () => {
        const answers = {
            link: LINK,
            database: db('appfull'),
            appOptions: { mail: true, files: true, isolation: 'database' }
        }
        return { frontend: { answers: { ui: 'all' }, api: linked.apiFor(answers) }, backend: { part: linked, answers } }
    }
}

const names = flags.only ? flags.only.split(',') : Object.keys(VARIANTS)
for (const name of names) if (!VARIANTS[name]) throw new Error(`Unknown variant ${name} (${Object.keys(VARIANTS)})`)

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-verify-'))
const failures = []
const skipped = []
const started = Date.now()
const log = text => console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s] ${text}`)

/** Runs `npm run <script>` when package.json has it. */
async function script(dir, name) {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'))
    if (!pkg.scripts?.[name]) return false
    await run('npm', ['run', name], { cwd: dir })
    return true
}

/** The files of Claude Code, the knowledge base and Google Cloud are in the project, and their scripts work. */
async function checkExtras(projectDir, project) {
    const expected = [
        ...Object.keys(projectClaudeFiles(project)),
        ...Object.keys(kbFiles(project)),
        ...Object.keys(cloudFiles(project))
    ]
    const missing = expected.filter(rel => !existsSync(path.join(projectDir, rel)))
    if (missing.length) throw new Error(`Missing in the project: ${missing.join(', ')}`)
    for (const rel of ['.mcp.json', '.claude/settings.json', '.claude/git-policy.json', 'docs/kb/pages.json'])
        JSON.parse(await fs.readFile(path.join(projectDir, rel), 'utf8'))
    for (const rel of expected.filter(rel => rel.endsWith('.mjs')))
        await run('node', ['--check', path.join(projectDir, rel)])
    if (!(await fs.readFile(path.join(projectDir, 'docs', 'README.md'), 'utf8')).includes('kb/README.md'))
        throw new Error('docs/README.md does not link the knowledge base')
    // The git guard of the project: no commit on developer, only on the branch of an issue
    await run('git', ['init', '-q', '-b', 'developer'], { cwd: projectDir })
    const hook = command =>
        spawnSync('node', ['.claude/hooks/guard-git.mjs'], {
            cwd: projectDir,
            input: JSON.stringify({ tool_input: { command }, cwd: projectDir }),
            encoding: 'utf8',
            env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir }
        })
    const commit = hook('git commit -m "x (closes #1)"')
    if (commit.status !== 2 || !/branch of the issue/.test(commit.stderr))
        throw new Error(`The git guard let a commit on developer through: ${commit.stderr}`)
    if (hook('git push origin main').status !== 2) throw new Error('The git guard let a push to main through')
    // The Prettier hook formats a file of the frontend with the Prettier of the frontend
    const file = path.join(projectDir, 'frontend', 'src', 'verify-format.ts')
    await fs.writeFile(file, 'export const x={a:1};\n')
    spawnSync('node', ['.claude/hooks/format.mjs'], {
        cwd: projectDir,
        input: JSON.stringify({ tool_input: { file_path: file } }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir }
    })
    const formatted = await fs.readFile(file, 'utf8')
    await fs.rm(file)
    if (formatted !== 'export const x = { a: 1 }\n') throw new Error(`The Prettier hook did not format: ${formatted}`)
    await fs.rm(path.join(projectDir, '.git'), { recursive: true, force: true })
    // The manifest knows every managed file, and update on a fresh project changes nothing
    const manifest = readManifest(projectDir)
    if (!manifest) throw new Error(`No ${MANIFEST}`)
    const plan = await update({
        projectDir,
        version: 'verify',
        log: () => {},
        // Never a question here: a fresh project has nothing to ask about
        prompts: { confirm: async () => false }
    })
    const changed = plan.filter(entry => entry.action !== 'same')
    if (changed.length) throw new Error(`update changes a fresh project: ${JSON.stringify(changed)}`)
    // doctor finds nothing that does not work (warnings, such as gh or Chrome, are fine here)
    const failed = (await checks({ projectDir, version: 'verify' })).filter(entry => entry.status === FAIL)
    if (failed.length) throw new Error(`doctor: ${failed.map(entry => entry.text).join(', ')}`)
    // The backend starts as on Cloud Run: the built API on PORT 8080 answers /health
    await startsOnPort(path.join(projectDir, 'backend'))
}

/** Starts `node dist/main` with PORT=8080 and waits for an answer of /health (any status: the database may be off). */
async function startsOnPort(dir) {
    const child = spawn('node', ['dist/main'], {
        cwd: dir,
        // As on Cloud Run: the test eID and the test payments are refused in production (cloud.js sets them so too)
        env: { ...process.env, PORT: '8080', NODE_ENV: 'production', OIDC_EID: 'on', PAYMENTS: 'off' },
        stdio: 'ignore'
    })
    try {
        for (let i = 0; i < 40; i++) {
            await new Promise(resolve => setTimeout(resolve, 500))
            const answer = await fetch('http://127.0.0.1:8080/health').catch(() => null)
            if (answer) return
        }
        throw new Error('The built backend did not answer on PORT 8080')
    } finally {
        child.kill()
    }
}

/** Starts a process and waits until `url` answers (any status); returns the process. */
async function serve(command, args, { cwd, env, url }) {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'ignore' })
    for (let i = 0; i < 120; i++) {
        await new Promise(resolve => setTimeout(resolve, 500))
        if (await fetch(url).catch(() => null)) return child
    }
    child.kill()
    throw new Error(`${command} ${args.join(' ')} did not answer on ${url}`)
}

/**
 * The simple login through /api of the frontend, as a browser does it: every page needs a login (and comes back after
 * it, never to another host); register, me, log out; a change from another site is refused; a browser that writes its
 * own X-Forwarded-For does not escape the rate limit of the login.
 */
async function loginThroughFrontend(projectDir) {
    const LIMIT = 4
    const api = await serve('node', ['dist/main'], {
        cwd: path.join(projectDir, 'backend'),
        env: { PORT: '4100', AUTH_RATE_LIMIT: String(LIMIT) },
        url: 'http://127.0.0.1:4100/health'
    })
    let web = null
    try {
        web = await serve('node', [path.join('node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', '3100'], {
            cwd: path.join(projectDir, 'frontend'),
            env: { API_URL: 'http://127.0.0.1:4100' },
            url: 'http://127.0.0.1:3100/api/health'
        })
        const base = 'http://127.0.0.1:3100'
        const json = { 'content-type': 'application/json', origin: base }
        const health = await fetch(base + '/api/health')
        if (health.status !== 200) throw new Error(`/api/health through the frontend: ${health.status}`)
        // Every page needs a login: without a session to /login, and back after it; /login and /register stay open
        const page = (url, cookie) => fetch(base + url, { redirect: 'manual', headers: cookie ? { cookie } : {} })
        const goesTo = async (url, cookie) => {
            const answer = await page(url, cookie)
            return answer.status >= 300 && answer.status < 400
                ? new URL(answer.headers.get('location'), base).href
                : answer.status
        }
        for (const [url, expected] of [
            ['/', base + '/login'],
            ['/profile', base + '/login?returnTo=%2Fprofile'],
            ['/login', 200],
            ['/register', 200],
            ['/apikeys', base + '/login?returnTo=%2Fapikeys']
        ]) {
            const where = await goesTo(url)
            if (where !== expected) throw new Error(`${url} without a session: ${where}, not ${expected}`)
        }
        const email = `verify-${Date.now()}@example.com`
        const registered = await fetch(base + '/api/auth/register', {
            method: 'POST',
            headers: json,
            body: JSON.stringify({ name: 'Verify', email, password: 'correct horse battery' })
        })
        const cookie = registered.headers.getSetCookie().find(value => value.startsWith('session='))
        if (registered.status !== 201 || !cookie || !/HttpOnly/i.test(cookie) || /Domain=/i.test(cookie))
            throw new Error(`register through /api: ${registered.status} ${cookie ?? 'no session cookie'}`)
        const session = cookie.split(';')[0]
        const me = await fetch(base + '/api/auth/me', { headers: { cookie: session } })
        if (me.status !== 200 || (await me.json()).email !== email) throw new Error(`/api/auth/me: ${me.status}`)
        // Logged in: the page opens; the login sends you on, only to a page of this app (never another host)
        if ((await goesTo('/profile', session)) !== 200) throw new Error('/profile with a session is not shown')
        for (const [url, expected] of [
            ['/login?returnTo=%2Fprofile', base + '/profile'],
            ['/login?returnTo=' + encodeURIComponent('//evil.example.com'), base + '/'],
            ['/login?returnTo=' + encodeURIComponent('https://evil.example.com'), base + '/'],
            ['/login?returnTo=' + encodeURIComponent('/..//evil.example.com'), base + '/']
        ]) {
            const where = await goesTo(url, session)
            if (where !== expected) throw new Error(`${url} with a session: ${where}, not ${expected}`)
        }
        const forged = await fetch(base + '/api/auth/logout', {
            method: 'POST',
            headers: { cookie: session, origin: 'https://evil.example.com' }
        })
        if (forged.status !== 403) throw new Error(`a logout from another site: ${forged.status}`)
        const logout = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { ...json, cookie: session } })
        if (![200, 201, 204].includes(logout.status)) throw new Error(`log out through /api: ${logout.status}`)
        // Another X-Forwarded-For and another account on every try: still LIMIT tries per minute (register counted too)
        let blocked = 0
        for (let i = 0; i <= LIMIT; i++) {
            const attempt = await fetch(base + '/api/auth/login', {
                method: 'POST',
                headers: { ...json, 'x-forwarded-for': `198.51.100.${i}`, 'x-client-address': `203.0.113.${i}` },
                body: JSON.stringify({ email: `nobody-${i}@example.com`, password: 'wrong password' })
            })
            if (attempt.status === 429) blocked++
        }
        if (!blocked) throw new Error('a forged X-Forwarded-For escaped the rate limit of the login')
    } finally {
        web?.kill()
        api.kill()
    }
}

/** How pg connects to the database of a variant (its answers also have `connection`, which pg reads as a socket). */
const connectionOf = ({ host, port, user, password, database }) => ({ host, port, user, password, database })

/** The superadmin of .env is in the users table with the hash of the CLI (the API made it at its first start). */
async function superadminExists(dir, database, oidc) {
    const pg = createRequire(path.join(dir, 'package.json'))('pg')
    const client = new pg.Client(connectionOf(database))
    await client.connect()
    try {
        const { rows } = await client.query(
            `SELECT password_hash FROM "${usersTable(database.database)}" WHERE is_superadmin AND lower(email) = $1`,
            [oidc.adminEmail.toLowerCase()]
        )
        if (rows[0]?.password_hash !== oidc.adminPasswordHash)
            throw new Error(`No superadmin ${oidc.adminEmail} with the password of the CLI after the first start`)
    } finally {
        await client.end()
    }
}

for (const name of names) {
    const projectDir = path.join(root, name)
    await fs.mkdir(projectDir)
    const variant = await VARIANTS[name]()
    try {
        // Everything the CLI adds when every question is answered with yes, in the order of the CLI
        const project = describeProject({
            name,
            frontend: nextjs,
            backend: variant.backend.part,
            answers: variant.backend.answers
        })
        project.cloud = true
        project.claude = true
        const steps = [
            ...(await nextjs.steps({ projectDir, answers: variant.frontend.answers, api: variant.frontend.api })),
            ...(await variant.backend.part.steps({
                projectDir,
                answers: variant.backend.answers,
                secrets: variant.backend.secrets
            })),
            docsStep({
                projectDir,
                parts: [
                    { dir: 'frontend', file: 'frontend.md', title: 'Next.js' },
                    { dir: 'backend', file: 'api.md', title: 'NestJS' }
                ],
                // Like the CLI: the Swagger of the API (the API of a linked app on its own port)
                swagger: `http://localhost:${variant.frontend.api?.linked ? 4001 : 4000}/docs`,
                kb: true
            }),
            ...kbSteps({ projectDir, project }),
            ...claudeSteps({ projectDir, project, owner: async () => 'dafkedd' }),
            ...cloudSteps({ projectDir, project }),
            ...manifestSteps({ projectDir, project, version: 'verify' })
        ]
        for (const step of steps) {
            log(`${name}: ${step.title}`)
            await step.run()
        }
        log(`${name}: Claude Code, knowledge base and Google Cloud in the project`)
        await checkExtras(projectDir, project)
        const frontend = path.join(projectDir, 'frontend')
        const backend = path.join(projectDir, 'backend')
        log(`${name}: extra checks (Prettier, TypeScript, lint and the Pasport design of the frontend)`)
        await run('npx', ['--no-install', 'tsc', '--noEmit', '-p', 'tsconfig.json'], { cwd: backend })
        await run('npx', ['--no-install', 'tsc', '--noEmit'], { cwd: frontend })
        await script(backend, 'format:check')
        await script(frontend, 'format:check')
        await script(frontend, 'lint')
        await script(frontend, 'check:design')
        log(`${name}: npm audit (high and critical, as in the CI)`)
        for (const dir of [backend, frontend])
            await run('npm', ['audit', '--omit=dev', '--audit-level=high'], { cwd: dir })
        if (process.env.VERIFY_GITLEAKS) {
            log(`${name}: gitleaks (as in the CI)`)
            await run('git', ['init', '-q'], { cwd: projectDir })
            await run('git', ['add', '-A'], { cwd: projectDir })
            await run(
                'git',
                ['-c', 'user.name=verify', '-c', 'user.email=verify@example.com', 'commit', '-qm', 'verify'],
                {
                    cwd: projectDir
                }
            )
            try {
                await run(process.env.VERIFY_GITLEAKS, ['git', '--redact', '--no-banner', '.'], { cwd: projectDir })
            } finally {
                await fs.rm(path.join(projectDir, '.git'), { recursive: true, force: true })
            }
        }
        if (flags.lighthouse && lighthouseUrls(project).length) {
            log(`${name}: Lighthouse (frontend/lighthouserc.json, as in the CI)`)
            // Chrome refuses its sandbox as root (a container): only then without it
            const root = process.getuid?.() === 0 ? ['--collect.settings.chromeFlags=--no-sandbox'] : []
            await run('npx', ['--yes', `@lhci/cli@${LHCI_VERSION}`, 'autorun', ...root], { cwd: frontend })
        }
        if (variant.backend.answers.database.connection === 'ok') {
            const oidc = variant.backend.answers.oidc
            if (oidc?.adminEmail) {
                // The superadmin of the CLI exists after the first start, also when the demo data came before it
                log(`${name}: the superadmin was made at the first start (after the demo data of the install)`)
                await superadminExists(backend, variant.backend.answers.database, oidc)
            }
            log(`${name}: tests against PostgreSQL (npm run test:db)`)
            await script(backend, 'test:db')
            if (variant.flow) {
                log(`${name}: the login through /api of the frontend (the built API and frontend)`)
                await variant.flow(projectDir)
            }
            const demo = variant.backend.answers.oidc?.demo
            if (demo) {
                log(`${name}: demo data (npm run demo:data, again, demo:clear, again)`)
                if (!demo.added) throw new Error(`The demo data was not added during the install: ${demo.error ?? ''}`)
                for (const script of ['demo:data', 'demo:data', 'demo:clear', 'demo:data'])
                    await run('npm', ['run', script], { cwd: backend })
            }
        } else if (flags['require-db']) {
            throw new Error('The database cannot be reached (VERIFY_DB_*), and --require-db was given')
        } else skipped.push(`${name}: test:db (no database reachable on VERIFY_DB_*)`)
        log(`${name}: OK`)
    } catch (error) {
        failures.push({ name, error })
        log(`${name}: FAILED`)
    } finally {
        // The database of the variant (the tests remove their own), with the pg of the generated backend
        const database = variant.backend.answers.database
        try {
            const pg = createRequire(path.join(projectDir, 'backend', 'package.json'))('pg')
            const client = new pg.Client({ ...connectionOf(database), database: 'postgres' })
            await client.connect()
            try {
                await client.query(`DROP DATABASE IF EXISTS "${database.database}" WITH (FORCE)`)
            } finally {
                await client.end()
            }
        } catch {
            // No database, or no backend: nothing to remove
        }
    }
}

if (flags.keep) console.log(`\nThe projects are in ${root}`)
else await fs.rm(root, { recursive: true, force: true })

for (const line of skipped) console.log(`SKIPPED ${line}`)
for (const { name, error } of failures)
    console.error(`\nFAILED ${name}\n${error instanceof Error ? error.message : error}`)
console.log(
    failures.length ? `\n${failures.length} of ${names.length} variants failed` : `\nAll ${names.length} variants OK`
)
process.exitCode = failures.length ? 1 : 0
