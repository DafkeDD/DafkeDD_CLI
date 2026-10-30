import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

/** Where the skills and agents of the CLI and of every project live. */
const SKILLS = ['.claude/skills', 'templates/project-claude/.claude/skills']
const AGENTS = ['.claude/agents', 'templates/project-claude/.claude/agents']
/**
 * The agents with write tools (the knowledge base). Every other agent is a check: only reading tools, plus a shell that
 * its instructions keep read-only.
 */
const WRITERS = ['kb']

/** The front matter (one line per key) and the body of a skill or agent. */
async function read(file) {
    const text = await fs.readFile(file, 'utf8')
    const match = text.match(/^---\n([\s\S]*?)\n---\n/)
    assert.ok(match, `${file}: front matter`)
    const keys = Object.fromEntries(match[1].split('\n').map(line => line.split(/:\s(.*)/s).slice(0, 2)))
    return { keys, frontMatter: match[1], body: text.slice(match[0].length) }
}

async function all() {
    const found = []
    for (const folder of SKILLS)
        for (const name of await fs.readdir(folder))
            found.push({ kind: 'skill', name, file: path.join(folder, name, 'SKILL.md') })
    for (const folder of AGENTS)
        for (const file of (await fs.readdir(folder)).filter(file => file.endsWith('.md')))
            found.push({ kind: 'agent', name: file.slice(0, -3), file: path.join(folder, file) })
    return found
}

test('every skill and agent is named after its folder or file, in kebab case', async () => {
    const found = await all()
    assert.ok(found.filter(entry => entry.kind === 'skill').length >= 20)
    assert.ok(found.filter(entry => entry.kind === 'agent').length >= 14)
    for (const { name, file } of found) {
        const { keys } = await read(file)
        assert.equal(keys.name, name, file)
        assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, file)
        assert.ok(name.length <= 40, file)
    }
})

test('every description says what it does and when to use it, in at most 1024 characters', async () => {
    for (const { file } of await all()) {
        const { keys } = await read(file)
        const description = keys.description ?? ''
        // Always in the context of the session: it decides when the skill or agent is used, so short and specific
        assert.ok(description.length >= 40 && description.length <= 1024, `${file}: ${description.length} characters`)
        assert.ok(!/<[a-z/]/i.test(description), `${file}: no tags in a description`)
        assert.match(description, /\b(use|load|start|when(ever)?|before|after)\b/i, `${file}: when to use it`)
    }
})

test('a SKILL.md stays under 500 lines, so loading it stays cheap', async () => {
    for (const { kind, file } of await all()) {
        if (kind !== 'skill') continue
        const { body } = await read(file)
        assert.ok(body.split('\n').length < 500, file)
    }
})

/** The only tools a checking agent may have: reading, a shell, and the read-only browser and database servers. */
const CHECK_TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'mcp__playwright', 'mcp__postgres']
/** The tools of kb, which writes the knowledge base: the reading tools plus Edit and Write, never other servers. */
const WRITER_TOOLS = [...CHECK_TOOLS, 'Edit', 'Write']
/**
 * The only keys the front matter of an agent (a check or kb) may have, each on one line of its own. Anything else (hooks,
 * mcpServers, permissionMode, disallowedTools, also as a YAML block on the next lines) could widen what it may do.
 */
const CHECK_KEYS = ['name', 'description', 'tools', 'model']

/** The models an agent may name (the default model when there is none). */
const MODELS = ['sonnet', 'opus', 'haiku', 'inherit']

/**
 * Why the front matter of an agent is not allowed (null when it is): allowlists of keys (each once) and of `tools`
 * (the reading tools of a check; kb may add Edit and Write).
 */
function agentProblem(frontMatter, tools = CHECK_TOOLS) {
    // A line break YAML may read that a split on \n does not see (a carriage return, NEL, a line separator)
    if (/[\r\u0085\u2028\u2029]/.test(frontMatter)) return 'a line break other than \\n in the front matter'
    const keys = {}
    for (const line of frontMatter.split('\n')) {
        if (!line.trim()) continue
        // A line that continues a key (a YAML list or a value on the next line) or a line that is no key
        const key = line.match(/^([A-Za-z][\w-]*):(?: (.*))?$/)
        if (!key) return `not one key per line: ${line}`
        if (!CHECK_KEYS.includes(key[1])) return `${key[1]} in the front matter`
        if (!key[2]?.trim()) return `${key[1]} without a value on its line`
        // YAML parsers keep the first, the last or neither of a repeated key: never check only one of them
        if (key[1] in keys) return `${key[1]} twice in the front matter`
        keys[key[1]] = key[2].trim()
    }
    if (!keys.tools) return 'no tools listed (it would get every tool)'
    if (keys.model && !MODELS.includes(keys.model)) return `not a model: ${keys.model}`
    const extra = keys.tools
        .split(',')
        .map(tool => tool.trim())
        .filter(tool => !tools.includes(tool))
    return extra.length ? `not a reading tool: ${extra.join(', ')}` : null
}

