import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { checksGreen, decide, GH_TIMEOUT, GIT_TIMEOUT, gitCommands, readPolicy } from '../.claude/hooks/guard-git.mjs'
import { FORMAT_TIMEOUT } from '../.claude/hooks/format.mjs'
import { describeProject, projectClaudeFiles } from '../src/claude.js'
import {
    AGENTS,
    approvalFile,
    approve,
    branchPaths,
    DEADLINE,
    KINDS,
    shorter,
    timedOut,
    missing,
    required
} from '../.claude/hooks/approvals.mjs'

const HOOK = path.resolve('.claude/hooks/guard-git.mjs')
const TEMPLATE = 'templates/project-claude/.claude'
const CLI = { push: 'branch', branch: 'developer' }
const PROJECT = { push: 'issue-branches', merge: 'developer' }
const allowed = { branch: 'developer', missingApprovals: () => [], policy: CLI }
const unapproved = { branch: 'developer', missingApprovals: () => ['review', 'tests'], policy: CLI }
const onIssue = { branch: 'issue/12-files-module', missingApprovals: () => [], policy: PROJECT }
const pr =
    (changes = {}) =>
    () => ({
        base: 'developer',
        head: 'issue/12-files-module',
        green: true,
        missing: [],
        ...changes
    })

test('the hooks of this repository are the ones every project gets (one source)', async () => {
    for (const name of ['approvals.mjs', 'approve.mjs', 'format.mjs', 'guard-git.mjs'])
        assert.equal(
            await fs.readFile(`.claude/hooks/${name}`, 'utf8'),
            await fs.readFile(`${TEMPLATE}/hooks/${name}`, 'utf8'),
            name
        )
    // The header says what an approval covers: not exactly the staged tree, a documentation-only change keeps some
    const header = (await fs.readFile(`${TEMPLATE}/hooks/guard-git.mjs`, 'utf8')).split('\n// - git push')[0]
    assert.match(
        header.replace(/\n\/\/\s*/g, ' '),
        /for the staged tree \(some approvals still count after a documentation-only change: approvals\.mjs\)/
    )
    assert.ok(!header.includes('exactly the staged tree'))
    // The CLI works like the projects it makes: a branch per issue, merged into developer
    assert.deepEqual(JSON.parse(await fs.readFile('.claude/git-policy.json', 'utf8')), PROJECT)
    assert.deepEqual(JSON.parse(await fs.readFile(`${TEMPLATE}/git-policy.json`, 'utf8')), PROJECT)
    assert.deepEqual(readPolicy('.'), PROJECT)
    assert.deepEqual(readPolicy(os.tmpdir()), { push: 'issue-branches', merge: null })
})

test('the settings run the git guard before Bash and Prettier after every edit', async () => {
    for (const dir of ['.claude', TEMPLATE]) {
        const settings = JSON.parse(await fs.readFile(`${dir}/settings.json`, 'utf8'))
        assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /guard-git\.mjs/)
        assert.equal(settings.hooks.PreToolUse[0].matcher, 'Bash')
        assert.match(settings.hooks.PostToolUse[0].hooks[0].command, /format\.mjs/)
        assert.match(settings.hooks.PostToolUse[0].matcher, /Edit/)
    }
})

test('gitCommands finds the git and gh commands of a command line', () => {
    assert.deepEqual(gitCommands('npm test && git add -A; FOO=1 git -C x commit -m hi | cat'), [
        ['add', '-A'],
        ['commit', '-m', 'hi']
    ])
    assert.deepEqual(gitCommands('echo git'), [])
    assert.deepEqual(gitCommands('git commit -m "a; b && c" && git push'), [['commit', '-m', 'a; b && c'], ['push']])
    assert.deepEqual(gitCommands('gh pr merge 12 --squash'), [['gh:pr merge', '12', '--squash']])
})

test('a commit needs the approvals of the checking agents for the staged change', () => {
    assert.equal(decide('git commit -m "0.42.0: x"', allowed), null)
    assert.match(decide('git commit -m "x"', unapproved), /review, tests missing\. Run the agents reviewer, tester/)
    assert.match(decide('git commit -am "x"', allowed), /commit -a is not allowed/)
    assert.match(decide('git commit --all -m x', allowed), /commit --all is not allowed/)
    // Only the staged tree: no -a after the message, no paths, no --include or --only
    assert.match(decide('git commit -m x -a', allowed), /commit -a is not allowed/)
    for (const line of ['git commit -m x src/a.ts', 'git commit -m x -- src/a.ts'])
        assert.match(decide(line, allowed), /with paths is not allowed/, line)
    for (const line of ['git commit -i -m x', 'git commit --only -m x'])
        assert.notEqual(decide(line, allowed), null, line)
    // A message is one word for the shell, also with && or a new line in it
    assert.equal(decide('git commit -sm "fix: a && b"', allowed), null)
    assert.equal(decide('git commit -m "$(cat <<\'EOF\'\nAdd files && more\n\nCloses #12\nEOF\n)"', allowed), null)
    assert.match(decide('git add -A && git commit -m x', allowed), /Stage first/)
    // Words of the message are no options; a dry run commits nothing
    assert.equal(decide('git commit -m "remove the -a flag"', allowed), null)
    assert.equal(decide('git commit --dry-run', unapproved), null)
    assert.equal(decide('git status && git diff --staged', unapproved), null)
})

