import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
    askClaude,
    ciWorkflow,
    claudeNext,
    claudeSteps,
    codeowners,
    describeProject,
    lighthouseRc,
    lighthouseUrls,
    projectClaudeFiles,
    projectClaudeMd,
    releaseWorkflow,
    templateFiles
} from '../src/claude.js'
import { main } from '../src/index.js'

const LINK = { issuer: 'http://localhost:4000/oidc', accountUrl: 'http://localhost:3000', clientId: 'planner' }
const app = describeProject({
    name: 'planner',
    frontend: { id: 'nextjs' },
    backend: { id: 'linked' },
    answers: {
        link: LINK,
        database: { database: 'planner' },
        appOptions: { mail: true, files: false, isolation: 'database' }
    }
})
const pasport = describeProject({
    name: 'pasport',
    frontend: { id: 'nextjs' },
    backend: { id: 'nestjs' },
    answers: { oidc: { adminEmail: 'a@b.c' }, database: { database: 'pasport' } }
})
const frontendOnly = describeProject({ name: 'site', frontend: { id: 'nextjs' } })

test('the CLI asks for Claude Code, yes by default', async () => {
    let asked
    const answer = await askClaude({ prompts: { confirm: async config => ((asked = config), true) } })
    assert.equal(answer, true)
    assert.equal(asked.default, true)
    assert.match(asked.message, /Claude Code/)
    assert.match(asked.message, /per issue een branch/)
})

test('describeProject knows the parts and the kind of backend', () => {
    assert.deepEqual(
        { kind: app.kind, frontend: app.frontend, backend: app.backend, database: app.database },
        { kind: 'app', frontend: true, backend: true, database: 'planner' }
    )
    assert.deepEqual(app.modules, { mail: true, files: false, isolation: 'database' })
    assert.equal(pasport.kind, 'pasport')
    assert.equal(pasport.modules, null)
    assert.equal(frontendOnly.kind, null)
    assert.equal(describeProject({ name: 'x', backend: { id: 'nestjs' }, answers: { auth: true } }).kind, 'login')
    assert.equal(describeProject({ name: 'x', backend: { id: 'nestjs' }, answers: {} }).kind, 'api')
})

