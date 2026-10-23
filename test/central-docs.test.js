import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import { spawn } from 'node:child_process'
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
        askClaude: async () => false,
        askCloud: async () => false,
        projectDir: '/tmp/none',
        prompts: { select: async c => (c.message.includes('frontend') ? 'fe' : 'be') },
        ask: async () => null,
        registry: { fe: item('fe', 'frontend.md') },
        backendRegistry: { be: item('be', 'api.md') },
        execute: async steps => titles.push(...steps.map(s => s.title)),
        log: () => {}
    })
    assert.deepEqual(titles, [
        'fe step',
        'be step',
        'Documentatie samenstellen (./docs)',
        'Kennisbank aanmaken (docs/kb, 4 talen)'
    ])
})

test('docs step also writes docs/index.html, a self-contained web page', async () => {
    const dir = await project()
    await docsStep({ projectDir: dir, parts, swagger: 'http://localhost:4000/docs' }).run()
    const html = await fs.readFile(path.join(dir, DOCS_DIR, 'index.html'), 'utf8')
    assert.match(html, /<h1 id="api--backend-docs">|<h1 id="api-/)
    assert.match(html, /<section id="frontend"/)
    assert.match(html, /http:\/\/localhost:4000\/docs/)
    assert.doesNotMatch(html, /<script src=|<link [^>]*href="http/)
})

test('docs can be served: serve.mjs, docs/package.json and a docs script in backend and frontend', async () => {
    const dir = await project()
    await fs.writeFile(path.join(dir, 'backend/package.json'), JSON.stringify({ scripts: { test: 'x' } }, null, 4))
    await fs.writeFile(path.join(dir, 'frontend/package.json'), JSON.stringify({ name: 'fe' }, null, 2))
    await docsStep({ projectDir: dir, parts }).run()
    const backend = await fs.readFile(path.join(dir, 'backend/package.json'), 'utf8')
    assert.equal(JSON.parse(backend).scripts.docs, 'node ../docs/serve.mjs')
    assert.equal(JSON.parse(backend).scripts.test, 'x')
    assert.match(backend, /\n {4}"scripts"/, 'keeps the indentation of the file')
    assert.equal(
        JSON.parse(await fs.readFile(path.join(dir, 'frontend/package.json'), 'utf8')).scripts.docs,
        'node ../docs/serve.mjs'
    )
    assert.equal(
        JSON.parse(await fs.readFile(path.join(dir, DOCS_DIR, 'package.json'), 'utf8')).scripts.docs,
        'node serve.mjs'
    )
})

test('the docs server serves the site and nothing outside ./docs', async () => {
    const dir = await project()
    await fs.writeFile(path.join(dir, 'secret.txt'), 'secret')
    await docsStep({ projectDir: dir, parts }).run()
    const port = 5000 + Math.floor(Math.random() * 1000)
    const server = spawn(process.execPath, [path.join(dir, DOCS_DIR, 'serve.mjs')], {
        env: { ...process.env, DOCS_PORT: String(port) }
    })
    try {
        await new Promise((resolve, reject) => {
            server.stdout.once('data', resolve)
            server.once('error', reject)
        })
        const home = await fetch(`http://127.0.0.1:${port}/`)
        assert.equal(home.status, 200)
        assert.match(home.headers.get('content-type'), /text\/html/)
        assert.match(await home.text(), /<!doctype html>/)
        assert.equal((await fetch(`http://127.0.0.1:${port}/api.md`)).status, 200)
        assert.equal((await fetch(`http://127.0.0.1:${port}/serve.mjs`)).status, 404)
        assert.equal((await fetch(`http://127.0.0.1:${port}/..%2Fsecret.txt`)).status, 404)
    } finally {
        server.kill()
    }
})

test('docs is a project of its own: npm run dev in ./docs, and the CLI summary says so', async () => {
    const dir = await project()
    await docsStep({ projectDir: dir, parts }).run()
    const pkg = JSON.parse(await fs.readFile(path.join(dir, DOCS_DIR, 'package.json'), 'utf8'))
    assert.equal(pkg.scripts.dev, 'node serve.mjs')
    assert.equal(pkg.scripts.start, 'node serve.mjs')

    const logs = []
    const item = (id, docsFile) => ({
        id,
        label: id,
        dir: id,
        docsFile,
        next: [],
        ask: async () => ({}),
        steps: async () => []
    })
    await main({
        askClaude: async () => false,
        askCloud: async () => false,
        projectDir: '/tmp/none',
        prompts: { select: async c => (c.message.includes('frontend') ? 'fe' : 'be') },
        ask: async () => null,
        registry: { fe: item('fe', 'frontend.md') },
        backendRegistry: { be: item('be', 'api.md') },
        execute: async () => {},
        log: line => logs.push(line)
    })
    const output = logs.join('\n')
    assert.match(output, /Documentatie geïnstalleerd in .*\.\/docs/)
    assert.match(output, /cd docs/)
    assert.match(output, /npm run dev/)
    assert.match(output, /http:\/\/localhost:5000/)
})