test('the policy of one branch: a push only goes to it, never forced or deleting; no merges', () => {
    for (const line of [
        'git push',
        'git push origin',
        'git push origin developer',
        'git push -u origin developer',
        'git push origin HEAD',
        'git push origin HEAD:developer'
    ])
        assert.equal(decide(line, allowed), null, line)
    assert.match(decide('git push', { ...allowed, branch: 'main' }), /not to main/)
    assert.match(decide('git push origin main', allowed), /not to main/)
    assert.match(decide('git push origin developer:main', allowed), /not to main/)
    for (const line of [
        'git push -f origin developer',
        'git push --force-with-lease',
        'git push --delete origin developer',
        'git push origin +developer',
        'git push --mirror'
    ])
        assert.notEqual(decide(line, allowed), null, line)
    assert.match(decide('gh pr merge 12 --squash', { ...allowed, pullRequest: pr() }), /merging is done by a person/)
})

test('a project: a branch per issue, commits only there, pushes only of issue branches', () => {
    assert.equal(decide('git commit -m "Add files (closes #12)"', onIssue), null)
    assert.match(
        decide('git commit -m x', { ...onIssue, branch: 'developer' }),
        /branch of the issue, not on developer/
    )
    assert.match(decide('git commit -m x', { ...onIssue, branch: 'main' }), /git switch -c issue\/<number>-<words>/)
    for (const line of ['git push -u origin issue/12-files-module', 'git push', 'git push origin HEAD'])
        assert.equal(decide(line, onIssue), null, line)
    for (const line of ['git push origin developer', 'git push origin main', 'git push origin issue/12:main'])
        assert.match(decide(line, onIssue), /branch of an issue/, line)
    assert.match(decide('git push', { ...onIssue, branch: 'developer' }), /not to developer/)
    assert.match(decide('git push -f', onIssue), /not allowed/)
    // Deleting a branch on the remote, also with an empty source
    for (const line of [
        'git push origin :issue/12-x',
        'git push origin --delete issue/12-x',
        'git push -d origin issue/12-x'
    ])
        assert.match(decide(line, onIssue), /not allowed/, line)
    // Fixing an update of Dependabot on its own branch
    const dependabot = { ...onIssue, branch: 'dependabot/npm_and_yarn/backend/nestjs-12.1.0' }
    assert.equal(decide('git commit -m "Fix the update"', dependabot), null)
    assert.equal(decide('git push', dependabot), null)
    // A release in preparation has its own branch
    assert.equal(decide('git commit -m "Release 1.4.0"', { ...onIssue, branch: 'release/1.4.0' }), null)
    assert.equal(decide('git push -u origin release/1.4.0', onIssue), null)
    assert.match(decide('git push origin release/next', onIssue), /branch of an issue/)
})

test('a project: an agent merges a pull request of an issue into developer only with green checks and approvals', () => {
    const merge = 'gh pr merge 12 --squash --delete-branch'
    assert.equal(decide(merge, { ...onIssue, pullRequest: pr() }), null)
    assert.match(
        decide(merge, { ...onIssue, pullRequest: pr({ base: 'main' }) }),
        /main \(a release\) is done by a person/
    )
    assert.match(
        decide(merge, { ...onIssue, pullRequest: pr({ head: 'feature/x' }) }),
        /not from the branch of an issue/
    )
    assert.match(decide(merge, { ...onIssue, pullRequest: pr({ green: false }) }), /not all green/)
    // Releases and Dependabot updates are merged into developer the same way
    for (const head of ['release/1.4.0', 'dependabot/npm_and_yarn/backend/nestjs-12.1.0'])
        assert.equal(decide(merge, { ...onIssue, pullRequest: pr({ head }) }), null, head)
    assert.match(decide(merge, { ...onIssue, pullRequest: pr({ missing: ['security'] }) }), /approval of security/)
    assert.match(decide(merge, { ...onIssue, pullRequest: () => null }), /could not be read/)
    assert.match(decide('gh pr merge --squash', { ...onIssue, pullRequest: pr() }), /Name the pull request/)
    assert.match(decide('gh pr merge 12 --admin', { ...onIssue, pullRequest: pr() }), /--admin is not allowed/)
    for (const line of ['gh release create v1.0.0', 'gh repo delete x --yes'])
        assert.match(decide(line, onIssue), /done by a person/, line)
    for (const line of [
        'gh issue create --title x --body y',
        'gh pr create --base developer --fill',
        'gh pr checks 12'
    ])
        assert.equal(decide(line, onIssue), null, line)
})

