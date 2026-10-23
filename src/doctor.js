import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import pc from 'picocolors'
import { LABELS } from '../templates/project-claude/.claude/scripts/setup-labels.mjs'
import { DEVELOP_BRANCH } from './claude.js'
import { inferProject, MANIFEST, parseEnvFile, readManifest } from './manifest.js'
import { run } from './runner.js'

/**
 * `DafkeDD_CLI doctor` in the folder of a project: is everything there that the project, its agents and its MCP
 * servers need? Every check is a line: ok, warn (works, but something is missing) or fail (does not work).
 */
export const OK = 'ok'
export const WARN = 'warn'
export const FAIL = 'fail'

const works = async (exec, cmd, args, cwd) => {
    try {
        return (await exec(cmd, args, { cwd })).trim() || true
    } catch {
        return null
    }
}

/** The Chrome Playwright MCP uses: installed Chrome, or the Chromium of `npx playwright install chromium`. */
export function chromePaths({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
    if (platform === 'win32')
        return [
            path.join(env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(
                env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
                'Google',
                'Chrome',
                'Application',
                'chrome.exe'
            ),
            path.join(
                env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'),
                'Google',
                'Chrome',
                'Application',
                'chrome.exe'
            ),
            path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'ms-playwright')
        ]
    if (platform === 'darwin')
        return ['/Applications/Google Chrome.app', path.join(home, 'Library', 'Caches', 'ms-playwright')]
    return ['/usr/bin/google-chrome', '/opt/google/chrome/chrome', path.join(home, '.cache', 'ms-playwright')]
}

const readJson = file => {
    try {
        return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
        return undefined
    }
}

/** True when something answers on host:port within the timeout. */
export function reachable(host, port, timeout = 1500) {
    return new Promise(resolve => {
        const socket = net.connect({ host, port: Number(port) })
        const done = ok => {
            socket.destroy()
            resolve(ok)
        }
        socket.setTimeout(timeout, () => done(false))
        socket.once('connect', () => done(true))
        socket.once('error', () => done(false))
    })
}

/** The checks of a project; `exec`, `exists` and `connect` are injectable for the tests. */
export async function checks({
    projectDir = process.cwd(),
    version,
    exec = run,
    exists = existsSync,
    connect = reachable,
    nodeVersion = process.versions.node
} = {}) {
    const result = []
    const add = (status, text, fix) => result.push({ status, text, fix })
    const at = rel => path.join(projectDir, rel)

    const major = Number(nodeVersion.split('.')[0])
    add(major >= 20 ? OK : FAIL, `Node.js ${nodeVersion}`, major >= 20 ? null : 'Installeer Node.js 20 of later')
    add((await works(exec, 'git', ['--version'], projectDir)) ? OK : FAIL, 'git', 'Installeer git')

    const gh = await works(exec, 'gh', ['--version'], projectDir)
    const ghAuth = gh && (await works(exec, 'gh', ['auth', 'status'], projectDir))
    add(
        gh ? (ghAuth ? OK : WARN) : WARN,
        gh ? (ghAuth ? 'GitHub CLI, ingelogd' : 'GitHub CLI, niet ingelogd') : 'GitHub CLI (gh)',
        gh ? 'gh auth login' : 'Installeer gh: https://cli.github.com'
    )

    const manifest = readManifest(projectDir)
    const project = manifest?.project ?? inferProject(projectDir)
    if (!project.frontend && !project.backend) {
        add(FAIL, 'Geen project van DafkeDD_CLI in deze map', 'Start doctor in de map van het project')
        return result
    }
    if (!manifest) add(WARN, `Geen ${MANIFEST}`, 'npx --allow-git=all github:DafkeDD/DafkeDD_CLI update')
    else if (version && manifest.version !== version)
        add(
            WARN,
            `Gemaakt met DafkeDD_CLI ${manifest.version}, nu is er ${version}`,
            'npx --allow-git=all github:DafkeDD/DafkeDD_CLI update'
        )
    else add(OK, `${MANIFEST} (v${manifest.version})`)

    for (const part of ['frontend', 'backend'])
        if (project[part])
            add(exists(at(`${part}/node_modules`)) ? OK : WARN, `${part}: dependencies`, `cd ${part} && npm install`)

    const backendEnv = exists(at('backend/.env')) ? parseEnvFile(readFileSync(at('backend/.env'), 'utf8')) : null
    if (project.backend) add(backendEnv ? OK : FAIL, 'backend/.env', 'Kopieer backend/.env.example naar backend/.env')
    if (project.database && backendEnv?.DATABASE_HOST) {
        const up = await connect(backendEnv.DATABASE_HOST, backendEnv.DATABASE_PORT || 5432)
        add(
            up ? OK : WARN,
            `PostgreSQL op ${backendEnv.DATABASE_HOST}:${backendEnv.DATABASE_PORT || 5432}`,
            exists(at('backend/docker-compose.yml')) ? 'cd backend && npm run db:up' : 'Start PostgreSQL'
        )
    }

    if (project.claude) {
        const settings = readJson(at('.claude/settings.json'))
        add(settings ? OK : FAIL, '.claude/settings.json', 'npx --allow-git=all github:DafkeDD/DafkeDD_CLI update')
        for (const hook of ['guard-git.mjs', 'approvals.mjs', 'approve.mjs', 'format.mjs'])
            if (!exists(at(`.claude/hooks/${hook}`)))
                add(FAIL, `.claude/hooks/${hook} ontbreekt`, 'npx --allow-git=all github:DafkeDD/DafkeDD_CLI update')
        const mcp = readJson(at('.mcp.json'))
        const servers = Object.keys(mcp?.mcpServers ?? {})
        add(
            mcp ? OK : WARN,
            `.mcp.json${servers.length ? ` (${servers.join(', ')})` : ''}`,
            'npx --allow-git=all github:DafkeDD/DafkeDD_CLI update'
        )
        const enabled = settings?.enabledMcpjsonServers ?? []
        const off = servers.filter(name => !enabled.includes(name))
        if (off.length)
            add(
                WARN,
                `MCP niet aangezet in .claude/settings.json: ${off.join(', ')}`,
                'Voeg ze toe aan enabledMcpjsonServers'
            )
        if (servers.includes('playwright')) {
            const chrome = chromePaths().some(file => exists(file))
            add(chrome ? OK : WARN, 'Chrome voor de Playwright MCP', 'npx playwright install chromium')
        }
        if (servers.includes('postgres')) {
            const uvx = await works(exec, 'uvx', ['--version'], projectDir)
            const docker = uvx ? null : await works(exec, 'docker', ['--version'], projectDir)
            add(
                uvx || docker ? OK : WARN,
                `PostgreSQL MCP via ${uvx ? 'uvx' : docker ? 'Docker' : 'uvx of Docker'}`,
                'Installeer uv: https://docs.astral.sh/uv/'
            )
        }
    }

    if (project.cloud) {
        const gcloud = await works(exec, 'gcloud', ['--version'], projectDir)
        add(
            gcloud ? OK : WARN,
            'gcloud (enkel voor infra/bootstrap.sh; of gebruik Cloud Shell)',
            'https://cloud.google.com/sdk/docs/install'
        )
    }

    // GitHub: the repository, the labels of the issues and the protection of the branches
    const repo =
        ghAuth &&
        (await works(exec, 'gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], projectDir))
    if (repo && typeof repo === 'string') {
        add(OK, `GitHub: ${repo}`)
        if (project.claude) {
            const labels = await works(
                exec,
                'gh',
                ['label', 'list', '--limit', '200', '--json', 'name', '--jq', '.[].name'],
                projectDir
            )
            const have = typeof labels === 'string' ? labels.split(/\r?\n/) : []
            const missing = LABELS.map(([name]) => name).filter(name => !have.includes(name))
            add(
                missing.length ? WARN : OK,
                missing.length ? `Labels ontbreken: ${missing.join(', ')}` : 'Labels van de issues',
                'node .claude/scripts/setup-labels.mjs'
            )
        }
        for (const branch of project.claude ? [DEVELOP_BRANCH, 'main'] : []) {
            const protectedBranch = await works(
                exec,
                'gh',
                ['api', `repos/${repo}/branches/${branch}/protection`, '--jq', '.url'],
                projectDir
            )
            add(protectedBranch ? OK : WARN, `Branch ${branch} beschermd`, 'node .claude/scripts/protect-branches.mjs')
        }
    } else if (ghAuth) add(WARN, 'Geen GitHub-repository gevonden (git remote origin)', 'gh repo create')
    return result
}

const ICON = { [OK]: pc.green('✔'), [WARN]: pc.yellow('!'), [FAIL]: pc.red('✖') }

/** Runs the checks and prints them; true when nothing failed. */
export async function doctor({ projectDir = process.cwd(), version, log = console.log, ...rest } = {}) {
    log(pc.bold(`\nDafkeDD_CLI doctor`) + pc.dim(` v${version}  ${projectDir}\n`))
    const result = await checks({ projectDir, version, ...rest })
    for (const { status, text, fix } of result)
        log(`${ICON[status]} ${text}${status !== OK && fix ? pc.dim(`  →  ${fix}`) : ''}`)
    const failed = result.filter(entry => entry.status === FAIL).length
    const warned = result.filter(entry => entry.status === WARN).length
    log(
        '\n' +
            (failed
                ? pc.red(`${failed} probleem${failed > 1 ? 'en' : ''}`)
                : warned
                  ? pc.yellow(`${warned} waarschuwing${warned > 1 ? 'en' : ''}`)
                  : pc.green('Alles in orde')) +
            '\n'
    )
    return failed === 0
}
