import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describeProject, projectClaudeFiles } from '../src/claude.js'
import {
    buildManifest,
    inferProject,
    managedFiles,
    MANIFEST,
    manifestProject,
    manifestSteps,
    parseEnvFile,
    projectName,
    readManifest,
    sha
} from '../src/manifest.js'
import { NEW_SUFFIX, planUpdate, update } from '../src/update.js'

const project = {
    ...describeProject({
        name: 'planner',
        frontend: { id: 'nextjs' },
        backend: { id: 'linked' },
        answers: {
            database: { database: 'planner' },
            appOptions: { mail: true },
            link: {
                issuer: 'https://login.example.com/oidc',
                accountUrl: 'https://login.example.com',
                clientId: 'planner',
                clientSecret: 'secret-of-the-app',
                product: 'planner',
                apiUrl: 'https://api.login.example.com'
            }
        }
    }),
    claude: true,
    cloud: true
}

async function tempDir(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-update-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    return dir
}

async function writeAll(dir, files) {
    for (const [rel, content] of Object.entries(files)) {
        await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
        await fs.writeFile(path.join(dir, rel), content)
    }
}

const silent = () => {}

test('the manifest keeps what the project is made of, without secrets', () => {
    const kept = manifestProject(project)
    assert.deepEqual(kept.link, {
        issuer: 'https://login.example.com/oidc',
        accountUrl: 'https://login.example.com',
        clientId: 'planner',
        product: 'planner'
    })
    assert.ok(!JSON.stringify(kept).includes('secret'))
    assert.equal(kept.claude, true)
    assert.equal(kept.cloud, true)
    // The manifest describes the project well enough to make the same files again
    // Every file the same: the licence of the app (OIDC_PRODUCT) too
    assert.deepEqual(managedFiles(kept), managedFiles(project))
    assert.match(managedFiles(kept)['infra/terraform/main.tf'], /OIDC_PRODUCT += "planner"/)
})

test('the manifest step hashes the managed files as they are on disk', async t => {
    const dir = await tempDir(t)
    await writeAll(dir, projectClaudeFiles(project))
    await manifestSteps({ projectDir: dir, project, version: '1.0.0' })[0].run()
    const manifest = readManifest(dir)
    assert.equal(manifest.version, '1.0.0')
    assert.equal(manifest.files['CLAUDE.md'], sha(projectClaudeFiles(project)['CLAUDE.md']))
    // Only what exists: the Terraform files were not written here
    assert.ok(!manifest.files['infra/terraform/main.tf'])
    assert.equal(readManifest(path.join(dir, 'nothing-here')), null)
})

test('planUpdate: new, same, updated by the CLI, changed by you, no longer needed', () => {
    const wanted = { a: 'A2', b: 'B', c: 'C2', d: 'D2' }
    const plan = planUpdate({
        disk: { b: sha('B'), c: sha('C1'), d: sha('mine'), old: sha('x') },
        remembered: { b: sha('B'), c: sha('C1'), d: sha('D1'), old: sha('x') },
        wanted
    })
    assert.deepEqual(plan, [
        { rel: 'a', action: 'new' },
        { rel: 'b', action: 'same' },
        { rel: 'c', action: 'updated' },
        { rel: 'd', action: 'changed' },
        { rel: 'old', action: 'removed' }
    ])
    // Without a manifest, every file that differs is yours
    assert.deepEqual(planUpdate({ disk: { c: sha('C1') }, wanted: { c: 'C2' } }), [{ rel: 'c', action: 'changed' }])
})

test('update replaces what the CLI wrote, never what you changed, and remembers the new version', async t => {
    const dir = await tempDir(t)
    const files = managedFiles(project)
    await writeAll(dir, files)
    await fs.writeFile(path.join(dir, 'frontend', 'package.json'), '{}')
    // An older CLI: its manifest remembers an older reviewer and CLAUDE.md
    const manifest = await buildManifest({ projectDir: dir, project, version: '0.45.0' })
    await fs.writeFile(path.join(dir, '.claude/agents/reviewer.md'), 'old reviewer')
    manifest.files['.claude/agents/reviewer.md'] = sha('old reviewer')
    // ... and you changed CLAUDE.md yourself, and a pipeline is missing
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), 'my own rules')
    await fs.rm(path.join(dir, '.github/workflows/release.yml'))
    // ... and codeql.yml is new in this version (the old manifest does not know it)
    await fs.rm(path.join(dir, '.github/workflows/codeql.yml'))
    delete manifest.files['.github/workflows/codeql.yml']
    // Windows: a checkout with CRLF is still the same file
    const hook = path.join(dir, '.claude/hooks/guard-git.mjs')
    await fs.writeFile(hook, (await fs.readFile(hook, 'utf8')).replace(/\n/g, '\r\n'))
    await fs.writeFile(path.join(dir, MANIFEST), JSON.stringify(manifest))

    const plan = await update({ projectDir: dir, version: '0.46.0', log: silent })
    const action = rel => plan.find(entry => entry.rel === rel).action
    assert.equal(action('.claude/agents/reviewer.md'), 'updated')
    assert.equal(action('CLAUDE.md'), 'changed')
    // Deleted by you: it does not come back; new in this version: written
    assert.equal(action('.github/workflows/release.yml'), 'deleted')
    assert.equal(action('.github/workflows/codeql.yml'), 'new')
    assert.equal(action('.claude/hooks/guard-git.mjs'), 'same')
    assert.equal(
        await fs.readFile(path.join(dir, '.claude/agents/reviewer.md'), 'utf8'),
        files['.claude/agents/reviewer.md']
    )
    assert.equal(await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8'), 'my own rules')
    assert.equal(await fs.readFile(path.join(dir, 'CLAUDE.md' + NEW_SUFFIX), 'utf8'), files['CLAUDE.md'])
    await assert.rejects(fs.stat(path.join(dir, '.github/workflows/release.yml')))
    assert.equal(
        await fs.readFile(path.join(dir, '.github/workflows/codeql.yml'), 'utf8'),
        files['.github/workflows/codeql.yml']
    )
    const next = readManifest(dir)
    assert.equal(next.version, '0.46.0')
    // CLAUDE.md: the hash of the new version, so the next update replaces it only when you took it over
    assert.equal(next.files['CLAUDE.md'], sha(files['CLAUDE.md']))
    assert.match(await fs.readFile(path.join(dir, '.gitignore'), 'utf8'), /\*\.dafkedd-new/)
    // The knowledge base pages that were missing
    assert.ok(await fs.stat(path.join(dir, 'docs/kb/pages.json')))

    // Again: nothing changes but CLAUDE.md stays yours
    const again = await update({ projectDir: dir, version: '0.46.0', log: silent })
    assert.deepEqual(
        again.filter(entry => entry.action !== 'same'),
        [
            { rel: '.github/workflows/release.yml', action: 'deleted' },
            { rel: 'CLAUDE.md', action: 'changed' }
        ]
    )
})

