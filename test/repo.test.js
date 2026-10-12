import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { askRepo, ghOwner, repoExists, repoSteps, platforms, NAME_PATTERN } from '../src/repo.js'

/** Fake `exec` that records calls and lets a handler decide what happens. */
function fakeExec(handler = async () => '') {
    const calls = []
    const exec = async (cmd, args, options) => {
        calls.push([cmd, ...args].join(' '))
        return handler(cmd, args, options)
    }
    exec.calls = calls
    return exec
}

/** Fake prompts that answer from a queue and remember the config they were called with. */
function fakePrompts({ confirm = true, platform = 'github', name = 'my-repo', visibility = 'private' } = {}) {
    const seen = {}
    return {
        seen,
        confirm: async config => ((seen.confirm = config), confirm),
        select: async config => {
            if (config.message.includes('platform')) return ((seen.platform = config), platform)
            return ((seen.visibility = config), visibility)
        },
        input: async config => ((seen.input = config), name)
    }
}

test('platforms only offers GitHub for now', () => {
    assert.deepEqual(Object.keys(platforms), ['github'])
})

test('NAME_PATTERN accepts letters, digits, dot, dash and underscore only', () => {
    for (const ok of ['my-repo', 'my_repo', 'my.repo', 'Repo1']) assert.ok(NAME_PATTERN.test(ok), ok)
    for (const bad of ['', 'my repo', 'a/b', 'a$b', 'é']) assert.ok(!NAME_PATTERN.test(bad), bad)
})

test('ghOwner returns the trimmed login, or null when gh fails', async () => {
    assert.equal(
        await ghOwner(
            '.',
            fakeExec(async () => 'octocat\n')
        ),
        'octocat'
    )
    assert.equal(
        await ghOwner(
            '.',
            fakeExec(async () => {
                throw new Error('not logged in')
            })
        ),
        null
    )
    assert.equal(
        await ghOwner(
            '.',
            fakeExec(async () => '  \n')
        ),
        null
    )
})

test('repoExists is true when `gh repo view` succeeds and false when it fails', async () => {
    const yes = fakeExec(async () => 'ok')
    assert.equal(await repoExists('octocat', 'hello', '.', yes), true)
    assert.deepEqual(yes.calls, ['gh repo view octocat/hello'])
    const no = fakeExec(async () => {
        throw new Error('not found')
    })
    assert.equal(await repoExists('octocat', 'hello', '.', no), false)
})

test('askRepo returns null and asks nothing else when the user does not want to push', async () => {
    const prompts = fakePrompts({ confirm: false })
    assert.equal(await askRepo({ projectDir: '/tmp/x', prompts, exec: fakeExec() }), null)
    assert.equal(prompts.seen.input, undefined)
    assert.equal(prompts.seen.platform, undefined)
})

test('askRepo returns name (trimmed), platform and visibility when pushing', async () => {
    const prompts = fakePrompts({ name: '  my-repo  ', visibility: 'public' })
    const result = await askRepo({ projectDir: '/tmp/x', prompts, exec: fakeExec(async () => 'octocat') })
    assert.deepEqual(result, { name: 'my-repo', platform: 'github', visibility: 'public' })
    assert.deepEqual(
        prompts.seen.visibility.choices.map(c => c.value),
        ['private', 'public']
    )
})

test('askRepo suggests the folder name as default, with unsafe characters replaced', async () => {
    const prompts = fakePrompts()
    await askRepo({ projectDir: path.join(os.tmpdir(), 'my cool project'), prompts, exec: fakeExec() })
    assert.equal(prompts.seen.input.default, 'my-cool-project')
})

test('askRepo name validation rejects invalid characters', async () => {
    const prompts = fakePrompts()
    await askRepo({ projectDir: '/tmp/x', prompts, exec: fakeExec(async () => 'octocat') })
    const message = await prompts.seen.input.validate('bad name!')
    assert.match(message, /enkel letters/)
})

test('askRepo name validation rejects a name that already exists for the user', async () => {
    const exec = fakeExec(async (cmd, args) => (args[0] === 'api' ? 'octocat\n' : 'exists'))
    const prompts = fakePrompts()
    await askRepo({ projectDir: '/tmp/x', prompts, exec })
    const message = await prompts.seen.input.validate('taken')
    assert.match(message, /octocat\/taken/)
    assert.match(message, /bestaat al/)
})

test('askRepo name validation accepts a free name', async () => {
    const exec = fakeExec(async (cmd, args) => {
        if (args[0] === 'api') return 'octocat\n'
        throw new Error('not found')
    })
    const prompts = fakePrompts()
    await askRepo({ projectDir: '/tmp/x', prompts, exec })
    assert.equal(await prompts.seen.input.validate('free-name'), true)
})

test('askRepo skips the existence check when gh is not available', async () => {
    const exec = fakeExec(async () => {
        throw new Error('gh missing')
    })
    const prompts = fakePrompts()
    await askRepo({ projectDir: '/tmp/x', prompts, exec })
    assert.equal(await prompts.seen.input.validate('anything'), true)
    assert.ok(!exec.calls.some(c => c.startsWith('gh repo view')))
})

test('repoSteps has two steps: git and GitHub', () => {
    const steps = repoSteps({ projectDir: '/tmp/x', repo: { name: 'r', visibility: 'private' }, exec: fakeExec() })
    assert.equal(steps.length, 2)
    assert.equal(steps[0].title, 'Git initialiseren')
    assert.match(steps[1].title, /"r"/)
})

test('repoSteps initialises git, commits, creates the repo and pushes', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-repo-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    const exec = fakeExec()
    const steps = repoSteps({ projectDir: dir, repo: { name: 'demo', visibility: 'private' }, exec })
    for (const step of steps) await step.run()
    assert.deepEqual(exec.calls, [
        'git init -b main',
        'git add -A',
        'git commit -m Initial commit',
        'gh auth status',
        'gh repo create demo --private --source=. --remote=origin --push'
    ])
})

test('repoSteps skips git init when the folder is already a git repository', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-repo-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    await fs.mkdir(path.join(dir, '.git'))
    const exec = fakeExec()
    await repoSteps({ projectDir: dir, repo: { name: 'demo', visibility: 'public' }, exec })[0].run()
    assert.ok(!exec.calls.some(c => c.startsWith('git init')))
})

test('repoSteps uses --public for public repositories', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-repo-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    const exec = fakeExec()
    await repoSteps({ projectDir: dir, repo: { name: 'demo', visibility: 'public' }, exec })[1].run()
    assert.ok(exec.calls.includes('gh repo create demo --public --source=. --remote=origin --push'))
})

test('repoSteps explains how to log in when gh is missing and does not try to create the repo', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-repo-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    const exec = fakeExec(async (cmd, args) => {
        if (cmd === 'gh') throw new Error('gh: command not found')
        return ''
    })
    await assert.rejects(
        repoSteps({ projectDir: dir, repo: { name: 'demo', visibility: 'private' }, exec })[1].run(),
        /gh auth login/
    )
    assert.ok(!exec.calls.some(c => c.startsWith('gh repo create')))
})
