import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { projectClaudeFiles } from './claude.js'
import { cloudFiles } from './cloud.js'
import { designFiles } from './frontends/oidc.js'
import { isSite, siteDesignFiles } from './frontends/site.js'

/**
 * The manifest of a generated project (`.dafkedd.json`, committed): the version of the CLI, what the project is made
 * of and a hash of every file the CLI manages (Claude Code, Google Cloud, the Pasport design of the frontend). `update` uses it to know which files are
 * still as the CLI wrote them (those it may replace) and which you changed (those it never overwrites).
 * No secrets: of a linked app only the addresses and the client id of the login server.
 */
export const MANIFEST = '.dafkedd.json'

/** The hash of a text file, with LF line ends (a Windows checkout with core.autocrlf has CRLF: still the same file). */
export const sha = content => createHash('sha256').update(String(content).replace(/\r\n/g, '\n')).digest('hex')

/** What the manifest keeps of describeProject() (plus `claude` and `cloud`). */
export function manifestProject(project) {
    return {
        name: project.name,
        frontend: Boolean(project.frontend),
        backend: Boolean(project.backend),
        kind: project.kind ?? null,
        database: project.database ?? null,
        modules: project.modules ?? null,
        link: project.link
            ? {
                  issuer: project.link.issuer,
                  accountUrl: project.link.accountUrl,
                  clientId: project.link.clientId,
                  // The licence the app sells (OIDC_PRODUCT in Terraform): without it a paid app would become free
                  product: project.link.product ?? null
              }
            : null,
        claude: Boolean(project.claude),
        cloud: Boolean(project.cloud)
    }
}

/** Every file the CLI manages for this project, with the content of this version of the CLI. */
export function managedFiles(project) {
    return {
        ...(project.claude ? projectClaudeFiles(project) : {}),
        ...(project.cloud ? cloudFiles(project) : {}),
        // The Pasport design of the frontend of the login server and of every linked app
        ...(project.frontend && (project.kind === 'pasport' || project.kind === 'app')
            ? designFiles({ linked: project.kind === 'app' })
            : {}),
        // The same design in every other frontend (a site, an API, the simple login)
        ...(isSite(project) ? siteDesignFiles(project) : {})
    }
}

/** The manifest of a project, from the files as they are on disk now. */
export async function buildManifest({ projectDir, project, version }) {
    const files = {}
    for (const rel of Object.keys(managedFiles(project)).sort()) {
        const full = path.join(projectDir, rel)
        if (existsSync(full)) files[rel] = sha(await fs.readFile(full, 'utf8'))
    }
    return { version, project: manifestProject(project), files }
}

export const writeManifest = (projectDir, manifest) =>
    fs.writeFile(path.join(projectDir, MANIFEST), JSON.stringify(manifest, null, 4) + '\n')

/** The manifest of a project; null when there is none (a project of a CLI before 0.46.0). */
export function readManifest(projectDir) {
    const file = path.join(projectDir, MANIFEST)
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf8'))
}

/** The step of the CLI that writes the manifest: after every other file, before git (so it is in the first commit). */
export function manifestSteps({ projectDir, project, version }) {
    return [
        {
            title: `Manifest schrijven (${MANIFEST}, voor "update")`,
            weight: 1,
            run: async () => writeManifest(projectDir, await buildManifest({ projectDir, project, version }))
        }
    ]
}

/** KEY=value lines of a .env file (quotes removed, comments skipped). */
export function parseEnvFile(text) {
    const env = {}
    for (const line of text.split(/\r?\n/)) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
        if (!match) continue
        let value = match[2].trim()
        if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1)
        else value = value.replace(/\s+#.*$/, '')
        env[match[1]] = value
    }
    return env
}

const readEnv = (...files) => {
    const env = {}
    for (const file of files) if (existsSync(file)) Object.assign(env, parseEnvFile(readFileSync(file, 'utf8')))
    return env
}

/**
 * The name the CLI gave the project: the title of CLAUDE.md (`# <name>`), else the name of its Terraform (the state
 * prefix of versions.tf), else the folder. Not only the folder: a clone can live in a folder with another name, and a
 * wrong name would move every resource of Google Cloud.
 */
export function projectName(projectDir) {
    const at = rel => path.join(projectDir, rel)
    if (existsSync(at('CLAUDE.md'))) {
        const title = /^# (\S+)\s*$/m.exec(readFileSync(at('CLAUDE.md'), 'utf8'))
        if (title) return title[1]
    }
    if (existsSync(at('infra/terraform/versions.tf'))) {
        const prefix = /prefix\s*=\s*"([^"]+)"/.exec(readFileSync(at('infra/terraform/versions.tf'), 'utf8'))
        if (prefix) return prefix[1]
    }
    return path.basename(path.resolve(projectDir))
}

/**
 * What a project without a manifest is made of, from its folders and .env files: the frontend and the backend, the
 * kind (OIDC_MASTER_KEY: the login server, OIDC_CLIENT_IDS: a linked app, JWT_SECRET: the simple login), the
 * database, the modules of an app, Claude Code (CLAUDE.md) and Google Cloud (infra/terraform).
 */
export function inferProject(projectDir) {
    const at = rel => path.join(projectDir, rel)
    const frontend = existsSync(at('frontend/package.json'))
    const backend = existsSync(at('backend/package.json'))
    const env = readEnv(at('backend/.env.example'), at('backend/.env'))
    const frontendEnv = readEnv(at('frontend/.env.example'), at('frontend/.env'), at('frontend/.env.local'))
    const kind = !backend
        ? null
        : env.OIDC_MASTER_KEY !== undefined
          ? 'pasport'
          : env.OIDC_CLIENT_IDS !== undefined
            ? 'app'
            : env.JWT_SECRET !== undefined
              ? 'login'
              : 'api'
    return {
        name: projectName(projectDir),
        frontend,
        backend,
        kind,
        database: env.DATABASE_NAME || null,
        modules:
            kind === 'app'
                ? {
                      mail: existsSync(at('backend/src/mail')),
                      files: existsSync(at('backend/src/files')),
                      isolation: env.TENANT_ISOLATION === 'database' ? 'database' : 'rls'
                  }
                : null,
        link:
            kind === 'app' && env.OIDC_ISSUER
                ? {
                      issuer: env.OIDC_ISSUER,
                      accountUrl: frontendEnv.OIDC_ACCOUNT_URL || new URL(env.OIDC_ISSUER).origin,
                      clientId: (env.OIDC_CLIENT_IDS || '').split(',')[0].trim(),
                      product: env.OIDC_PRODUCT || null
                  }
                : null,
        claude: existsSync(at('CLAUDE.md')) || existsSync(at('.claude/agents')),
        cloud: existsSync(at('infra/terraform'))
    }
}
