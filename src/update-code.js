import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import pc from 'picocolors'
import * as appBackend from './backends/app.js'
import * as login from './backends/auth.js'
import { buildFiles, PORT, SECURITY_OVERRIDES } from './backends/nestjs.js'
import * as oidc from './backends/oidc.js'
import { databases } from './databases/index.js'
import { EID_MOCK_SCRIPT } from './eid.js'
import { files as nextFiles, LOCALES, sitePages, uiFiles, withApi } from './frontends/nextjs.js'
import { frontendReadme } from './frontends/docs.js'
import { DOCS_DIR, docsFolder, pointer } from './docs.js'
import { parseEnvFile } from './manifest.js'
import { run } from './runner.js'

const git = promisify(execFile)

/**
 * The code of a project that `update` keeps in step since 0.54.0: the source of the backend (the login server, a linked
 * app, an API) and of the frontend, as this version of the CLI makes it. Never the secrets and what is yours to set:
 * .env files, package.json (only missing scripts and packages are added), docker-compose.yml (its password),
 * the texts (only missing ones are added) and the knowledge base.
 */
const NEVER = new Set([
    'backend/.env',
    'backend/.env.example',
    'backend/package.json',
    'backend/docker-compose.yml',
    'frontend/.env.local',
    'frontend/package.json'
])

/**
 * The starting points of a project: the code the CLI writes once for you to build on (your home page and pages in the
 * rail, the example notes, the module list, the roles of your app). `update` only adds them when they are missing: one
 * that is there is never compared with what the CLI makes now, one you deleted stays deleted (the manifest remembers
 * it). Patterns: a folder ends with `/`.
 */
export const STARTERS = [
    'backend/src/app.module.ts',
    'backend/src/app.controller.ts',
    'backend/src/app.service.ts',
    'backend/src/app.controller.spec.ts',
    'backend/src/examples/',
    'backend/src/notes/',
    'backend/config/',
    'backend/test/app.e2e-spec.ts',
    'frontend/src/app/[locale]/page.tsx',
    'frontend/src/lib/nav.ts',
    'frontend/src/components/notes.tsx',
    'frontend/src/components/session-links.tsx',
    'frontend/src/components/api-status.tsx'
]

/**
 * On the login server the frontend is the portal and the backend is the server itself (the CLI adds its modules to
 * app.module.ts): only the examples and the config folder are yours there.
 */
export const isStarter = (rel, kind = null) =>
    (kind !== 'pasport' || rel.startsWith('backend/src/examples/') || rel.startsWith('backend/config/')) &&
    STARTERS.some(starter => (starter.endsWith('/') ? rel.startsWith(starter) : rel === starter))

const readEnv = file => (existsSync(file) ? parseEnvFile(readFileSync(file, 'utf8')) : {})

