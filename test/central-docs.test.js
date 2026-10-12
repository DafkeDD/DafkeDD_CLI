import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { docsStep, docsIndex, DOCS_DIR } from '../src/docs.js'
import { nestjs } from '../src/backends/nestjs.js'
import { nextjs } from '../src/frontends/nextjs.js'
import { main } from '../src/index.js'

const parts = [
    { dir: 'frontend', file: 'frontend.md', title: 'Frontend' },
    { dir: 'backend', file: 'api.md', title: 'Backend' }
]

async function project() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-'))
    for (const [d, text] of [
        ['frontend', '# Frontend docs'],
        ['backend', '# Backend docs']
    ]) {
        await fs.mkdir(path.join(dir, d))
        await fs.writeFile(path.join(dir, d, 'README.md'), text)
    }
    return dir
}

test('docs step moves the READMEs into ./docs and leaves pointers behind', async () => {
    const dir = await project()
    await docsStep({ projectDir: dir, parts, swagger: 'http://localhost:4000/docs' }).run()
    assert.equal(await fs.readFile(path.join(dir, DOCS_DIR, 'api.md'), 'utf8'), '# Backend docs')
    assert.equal(await fs.readFile(path.join(dir, DOCS_DIR, 'frontend.md'), 'utf8'), '# Frontend docs')
    const index = await fs.readFile(path.join(dir, DOCS_DIR, 'README.md'), 'utf8')
    assert.match(index, /\(api\.md\)/)
    assert.match(index, /\(frontend\.md\)/)
    assert.match(index, /http:\/\/localhost:4000\/docs/)
    assert.match(await fs.readFile(path.join(dir, 'backend/README.md'), 'utf8'), /\.\.\/docs\/api\.md/)
    assert.match(await fs.readFile(path.join(dir, 'frontend/README.md'), 'utf8'), /\.\.\/docs\/frontend\.md/)
})

test('docs step only documents the parts that were installed', async () => {
    const dir = await project()
    await fs.rm(path.join(dir, 'frontend'), { recursive: true })
    await docsStep({ projectDir: dir, parts }).run()
    const index = await fs.readFile(path.join(dir, DOCS_DIR, 'README.md'), 'utf8')
    assert.match(index, /\(api\.md\)/)
    assert.doesNotMatch(index, /frontend\.md/)
    assert.doesNotMatch(index, /Swagger/)
})

test('docs step writes nothing when no README exists', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-'))
    await docsStep({ projectDir: dir, parts }).run()
    await assert.rejects(fs.stat(path.join(dir, DOCS_DIR)))
})

test('index lists the given parts', () => {
    assert.match(docsIndex([{ file: 'api.md' }]), /\| \[API\]\(api\.md\)/)
})

test('the NestJS backend and the Next.js frontend document into ./docs', () => {
    assert.equal(nestjs.docsFile, 'api.md')
    assert.equal(nextjs.docsFile, 'frontend.md')
})

test('main adds the docs step last before the repo steps, only when parts document themselves', async () => {
    const titles = []
    const item = (id, docsFile) => ({
        id,
        label: id,
        dir: id,
        docsFile,
        api: { port: 4000 },
        ask: async () => ({}),
        steps: async () => [{ title: `${id} step`, run: async () => {} }]
    })
    await main({
        projectDir: '/tmp/none',
        prompts: { select: async c => (c.message.includes('frontend') ? 'fe' : 'be') },
        ask: async () => null,
        registry: { fe: item('fe', 'frontend.md') },
        backendRegistry: { be: item('be', 'api.md') },
        execute: async steps => titles.push(...steps.map(s => s.title)),
        log: () => {}
    })
    assert.deepEqual(titles, ['fe step', 'be step', 'Documentatie samenstellen (./docs)'])
})
