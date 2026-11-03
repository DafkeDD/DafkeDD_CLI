import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { GITIGNORE_LINES, projectClaudeFiles } from '../src/claude.js'

const TEMPLATE = 'templates/project-claude/mods'
const OWN = ['checks-desk', 'handoff-offer', 'screen-share', 'mods']
const read = rel => readFileSync(rel, 'utf8')
const json = rel => JSON.parse(read(rel))

/** Every file under a folder, relative to it. */
function files(dir) {
    return readdirSync(dir, { recursive: true })
        .map(rel => String(rel).split(path.sep).join('/'))
        .filter(rel => statSync(path.join(dir, rel)).isFile())
        .sort()
}

test('the marketplace lists every mod, each a complete plugin with its hooks module', () => {
    const market = json(`${TEMPLATE}/.claude-plugin/marketplace.json`)
    assert.equal(market.name, 'dafkedd-mods')
    assert.deepEqual(
        market.plugins.map(plugin => plugin.name),
        ['checks-desk', 'handoff-offer', 'screen-share', 'replay-theater', 'mods']
    )
    for (const plugin of market.plugins) {
        assert.equal(plugin.source, `./${plugin.name}`)
        const manifest = json(`${TEMPLATE}/${plugin.name}/.claude-plugin/plugin.json`)
        assert.equal(manifest.name, plugin.name)
        assert.ok(manifest.description.length > 20, plugin.name)
        const hooks = json(`${TEMPLATE}/${plugin.name}/hooks/hooks.json`)
        assert.equal(hooks.modules.length, 1)
        assert.ok(
            read(`${TEMPLATE}/${plugin.name}/hooks/${hooks.modules[0].slice(2)}`).match(
                /export (const|function) register\b/
            )
        )
    }
    // The README says how to install them
    const readme = read(`${TEMPLATE}/README.md`)
    for (const line of [
        '/plugin marketplace add ./mods',
        '/plugin install checks-desk@dafkedd-mods',
        '/reload-plugins'
    ])
        assert.ok(readme.includes(line), line)
})

