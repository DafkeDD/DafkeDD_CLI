import test from 'node:test'
import assert from 'node:assert/strict'
import { frontends } from '../src/frontends/index.js'
import { nextjs } from '../src/frontends/nextjs.js'

test('the registry exposes the Next.js frontend under its id', () => {
    assert.equal(frontends.nextjs, nextjs)
})

test('every registered frontend has the fields the CLI relies on', () => {
    for (const [id, frontend] of Object.entries(frontends)) {
        assert.equal(frontend.id, id)
        assert.equal(typeof frontend.label, 'string')
        assert.equal(typeof frontend.description, 'string')
        assert.equal(typeof frontend.dir, 'string')
        assert.equal(typeof frontend.steps, 'function')
        assert.ok(Array.isArray(frontend.next))
    }
})

test('the backend registry exposes NestJS under its id', async () => {
    const { backends } = await import('../src/backends/index.js')
    const { nestjs } = await import('../src/backends/nestjs.js')
    assert.equal(backends.nestjs, nestjs)
})

test('every registered backend has the fields the CLI relies on', async () => {
    const { backends } = await import('../src/backends/index.js')
    for (const [id, backend] of Object.entries(backends)) {
        assert.equal(backend.id, id)
        assert.equal(typeof backend.label, 'string')
        assert.equal(typeof backend.description, 'string')
        assert.equal(typeof backend.dir, 'string')
        assert.equal(typeof backend.steps, 'function')
        assert.equal(typeof backend.ask, 'function')
        assert.equal(typeof backend.next, 'function', 'next steps depend on the answers')
        assert.equal(typeof backend.summary, 'function')
        assert.equal(typeof backend.api.port, 'number', 'the frontend needs to know where the API runs')
    }
})