test('checks count as green only when there are some and all of them passed', () => {
    assert.equal(checksGreen([{ conclusion: 'SUCCESS' }, { state: 'SUCCESS' }, { conclusion: 'SKIPPED' }]), true)
    assert.equal(checksGreen([]), false)
    assert.equal(checksGreen(undefined), false)
    assert.equal(checksGreen([{ conclusion: 'SUCCESS' }, { conclusion: null, status: 'IN_PROGRESS' }]), false)
    assert.equal(checksGreen([{ conclusion: 'FAILURE' }]), false)
    assert.equal(checksGreen([{ state: 'PENDING' }]), false)
})

test('the approvals belong to exactly the staged tree, and the hook blocks a commit without them', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-hooks-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('init', '-q', '-b', 'issue/1-start')
    await fs.writeFile(path.join(dir, 'a.txt'), 'one\n')
    git('add', 'a.txt')
    const hook = command =>
        spawnSync('node', [HOOK], {
            input: JSON.stringify({ tool_input: { command }, cwd: dir }),
            encoding: 'utf8',
            env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
        })

    assert.deepEqual(missing(dir), ['review', 'tests', 'docs', 'i18n'])
    const blocked = hook('git commit -m one')
    assert.equal(blocked.status, 2)
    assert.match(blocked.stderr, /review, tests, docs, i18n missing/)

    for (const kind of ['review', 'tests', 'docs']) approve(dir, kind)
    assert.deepEqual(missing(dir), ['i18n'])
    approve(dir, 'i18n')
    assert.deepEqual(missing(dir), [])
    assert.equal(hook('git commit -m one').status, 0)
    assert.throws(() => approve(dir, 'other'), /Unknown approval/)

    // Another change: the approvals no longer count
    await fs.writeFile(path.join(dir, 'a.txt'), 'two\n')
    git('add', 'a.txt')
    assert.deepEqual(missing(dir), ['review', 'tests', 'docs', 'i18n'])
    assert.equal(hook('git commit -m two').status, 2)
    // A change to a sensitive part needs the security agent too
    await fs.mkdir(path.join(dir, 'oidc'))
    await fs.writeFile(path.join(dir, 'oidc', 'tokens.ts'), 'x\n')
    git('add', 'oidc/tokens.ts')
    assert.deepEqual(missing(dir), ['review', 'tests', 'docs', 'i18n', 'security'])
    // The approvals are kept inside .git, never committed
    assert.match(git('status', '--porcelain'), /^A  a\.txt\nA  oidc\/tokens\.ts\n$/)
    assert.equal(hook('ls -la').status, 0)
    // Without a policy file: the policy of a project (a branch per issue)
    assert.match(hook('git push origin main').stderr, /branch of an issue/)
    assert.equal(hook('git push -u origin issue/1-start').status, 0)
    // With the policy of the CLI
    await fs.mkdir(path.join(dir, '.claude'))
    await fs.writeFile(path.join(dir, '.claude', 'git-policy.json'), JSON.stringify(CLI))
    assert.match(hook('git push -u origin issue/1-start').stderr, /Push only to developer/)
})

test('an approval still counts when only files outside its scope changed since; review, tests and docs never', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-scope-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('init', '-q', '-b', 'issue/1-start')
    await fs.mkdir(path.join(dir, 'src', 'oidc'), { recursive: true })
    await fs.writeFile(path.join(dir, 'src', 'oidc', 'tokens.ts'), 'one\n')
    await fs.writeFile(path.join(dir, 'README.md'), 'one\n')
    git('add', '-A')
    for (const kind of ['review', 'tests', 'docs', 'i18n', 'security']) approve(dir, kind)
    assert.deepEqual(missing(dir), [])
    // Only documentation, a docs generator and a test of the CLI changed: i18n still counts; security still counts for
    // the markdown, not for the generator (code); the others look again
    await fs.writeFile(path.join(dir, 'README.md'), 'two\n')
    await fs.mkdir(path.join(dir, 'src', 'backends'), { recursive: true })
    await fs.writeFile(path.join(dir, 'src', 'backends', 'docs.js'), 'two\n')
    await fs.mkdir(path.join(dir, 'test'))
    await fs.writeFile(path.join(dir, 'test', 'a.test.js'), 'two\n')
    git('add', '-A')
    assert.deepEqual(missing(dir), ['review', 'tests', 'docs', 'security'])
    for (const kind of ['review', 'tests', 'docs', 'security']) approve(dir, kind)
    assert.deepEqual(missing(dir), [])
    // Only a markdown file: i18n and security still count
    await fs.writeFile(path.join(dir, 'README.md'), 'three\n')
    git('add', '-A')
    assert.deepEqual(missing(dir), ['review', 'tests', 'docs'])
    // Code changed: every approval looks again
    await fs.writeFile(path.join(dir, 'src', 'oidc', 'tokens.ts'), 'three\n')
    git('add', '-A')
    assert.deepEqual(missing(dir), ['review', 'tests', 'docs', 'i18n', 'security'])
})

