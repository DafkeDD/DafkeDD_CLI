import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
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
    // One command string, no list of arguments: on Windows (npm.cmd through a shell) that list gives Node's DEP0190
    const answer = JSON.parse(
        execSync('npm pack --dry-run --json --ignore-scripts', {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        })
    )
    // npm 11 and older answer a list, npm 12 an object per package name
    const pack = Array.isArray(answer) ? answer[0] : Object.values(answer)[0]
    const packed = pack.files.map(file => file.path)
    const shipped = new Set(packed)
    for (const file of walk(join(ROOT, 'templates'))) assert.ok(shipped.has(file), `${file} is not in the package`)
    assert.ok(shipped.has('templates/backend-oidc/test/virtual-authenticator.ts'))
    assert.ok(!packed.some(file => file.startsWith('test/')), 'the tests of the CLI stay out')
})
