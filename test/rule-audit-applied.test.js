import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { projectClaudeFiles } from '../src/claude.js'

// The first rule audit (#52): hard rules keep their strength, but say why, without shouting
const read = rel => readFileSync(rel, 'utf8').replace(/\s+/g, ' ')
const skills = dir => readdirSync(dir).map(name => `${dir}/${name}/SKILL.md`)
const agents = dir => readdirSync(dir).map(name => `${dir}/${name}`)
// rule-audit itself quotes the shouting it looks for
const FILES = [
    'CLAUDE.md',
    ...skills('.claude/skills'),
    ...agents('.claude/agents'),
    ...skills('templates/project-claude/.claude/skills'),
    ...agents('templates/project-claude/.claude/agents')
].filter(file => !file.includes('/rule-audit/'))

test('no rule shouts: no "MUST" or bold "never" in CLAUDE.md, the skills and the agents', () => {
    const project = projectClaudeFiles({ name: 'p', frontend: true, backend: true, kind: 'app', database: 'p' })
    for (const [file, text] of [
        ...FILES.map(file => [file, read(file)]),
        ['project CLAUDE.md', project['CLAUDE.md']]
    ]) {
        assert.ok(!/\bMUST\b/.test(text), `${file}: MUST`)
        assert.ok(!/\*\*never\*\*/.test(text), `${file}: **never**`)
        assert.ok(!/no exceptions/i.test(text), `${file}: no exceptions`)
    }
})

test('the hard rules say why', () => {
    const cli = read('CLAUDE.md')
    assert.match(cli, /never changed: it already ran, with its checksum, in databases out there/)
    assert.match(cli, /one organisation never sees another's data/)
    assert.match(cli, /under no one else's licence\. Rebuild the behaviour, never the text\./)
    assert.match(cli, /\*\*First-login tour \(hard rule\)\*\*: so a new user meets every page once/)
    for (const file of agents('.claude/agents').filter(file => !file.endsWith('kb.md')))
        assert.match(read(file), /When in doubt, Blocking\. A missed problem ships to every project/, file)
    assert.match(read('.claude/agents/tester.md'), /the six variants of `CLAUDE\.md`/)
    assert.match(read('.claude/skills/diagnose/SKILL.md'), /Show the cause before you fix it: a guessed fix can hide/)
    assert.match(read('templates/project-claude/.claude/skills/infra/SKILL.md'), /Terraform does not know it/)
    assert.match(read('templates/project-claude/.claude/skills/backup/SKILL.md'), /a long-lived secret on disk/)
})

test('the paths in the CLI pasport-design skill exist', () => {
    const text = read('.claude/skills/pasport-design/SKILL.md')
    for (const path of [
        'templates/frontend-oidc-linked/src/components/shell/',
        'templates/frontend-oidc-linked/src/components/pasport/page-head.tsx'
    ]) {
        assert.ok(text.includes(path), path)
        readdirSync(path.endsWith('/') ? path : path.replace(/[^/]+$/, ''))
    }
    for (const name of ['shell.tsx', 'portal-shell.tsx'])
        assert.ok(readdirSync('templates/frontend-oidc/src/components/pasport').includes(name), name)
})

test('a project names its owner, not Davey', () => {
    for (const file of [
        ...skills('templates/project-claude/.claude/skills'),
        ...agents('templates/project-claude/.claude/agents')
    ])
        assert.ok(!read(file).includes('Davey'), file)
})

test("the Cloud buttons of a project stay a person's, with the reason", () => {
    const project = projectClaudeFiles({
        name: 'p',
        frontend: true,
        backend: true,
        kind: 'app',
        database: 'p',
        cloud: true
    })
    assert.match(
        project['CLAUDE.md'].replace(/\s+/g, ' '),
        /Never run them yourself: they change what runs in production and what it costs, so a person presses them/
    )
})