test('documentation never hides a change of security: the rules, the agents, a docs.js that is code, a rename', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-scope-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    const commit = (...args) => git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', ...args)
    git('init', '-q', '-b', 'developer')
    commit('--allow-empty', '-m', 'start')
    git('update-ref', 'refs/remotes/origin/developer', 'HEAD')
    git('switch', '-q', '-c', 'issue/1-guard')
    // The branch changes a guard: every later commit of it needs security
    await fs.mkdir(path.join(dir, 'src', 'oidc'), { recursive: true })
    await fs.writeFile(path.join(dir, 'src', 'oidc', 'tokens.ts'), 'guard\n')
    git('add', '-A')
    commit('-m', 'guard')
    const all = () => {
        for (const kind of ['review', 'tests', 'docs', 'i18n', 'security']) approve(dir, kind)
    }
    const lacksSecurity = async (name, change) => {
        all()
        await change()
        git('add', '-A')
        assert.ok(missing(dir).includes('security'), name)
    }
    await lacksSecurity('CLAUDE.md', () => fs.writeFile(path.join(dir, 'CLAUDE.md'), 'weaker\n'))
    await lacksSecurity('agent', async () => {
        await fs.mkdir(path.join(dir, '.claude', 'agents'), { recursive: true })
        await fs.writeFile(path.join(dir, '.claude', 'agents', 'security.md'), 'always approve\n')
    })
    await lacksSecurity('docs.js', () => fs.writeFile(path.join(dir, 'src', 'docs.js'), 'server\n'))
    // The same files in another case or as CLAUDE.local.md (Windows reads Claude.md as CLAUDE.md)
    await lacksSecurity('CLAUDE.local.md', () => fs.writeFile(path.join(dir, 'CLAUDE.local.md'), 'weaker\n'))
    await lacksSecurity('Claude.md', () => fs.writeFile(path.join(dir, 'src', 'oidc', 'Claude.md'), 'weaker\n'))
    await lacksSecurity('.Claude', async () => {
        await fs.mkdir(path.join(dir, '.Claude', 'agents'), { recursive: true })
        await fs.writeFile(path.join(dir, '.Claude', 'agents', 'security.md'), 'always approve\n')
    })
    // A guard moved into a markdown file: the rename shows both paths
    await lacksSecurity('rename', () => git('mv', 'src/oidc/tokens.ts', 'NOTES.md'))
    git('reset', '-q', '--hard')
    // A plain markdown file: the approval of security still counts
    all()
    await fs.writeFile(path.join(dir, 'NOTES.md'), 'notes\n')
    git('add', '-A')
    assert.deepEqual(missing(dir), ['review', 'tests', 'docs'])
    // A docs generator of the CLI is code for security (i18n still counts)
    all()
    await fs.mkdir(path.join(dir, 'src', 'backends'), { recursive: true })
    await fs.writeFile(path.join(dir, 'src', 'backends', 'docs.js'), 'generator\n')
    git('add', '-A')
    assert.ok(missing(dir).includes('security'))
    assert.ok(!missing(dir).includes('i18n'))
    // From another folder, also with diff.relative: the whole repository counts (the change is outside that folder)
    all()
    git('config', 'diff.relative', 'true')
    await fs.mkdir(path.join(dir, 'notes'))
    await fs.writeFile(path.join(dir, 'notes', 'a.md'), 'a\n')
    await fs.writeFile(path.join(dir, 'src', 'oidc', 'tokens.ts'), 'changed\n')
    git('add', '-A')
    assert.ok(missing(path.join(dir, 'notes')).includes('security'))
    git('config', '--unset', 'diff.relative')
    // Only names of trees in the folder are compared: an approval named after HEAD (whose tree differs from the staged one
    // only by markdown) does not count
    git('reset', '-q', '--hard')
    await fs.rm(path.dirname(approvalFile(dir, 'security', 'x')), { recursive: true, force: true })
    await fs.mkdir(path.dirname(approvalFile(dir, 'security', 'x')), { recursive: true })
    await fs.writeFile(approvalFile(dir, 'security', 'HEAD'), 'x\n')
    await fs.writeFile(path.join(dir, 'MORE.md'), 'more\n')
    git('add', '-A')
    assert.ok(missing(dir).includes('security'))
})

