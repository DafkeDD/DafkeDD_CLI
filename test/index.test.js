import test from 'node:test'
import assert from 'node:assert/strict'
import { main, version } from '../src/index.js'

function setup({ repo = null } = {}) {
    const events = []
    const frontend = {
        id: 'demo',
        label: 'Demo',
        description: 'demo frontend',
        dir: 'frontend',
        next: ['cd frontend', 'npm run dev'],
        ask: async () => {
            events.push('frontend.ask')
            return { ui: 'all' }
        },
        steps: async ({ answers }) => {
            events.push(`frontend.steps(${answers.ui})`)
            return [{ title: 'frontend step', run: async () => {} }]
        }
    }
    const logs = []
    const options = {
        projectDir: '/tmp/project',
        prompts: {
            select: async config => {
                events.push('select')
                assert.deepEqual(
                    config.choices.map(c => c.value),
                    ['demo']
                )
                return 'demo'
            }
        },
        ask: async () => {
            events.push('askRepo')
            return repo
        },
        registry: { demo: frontend },
        execute: async steps => {
            events.push(`execute(${steps.map(s => s.title).join(',')})`)
        },
        log: line => logs.push(line)
    }
    return { events, logs, options }
}

test('main prints the version and the project folder', async () => {
    const { logs, options } = setup()
    await main(options)
    assert.ok(logs.some(l => l.includes(`v${version}`)))
    assert.ok(logs.some(l => l.includes('/tmp/project')))
})

test('main asks the frontend question first and the GitHub question last', async () => {
    const { events, options } = setup()
    await main(options)
    assert.deepEqual(events.slice(0, 4), ['select', 'frontend.ask', 'askRepo', 'frontend.steps(all)'])
})

test('main only runs the frontend steps when the user does not want to push', async () => {
    const { events, logs, options } = setup({ repo: null })
    await main(options)
    assert.ok(events.includes('execute(frontend step)'))
    assert.ok(!logs.some(l => l.includes('Gepusht')))
})

test('main appends the git and GitHub steps when the user wants to push', async () => {
    const { events, logs, options } = setup({ repo: { name: 'demo-repo', platform: 'github', visibility: 'private' } })
    await main(options)
    const executed = events.find(e => e.startsWith('execute('))
    assert.match(executed, /^execute\(frontend step,Git initialiseren,Repo "demo-repo"/)
    assert.ok(logs.some(l => l.includes('Gepusht') && l.includes('demo-repo')))
})

test('main prints how to start the frontend afterwards', async () => {
    const { logs, options } = setup()
    await main(options)
    assert.ok(logs.some(l => l.includes('npm run dev')))
    assert.ok(logs.some(l => l.includes('./frontend')))
})

test('main rethrows when a step fails', async () => {
    const { options } = setup()
    options.execute = async () => {
        throw new Error('step failed')
    }
    await assert.rejects(main(options), /step failed/)
})