/** The name of the app in a linked frontend (src/lib/brand.ts: APP_NAME), or null. */
function appNameOf(projectDir) {
    const file = path.join(projectDir, 'frontend', 'src', 'lib', 'brand.ts')
    if (!existsSync(file)) return null
    // As Prettier wrote it: 'Planner' (or "Planner" before formatting), null on the login server
    const found = /APP_NAME: string \| null = (?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/.exec(
        readFileSync(file, 'utf8')
    )
    return found ? (found[1] ?? found[2]).replace(/\\(.)/g, '$1') : null
}

/** The other OpenID Connect servers in a .env (an issuer each), without their secrets. */
function externalsOf(env) {
    const result = []
    for (let n = 1; n <= oidc.MAX_EXTERNALS; n++) {
        const key = name => env[n === 1 ? `OIDC_EXTERNAL_${name}` : `OIDC_EXTERNAL_${n}_${name}`]
        const issuer = (key('ISSUER') ?? '').trim()
        if (!issuer) continue
        try {
            new URL(issuer)
        } catch {
            continue
        }
        result.push({
            issuer,
            clientId: key('CLIENT_ID') ?? '',
            clientSecret: '',
            name: key('NAME') ?? '',
            only: false
        })
    }
    return result
}

/**
 * What the CLI asked when it made the project, as far as the code depends on it: from the manifest and the .env files
 * (never a secret: the code does not contain any).
 */
export function answersOf(project, projectDir) {
    const env = {
        ...readEnv(path.join(projectDir, 'backend', '.env.example')),
        ...readEnv(path.join(projectDir, 'backend', '.env'))
    }
    const database = env.DATABASE_NAME
        ? {
              id: 'postgres',
              mode: existsSync(path.join(projectDir, 'backend', 'docker-compose.yml')) ? 'docker' : 'local',
              host: env.DATABASE_HOST || 'localhost',
              port: Number(env.DATABASE_PORT) || 5432,
              user: env.DATABASE_USER || 'postgres',
              password: '',
              database: env.DATABASE_NAME,
              project: project.name
          }
        : null
    const cors = /:(\d+)\/?$/.exec(env.CORS_ORIGIN ?? '')
    const link =
        project.kind === 'app'
            ? {
                  issuer: project.link?.issuer ?? env.OIDC_ISSUER,
                  apiUrl: env.OIDC_AUDIENCE ?? '',
                  accountUrl: project.link?.accountUrl ?? '',
                  clientId: project.link?.clientId ?? (env.OIDC_CLIENT_IDS ?? '').split(',')[0].trim(),
                  clientSecret: null,
                  product: project.link?.product ?? (env.OIDC_PRODUCT || null),
                  name: appNameOf(projectDir) ?? project.name,
                  firstParty: true,
                  scopes: [],
                  port: cors ? Number(cors[1]) : 3001
              }
            : null
    const oidcAnswers =
        project.kind === 'pasport'
            ? {
                  adminEmail: 'admin@example.com',
                  adminPasswordHash: '',
                  masterKey: '',
                  loginUi: Boolean(project.frontend),
                  // The other OpenID Connect servers set already (OIDC_EXTERNAL_*, _2_* ...): Google and Microsoft are
                  // only suggested when they are not among them
                  externals: externalsOf(env)
              }
            : null
    const appOptions = appBackend.options(project.modules ?? {})
    const api = !project.backend
        ? null
        : link
          ? { port: appBackend.APP_PORT, url: `http://localhost:${appBackend.APP_PORT}`, oidc: true, linked: link }
          : { port: PORT, auth: project.kind === 'login', ...(oidcAnswers ? { oidc: true } : {}) }
    // The login server, a linked app and the simple login need their database: without DATABASE_NAME in .env the code
    // of the backend is not known (it is left alone)
    const backend = Boolean(project.backend) && (database !== null || project.kind === 'api' || !project.kind)
    return { database, link, oidc: oidcAnswers, auth: project.kind === 'login', appOptions, api, env, backend }
}

/** Every file of the code the CLI makes for this project now, as `backend/<file>` and `frontend/<file>`. */
export function codeFiles(project, projectDir) {
    const answers = answersOf(project, projectDir)
    const result = {}
    if (answers.backend) {
        const backend = buildFiles(answers.database, {
            auth: answers.auth ? { jwtSecret: '' } : null,
            oidc: answers.oidc,
            app: answers.link,
            appOptions: answers.appOptions
        })
        for (const [rel, content] of Object.entries(backend)) result[`backend/${rel}`] = content
    }
    if (project.frontend) {
        let all = sitePages({ ...nextFiles, ...uiFiles }, { api: answers.api, appName: project.name })
        if (answers.api) all = withApi(all, answers.api, { ui: true })
        all['README.md'] = frontendReadme({ ui: 'all', api: answers.api, locales: LOCALES, apiPort: answers.api?.port })
        for (const [rel, content] of Object.entries(all))
            if (!rel.startsWith('messages/')) result[`frontend/${rel}`] = content
    }
    for (const rel of NEVER) delete result[rel]
    return result
}

/**
 * The texts the frontend of this project has now, per language (messages/<locale>.json): `update` adds the missing
 * ones, yours stay as they are.
 */
export function frontendMessages(project, projectDir) {
    const answers = answersOf(project, projectDir)
    let all = sitePages({ ...nextFiles, ...uiFiles }, { api: answers.api, appName: project.name })
    if (answers.api) all = withApi(all, answers.api, { ui: true })
    return Object.fromEntries(LOCALES.map(locale => [locale, JSON.parse(all[`messages/${locale}.json`])]))
}

/**
 * Formats the files like Prettier of the project formats them (the CLI runs `prettier --write .` when it makes the
 * project), with the Prettier and the settings in that folder. Without node_modules there: null (run npm install).
 */
export async function formatLike(projectDir, part, files) {
    const root = path.join(projectDir, part)
    let prettier
    let require
    try {
        require = createRequire(path.join(root, 'package.json'))
        const resolved = require.resolve('prettier')
        // Only the Prettier of that folder: one higher up would format otherwise than the project did
        if (!resolved.startsWith(path.join(root, 'node_modules') + path.sep)) return null
        prettier = await import(pathToFileURL(resolved).href)
        prettier = prettier.default ?? prettier
    } catch {
        return null
    }
    const ignorePath = path.join(root, '.prettierignore')
    const result = {}
    for (const [rel, content] of Object.entries(files)) {
        const file = path.join(projectDir, rel)
        try {
            const info = await prettier.getFileInfo(file, {
                ignorePath: existsSync(ignorePath) ? ignorePath : undefined,
                resolveConfig: false
            })
            if (info.ignored || !info.inferredParser) {
                result[rel] = content
                continue
            }
            const options = (await prettier.resolveConfig(file)) ?? {}
            // Plugins from the node_modules of that folder (Prettier would look next to the current directory)
            const plugins = (options.plugins ?? []).map(plugin =>
                typeof plugin === 'string' ? pathToFileURL(require.resolve(plugin)).href : plugin
            )
            result[rel] = await prettier.format(content, { ...options, plugins, filepath: file })
        } catch (error) {
            if (process.env.DAFKEDD_DEBUG) console.error(rel, error)
            // A file Prettier cannot read: as it is
            result[rel] = content
        }
    }
    return result
}

/**
 * Files that are still exactly as the CLI made them, for a project whose manifest does not know them yet (made before
 * update kept the code in step): git knows them from one commit only (the first commit of the CLI) and they did not
 * change since. Those may be replaced; every other file gets the new version next to it.
 */
export async function untouchedSinceFirstCommit(projectDir, rels) {
    const untouched = new Set()
    if (!existsSync(path.join(projectDir, '.git'))) return untouched
    try {
        const { stdout: first } = await git('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: projectDir })
        const roots = new Set(first.split('\n').filter(Boolean))
        const { stdout: dirty } = await git('git', ['status', '--porcelain', '--untracked-files=no'], {
            cwd: projectDir,
            maxBuffer: 64 * 1024 * 1024
        })
        const changed = new Set(
            dirty
                .split('\n')
                .filter(Boolean)
                .map(line => line.slice(3).replace(/^"|"$/g, ''))
        )
        // One log for everything: per file the commits that touched it
        const { stdout: log } = await git('git', ['log', '--format=commit %H', '--name-only', '--no-renames'], {
            cwd: projectDir,
            maxBuffer: 256 * 1024 * 1024
        })
        const commitsOf = new Map()
        let commit = ''
        for (const line of log.split('\n')) {
            if (line.startsWith('commit ')) commit = line.slice(7)
            else if (line) {
                const rel = line.replace(/^"|"$/g, '')
                if (!commitsOf.has(rel)) commitsOf.set(rel, new Set())
                commitsOf.get(rel).add(commit)
            }
        }
        for (const rel of rels) {
            if (changed.has(rel)) continue
            const commits = commitsOf.get(rel)
            if (commits?.size === 1 && roots.has([...commits][0])) untouched.add(rel)
        }
    } catch {
        // No git, or not a repository: nothing is known
    }
    return untouched
}

/** `name@spec` → name (also @scope/name and a URL as spec). */
const packageName = spec => /^(@?[^@]+)@/.exec(spec)?.[1] ?? spec

/** The scripts and packages of the backend of this project now. */
function backendPackages(project, answers) {
    const scripts = {}
    const dependencies = []
    const devDependencies = []
    if (answers.database) {
        const db = databases[answers.database.id]
        Object.assign(scripts, db.backend(answers.database).scripts)
        dependencies.push(...db.dependencies)
        devDependencies.push(...db.devDependencies)
    }
    if (answers.auth) {
        dependencies.push(...login.PACKAGES.dependencies)
        devDependencies.push(...login.PACKAGES.devDependencies)
    }
    if (answers.oidc) {
        Object.assign(scripts, oidc.SCRIPTS)
        dependencies.push(...oidc.PACKAGES.dependencies)
        devDependencies.push(...oidc.PACKAGES.devDependencies)
    }
    if (answers.link) {
        Object.assign(scripts, appBackend.scripts(answers.appOptions))
        const extra = appBackend.packages(answers.appOptions)
        dependencies.push(...extra.dependencies)
        devDependencies.push(...extra.devDependencies)
    }
    return { scripts, dependencies, devDependencies }
}

/**
 * package.json of the backend and the frontend: the scripts of this version that are missing (yours are never
 * changed) and the packages the new code needs (installed with npm). Returns what it did, as lines.
 */
export async function updatePackages({ projectDir, project, exec = run }) {
    const answers = answersOf(project, projectDir)
    const lines = []
    const parts = []
    if (answers.backend) parts.push(['backend', backendPackages(project, answers)])
    if (project.frontend && answers.api?.oidc)
        parts.push([
            'frontend',
            {
                scripts: {
                    'check:design': 'node scripts/check-design.mjs',
                    ...(answers.api.linked ? {} : { 'eid:mock': EID_MOCK_SCRIPT })
                },
                dependencies: [],
                devDependencies: []
            }
        ])
    for (const [part, wanted] of parts) {
        const file = path.join(projectDir, part, 'package.json')
        if (!existsSync(file)) continue
        const text = await fs.readFile(file, 'utf8')
        const pkg = JSON.parse(text)
        const added = Object.keys(wanted.scripts).filter(name => !(name in (pkg.scripts ?? {})))
        const overrides =
            part === 'backend' ? Object.keys(SECURITY_OVERRIDES).filter(name => !(name in (pkg.overrides ?? {}))) : []
        if (overrides.length) pkg.overrides = { ...pkg.overrides, ...SECURITY_OVERRIDES }
        if (added.length) {
            pkg.scripts = { ...pkg.scripts, ...Object.fromEntries(added.map(name => [name, wanted.scripts[name]])) }
            lines.push(`${pc.green('✔')} ${part}/package.json: scripts toegevoegd (${added.join(', ')})`)
        }
        // Only when something was added, with the indentation the file has (Prettier: 4 spaces)
        if (added.length || overrides.length) {
            const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? '  '
            await fs.writeFile(file, JSON.stringify(pkg, null, indent) + '\n')
        }
        const has = name => Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name])
        for (const [list, dev] of [
            [wanted.dependencies, false],
            [wanted.devDependencies, true]
        ]) {
            const missing = list.filter(spec => !has(packageName(spec)))
            if (!missing.length) continue
            try {
                await exec('npm', ['install', ...(dev ? ['--save-dev'] : []), ...missing], {
                    cwd: path.join(projectDir, part)
                })
                lines.push(`${pc.green('✔')} ${part}: pakketten geïnstalleerd (${missing.map(packageName).join(', ')})`)
            } catch {
                lines.push(
                    `${pc.yellow('!')} Installeer zelf in ./${part}: npm install ${dev ? '--save-dev ' : ''}${missing.join(' ')}`
                )
            }
        }
    }
    return lines
}

