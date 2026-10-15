import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const walk = dir =>
    readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory()
            ? walk(join(dir, entry.name))
            : [relative(ROOT, join(dir, entry.name)).replaceAll('\\', '/')]
    )

test('the package ships every template file (also their test folders), but not the tests of the CLI', () => {
    // npx installs from the packed package: .npmignore decides what reaches the user
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const packed = JSON.parse(
        execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
            cwd: ROOT,
            encoding: 'utf8',
            shell: process.platform === 'win32',
            stdio: ['ignore', 'pipe', 'ignore']
        })
    )[0].files.map(file => file.path)
    const shipped = new Set(packed)
    for (const file of walk(join(ROOT, 'templates'))) assert.ok(shipped.has(file), `${file} is not in the package`)
    assert.ok(shipped.has('templates/backend-oidc/test/virtual-authenticator.ts'))
    assert.ok(!packed.some(file => file.startsWith('test/')), 'the tests of the CLI stay out')
})