test('the allowlists of a checking agent refuse every tool and key that could let it write', () => {
    const agent = rest => `name: reviewer\ndescription: Reviews a change. Use it before every commit.\n${rest}`
    assert.equal(
        agentProblem(agent('tools: Read, Grep, Glob, Bash, mcp__playwright, mcp__postgres\nmodel: sonnet')),
        null
    )
    for (const tools of [
        '*',
        'Read, Write',
        'Read, edit',
        'Read, Edit',
        'Read, MultiEdit',
        'Read, NotebookEdit',
        'Read, mcp__github',
        'Read, mcp__memory__memory_write',
        'Bash(*)',
        'Read, mcp__playwright__*',
        '[Read, Write]'
    ])
        assert.ok(agentProblem(agent(`tools: ${tools}`)), tools)
    for (const rest of [
        // No tools: every tool
        'model: sonnet',
        'tools:\n  - Read\n  - Write',
        'tools: Read\n  , Write',
        'tools: Read\nmcpServers:\n  - github',
        'tools: Read\nmcpServers: github',
        'tools: Read\ndisallowedTools:\n  - Write',
        'tools: Read\npermissionMode: bypassPermissions',
        'tools: Read\nhooks:\n  PreToolUse:\n    - matcher: Bash',
        'tools: Read\nallowed-tools: Write',
        // A key on one line: a hook, a key indented under another, a key that does not start the line
        'tools: Read\nhooks: {PreToolUse: [{matcher: Bash}]}',
        'tools: Read\n  model: sonnet',
        '  tools: Read',
        // A repeated key (YAML parsers keep the first, the last or neither) and a model that is no plain name
        'tools: Write\ntools: Read',
        'tools: Read\nmodel: sonnet\nmodel: opus',
        'tools: Read\nmodel: {a: b}'
    ])
        assert.ok(agentProblem(agent(rest)), rest)
})

test('kb may write files, but gets the same keys and no other server, wildcard or notebook', () => {
    const kb = rest =>
        `name: kb\ndescription: Builds the knowledge base. Use it after every change to a screen.\n${rest}`
    assert.equal(agentProblem(kb('tools: Read, Grep, Glob, Edit, Write, Bash, mcp__playwright'), WRITER_TOOLS), null)
    for (const rest of [
        'tools: Read, Write\nhooks:\n  Stop: x',
        'tools: Read, Write\nmcpServers: github',
        'tools: Read, Write\nhooks: {PreToolUse: [{matcher: Bash}]}',
        'tools: Read, Write\npermissionMode: bypassPermissions',
        'tools: Read, Write, mcp__github',
        'tools: *',
        'tools: Read, NotebookEdit',
        'tools: Read, Write\ntools: Read',
        'tools: Read\u0085mcpServers: github',
        'tools: Read\rmcpServers: github'
    ])
        assert.ok(agentProblem(kb(rest), WRITER_TOOLS), rest)
})

test('the checking agents have only reading tools and keys (only kb has write tools, for the knowledge base)', async () => {
    for (const { kind, name, file } of await all()) {
        if (kind !== 'agent') continue
        const { keys, frontMatter } = await read(file)
        assert.ok(keys.tools, `${file}: the tools are listed`)
        // kb writes the knowledge base: the same keys, its tools may also write files (never other servers or wildcards)
        const tools = WRITERS.includes(name) ? WRITER_TOOLS : CHECK_TOOLS
        assert.equal(agentProblem(frontMatter, tools), null, file)
    }
})

test('a line break other than \\n is refused also where nothing else would look (name, description)', () => {
    for (const tools of [CHECK_TOOLS, WRITER_TOOLS])
        for (const breakChar of ['\u0085', '\r', '\u2028', '\u2029']) {
            const frontMatter = `name: kb\ndescription: x${breakChar}mcpServers: github\ntools: Read`
            assert.ok(agentProblem(frontMatter, tools), JSON.stringify(breakChar))
            assert.ok(
                agentProblem(`name: kb${breakChar}hooks: {Stop: x}\ndescription: x\ntools: Read`, tools),
                JSON.stringify(breakChar)
            )
        }
})

test('only kb has write tools: every other agent with Edit or Write is a finding', async () => {
    assert.deepEqual(WRITERS, ['kb'])
    // The keys an agent may have: a new one (hooks, mcpServers, permissionMode, disallowedTools) is a decision, not a fix
    assert.deepEqual(CHECK_KEYS, ['name', 'description', 'tools', 'model'])
    assert.deepEqual(MODELS, ['sonnet', 'opus', 'haiku', 'inherit'])
    assert.deepEqual(WRITER_TOOLS, [...CHECK_TOOLS, 'Edit', 'Write'])
    const writing = []
    for (const { kind, name, file } of await all()) {
        if (kind !== 'agent') continue
        const { keys } = await read(file)
        if (/\b(Edit|Write|MultiEdit|NotebookEdit)\b/.test(keys.tools)) writing.push(name)
    }
    assert.deepEqual([...new Set(writing)], ['kb'])
})