/**
 * The settings of this version that backend/.env and backend/.env.example miss: added at the end with their comment,
 * from the example (never a secret). What is there is never changed.
 */
export async function updateEnv({ projectDir, project }) {
    const answers = answersOf(project, projectDir)
    if (!answers.backend) return []
    const generated = buildFiles(answers.database, {
        auth: answers.auth ? { jwtSecret: '' } : null,
        oidc: answers.oidc,
        app: answers.link,
        appOptions: answers.appOptions
    })['.env.example']
    if (!generated) return []
    // Every setting of the example with the comment lines right above it
    const blocks = []
    let comments = []
    for (const line of generated.split('\n')) {
        if (/^\s*#/.test(line)) comments.push(line)
        else if (/^[A-Z0-9_]+=/.test(line)) {
            blocks.push({ key: line.split('=')[0], text: [...comments, line].join('\n') })
            comments = []
        } else comments = []
    }
    const lines = []
    for (const name of ['.env', '.env.example']) {
        const file = path.join(projectDir, 'backend', name)
        if (!existsSync(file)) continue
        const text = await fs.readFile(file, 'utf8')
        const known = new Set(Object.keys(parseEnvFile(text)))
        // Also a setting that is only there as a comment (# KEY=...): yours, on purpose
        for (const match of text.matchAll(/^#\s*([A-Z0-9_]+)=/gm)) known.add(match[1])
        // A secret (a placeholder in the example) is added as a comment: you fill it in, the API says when it is missing
        const missing = blocks
            .filter(block => !known.has(block.key))
            .map(block =>
                /^(OIDC_MASTER_KEY|OIDC_BOOTSTRAP_ADMIN_PASSWORD_HASH|JWT_SECRET)=/m.test(block.text)
                    ? { ...block, text: block.text.replace(/^([A-Z0-9_]+=)/m, '# $1') }
                    : block
            )
        if (!missing.length) continue
        const addition =
            '\n# Added by DafkeDD_CLI update: new settings of this version\n' +
            missing.map(block => block.text).join('\n') +
            '\n'
        await fs.writeFile(file, text.replace(/\n*$/, '\n') + addition)
        lines.push(
            `${pc.green('✔')} backend/${name}: ${missing.length} nieuwe instellingen toegevoegd (${missing.map(block => block.key).join(', ')})`
        )
    }
    return lines
}

/**
 * The READMEs of the backend and the frontend live in ./docs (api.md, frontend.md), the READMEs only point there: the
 * same move as when the project was made, on the formatted files. Also the index and the web page of ./docs.
 */
export function moveReadmesToDocs(projectDir, project, files) {
    if (!existsSync(path.join(projectDir, DOCS_DIR))) return files
    const result = { ...files }
    const done = []
    for (const [dir, file, fallback] of [
        ['frontend', 'frontend.md', 'Next.js'],
        ['backend', 'api.md', 'NestJS']
    ]) {
        const readme = `${dir}/README.md`
        if (result[readme] === undefined) continue
        const disk = path.join(projectDir, readme)
        // The title the pointer had (the name of that part when the project was made)
        const title = existsSync(disk) ? (/^# (.+)$/m.exec(readFileSync(disk, 'utf8'))?.[1] ?? fallback) : fallback
        const markdown = result[readme]
        result[`${DOCS_DIR}/${file}`] = markdown
        result[readme] = pointer(title, file)
        done.push({ file, id: file.replace(/\.md$/, ''), title, markdown })
    }
    if (done.length) {
        const swagger = project.backend
            ? `http://localhost:${project.kind === 'app' ? appBackend.APP_PORT : PORT}/docs`
            : null
        Object.assign(result, docsFolder(done, { swagger, kb: Boolean(project.frontend) }))
    }
    return result
}
