import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { commands, LABELS, REPO } from '../scripts/setup-labels.mjs'

const SKILLS = ['plan', 'implement', 'diagnose', 'handoff', 'port-from-test', 'pasport-design', 'nestjs', 'postgresql']
const AGENTS = ['reviewer', 'tester', 'docs', 'i18n', 'security']
const names = new Set(LABELS.map(([name]) => name))

/** The frontmatter of an agent or skill: one line per key. */
async function frontmatter(file) {
    const text = await fs.readFile(file, 'utf8')
    const match = text.match(/^---\n([\s\S]*?)\n---\n/)
    assert.ok(match, file)
    return { text, keys: Object.fromEntries(match[1].split('\n').map(line => line.split(/:\s(.*)/s).slice(0, 2))) }
}

test('every skill and agent has a name and a description of one line', async () => {
    for (const skill of SKILLS) {
        const { keys } = await frontmatter(`.claude/skills/${skill}/SKILL.md`)
        assert.equal(keys.name, skill)
        assert.ok(keys.description?.length > 40, skill)
    }
    for (const agent of AGENTS) {
        const { keys } = await frontmatter(`.claude/agents/${agent}.md`)
        assert.equal(keys.name, agent)
        assert.ok(keys.description?.length > 40, agent)
        assert.ok(keys.tools, agent)
    }
})

test('the checking agents are read-only, building is done with the knowledge skills (no building agents)', async () => {
    for (const agent of ['reviewer', 'tester', 'docs', 'i18n', 'security']) {
        const { keys } = await frontmatter(`.claude/agents/${agent}.md`)
        assert.ok(!/\b(Edit|Write)\b/.test(keys.tools), agent)
        // docs and i18n mostly compare text: a cheaper model; the review, security and tests keep the default one
        assert.equal(keys.model, ['docs', 'i18n'].includes(agent) ? 'sonnet' : undefined, agent)
    }
    // Building is the main session's, with the knowledge skills: no building agents any more
    for (const agent of ['frontend', 'nestjs', 'postgresql'])
        assert.ok(!existsSync(`.claude/agents/${agent}.md`), agent)
    for (const skill of ['pasport-design', 'nestjs', 'postgresql']) {
        const { text } = await frontmatter(`.claude/skills/${skill}/SKILL.md`)
        assert.match(text, /start the checking agents \(the `implement` skill\)/, skill)
    }
    assert.match(
        await fs.readFile('.claude/skills/pasport-design/SKILL.md', 'utf8'),
        /First-login tour|first-login tour/
    )
})

test('the skills use only labels that npm run labels creates, on the right repository', async () => {
    for (const skill of SKILLS) {
        const { text } = await frontmatter(`.claude/skills/${skill}/SKILL.md`)
        for (const [label] of text.matchAll(/\b(?:type|area|status):[a-z-]+\b/g))
            assert.ok(names.has(label), `${skill}: ${label}`)
    }
    for (const template of ['feature.yml', 'bug.yml']) {
        const text = await fs.readFile(`.github/ISSUE_TEMPLATE/${template}`, 'utf8')
        for (const [, label] of text.matchAll(/'([a-z]+:[a-z-]+)'/g))
            assert.ok(names.has(label), `${template}: ${label}`)
    }
    assert.equal(REPO, 'DafkeDD/DafkeDD_CLI')
    const [first] = commands()
    assert.deepEqual(first.slice(0, 5), ['label', 'create', 'spec', '--repo', REPO])
    assert.ok(first.includes('--force'), 'running it again updates the labels')
    assert.equal(new Set(LABELS.map(([, color]) => color)).size > 5, true)
})

test('implement works on an issue branch, opens a pull request and merges it when green; the plan makes the issues', async () => {
    const implement = await fs.readFile('.claude/skills/implement/SKILL.md', 'utf8')
    assert.match(implement, /\(closes #<n>\)/)
    assert.match(implement, /git switch -c issue\/<n>-<two-or-three-words> origin\/developer/)
    assert.match(implement, /gh pr create --base developer/)
    assert.match(implement, /gh pr merge <number> --squash --delete-branch/)
    assert.match(implement, /Never merge into `main`/)
    for (const name of ['reviewer', 'tester', 'docs', 'i18n', 'security', 'pasport-design', 'nestjs', 'postgresql'])
        assert.ok(implement.includes(`**${name}**`), name)
    const plan = await fs.readFile('.claude/skills/plan/SKILL.md', 'utf8')
    assert.match(plan, /gh issue create --repo DafkeDD\/DafkeDD_CLI --label spec/)
    const ignored = await fs.readFile('.gitignore', 'utf8')
    assert.match(ignored, /^\.claude\/handoff\.md$/m)
})

test('CLAUDE.md names every agent and skill', async () => {
    const text = await fs.readFile('CLAUDE.md', 'utf8')
    for (const name of [...AGENTS, ...SKILLS]) assert.ok(text.includes('`' + name + '`'), name)
})
