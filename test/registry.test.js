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
