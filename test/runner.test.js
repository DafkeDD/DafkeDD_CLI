import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { masked, quote, run, secretsOf } from '../src/runner.js'

const node = process.execPath

test('run resolves with the stdout of the command', async () => {
    const out = await run(node, ['-p', '1+1'])
    assert.equal(out.trim(), '2')
})

test('run gives output without colour codes, also when the caller forces colours (npm 12 scripts)', async () => {
    const before = process.env.FORCE_COLOR
    process.env.FORCE_COLOR = '1'
    try {
        assert.equal((await run(node, ['-p', '1+1'])).trim(), '2')
    } finally {
        if (before === undefined) delete process.env.FORCE_COLOR
        else process.env.FORCE_COLOR = before
    }
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

test('a failing command never shows a password in its error, neither from its arguments nor from its output', async () => {
    // The command prints its arguments, as npm does in the banner of a script (> node demo-data.mjs --password ...)
    const echo = "console.log(process.argv.slice(1).join(' ')); process.exit(1)"
    for (const args of [
        ['--password', 'S3cret-pw-1'],
        ['--password=S3cret-pw-1'],
        ['--name', 'Support', '--password', 'S3cret-pw-1', '--email', 'a@example.com']
    ])
        await assert.rejects(run(node, ['-e', echo, '--', ...args]), err => {
            assert.ok(!err.message.includes('S3cret-pw-1'), err.message)
            assert.match(err.message, /--password[ =]\*\*\*/)
            // The rest of the command stays readable
            assert.match(err.message, /faalde \(exit 1\)/)
            return true
        })
    // A command that works still gets its own output, untouched
    assert.equal((await run(node, ['-e', "console.log('pw-out')", '--', '--password', 'pw-out'])).trim(), 'pw-out')
})

test('two passwords where one is part of the other: nothing of the longer one shows', () => {
    const secrets = secretsOf(['--password', 'abc', '--password=abcdef'])
    assert.equal(masked('abcdef abc', secrets), '*** ***')
    assert.equal(masked('abc abcdef', secretsOf(['--password=abcdef', '--password', 'abc'])), '*** ***')
    // No secret for an empty value or a trailing --password
    assert.deepEqual(secretsOf(['--password', '', '--password=', '--password']), [])
})

test('a command that cannot start never shows the password either (spawnargs of the error)', async () => {
    await assert.rejects(run('dafkedd-command-that-does-not-exist-xyz', ['--password', 'S3cret-pw-2']), err => {
        assert.ok(!JSON.stringify(err, Object.getOwnPropertyNames(err)).includes('S3cret-pw-2'))
        assert.ok(!String(err.stack).includes('S3cret-pw-2'))
        assert.ok(!(err.spawnargs ?? []).includes('S3cret-pw-2'))
        return true
    })
})
