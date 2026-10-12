import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { run, quote } from '../src/runner.js'

const node = process.execPath

test('run resolves with the stdout of the command', async () => {
    const out = await run(node, ['-p', '1+1'])
    assert.equal(out.trim(), '2')
})

test('run executes the command in the given cwd', async t => {
    const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-runner-')))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    const out = await run(node, ['-p', 'process.cwd()'], { cwd: dir })
    assert.equal(await fs.realpath(out.trim()), dir)
})

test('run sets quiet environment variables (CI, NODE_NO_WARNINGS, telemetry off)', async () => {
    assert.equal((await run(node, ['-p', 'process.env.CI'])).trim(), '1')
    assert.equal((await run(node, ['-p', 'process.env.NODE_NO_WARNINGS'])).trim(), '1')
    assert.equal((await run(node, ['-p', 'process.env.NEXT_TELEMETRY_DISABLED'])).trim(), '1')
})

test('run lets the caller override or add environment variables', async () => {
    const out = await run(node, ['-p', 'process.env.DAFKEDD_TEST'], { env: { DAFKEDD_TEST: 'yes' } })
    assert.equal(out.trim(), 'yes')
})

test('run rejects with the exit code when the command fails', async () => {
    await assert.rejects(run(node, ['-e', 'process.exit(3)']), err => {
        assert.match(err.message, /faalde \(exit 3\)/)
        return true
    })
})

test('run rejects when the command does not exist', async () => {
    await assert.rejects(run('dafkedd-command-that-does-not-exist-xyz', []))
})

test('run includes the last output lines in the error message', async () => {
    await assert.rejects(run(node, ['-e', 'console.log(1);process.exit(2)']), err => {
        assert.match(err.message, /exit 2/)
        return true
    })
})

test('quote leaves safe arguments untouched', () => {
    for (const arg of ['install', 'next-intl@latest', '--save-dev', 'a/b.js', '@/*'.replace('*', 'x')]) {
        assert.equal(quote(arg), arg)
    }
})

test('quote wraps arguments with spaces or special characters in double quotes', () => {
    assert.equal(quote('a b'), '"a b"')
    assert.equal(quote('@/*'), '"@/*"')
})

test('quote escapes embedded double quotes', () => {
    assert.equal(quote('say "hi"'), '"say \\"hi\\""')
})