test('CLAUDE.md of a project: its parts, the rules, the branch per issue, the merge and the release', () => {
    const text = projectClaudeMd(app)
    for (const part of [
        '# planner',
        'an **app linked to a Pasport login server**',
        '`./frontend`',
        'database `planner`',
        `client \`planner\``,
        '`TENANT_ISOLATION=database` (a database per organisation)',
        '- Mail: `MailService`',
        '`issue/<number>-<words>` from `developer`',
        '`gh pr merge <n> --squash --delete-branch`',
        'only a person merges `developer` into `main`',
        '.claude/design/pasport.md',
        'four languages'.replace('four languages', 'Four languages')
    ])
        assert.ok(text.includes(part), part)
    for (const name of [
        'frontend',
        'nestjs',
        'postgresql',
        'reviewer',
        'tester',
        'docs',
        'i18n',
        'security',
        'plan',
        'implement',
        'diagnose',
        'handoff'
    ])
        assert.ok(text.includes('`' + name + '`'), name)
    assert.ok(!text.includes('- Files:'), 'no files module')
    assert.match(projectClaudeMd(pasport), /the \*\*Pasport login server\*\*/)
    assert.ok(!projectClaudeMd(frontendOnly).includes('`./backend`'))
    // The docs live in docs/ (the READMEs only point there); update brings the code too; the seed of each kind
    assert.match(text, /every endpoint in `docs\/api\.md` \(body, example, response, errors; the READMEs of/)
    assert.ok(!text.includes('the README of the backend'))
    assert.match(
        text,
        /`\.\.\. update` brings the agents, hooks, pipelines and the code of `\.\/backend`, `\.\/frontend` and/
    )
    assert.match(text, /`<file>\.dafkedd-new`/)
    assert.match(projectClaudeMd(frontendOnly), /the code of `\.\/frontend` and `\.\/docs`/)
    assert.ok(!text.includes('npm run seed'))
    assert.match(text, /it creates a seed script in `\.\/backend`/)
    assert.match(
        projectClaudeMd(pasport),
        /`npm run demo:data` and `npm run demo:clear` in `\.\/backend` already exist/
    )
    // The tour of the first login is an absolute MUST of every app with the Pasport design
    for (const md of [projectClaudeMd(pasport), text, projectClaudeMd(frontendOnly)])
        assert.match(md, /\*\*First-login tour \(an absolute MUST\)\*\*: the first time a user logs in/)
    assert.match(projectClaudeMd(pasport), /`Tour` in `frontend\/src\/components\/pasport\/tour\.tsx`/)
    // An app without the tour yet says so
    assert.match(text, /Known gap: this app does not have the tour yet \(DafkeDD_CLI issue #11/)
})

test('the CI checks every part on pushes and pull requests, with PostgreSQL for the database tests', () => {
    const ci = ciWorkflow(app)
    assert.match(ci, /pull_request:\n\s+branches: \[developer, main\]/)
    assert.match(ci, /workflow_call:/)
    // A push to main is a release (release.yml runs the CI itself), so the CI runs on a push to developer only
    assert.match(ci, /push:\n\s+branches: \[developer\]\n/)
    // test:db only when the backend has it
    assert.ok(ci.includes('npm run --if-present test:db'))
    assert.match(ci, /image: postgres:17/)
    assert.match(ci, /DATABASE_NAME: planner/)
    for (const run of ['format:check', 'lint', 'build', 'test:e2e']) assert.ok(ci.includes(`npm run ${run}`), run)
    assert.match(ci, /working-directory: frontend/)
    assert.match(ci, /cache-dependency-path: backend\/package-lock.json/)
    const frontendCi = ciWorkflow(frontendOnly)
    assert.ok(!frontendCi.includes('backend') && !frontendCi.includes('postgres'))
    // The Pasport design is checked in every project with a frontend, a site without a login too
    assert.ok(ci.includes('npm run check:design'))
    assert.ok(ciWorkflow(pasport).includes('npm run check:design'))
    assert.ok(frontendCi.includes('npm run check:design'))
})

test('the release runs only on main, after the CI, with the version of the backend', () => {
    const release = releaseWorkflow(app)
    assert.match(release, /push:\n\s+branches: \[main\]/)
    assert.match(release, /uses: \.\/\.github\/workflows\/ci\.yml/)
    assert.match(release, /needs: test/)
    // The first push of the repository is no release
    assert.equal(release.match(/if: github\.event\.before != '0{40}'/g).length, 2)
    assert.match(release, /require\('\.\/backend\/package\.json'\)\.version/)
    assert.match(release, /gh release create "v\$\{\{ steps\.version\.outputs\.version \}\}"/)
    assert.match(releaseWorkflow(frontendOnly), /require\('\.\/frontend\/package\.json'\)/)
})

test('a project gets the agents, skills, hooks, design, issue forms, the policy and both pipelines', () => {
    const files = projectClaudeFiles(app)
    for (const rel of [
        'CLAUDE.md',
        '.claude/settings.json',
        '.claude/git-policy.json',
        '.claude/hooks/guard-git.mjs',
        '.claude/hooks/approvals.mjs',
        '.claude/hooks/approve.mjs',
        '.claude/hooks/format.mjs',
        '.claude/design/pasport.md',
        '.claude/design/pasport-tokens.json',
        '.claude/scripts/setup-labels.mjs',
        '.github/ISSUE_TEMPLATE/feature.yml',
        '.github/ISSUE_TEMPLATE/bug.yml',
        '.github/workflows/ci.yml',
        '.github/workflows/release.yml',
        '.github/dependabot.yml',
        'CHANGELOG.md',
        ...[
            'frontend',
            'nestjs',
            'postgresql',
            'reviewer',
            'tester',
            'docs',
            'i18n',
            'security',
            'qa',
            'kb',
            'e2e',
            'a11y',
            'privacy',
            'performance',
            'dependencies',
            'release',
            'translator',
            'seed',
            'observability',
            'support',
            'architect',
            'backup',
            'infra'
        ].map(name => `.claude/agents/${name}.md`),
        ...['plan', 'implement', 'diagnose', 'handoff'].map(name => `.claude/skills/${name}/SKILL.md`)
    ])
        assert.ok(files[rel], rel)
    assert.deepEqual(JSON.parse(files['.claude/git-policy.json']), { push: 'issue-branches', merge: 'developer' })
    assert.ok(!files['.claude/skills/port-from-test/SKILL.md'], 'only for the CLI')
    // The skill of a project merges into developer with a pull request, never into main
    const implement = files['.claude/skills/implement/SKILL.md']
    assert.match(implement, /git switch -c issue\/<n>-<two-or-three-words> origin\/developer/)
    assert.match(implement, /gh pr create --base developer/)
    assert.match(implement, /gh pr checks <number> --watch/)
    assert.match(implement, /Never merge into `main`, never release/)
    assert.deepEqual(
        Object.keys(templateFiles()).sort(),
        Object.keys(files)
            .filter(
                rel =>
                    ![
                        'CLAUDE.md',
                        '.mcp.json',
                        '.github/workflows/ci.yml',
                        '.github/workflows/release.yml',
                        '.github/workflows/codeql.yml',
                        '.github/workflows/screenshots.yml',
                        'frontend/lighthouserc.json'
                    ].includes(rel)
            )
            .sort()
    )
})

test('claudeSteps writes the files and adds the handoff to the root .gitignore once', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-claude-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules')
    const [step] = claudeSteps({ projectDir: dir, project: app, owner: async () => 'dafkedd' })
    assert.match(step.title, /Claude Code/)
    await step.run()
    await step.run()
    assert.equal(
        await fs.readFile(path.join(dir, '.gitignore'), 'utf8'),
        'node_modules\n.claude/handoff.md\n.env.test\nplaywright-report/\ntest-results/\n.lighthouseci/\n*.dafkedd-new\n'
    )
    assert.match(await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8'), /^# planner/)
    assert.ok(await fs.stat(path.join(dir, '.claude', 'agents', 'frontend.md')))
    assert.ok(await fs.stat(path.join(dir, '.github', 'workflows', 'release.yml')))
    assert.ok(claudeNext().some(line => line.includes('setup-labels')))
    // The CLI made the repository: it did that itself
    assert.ok(!claudeNext({ repo: true }).some(line => line.includes('setup-labels')))
    assert.equal(await fs.readFile(path.join(dir, '.github', 'CODEOWNERS'), 'utf8'), codeowners('dafkedd'))
    assert.match(codeowners('dafkedd'), /^\* @dafkedd$/m)
    // Without gh (or not logged in): no CODEOWNERS
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-claude-'))
    t.after(() => fs.rm(other, { recursive: true, force: true }))
    await claudeSteps({ projectDir: other, project: app, owner: async () => null })[0].run()
    await assert.rejects(fs.stat(path.join(other, '.github', 'CODEOWNERS')))
    // The pull request template and the security policy
    const files = projectClaudeFiles(app)
    assert.match(files['.github/pull_request_template.md'], /^Closes #$/m)
    assert.match(files['SECURITY.md'], /private vulnerability reporting/)
})

test('main: Claude Code is added before git, and developer becomes the default branch', async () => {
    const titles = []
    const logs = []
    const part = (id, dir) => ({
        id,
        label: id,
        dir,
        ask: async () => ({}),
        steps: async () => [{ title: `${id} step`, run: async () => {} }]
    })
    await main({
        projectDir: '/tmp/planner',
        prompts: { select: async config => (config.message.includes('frontend') ? 'nextjs' : 'nestjs') },
        askClaude: async () => true,
        askCloud: async () => false,
        ask: async () => ({ name: 'planner', platform: 'github', visibility: 'private' }),
        registry: { nextjs: part('nextjs', 'frontend') },
        backendRegistry: { nestjs: { ...part('nestjs', 'backend'), api: { port: 4000 } } },
        execute: async steps => titles.push(...steps.map(step => step.title)),
        log: line => logs.push(line)
    })
    const claude = titles.findIndex(title => title.startsWith('Claude Code toevoegen'))
    assert.ok(claude > titles.indexOf('nestjs step'))
    assert.ok(claude < titles.indexOf('Git initialiseren'))
    assert.ok(titles.includes('Branch developer aanmaken en als standaardbranch instellen'))
    assert.ok(logs.some(line => line.includes('standaardbranch developer')))
})

test('the new agents: what they may do, the knowledge base, Dependabot into developer, releases prepared for a person', () => {
    const files = projectClaudeFiles(app)
    const frontmatter = name =>
        files[`.claude/agents/${name}.md`].match(/^---\nname: (.+)\ndescription: (.+)\ntools: (.+)\n---\n/)
    for (const name of ['kb', 'e2e', 'a11y', 'privacy', 'performance', 'dependencies', 'release', 'translator']) {
        const [, own, description] = frontmatter(name)
        assert.equal(own, name)
        assert.ok(description.length > 60, name)
    }
    for (const name of ['a11y', 'privacy', 'performance']) assert.ok(!/Edit|Write/.test(frontmatter(name)[3]), name)
    for (const name of ['a11y', 'privacy'])
        assert.ok(files[`.claude/agents/${name}.md`].includes(`node .claude/hooks/approve.mjs ${name}`), name)
    // The simple checks run on a cheaper model; the review, security and tests keep the default one
    for (const name of ['docs', 'i18n'])
        assert.match(files[`.claude/agents/${name}.md`], /^tools: .+\nmodel: sonnet\n---/m)
    for (const name of ['reviewer', 'security', 'tester'])
        assert.ok(!/^model:/m.test(files[`.claude/agents/${name}.md`]), name)
    assert.match(files['.claude/agents/kb.md'], /docs\/kb\/screenshots\/<lang>\//)
    assert.match(files['.claude/agents/kb.md'], /e2e\/screens\.spec\.ts/)
    assert.match(files['.claude/agents/docs.md'], /the knowledge base/)
    assert.match(files['.claude/agents/release.md'], /You never merge into `main`/)
    assert.match(files['.claude/agents/dependencies.md'], /two weeks/)
    const dependabot = files['.github/dependabot.yml']
    assert.equal((dependabot.match(/target-branch: developer/g) ?? []).length, 3)
    for (const dir of ['/backend', '/frontend']) assert.ok(dependabot.includes(`directory: ${dir}`), dir)
    assert.match(files['CHANGELOG.md'], /## Unreleased/)
    assert.match(files['.github/workflows/ci.yml'], /npx playwright install --with-deps chromium\n\s+npm run test:e2e/)
    for (const name of ['kb', 'e2e', 'translator', 'a11y', 'privacy', 'performance', 'dependencies', 'release'])
        assert.ok(files['CLAUDE.md'].includes('`' + name + '`'), name)
    assert.match(files['CLAUDE.md'], /## Knowledge base/)
})

test('seed, support, architect, observability and backup; the decisions in docs/adr', () => {
    const files = projectClaudeFiles({ ...app, cloud: true })
    assert.match(files['.claude/agents/seed.md'], /refusing to run when\n?\s*`NODE_ENV=production`/)
    assert.match(files['.claude/agents/seed.md'], /TOTP secret/)
    assert.match(files['.claude/agents/support.md'], /gh issue list --search/)
    assert.match(files['.claude/agents/architect.md'], /docs\/adr\/NNNN-<title>\.md/)
    assert.match(files['.claude/agents/observability.md'], /monitoring\.tf/)
    assert.match(files['.claude/agents/backup.md'], /Restore test/)
    assert.match(files['docs/adr/README.md'], /\[0001\]\(0001-record-architecture-decisions\.md\)/)
    assert.match(files['docs/adr/template.md'], /## Options considered/)
    assert.match(files['CLAUDE.md'], /`observability` \(logs, alerts, budget\) and `backup`/)
    assert.ok(!projectClaudeMd(app).includes('`observability`'), 'without the cloud there is nothing to observe')
    assert.match(files['.claude/skills/plan/SKILL.md'], /\*\*architect\*\*/)
    assert.match(files['.claude/skills/implement/SKILL.md'], /\*\*seed\*\*/)
})

test('the multi-tenant rule is only for the Pasport server and the linked apps', () => {
    assert.match(projectClaudeMd(app), /\*\*Multi-tenant\*\*/)
    const login = describeProject({
        name: 'shop',
        frontend: { id: 'nextjs' },
        backend: { id: 'nestjs' },
        answers: { auth: true, database: { database: 'shop' } }
    })
    assert.ok(!projectClaudeMd(login).includes('withTenant'))
    assert.match(projectClaudeMd(login), /\*\*Migrations\*\*/)
    assert.ok(!projectClaudeMd(frontendOnly).includes('Migrations'))
})

test('the CI checks secrets and known vulnerabilities, Lighthouse the pages without login; CodeQL and screenshots', async () => {
    const pasport = describeProject({
        name: 'pas',
        frontend: { id: 'nextjs' },
        backend: { id: 'nestjs' },
        answers: { oidc: true, database: { database: 'pas' } }
    })
    const ci = ciWorkflow(pasport)
    assert.match(ci, /name: Security \(secrets, npm audit\)/)
    assert.match(ci, /gitleaks\/releases\/download\/v8\.21\.2\/gitleaks_8\.21\.2_linux_x64\.tar\.gz/)
    assert.match(ci, /\.\/gitleaks git --redact --no-banner \./)
    assert.match(ci, /for dir in backend frontend; do/)
    assert.match(ci, /npm audit --omit=dev --audit-level=high/)
    assert.match(ci, /npx --yes @lhci\/cli@0\.14\.0 autorun/)
    // Even without a frontend or a backend there is a job (the secrets)
    const empty = ciWorkflow(describeProject({ name: 'x' }))
    assert.match(empty, /Security/)
    assert.ok(!empty.includes('--audit-level'))

    assert.deepEqual(lighthouseUrls(pasport), [
        'http://localhost:3000/',
        'http://localhost:3000/login',
        'http://localhost:3000/register',
        'http://localhost:3000/forgot-password',
        'http://localhost:3000/reset-password',
        'http://localhost:3000/verify-email',
        'http://localhost:3000/invite'
    ])
    assert.deepEqual(lighthouseUrls(app), [])
    assert.ok(!ciWorkflow(app).includes('lhci'))
    const files = projectClaudeFiles(pasport)
    const rc = JSON.parse(files['frontend/lighthouserc.json'])
    assert.deepEqual(rc.ci.assert.assertions['categories:accessibility'], ['error', { minScore: 0.95 }])
    assert.equal(rc.ci.collect.url.length, 7)
    // The frontend checks its format: the file is as Prettier writes it
    const prettier = await import('prettier')
    const options = await prettier.resolveConfig('frontend/lighthouserc.json', { config: '.prettierrc' })
    for (const project of [pasport, frontendOnly])
        assert.ok(await prettier.check(lighthouseRc(project), { ...options, parser: 'json' }), lighthouseRc(project))

    assert.match(files['.github/workflows/codeql.yml'], /languages: javascript-typescript/)
    assert.match(
        files['.github/workflows/codeql.yml'],
        /vars\.CODEQL == 'on' \|\| \(github\.event_name != 'schedule' && !github\.event\.repository\.private\)/
    )
    // The CI can be started by the Screenshots workflow (its push starts nothing)
    assert.match(ciWorkflow(pasport), /\n {4}workflow_dispatch:\n/)
    assert.match(files['.github/workflows/screenshots.yml'], /gh workflow run ci\.yml --ref "\$GITHUB_REF_NAME"/)
    assert.match(files['.github/workflows/screenshots.yml'], /actions: write/)
    // gitleaks knows the hashes of the manifest are no secrets
    assert.match(files['.gitleaks.toml'], /\^\\\.dafkedd\\\.json\$/)
    const screenshots = files['.github/workflows/screenshots.yml']
    assert.match(screenshots, /if: startsWith\(github\.ref_name, 'issue\/'\)/)
    assert.match(screenshots, /--update-snapshots/)
    assert.ok(
        !projectClaudeFiles(describeProject({ name: 'api', backend: { id: 'nestjs' } }))[
            '.github/workflows/screenshots.yml'
        ]
    )
})