test('a project: a11y and privacy still count after markdown, never after a screen, a migration or docs/privacy.md', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-project-scope-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('init', '-q', '-b', 'issue/1-screen')
    const write = async (rel, content) => {
        await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
        await fs.writeFile(path.join(dir, rel), content)
        git('add', '-A')
    }
    await write('frontend/src/page.tsx', 'one\n')
    await write('backend/src/database/migrations.ts', 'one\n')
    const all = () => {
        for (const kind of KINDS) approve(dir, kind)
    }
    all()
    assert.deepEqual(missing(dir), [])
    await write('docs/kb/en/page.md', 'how\n')
    for (const kind of ['a11y', 'privacy']) assert.ok(!missing(dir).includes(kind), kind)
    all()
    await write('docs/privacy.md', 'register\n')
    assert.ok(missing(dir).includes('privacy'))
    assert.ok(!missing(dir).includes('a11y'))
    all()
    await write('frontend/src/page.tsx', 'two\n')
    assert.ok(missing(dir).includes('a11y'))
    all()
    await write('backend/src/database/migrations.ts', 'two\n')
    assert.ok(missing(dir).includes('privacy'))
})

test('every approval has its agent, and the sensitive parts also need the security agent', async () => {
    for (const kind of KINDS) {
        // qa clicks through a running app: only the generated projects have it
        for (const dir of ['qa', 'a11y', 'privacy'].includes(kind) ? [TEMPLATE] : ['.claude', TEMPLATE]) {
            const text = await fs.readFile(`${dir}/agents/${AGENTS[kind]}.md`, 'utf8')
            assert.ok(text.includes(`node .claude/hooks/approve.mjs ${kind}`), `${dir} ${kind}`)
        }
    }
    assert.deepEqual(required(['README.md', 'src/frontends/nextjs.js']), ['review', 'tests', 'docs', 'i18n'])
    for (const file of [
        'templates/backend-oidc/src/oidc/tokens.service.ts',
        'templates/backend-app/src/database/migrations.ts',
        'templates/backend-app-files/src/files/files.service.ts',
        'templates/frontend-oidc/src/proxy.ts',
        '.claude/hooks/guard-git.mjs',
        'src/backends/auth.js',
        'backend/src/billing/billing.service.ts'
    ])
        assert.ok(required([file]).includes('security'), file)
    // Screens and the database of a generated project also need qa; the paths of the CLI itself never do
    for (const file of [
        'frontend/src/app/[locale]/page.tsx',
        'frontend/messages/nl.json',
        'backend/src/notes/notes.controller.ts',
        'backend/src/database/migrations.ts',
        'backend/src/notes/pg-notes.store.ts'
    ])
        assert.ok(required([file]).includes('qa'), file)
    assert.ok(required(['frontend/src/app/page.tsx']).includes('a11y'))
    assert.ok(!required(['backend/src/notes/notes.controller.ts']).includes('a11y'))
    assert.ok(required(['backend/src/database/migrations.ts']).includes('privacy'))
    assert.ok(!required(['frontend/src/app/page.tsx']).includes('privacy'))
    for (const file of [
        'templates/frontend-oidc/src/components/notes.tsx',
        'src/frontends/nextjs.js',
        'backend/README.md'
    ])
        assert.ok(!required([file]).includes('qa'), file)
})

