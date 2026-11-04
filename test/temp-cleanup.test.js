// The tests of the CLI leave no temp folder behind (#72): a session or a CI runner would fill its disk with them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The tests that make temp folders of their own
const FILES = ['test/npm.test.js', 'test/eid.test.js', 'test/central-docs.test.js', 'test/proxy-matcher.test.js']

test('the tests that make temp folders remove them again', t => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'cleanup-check-'))
    t.after(() => rmSync(tmp, { recursive: true, force: true }))
    // A test runner inside a test runner only reports to it (NODE_TEST_CONTEXT): this one runs on its own
    const { NODE_TEST_CONTEXT, ...env } = process.env
    // TAP on every Node: without a terminal Node 22 reports TAP (# pass 4), Node 24 and later spec (ℹ pass 4)
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...FILES], {
        env: { ...env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
        encoding: 'utf8',
        timeout: 120000
    })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    // It really ran the tests
    assert.match(result.stdout, /# pass [1-9]/)
    const left = readdirSync(tmp).filter(name => /^dafkedd-|^docs-/.test(name))
    assert.deepEqual(left, [])
})