test('update without a manifest reads the project from its folders and asks first', async t => {
    const dir = path.join(await tempDir(t), 'planner')
    await writeAll(dir, {
        'frontend/package.json': '{}',
        'frontend/.env.local': 'OIDC_ACCOUNT_URL=https://login.example.com\n',
        'backend/package.json': '{}',
        'backend/.env':
            "DATABASE_NAME=planner\nTENANT_ISOLATION=database\nOIDC_ISSUER=https://login.example.com/oidc\nOIDC_CLIENT_IDS=planner\nDATABASE_PASSWORD='x y'\n",
        'backend/src/files/files.module.ts': '',
        'CLAUDE.md': 'mine'
    })
    const inferred = inferProject(dir)
    assert.equal(inferred.kind, 'app')
    assert.equal(inferred.database, 'planner')
    assert.deepEqual(inferred.modules, { mail: false, files: true, isolation: 'database' })
    assert.deepEqual(inferred.link, {
        issuer: 'https://login.example.com/oidc',
        accountUrl: 'https://login.example.com',
        clientId: 'planner',
        product: null
    })
    assert.equal(inferred.claude, true)
    assert.equal(inferred.cloud, false)

    let asked = 0
    const no = { confirm: async () => (asked++, false) }
    assert.equal(await update({ projectDir: dir, version: '0.46.0', prompts: no, log: silent }), null)
    assert.equal(asked, 1)
    assert.equal(readManifest(dir), null)

    const yes = { confirm: async () => true }
    const plan = await update({ projectDir: dir, version: '0.46.0', prompts: yes, log: silent })
    assert.equal(plan.find(entry => entry.rel === 'CLAUDE.md').action, 'changed')
    assert.equal(readManifest(dir).project.kind, 'app')
})

test('inferProject knows the kinds by their settings; update refuses a folder without a project', async t => {
    const dir = await tempDir(t)
    const kind = async env => {
        await writeAll(dir, { 'backend/package.json': '{}', 'backend/.env': env })
        return inferProject(dir).kind
    }
    assert.equal(await kind('OIDC_MASTER_KEY=abc\n'), 'pasport')
    assert.equal(await kind("JWT_SECRET='x'\n"), 'login')
    assert.equal(await kind('PORT=3001\n'), 'api')
    const empty = await tempDir(t)
    await assert.rejects(update({ projectDir: empty, version: '1', log: silent }), /Geen project/)
    assert.deepEqual(parseEnvFile("A='a # b'\nB=c   # comment\n# C=d\n"), { A: 'a # b', B: 'c' })
})

test('the name of a project comes from CLAUDE.md or Terraform, not only from its folder', async t => {
    const dir = path.join(await tempDir(t), 'a-clone')
    await writeAll(dir, { 'infra/terraform/versions.tf': 'backend "gcs" {\n    prefix = "planner"\n  }\n' })
    assert.equal(projectName(dir), 'planner')
    await writeAll(dir, { 'CLAUDE.md': '# my-planner\n\nThis project ...' })
    assert.equal(projectName(dir), 'my-planner')
    assert.equal(projectName(path.join(dir, 'nothing')), 'nothing')
    await writeAll(dir, {
        'backend/package.json': '{}',
        'backend/.env': 'OIDC_ISSUER=https://login.example.com/oidc\nOIDC_CLIENT_IDS=planner\nOIDC_PRODUCT=planner\n'
    })
    assert.equal(inferProject(dir).link.product, 'planner')
    assert.equal(inferProject(dir).name, 'my-planner')
})
