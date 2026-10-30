import test from 'node:test'
import assert from 'node:assert/strict'
import { docsParts, main, version } from '../src/index.js'

/** Builds a fake frontend/backend plus injectable prompts that answer from `choices`. */
function setup({ frontend = 'demo-fe', backend = 'demo-be', repo = null, claude = false } = {}) {
    const events = []
    const make = (id, label, dir) => ({
        id,
        label,
        description: `${label} description`,
        dir,
        next: [`cd ${dir}`, `run ${id}`],
        ask: async ctx => {
            events.push(`${id}.ask(${JSON.stringify({ hasFrontend: ctx?.hasFrontend ?? null })})`)
            return { ui: 'all', auth: true }
        },
        steps: async ctx => {
            events.push(
                `${id}.steps(${JSON.stringify({ answers: ctx.answers, api: ctx.api ?? null, secrets: ctx.secrets ?? null })})`
            )
            return [{ title: `${id} step`, run: async () => {} }]
        }
    })
    const logs = []
    const asked = []
    const options = {
        projectDir: '/tmp/project',
        prompts: {
            select: async config => {
                asked.push(config)
                events.push(config.message.includes('frontend') ? 'select.frontend' : 'select.backend')
                return config.message.includes('frontend') ? frontend : backend
            }
        },
        askClaude: async () => {
            events.push('askClaude')
            return claude
        },
        askCloud: async () => {
            events.push('askCloud')
            return false
        },
        ask: async () => {
            events.push('askRepo')
            return repo
        },
        registry: { 'demo-fe': make('demo-fe', 'DemoFE', 'frontend') },
        backendRegistry: {
            'demo-be': {
                ...make('demo-be', 'DemoBE', 'backend'),
                api: { port: 4000 },
                next: answers => [`cd backend`, `run demo-be ${answers.ui}`],
                summary: () => [
                    { ok: true, text: 'database ok' },
                    { ok: false, text: 'database failed' }
                ]
            }
        },
        execute: async steps => {
            events.push(`execute(${steps.map(s => s.title).join(',')})`)
        },
        log: line => logs.push(line)
    }
    return { events, logs, asked, options }
}

test('main prints the version and the project folder', async () => {
    const { logs, options } = setup()
    await main(options)
    assert.ok(logs.some(l => l.includes(`v${version}`)))
    assert.ok(logs.some(l => l.includes('/tmp/project')))
})

test('main asks frontend, frontend options, backend and the GitHub question last', async () => {
    const { events, options } = setup()
    await main(options)
    const order = events.slice(0, 7).map(e => e.replace(/\(.*\)$/, ''))
    assert.deepEqual(order, [
        'select.frontend',
        'demo-fe.ask',
        'select.backend',
        'demo-be.ask',
        'askClaude',
        'askCloud',
        'askRepo'
    ])
})

test('main offers "no frontend" and "no backend" next to the real choices', async () => {
    const { asked, options } = setup()
    await main(options)
    assert.deepEqual(
        asked[0].choices.map(c => c.value),
        ['demo-fe', 'none']
    )
    assert.deepEqual(
        asked[1].choices.map(c => c.value),
        ['demo-be', 'none']
    )
})