test('the building knowledge (skills here and in a project) and the design it follows are in the repository', async () => {
    for (const skill of ['pasport-design', 'nestjs', 'postgresql']) {
        const text = await fs.readFile(`.claude/skills/${skill}/SKILL.md`, 'utf8')
        assert.match(text, new RegExp(`^---\\nname: ${skill}\\ndescription: .+\\n---\\n`), skill)
    }
    // A project builds with the same knowledge skills (frontend became pasport-design), not with agents
    for (const skill of ['pasport-design', 'nestjs', 'postgresql']) {
        const text = await fs.readFile(`${TEMPLATE}/skills/${skill}/SKILL.md`, 'utf8')
        assert.match(text, new RegExp(`^---\\nname: ${skill}\\ndescription: .+\\n---\\n`), skill)
        assert.match(text, /start the checking agents \(the `implement` skill\)/, skill)
    }
    for (const agent of ['frontend', 'nestjs', 'postgresql'])
        assert.ok(!existsSync(`${TEMPLATE}/agents/${agent}.md`), agent)
    assert.match(
        await fs.readFile('.claude/skills/pasport-design/SKILL.md', 'utf8'),
        /templates\/project-claude\/\.claude\/design\/pasport\.md/
    )
    assert.match(
        await fs.readFile(`${TEMPLATE}/skills/pasport-design/SKILL.md`, 'utf8'),
        /`\.claude\/design\/pasport\.md`/
    )
    const tokens = JSON.parse(await fs.readFile(`${TEMPLATE}/design/pasport-tokens.json`, 'utf8'))
    assert.equal(tokens.name, 'Pasport')
    assert.ok(tokens.color.tokens.some(token => token.name === 'accent'))
    assert.match(await fs.readFile(`${TEMPLATE}/design/pasport.md`, 'utf8'), /^# Pasport design system/)
})

test('a later commit on a branch still needs the approvals of everything the branch changed', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-branch-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('init', '-q', '-b', 'developer')
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'start')
    git('update-ref', 'refs/remotes/origin/developer', 'HEAD')
    git('switch', '-q', '-c', 'issue/1-a')
    await fs.mkdir(path.join(dir, 'frontend', 'src'), { recursive: true })
    await fs.writeFile(path.join(dir, 'frontend', 'src', 'page.tsx'), 'x\n')
    git('add', '-A')
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'screen')
    // Only the README changes now, but the branch changed a screen: qa and a11y are still needed
    await fs.writeFile(path.join(dir, 'README.md'), 'y\n')
    git('add', 'README.md')
    assert.deepEqual(branchPaths(dir), ['frontend/src/page.tsx'])
    const lacking = missing(dir)
    for (const kind of ['qa', 'a11y']) assert.ok(lacking.includes(kind), kind)
    assert.deepEqual(branchPaths(os.tmpdir()), [])
})

test('every hook has a timeout, and its own git, gh and Prettier calls stop well before it', async () => {
    const generated = projectClaudeFiles(describeProject({ name: 'shop', claude: true }))['.claude/settings.json']
    for (const [where, text] of [
        ['.claude/settings.json', await fs.readFile('.claude/settings.json', 'utf8')],
        [`${TEMPLATE}/settings.json`, await fs.readFile(`${TEMPLATE}/settings.json`, 'utf8')],
        ['a generated project', generated]
    ]) {
        const hooks = Object.values(JSON.parse(text).hooks).flatMap(entries => entries.flatMap(entry => entry.hooks))
        assert.equal(hooks.length, 2, where)
        for (const hook of hooks)
            assert.ok(Number.isInteger(hook.timeout) && hook.timeout > 0, `${where}: ${hook.command}`)
        const of = name => hooks.find(hook => hook.command.includes(name)).timeout * 1000
        // All calls of a run together stop at DEADLINE, the watchdog 5 s later: both before Claude Code gives up
        assert.ok(of('guard-git.mjs') > DEADLINE + 5_000 + 10_000, where)
        // A pull request merge asks gh twice and git a few times: that fits in the deadline
        assert.ok(DEADLINE > 2 * GH_TIMEOUT + 2 * GIT_TIMEOUT, where)
        // An exit code of the guard other than 0 (a crash before it can check, node not found) still blocks
        assert.match(
            hooks.find(hook => hook.command.includes('guard-git.mjs')).command,
            /guard-git\.mjs" \|\| exit 2$/,
            where
        )
        assert.ok(of('format.mjs') > FORMAT_TIMEOUT, where)
    }
    // Every call to git, gh or Prettier in the hooks has its own timeout
    for (const name of ['guard-git.mjs', 'approvals.mjs', 'format.mjs']) {
        const source = await fs.readFile(`${TEMPLATE}/hooks/${name}`, 'utf8')
        const calls = source.match(/execFileSync\([\s\S]*?\{[^}]*\}/g) ?? []
        assert.ok(calls.length > 0, name)
        for (const call of calls) assert.match(call, /timeout:/, `${name}: ${call}`)
    }
})

