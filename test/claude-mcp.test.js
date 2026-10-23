import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {
    accessMode,
    databaseUri,
    IMAGE,
    parseEnv,
    serverCommand
} from '../templates/project-claude/.claude/scripts/postgres-mcp.mjs'
import { projectClaudeFiles, describeProject } from '../src/claude.js'

const ENV = parseEnv(`# Database
DATABASE_HOST=localhost
DATABASE_PORT=54329
DATABASE_USER=app
DATABASE_PASSWORD='p@ss w#rd'
DATABASE_NAME=planner   # the database of the app
`)

test('a project gets the Playwright and PostgreSQL MCP servers, enabled for Claude Code', async () => {
    const files = projectClaudeFiles(describeProject({ name: 'planner', frontend: {}, backend: { id: 'linked' } }))
    const mcp = JSON.parse(files['.mcp.json'])
    assert.deepEqual(Object.keys(mcp.mcpServers), ['playwright', 'postgres'])
    // A pinned version: what the agents run does not change behind their back
    assert.match(mcp.mcpServers.playwright.args.join(' '), /@playwright\/mcp@\d+\.\d+\.\d+ --isolated/)
    assert.deepEqual(mcp.mcpServers.postgres, { command: 'node', args: ['.claude/scripts/postgres-mcp.mjs'] })
    // No password in .mcp.json: the wrapper reads backend/.env
    assert.ok(!files['.mcp.json'].includes('DATABASE_'))
    assert.deepEqual(JSON.parse(files['.claude/settings.json']).enabledMcpjsonServers, ['playwright', 'postgres'])
    const qa = files['.claude/agents/qa.md']
    assert.match(qa, /^---\nname: qa\ndescription: .+\ntools: .*mcp__playwright, mcp__postgres\n---/)
    assert.match(qa, /node \.claude\/hooks\/approve\.mjs qa/)
    assert.match(qa, /Never change data through the MCP/)
    assert.match(files['CLAUDE.md'], /`qa`/)
    assert.match(files['CLAUDE.md'], /Playwright MCP/)
})

test('a project only gets the MCP servers it can use', () => {
    const servers = project => Object.keys(JSON.parse(projectClaudeFiles(project)['.mcp.json']).mcpServers)
    const enabled = project => JSON.parse(projectClaudeFiles(project)['.claude/settings.json']).enabledMcpjsonServers
    // A frontend without a backend: only the browser
    const site = describeProject({ name: 'site', frontend: {} })
    assert.deepEqual(servers(site), ['playwright'])
    assert.deepEqual(enabled(site), ['playwright'])
    // An API without a database: none
    const api = describeProject({ name: 'api', backend: { id: 'nestjs' }, answers: {} })
    assert.deepEqual(servers(api), [])
    assert.deepEqual(enabled(api), [])
    // An API with a database and no frontend: only the database
    const data = describeProject({
        name: 'data',
        backend: { id: 'nestjs' },
        answers: { database: { database: 'data' } }
    })
    assert.deepEqual(servers(data), ['postgres'])
    // The rest of the settings (the hooks) stays
    assert.ok(JSON.parse(projectClaudeFiles(data)['.claude/settings.json']).hooks)
})

test('the PostgreSQL MCP reads the settings of backend/.env, read-only unless asked otherwise', () => {
    assert.deepEqual(ENV, {
        DATABASE_HOST: 'localhost',
        DATABASE_PORT: '54329',
        DATABASE_USER: 'app',
        DATABASE_PASSWORD: 'p@ss w#rd',
        DATABASE_NAME: 'planner'
    })
    assert.equal(databaseUri(ENV), 'postgresql://app:p%40ss%20w%23rd@localhost:54329/planner')
    assert.equal(
        databaseUri(ENV, { database: 'planner_t_abc' }),
        'postgresql://app:p%40ss%20w%23rd@localhost:54329/planner_t_abc'
    )
    assert.throws(() => databaseUri({}), /DATABASE_NAME/)
    assert.equal(accessMode(undefined), 'restricted')
    assert.equal(accessMode('anything'), 'restricted')
    assert.equal(accessMode('unrestricted'), 'unrestricted')
})

test('the PostgreSQL MCP runs with uvx, or with Docker that reaches the database on the host', () => {
    const uvx = serverCommand(ENV, { hasUvx: true, hasDocker: true, mode: 'restricted', database: 'planner' })
    assert.deepEqual(
        { command: uvx.command, args: uvx.args },
        { command: 'uvx', args: ['postgres-mcp', '--access-mode=restricted'] }
    )
    assert.match(uvx.uri, /@localhost:54329\/planner$/)
    const docker = serverCommand(ENV, { hasUvx: false, hasDocker: true, mode: 'restricted', database: 'planner' })
    assert.equal(docker.command, 'docker')
    assert.deepEqual(docker.args.slice(-3), ['DATABASE_URI', IMAGE, '--access-mode=restricted'])
    assert.match(docker.uri, /@host\.docker\.internal:54329\//)
    const remote = serverCommand(
        { ...ENV, DATABASE_HOST: 'db.example.com' },
        { hasDocker: true, mode: 'restricted', database: 'planner' }
    )
    assert.match(remote.uri, /@db\.example\.com:54329\//)
    assert.equal(serverCommand(ENV, { hasUvx: false, hasDocker: false, mode: 'restricted' }), null)
})

test('the CLI repository runs the same hooks but has no qa agent and no MCP servers of its own', async () => {
    await assert.rejects(fs.stat('.mcp.json'))
    await assert.rejects(fs.stat('.claude/agents/qa.md'))
})
