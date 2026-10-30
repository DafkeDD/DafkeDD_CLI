import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { checksGreen, decide, gitCommands, readPolicy } from '../.claude/hooks/guard-git.mjs'
import { AGENTS, approve, branchPaths, KINDS, missing, required } from '../.claude/hooks/approvals.mjs'

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

test('the building knowledge (skills here, agents in a project) and the design it follows are in the repository', async () => {
    for (const skill of ['pasport-design', 'nestjs', 'postgresql']) {
        const text = await fs.readFile(`.claude/skills/${skill}/SKILL.md`, 'utf8')
        assert.match(text, new RegExp(`^---\\nname: ${skill}\\ndescription: .+\\n---\\n`), skill)
    }
    for (const agent of ['frontend', 'nestjs', 'postgresql']) {
        const text = await fs.readFile(`${TEMPLATE}/agents/${agent}.md`, 'utf8')
        assert.match(text, new RegExp(`^---\\nname: ${agent}\\ndescription: .+\\ntools: .*Edit`), agent)
        assert.match(text, /never commit or push/, agent)
    }
    assert.match(
        await fs.readFile('.claude/skills/pasport-design/SKILL.md', 'utf8'),
        /templates\/project-claude\/\.claude\/design\/pasport\.md/
    )
    assert.match(await fs.readFile(`${TEMPLATE}/agents/frontend.md`, 'utf8'), /`\.claude\/design\/pasport\.md`/)
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