test('the git guard fails closed: an error of its own blocks the command, with why', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-conflict-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
    git('init', '-q', '-b', 'issue/1-start')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    await fs.writeFile(path.join(dir, 'a.txt'), 'one\n')
    git('add', 'a.txt')
    git('commit', '-qm', 'one')
    git('switch', '-qc', 'other')
    await fs.writeFile(path.join(dir, 'a.txt'), 'two\n')
    git('commit', '-qam', 'two')
    git('switch', '-q', 'issue/1-start')
    await fs.writeFile(path.join(dir, 'a.txt'), 'three\n')
    git('commit', '-qam', 'three')
    // A merge conflict: git write-tree (the staged tree of the approvals) fails
    assert.throws(() => git('merge', 'other'))
    const run = command =>
        spawnSync('node', [HOOK], {
            input: JSON.stringify({ tool_input: { command }, cwd: dir }),
            encoding: 'utf8',
            env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
        })
    const blocked = run('git commit -m merged')
    // Exit code 2 is the only one that blocks: any other lets the command through
    assert.equal(blocked.status, 2)
    assert.match(blocked.stderr, /The git guard could not check this command \(.*git write-tree.*\): blocked/)
    // What it does not guard still runs
    assert.equal(run('git status').status, 0)
})

test('the format hook never blocks or bothers the session, also on input it does not understand', () => {
    for (const input of ['not json', '{"tool_input":{"file_path":42}}', ''])
        assert.equal(
            spawnSync('node', [path.resolve('.claude/hooks/format.mjs')], { input, encoding: 'utf8' }).status,
            0,
            input
        )
})

/** A repository on an issue branch with one staged file and every approval it needs. */
async function approvedRepository(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-deadline-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    execFileSync('git', ['init', '-q', '-b', 'issue/1-start'], { cwd: dir })
    await fs.writeFile(path.join(dir, 'a.txt'), 'one\n')
    execFileSync('git', ['add', 'a.txt'], { cwd: dir })
    for (const kind of ['review', 'tests', 'docs', 'i18n']) approve(dir, kind)
    return dir
}

test('the command of the guard blocks also when the guard crashes before it can check', async t => {
    const dir = await approvedRepository(t)
    // A half-done update: approvals.mjs is missing, so guard-git.mjs cannot even start
    await fs.mkdir(path.join(dir, '.claude', 'hooks'), { recursive: true })
    await fs.copyFile(HOOK, path.join(dir, '.claude', 'hooks', 'guard-git.mjs'))
    const settings = JSON.parse(await fs.readFile(`${TEMPLATE}/settings.json`, 'utf8'))
    const command = settings.hooks.PreToolUse[0].hooks[0].command.replace('$CLAUDE_PROJECT_DIR', dir)
    const run = spawnSync(command, {
        shell: true,
        input: JSON.stringify({ tool_input: { command: 'git commit -m one' }, cwd: dir }),
        encoding: 'utf8'
    })
    assert.match(run.stderr, /ERR_MODULE_NOT_FOUND|Cannot find module/)
    assert.equal(run.status, 2)
})

test('the guard blocks when its calls together run out of time, never lets it through', async t => {
    if (process.platform === 'win32') return t.skip('a git that is slow on purpose is a shell script')
    const dir = await approvedRepository(t)
    const commit = env =>
        spawnSync('node', [HOOK], {
            input: JSON.stringify({ tool_input: { command: 'git commit -m one' }, cwd: dir }),
            encoding: 'utf8',
            env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env }
        })
    assert.equal(commit({}).status, 0)
    // A git whose diff is slow (a partial clone fetching trees, a network drive): the run is out of time
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-slow-git-'))
    t.after(() => fs.rm(bin, { recursive: true, force: true }))
    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
    await fs.writeFile(
        path.join(bin, 'git'),
        `#!/bin/sh\ncase " $* " in *" diff "*) sleep 3 ;; esac\nexec "${real}" "$@"\n`,
        { mode: 0o755 }
    )
    const started = Date.now()
    const slow = commit({ PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOOK_DEADLINE_MS: '1000' })
    assert.equal(slow.status, 2)
    assert.match(slow.stderr, /could not check this command .*: blocked/)
    assert.ok(Date.now() - started < 10_000)
})

test(
    'the guard blocks a run that never gets its input, before Claude Code would give up',
    { timeout: 20_000 },
    async t => {
        const child = spawn('node', [HOOK], {
            env: { ...process.env, HOOK_DEADLINE_MS: '200' },
            stdio: ['pipe', 'pipe', 'pipe']
        })
        let stderr = ''
        child.stderr.on('data', chunk => (stderr += chunk))
        // stdin stays open: the input never ends
        t.after(() => child.kill())
        const status = await new Promise(resolve => child.on('exit', resolve))
        assert.equal(status, 2)
        assert.match(stderr, /The git guard ran out of time: blocked/)
    }
)