test('main runs frontend steps, then backend steps, then the git steps', async () => {
    const { events, options } = setup({ repo: { name: 'demo-repo', platform: 'github', visibility: 'private' } })
    await main(options)
    const executed = events.find(e => e.startsWith('execute('))
    assert.match(
        executed,
        /^execute\(demo-fe step,demo-be step,Kennisbank aanmaken \(docs\/kb, 4 talen\),Antwoorden bewaren \(\.dafkedd-answers\.json, voor --answers\),Git initialiseren,Repo "demo-repo"/
    )
})

test('main tells the backend whether a frontend was chosen (the login pages need one)', async () => {
    const withFrontend = setup()
    await main(withFrontend.options)
    assert.ok(withFrontend.events.includes('demo-be.ask({"hasFrontend":true})'))
    const without = setup({ frontend: 'none' })
    await main(without.options)
    assert.ok(without.events.includes('demo-be.ask({"hasFrontend":false})'))
})

test('main tells the frontend whether the backend answered yes to the login pages', async () => {
    const { events, options } = setup()
    await main(options)
    const frontend = events.find(e => e.startsWith('demo-fe.steps'))
    assert.match(frontend, /"api":\{"port":4000,"auth":true,"proxySecret":"[0-9a-f]{64}"\}/)
    // The frontend and the backend share one secret (API_PROXY_SECRET), made for this project
    const secret = /"proxySecret":"([0-9a-f]{64})"/.exec(frontend)[1]
    assert.ok(events.find(e => e.startsWith('demo-be.steps')).includes(`"secrets":{"proxy":"${secret}"}`))
})

test('main tells the frontend which API it talks to when a backend is installed', async () => {
    const { events, options } = setup()
    await main(options)
    assert.ok(events.some(e => e.startsWith('demo-fe.steps') && e.includes('"port":4000')))
})

test('main passes no API to the frontend when no backend was chosen', async () => {
    const { events, options } = setup({ backend: 'none' })
    await main(options)
    assert.ok(events.some(e => e.startsWith('demo-fe.steps') && e.includes('"api":null')))
})

test('main works with only a backend', async () => {
    const { events, options } = setup({ frontend: 'none' })
    await main(options)
    assert.ok(!events.some(e => e.startsWith('demo-fe.ask')))
    assert.ok(events.includes('execute(demo-be step,Antwoorden bewaren (.dafkedd-answers.json, voor --answers))'))
})

test('main shows the result lines of the backend (✔ and ✖) and its answer-dependent next steps', async () => {
    const { logs, options } = setup()
    await main(options)
    const text = logs.join('\n')
    assert.ok(text.includes('database ok'))
    assert.ok(text.includes('database failed'))
    assert.ok(text.includes('run demo-be all'))
})

test('main works with only a frontend', async () => {
    const { events, logs, options } = setup({ backend: 'none' })
    await main(options)
    assert.ok(
        events.includes(
            'execute(demo-fe step,Kennisbank aanmaken (docs/kb, 4 talen),Antwoorden bewaren (.dafkedd-answers.json, voor --answers))'
        )
    )
    assert.ok(!events.some(e => e.startsWith('demo-be.ask')))
    assert.ok(!logs.some(l => l.includes('DemoBE')))
})

test('main does nothing when no frontend, no backend and no push were chosen', async () => {
    const { events, logs, options } = setup({ frontend: 'none', backend: 'none' })
    await main(options)
    assert.ok(!events.some(e => e.startsWith('execute(')))
    assert.ok(logs.some(l => l.includes('Niets te installeren')))
})

test('main only pushes when the user wants to', async () => {
    const withoutPush = setup({ repo: null })
    await main(withoutPush.options)
    assert.ok(!withoutPush.logs.some(l => l.includes('Gepusht')))
    const withPush = setup({ repo: { name: 'demo-repo', platform: 'github', visibility: 'private' } })
    await main(withPush.options)
    assert.ok(withPush.logs.some(l => l.includes('Gepusht') && l.includes('demo-repo')))
})

test('main prints what was installed and how to start each part', async () => {
    const { logs, options } = setup()
    await main(options)
    const text = logs.join('\n')
    assert.ok(text.includes('./frontend'))
    assert.ok(text.includes('./backend'))
    assert.ok(text.includes('run demo-fe'))
    assert.ok(text.includes('run demo-be'))
})

test('main rethrows when a step fails', async () => {
    const { options } = setup()
    options.execute = async () => {
        throw new Error('step failed')
    }
    await assert.rejects(main(options), /step failed/)
})

test('main hands over to the linked app when the login question chose the existing Pasport server', async () => {
    const { events, options } = setup({ backend: 'demo-be' })
    const asked = []
    options.backendRegistry['demo-be'].ask = async () => ({ database: { database: 'shop' }, switchTo: 'demo-linked' })
    options.backendRegistry['demo-linked'] = {
        id: 'demo-linked',
        label: 'Linked',
        description: 'x',
        dir: 'backend',
        api: { port: 4001 },
        next: () => [],
        ask: async ctx => {
            asked.push(ctx)
            return { link: { name: 'Shop' }, database: ctx.database }
        },
        steps: async ctx => {
            events.push(`demo-linked.steps(${JSON.stringify(ctx.answers)})`)
            return [{ title: 'linked step', run: async () => {} }]
        }
    }
    await main(options)
    assert.deepEqual(asked[0].database, { database: 'shop' }, 'the database is not asked again')
    assert.ok(events.some(e => e.startsWith('demo-linked.steps') && e.includes('"link":{"name":"Shop"}')))
    assert.ok(!events.some(e => e.startsWith('demo-be.steps')))
})

test('a hidden part (the linked app, reached through the login question) is not a backend choice of its own', async () => {
    const { asked, options } = setup()
    options.backendRegistry['demo-hidden'] = { id: 'demo-hidden', label: 'Hidden', description: 'x', hidden: true }
    await main(options)
    assert.ok(!asked[1].choices.some(choice => choice.value === 'demo-hidden'))
})

test('the real registry offers NestJS, not the linked app as a separate choice', async () => {
    const { backends } = await import('../src/backends/index.js')
    assert.equal(backends.linked.hidden, true)
    assert.ok(!backends.nestjs.hidden)
})

test('the pages in ./docs get an English title: docsTitle, otherwise the label of the choice', async () => {
    const { backends } = await import('../src/backends/index.js')
    const { frontends } = await import('../src/frontends/index.js')
    const parts = docsParts(frontends.nextjs, backends.linked, { id: 'x', label: 'No docs' })
    assert.deepEqual(
        parts.map(part => part.title),
        ['Next.js', 'App linked to a Pasport login server']
    )
    assert.doesNotMatch(parts[1].title, /koppelcode|bestaande/i)
    assert.equal(docsParts({ dir: 'backend', docsFile: 'api.md', label: 'NestJS' })[0].title, 'NestJS')
})