test('the CLI has the same marketplace as every project, and update keeps it in a project', () => {
    assert.deepEqual(files('mods'), files(TEMPLATE))
    for (const rel of files(TEMPLATE)) assert.equal(read(`mods/${rel}`), read(`${TEMPLATE}/${rel}`), rel)
    const project = projectClaudeFiles({ name: 'p', frontend: true, backend: true, kind: 'app', database: 'p' })
    for (const rel of files(TEMPLATE)) assert.equal(project[`mods/${rel}`], read(`${TEMPLATE}/${rel}`), rel)
    // The CLAUDE.md of a project says what they are and how to install them
    assert.match(project['CLAUDE.md'], /## Mods\n\n`mods\/` holds the Claude Code mods of this project/)
    assert.match(project['CLAUDE.md'], /`\/plugin install <name>@dafkedd-mods`/)
    // The docs of a project say what a mod may do and why
    assert.match(project['CLAUDE.md'], /`docs\/mods\.md`: what a mod may do and why/)
    const page = project['docs/mods.md']
    // A change to a mod needs the security agent (#54): the docs and the project CLAUDE.md say so
    assert.match(page.replace(/\s+/g, ' '), /A change to a mod needs the security agent too/)
    assert.match(project['CLAUDE.md'].replace(/\s+/g, ' '), /uploads, the database and the mods\./)
    for (const line of ['**Draw and read, never decide.**', '**No network, no model.**', '**Shared band.**'])
        assert.ok(page.includes(line), line)
    for (const name of [...OWN, 'replay-theater']) assert.match(page, new RegExp(`\\| \`${name}\` +\\|`), name)
})

test('replay-theater is Anthropic’s sample, unchanged, with its Apache 2.0 licence and a notice of its source', () => {
    const dir = `${TEMPLATE}/replay-theater`
    assert.match(read(`${dir}/LICENSE`), /Apache License\s+Version 2\.0, January 2004/)
    const notice = read(`${dir}/NOTICE`)
    assert.match(notice, /github\.com\/anthropics\/claude-code-playground/)
    assert.match(notice, /commit 569c5283d9a0a7ee7938df85bb32e4f48cbb8c86/)
    assert.match(notice, /Copied unchanged/)
    // npm never ships a .gitignore: the project ignores the types Claude Code writes beside each mod
    assert.ok(GITIGNORE_LINES.includes('mods/*/.claude-plugin/types/'))
    assert.match(read('.gitignore'), /^mods\/\*\/\.claude-plugin\/types\/$/m)
    assert.equal(json(`${dir}/.claude-plugin/plugin.json`).author.name, 'Claude Code DevRel')
    // Prettier never reformats the copy
    const ignored = read('.prettierignore')
    for (const folder of ['mods/replay-theater/', 'templates/project-claude/mods/replay-theater/'])
        assert.match(ignored, new RegExp(`^${folder.replaceAll('/', '\\/')}$`, 'm'))
})

test('our own mods never use the network or a model, never approve or deny, and have their tests', async () => {
    for (const name of OWN) {
        const source = read(`${TEMPLATE}/${name}/hooks/register.tsx`)
        for (const call of ['$.net', '$.network', '$.model', 'fetch(', 'fs.write', 'approve.mjs', 'deny'])
            assert.ok(!source.includes(call) || (call === 'approve.mjs' && name === 'checks-desk'), `${name}: ${call}`)
        assert.ok(
            files(`${TEMPLATE}/${name}/tests`).some(rel => rel.endsWith('.test.tsx')),
            name
        )
    }
    // checks-desk only reads the approvals: it watches approve.mjs calls to read again, never runs it
    const desk = read(`${TEMPLATE}/checks-desk/hooks/register.tsx`)
    assert.match(desk, /names\.includes\(`\$\{check\.kind\}-\$\{id\}`\)/)
    assert.ok(!/\$\.process\.run\(\[[^\]]*approve/.test(desk))
    // Every hook on a tool call or an agent passes the call on when it fails
    assert.equal(desk.match(/\.catch\(\(\$, e, next\) => next\(e\)\)/g)?.length, 5)
    assert.equal(desk.match(/on\('(tool\.call|agent\.spawn)'/g)?.length, 5)
    // The desk shows "approved for an earlier tree" for exactly the checks whose earlier approval the commit hook
    // may take
    const { OUT_OF_SCOPE } = await import('../templates/project-claude/.claude/hooks/approvals.mjs')
    const earlier = /EARLIER_COUNTS = new Set\(\[([^\]]*)\]\)/
        .exec(desk)[1]
        .match(/'(\w+)'/g)
        .map(k => k.slice(1, -1))
    assert.deepEqual(earlier.sort(), Object.keys(OUT_OF_SCOPE).sort())
    // The band is shared: both mods that draw there draw what is beneath too
    for (const name of ['checks-desk', 'handoff-offer'])
        assert.match(read(`${TEMPLATE}/${name}/hooks/register.tsx`), /const below = await next\(e\)[\s\S]*\{below\}/)
    // screen-share changes only what is drawn, never what is stored or what Claude reads
    const share = read(`${TEMPLATE}/screen-share/hooks/register.tsx`)
    for (const component of [
        'UserMessage',
        'AssistantMessage',
        'ToolUse',
        'ToolResult',
        'CommandOutput',
        'ToolGroup',
        'Pane',
        'AbovePrompt',
        'Placed'
    ])
        assert.ok(share.includes(`on('ui.render', { component: '${component}' }`), component)
    // Fail-closed: every row hook draws •••• when it fails anywhere, never the row as it was
    assert.equal(share.match(/on\('ui\.render'/g)?.length, 9)
    assert.equal(share.match(/\}\)\.catch\(blank\)/g)?.length, 9)
    // No catch of its own inside a row: a fallback there could draw the row as it was; only .catch(blank) answers
    assert.ok(!/\btry\s*\{|\bcatch\s*[({]/.test(share.replace(/\.catch\(blank\)/g, '')))
    for (const event of ["'session.append'", "'session.receive'", "'session.send'", "'prompt.submit'"])
        assert.ok(!share.includes(event), event)
    // handoff-offer only fills the prompt: the person sends it
    const offer = read(`${TEMPLATE}/handoff-offer/hooks/register.tsx`)
    assert.match(offer, /\$\.prompt\.fill\(\{ text: '\/handoff' \}\)/)
    assert.ok(!offer.includes('$.prompt.submit'))
    // /mods only shows the command: a mod cannot switch plugins
    assert.match(read(`${TEMPLATE}/mods/hooks/register.tsx`), /\$\.settings\.read\(\{ key: 'enabledPlugins' \}\)/)
})

/** What each of our own mods may ask the engine, as claude plugin validate lists it. */
const CALLS = {
    'checks-desk': [
        'agent.list',
        'command.register',
        'fs.list',
        'process.run',
        'state.get',
        'state.set',
        'ui.open',
        'ui.resolve'
    ],
    'handoff-offer': ['prompt.fill', 'state.get', 'state.set', 'ui.resolve'],
    'screen-share': ['command.register', 'state.get', 'state.set', 'ui.resolve', 'ui.status'],
    mods: ['command.register', 'settings.read', 'ui.open', 'ui.resolve']
}

// The engine's own checks, where Claude Code is installed (locally, the tester agent and the mods job of the CI, which
// sets REQUIRE_CLAUDE so a missing claude fails)
const claude = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' })
const skip = claude.status !== 0 && !process.env.REQUIRE_CLAUDE
test(
    'claude plugin validate and claude plugin test pass for every mod, with only the calls it may make',
    { skip },
    () => {
        assert.equal(claude.status, 0, 'claude is installed')
        for (const name of [...OWN, 'replay-theater']) {
            const out = spawnSync('claude', ['plugin', 'validate', '.'], {
                cwd: `${TEMPLATE}/${name}`,
                encoding: 'utf8'
            })
            assert.equal(out.status, 0, `${name}: ${out.stdout}${out.stderr}`)
            assert.match(out.stdout + out.stderr, /Validation passed/, name)
            if (!CALLS[name]) continue
            const calls = /calls: (.*)$/m.exec(out.stdout + out.stderr)?.[1] ?? ''
            const used = [...calls.matchAll(/\$\.([\w.]+)/g)].map(m => m[1])
            assert.ok(used.length > 0, `${name}: ${calls}`)
            for (const call of used) assert.ok(CALLS[name].includes(call), `${name} calls $.${call}`)
        }
        for (const name of OWN) {
            const out = execFileSync('claude', ['plugin', 'test', '.'], {
                cwd: `${TEMPLATE}/${name}`,
                encoding: 'utf8'
            })
            assert.match(out, / 0 fail/, name)
        }
    }
)
