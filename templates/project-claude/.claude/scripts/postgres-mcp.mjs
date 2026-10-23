#!/usr/bin/env node
// The PostgreSQL MCP server of this project (.mcp.json): Postgres MCP Pro (github.com/crystaldba/postgres-mcp, MIT),
// connected to the database of ./backend/.env. The password stays in .env (never in .mcp.json or git).
//
// - Read-only by default (--access-mode=restricted: read-only transactions with a time limit). For a session that may
//   change data: POSTGRES_MCP_ACCESS=unrestricted (never against production).
// - Runs with uvx (Python's uv) when it is installed, otherwise with Docker (crystaldba/postgres-mcp).
// - POSTGRES_MCP_DATABASE picks another database (for example one of TENANT_ISOLATION=database: <name>_t_<id>).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const IMAGE = 'crystaldba/postgres-mcp'

/** The settings of a .env file (KEY=value, 'quoted' or "quoted", # comments). */
export function parseEnv(text) {
    const result = {}
    for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
        if (!match) continue
        let value = match[2]
        const quoted = value.match(/^(['"])(.*)\1$/)
        value = quoted ? quoted[2] : value.replace(/\s+#.*$/, '').trim()
        result[match[1]] = value
    }
    return result
}

/** postgresql://user:password@host:port/database from the DATABASE_* settings of the backend. */
export function databaseUri(env, { host = env.DATABASE_HOST || 'localhost', database = env.DATABASE_NAME } = {}) {
    if (!database) throw new Error('DATABASE_NAME is missing in backend/.env')
    const user = encodeURIComponent(env.DATABASE_USER || 'postgres')
    const password = env.DATABASE_PASSWORD ? ':' + encodeURIComponent(env.DATABASE_PASSWORD) : ''
    return `postgresql://${user}${password}@${host}:${env.DATABASE_PORT || 5432}/${encodeURIComponent(database)}`
}

/** The access mode: restricted (read-only) unless unrestricted is asked for explicitly. */
export const accessMode = value => (value === 'unrestricted' ? 'unrestricted' : 'restricted')

/**
 * The command that starts the server: uvx when available, otherwise Docker (where localhost is the host machine:
 * host.docker.internal). Null when neither is installed.
 */
export function serverCommand(env, { hasUvx, hasDocker, mode, database }) {
    const args = [`--access-mode=${mode}`]
    if (hasUvx) return { command: 'uvx', args: ['postgres-mcp', ...args], uri: databaseUri(env, { database }) }
    if (hasDocker) {
        const host = /^(localhost|127\.0\.0\.1|::1)$/.test(env.DATABASE_HOST || 'localhost')
            ? 'host.docker.internal'
            : env.DATABASE_HOST
        return {
            command: 'docker',
            args: [
                'run',
                '-i',
                '--rm',
                '--add-host=host.docker.internal:host-gateway',
                '-e',
                'DATABASE_URI',
                IMAGE,
                ...args
            ],
            uri: databaseUri(env, { host, database })
        }
    }
    return null
}

const installed = command =>
    spawnSync(command, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
    const file = path.join(root, 'backend', '.env')
    if (!existsSync(file)) {
        console.error('No backend/.env: the PostgreSQL MCP server needs the DATABASE_* settings of the backend.')
        process.exit(1)
    }
    const env = parseEnv(readFileSync(file, 'utf8'))
    const server = serverCommand(env, {
        hasUvx: installed('uvx'),
        hasDocker: installed('docker'),
        mode: accessMode(process.env.POSTGRES_MCP_ACCESS),
        database: process.env.POSTGRES_MCP_DATABASE || env.DATABASE_NAME
    })
    if (!server) {
        console.error('The PostgreSQL MCP server needs uv (https://docs.astral.sh/uv/, then uvx) or Docker.')
        process.exit(1)
    }
    const child = spawn(server.command, server.args, {
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URI: server.uri },
        shell: process.platform === 'win32'
    })
    child.on('exit', code => process.exit(code ?? 0))
}
