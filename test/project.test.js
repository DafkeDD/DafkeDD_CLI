import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const read = rel => fs.readFile(new URL(`../${rel}`, import.meta.url), 'utf8')
const pkg = JSON.parse(await read('package.json'))
const lock = JSON.parse(await read('package-lock.json'))
const readme = await read('README.md')

test('package.json declares the CLI binary and ESM', () => {
    assert.equal(pkg.name, 'dafkedd_cli')
    assert.equal(pkg.type, 'module')
    assert.equal(pkg.bin.DafkeDD_CLI, 'bin/cli.js')
})

test('package-lock.json has the same version as package.json', () => {
    assert.equal(lock.version, pkg.version)
    assert.equal(lock.packages[''].version, pkg.version)
})

test('the README changelog has an entry for the current version', () => {
    assert.ok(readme.includes(`**${pkg.version}**`), `README changelog is missing ${pkg.version}`)
})

test('README and docs are written in English', () => {
    assert.match(readme, /## What does it install\?/)
    assert.match(readme, /## Changelog/)
})

test('tests and format check are wired into npm scripts', () => {
    assert.ok(pkg.scripts.test)
    assert.ok(pkg.scripts['format:check'])
    assert.ok(pkg.scripts.postinstall)
})

test('Prettier is configured in this repository', async () => {
    const rc = JSON.parse(await read('.prettierrc'))
    assert.equal(rc.tabWidth, 4)
    assert.equal(rc.semi, false)
})

test('a pre-push hook runs the tests and the format check', async () => {
    const hook = await read('.githooks/pre-push')
    assert.match(hook, /npm test/)
    assert.match(hook, /format:check/)
})

test('CI runs the tests on pushes and pull requests, and releases wait for green tests', async () => {
    const ci = await read('.github/workflows/ci.yml')
    assert.match(ci, /npm test/)
    assert.match(ci, /pull_request/)
    const release = await read('.github/workflows/release.yml')
    assert.match(release, /needs:\s*test/)
    assert.match(release, /npm test/)
})