test('a slow look at the branch never means "the branch changed nothing" (fewer approvals)', async t => {
    if (process.platform === 'win32') return t.skip('a git that is slow on purpose is a shell script')
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-branch-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
    git('init', '-q', '-b', 'developer')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    await fs.writeFile(path.join(dir, 'a.txt'), 'one\n')
    git('add', 'a.txt')
    git('commit', '-qm', 'one')
    git('update-ref', 'refs/remotes/origin/developer', 'HEAD')
    // Earlier on the branch: a change to the login, so the pull request needs security too
    git('switch', '-qc', 'issue/1-start')
    await fs.mkdir(path.join(dir, 'oidc'))
    await fs.writeFile(path.join(dir, 'oidc', 'tokens.ts'), 'x\n')
    git('add', 'oidc/tokens.ts')
    git('commit', '-qm', 'login')
    await fs.writeFile(path.join(dir, 'a.txt'), 'two\n')
    git('add', 'a.txt')
    for (const kind of ['review', 'tests', 'docs', 'i18n']) approve(dir, kind)
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-slow-git-'))
    t.after(() => fs.rm(bin, { recursive: true, force: true }))
    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
    // Only the look at what the branch changed (origin/developer...HEAD) is slow
    await fs.writeFile(
        path.join(bin, 'git'),
        `#!/bin/sh\ncase "$*" in *"...HEAD"*) sleep 3 ;; esac\nexec "${real}" "$@"\n`,
        { mode: 0o755 }
    )
    const commit = env =>
        spawnSync('node', [HOOK], {
            input: JSON.stringify({ tool_input: { command: 'git commit -m two' }, cwd: dir }),
            encoding: 'utf8',
            env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env }
        })
    assert.match(commit({}).stderr, /security missing/)
    const PATH = `${bin}${path.delimiter}${process.env.PATH}`
    // The whole run out of time, and one call out of time while the run still has time left: both block
    for (const env of [{ HOOK_DEADLINE_MS: '1000' }, { HOOK_GIT_TIMEOUT_MS: '1000' }]) {
        const slow = commit({ PATH, ...env })
        assert.equal(slow.status, 2, JSON.stringify(env))
        assert.match(slow.stderr, /could not check this command/, JSON.stringify(env))
    }
})

test('a time from the environment can only make a timeout shorter, never turn it off', () => {
    for (const value of ['0', '-5', 'NaN', '0.5', '-Infinity', 'abc', '', undefined, 'Infinity', '20000'])
        assert.equal(shorter(10_000, value), 10_000, String(value))
    assert.equal(shorter(10_000, '1'), 1)
    assert.equal(shorter(10_000, '1500.7'), 1500)
    assert.equal(shorter(90_000, ' 5 '), 5)
    for (const value of ['0', '-5', '0.5', 'abc', '1', '1500.7']) {
        const ms = shorter(10_000, value)
        assert.ok(Number.isInteger(ms) && ms >= 1 && ms <= 10_000, String(value))
    }
})

test('a slow git of the guard itself never means "no repository" (the policy of another folder)', async t => {
    if (process.platform === 'win32') return t.skip('a git that is slow on purpose is a shell script')
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-toplevel-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    execFileSync('git', ['init', '-q', '-b', 'issue/1-start'], { cwd: dir })
    await fs.mkdir(path.join(dir, '.claude'))
    await fs.writeFile(path.join(dir, '.claude', 'git-policy.json'), JSON.stringify(CLI))
    await fs.mkdir(path.join(dir, 'sub'))
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-slow-git-'))
    t.after(() => fs.rm(bin, { recursive: true, force: true }))
    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
    // Only finding the top of the repository is slow
    await fs.writeFile(
        path.join(bin, 'git'),
        `#!/bin/sh\ncase "$*" in *"--show-toplevel"*) sleep 3 ;; esac\nexec "${real}" "$@"\n`,
        { mode: 0o755 }
    )
    const { CLAUDE_PROJECT_DIR, ...env } = process.env
    const push = extra =>
        spawnSync('node', [HOOK], {
            input: JSON.stringify({
                tool_input: { command: 'git push origin issue/1-start' },
                cwd: path.join(dir, 'sub')
            }),
            encoding: 'utf8',
            env: { ...env, ...extra }
        })
    // The policy of this repository (push only to developer) blocks it
    assert.match(push({}).stderr, /Push only to developer/)
    const slow = push({ PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOOK_GIT_TIMEOUT_MS: '500' })
    assert.equal(slow.status, 2)
    assert.match(slow.stderr, /could not check this command/)
})

test('a call that ran out of time is told apart from any other failure', () => {
    assert.ok(timedOut({ code: 'ETIMEDOUT' }))
    assert.ok(timedOut({ signal: 'SIGTERM' }))
    assert.ok(!timedOut({ status: 128 }))
    assert.ok(!timedOut(new Error('fatal: not a git repository')))
    assert.ok(!timedOut(undefined))
})
