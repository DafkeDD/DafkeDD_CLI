import test from 'node:test'
import assert from 'node:assert/strict'
import { main, version } from '../src/index.js'

/** Builds a fake frontend/backend plus injectable prompts that answer from `choices`. */
function setup({ frontend = 'demo-fe', backend = 'demo-be', repo = null } = {}) {
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
            events.push(`${id}.steps(${JSON.stringify({ answers: ctx.answers, api: ctx.api ?? null })})`)
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
    const order = events.slice(0, 5).map(e => e.replace(/\(.*\)$/, ''))
    assert.deepEqual(order, ['select.frontend', 'demo-fe.ask', 'select.backend', 'demo-be.ask', 'askRepo'])
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
    assert.match(executed, /^execute\(demo-fe step,demo-be step,Git initialiseren,Repo "demo-repo"/)
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
    assert.ok(events.some(e => e.startsWith('demo-fe.steps') && e.includes('"api":{"port":4000,"auth":true}')))
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
    assert.ok(events.includes('execute(demo-be step)'))
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
    assert.ok(events.includes('execute(demo-fe step)'))
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
