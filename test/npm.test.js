import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ALLOW_SCRIPTS, denyInstallScripts } from '../src/npm.js'

test('npm 12+: the install scripts are denied in package.json (no warnings), choices already made stay', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-npm-'))
    await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'x', scripts: { dev: 'next dev' }, allowScripts: { sharp: true } })
    )
    await denyInstallScripts(root)
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
    assert.deepEqual(pkg.scripts, { dev: 'next dev' })
    assert.equal(pkg.allowScripts.koffi, false)
    assert.equal(pkg.allowScripts['@scarf/scarf'], false)
    assert.equal(pkg.allowScripts.sharp, true)
    for (const name of Object.keys(ALLOW_SCRIPTS)) assert.ok(name in pkg.allowScripts, name)
})

test('the frontend and the backend deny the install scripts before their first npm install', async () => {
    for (const file of ['../src/frontends/nextjs.js', '../src/backends/nestjs.js']) {
        const source = await fs.readFile(new URL(file, import.meta.url), 'utf8')
        assert.match(
            source,
            /await denyInstallScripts\(root\)\s+await exec\('npm', \['install'\], \{ cwd: root \}\)/,
            file
        )
    }
})
