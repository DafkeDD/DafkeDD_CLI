import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { checks, chromePaths, doctor, FAIL, OK, reachable, WARN } from '../src/doctor.js'
import { checkNames, protection } from '../templates/project-claude/.claude/scripts/protect-branches.mjs'
import { LABELS } from '../templates/project-claude/.claude/scripts/setup-labels.mjs'
import { ciWorkflow, describeProject, projectClaudeFiles } from '../src/claude.js'
import { buildManifest, writeManifest } from '../src/manifest.js'

const project = {
    ...describeProject({
        name: 'planner',
        frontend: { id: 'nextjs' },
        backend: { id: 'nestjs' },
        answers: { auth: true, database: { database: 'planner' } }
    }),
    claude: true,
    cloud: false
}

async function projectDir(t, { manifestVersion = '0.46.0' } = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-doctor-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    const files = {
        ...projectClaudeFiles(project),
        'frontend/package.json': '{}',
        'backend/package.json': '{}',
        'backend/.env': 'DATABASE_HOST=localhost\nDATABASE_PORT=5999\nDATABASE_NAME=planner\nJWT_SECRET=x\n'
    }
    for (const [rel, content] of Object.entries(files)) {
        await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
        await fs.writeFile(path.join(dir, rel), content)
    }
    await fs.mkdir(path.join(dir, 'frontend/node_modules'))
    if (manifestVersion)
        await writeManifest(dir, await buildManifest({ projectDir: dir, project, version: manifestVersion }))
    return dir
}

/** A fake exec: every tool is there, gh is logged in, the repository has every label and protected branches. */
const fakeExec =
    ({ missing = [], labels = LABELS.map(([name]) => name), protectedBranches = ['developer', 'main'] } = {}) =>
    async (cmd, args) => {
        if (missing.includes(cmd)) throw new Error(`${cmd}: not found`)
        if (cmd === 'gh' && args[0] === 'repo') return 'dafkedd/planner\n'
        if (cmd === 'gh' && args[0] === 'label') return labels.join('\n')
        if (cmd === 'gh' && args[0] === 'api') {
            const branch = args[1].split('/')[4]
            if (!protectedBranches.includes(branch)) throw new Error('HTTP 404: Branch not protected')
            return 'https://api.github.com/...'
        }
        return `${cmd} 1.0.0`
    }

const byText = (result, pattern) => result.find(entry => pattern.test(entry.text))

test('doctor: a complete project is in order', async t => {
    const dir = await projectDir(t)
    const result = await checks({
        projectDir: dir,
        version: '0.46.0',
        exec: fakeExec(),
        exists: file => /chrome|ms-playwright/i.test(file) || existsSync(file),
        connect: async () => true
    })
    assert.deepEqual(
        result.filter(entry => entry.status !== OK).map(entry => entry.text),
        ['backend: dependencies']
    )
    assert.ok(byText(result, /^\.mcp\.json \(playwright, postgres\)$/))
    assert.ok(byText(result, /^PostgreSQL MCP via uvx$/))
    assert.ok(byText(result, /^GitHub: dafkedd\/planner$/))
    assert.equal(byText(result, /^Branch developer beschermd$/).status, OK)
})

test('doctor: what is missing, with how to fix it', async t => {
    const dir = await projectDir(t, { manifestVersion: '0.45.0' })
    await fs.rm(path.join(dir, '.claude/hooks/guard-git.mjs'))
    const result = await checks({
        projectDir: dir,
        version: '0.46.0',
        exec: fakeExec({ missing: ['uvx', 'docker'], labels: ['spec'], protectedBranches: ['main'] }),
        exists: file => !/chrome|ms-playwright/i.test(file) && existsSync(file),
        connect: async () => false,
        nodeVersion: '18.20.0'
    })
    assert.equal(byText(result, /^Node\.js/).status, FAIL)
    assert.equal(
        byText(result, /0\.45\.0, nu is er 0\.46\.0/).fix,
        'npx --allow-git=all github:DafkeDD/DafkeDD_CLI update'
    )
    assert.equal(byText(result, /guard-git\.mjs ontbreekt/).status, FAIL)
    assert.equal(byText(result, /^Chrome/).status, WARN)
    assert.equal(byText(result, /^PostgreSQL MCP/).status, WARN)
    assert.equal(byText(result, /^PostgreSQL op localhost:5999$/).status, WARN)
    assert.match(byText(result, /^Labels ontbreken/).text, /type:feature/)
    assert.equal(byText(result, /^Branch developer/).status, WARN)
    assert.equal(byText(result, /^Branch developer/).fix, 'node .claude/scripts/protect-branches.mjs')
    assert.equal(byText(result, /^Branch main/).status, OK)

    const lines = []
    const ok = await doctor({
        projectDir: dir,
        version: '0.46.0',
        log: line => lines.push(line),
        exec: fakeExec(),
        exists: existsSync,
        connect: async () => true,
        nodeVersion: '18.0.0'
    })
    assert.equal(ok, false)
    assert.match(lines.join('\n'), /probleem/)
})

test('doctor: not a project, and without gh no GitHub checks', async t => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-doctor-'))
    t.after(() => fs.rm(empty, { recursive: true, force: true }))
    const result = await checks({ projectDir: empty, exec: fakeExec({ missing: ['gh'] }) })
    assert.equal(result.at(-1).status, FAIL)
    assert.match(result.at(-1).text, /Geen project/)
    assert.equal(byText(result, /^GitHub CLI/).status, WARN)
})

test('chromePaths per platform, reachable on a closed port', async () => {
    assert.ok(
        chromePaths({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\L' }, home: 'C:\\U' }).some(p =>
            p.includes('ms-playwright')
        )
    )
    assert.ok(chromePaths({ platform: 'linux', env: {}, home: '/home/x' }).includes('/usr/bin/google-chrome'))
    assert.equal(await reachable('127.0.0.1', 1, 500), false)
})

test('protect-branches: the checks of the CI are required, a pull request without review, no force-push', () => {
    assert.deepEqual(checkNames(ciWorkflow(project)), [
        'Backend (format, lint, build, unit, e2e and database tests)',
        'Frontend (format, lint, build, browser tests)',
        'Security (secrets, npm audit)'
    ])
    const body = protection(['A'])
    assert.deepEqual(body.required_status_checks, { strict: false, contexts: ['A'] })
    assert.equal(body.required_pull_request_reviews.required_approving_review_count, 0)
    assert.equal(body.enforce_admins, false)
    assert.equal(body.allow_force_pushes, false)
    assert.equal(body.allow_deletions, false)
})
