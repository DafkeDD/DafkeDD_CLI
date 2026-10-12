import test from 'node:test'
import assert from 'node:assert/strict'
import { runSteps } from '../src/progress.js'

test('runSteps runs every step in order', async () => {
    const order = []
    await runSteps([
        { title: 'one', run: async () => order.push('one') },
        { title: 'two', weight: 3, run: async () => order.push('two') },
        { title: 'three', weight: 2, run: async () => order.push('three') }
    ])
    assert.deepEqual(order, ['one', 'two', 'three'])
})

test('runSteps waits for slow steps before starting the next one', async () => {
    const order = []
    await runSteps([
        {
            title: 'slow',
            run: async () => {
                await new Promise(resolve => setTimeout(resolve, 50))
                order.push('slow')
            }
        },
        { title: 'fast', run: async () => order.push('fast') }
    ])
    assert.deepEqual(order, ['slow', 'fast'])
})

test('runSteps stops at the first failing step, rethrows the error and reports the step title', async t => {
    const errors = t.mock.method(console, 'error', () => {})
    const order = []
    const boom = new Error('boom')
    await assert.rejects(
        runSteps([
            { title: 'ok', run: async () => order.push('ok') },
            {
                title: 'broken',
                run: async () => {
                    throw boom
                }
            },
            { title: 'never', run: async () => order.push('never') }
        ]),
        err => err === boom
    )
    assert.deepEqual(order, ['ok'])
    assert.ok(errors.mock.calls.some(call => String(call.arguments.join(' ')).includes('broken')))
})

test('runSteps handles an empty list of steps', async () => {
    await runSteps([])
})
