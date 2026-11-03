import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = rel => readFileSync(rel, 'utf8')
const json = rel => JSON.parse(read(rel))

test('the CLI is MIT licensed: LICENSE, package.json, the lock file and the README agree (#62)', () => {
    assert.match(read('LICENSE'), /^MIT License\n\nCopyright \(c\) \d{4} DafkeDD\n/)
    assert.match(read('LICENSE'), /THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND/)
    assert.equal(json('package.json').license, 'MIT')
    assert.equal(json('package-lock.json').packages[''].license, 'MIT')
    assert.match(read('README.md'), /^## Licence\n\nMIT, see \[`LICENSE`\]\(LICENSE\)\./m)
})

test('our own mods are MIT too; replay-theater keeps the Apache 2.0 of Anthropic', () => {
    for (const base of ['mods', 'templates/project-claude/mods']) {
        for (const name of ['checks-desk', 'handoff-offer', 'screen-share', 'mods'])
            assert.equal(json(`${base}/${name}/.claude-plugin/plugin.json`).license, 'MIT', `${base}/${name}`)
        assert.equal(json(`${base}/replay-theater/.claude-plugin/plugin.json`).license, undefined)
        assert.match(read(`${base}/replay-theater/LICENSE`), /Apache License\s+Version 2\.0/)
    }
})
