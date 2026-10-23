import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildFiles, nestjs } from '../src/backends/nestjs.js'
import * as oidc from '../src/backends/oidc.js'
import { endpoints } from '../src/backends/docs.js'
import { ALLOW_REMOTE_NPMRC, allowEidDownload, EID_MOCK_SCRIPT, EID_PACKAGE, EID_VERSION } from '../src/eid.js'
import { nextjs } from '../src/frontends/nextjs.js'
import { OIDC_MESSAGES, oidcFrontendFiles } from '../src/frontends/oidc.js'
import { frontendReadme } from '../src/frontends/docs.js'

const DB = {
    id: 'postgres',
    mode: 'docker',
    host: 'localhost',
    port: 5432,
    user: 'app',
    password: 'x',
    database: 'shop',
    project: 'shop'
}
const ANSWERS = {
    adminEmail: 'admin@example.com',
    adminPassword: 'TempPassword123',
    adminPasswordHash: 'scrypt$32768$aa$bb',
    masterKey: 'cd'.repeat(32),
    loginUi: true
}
const backend = buildFiles(DB, { oidc: ANSWERS })
const frontend = oidcFrontendFiles({ apiPort: 4000 })

// ---------------------------------------------------------------- the library

test('DafkeDD eID is installed from its release on GitHub, in the backend and the frontend', () => {
    assert.match(EID_VERSION, /^\d+\.\d+\.\d+$/)
    assert.equal(
        EID_PACKAGE,
        `@dafkedd/eid@https://github.com/DafkeDD/DafkeDD_EID/releases/download/v${EID_VERSION}/dafkedd-eid-${EID_VERSION}.tgz`
    )
    assert.ok(oidc.PACKAGES.dependencies.includes(EID_PACKAGE))
    assert.equal(EID_MOCK_SCRIPT, 'dafke-eid --mock --auth-origin http://localhost:3000')
})

// ---------------------------------------------------------------- backend

test('the backend checks eID tokens with @dafkedd/eid/server and stores only an HMAC of the national number', () => {
    const service = backend['src/oidc/eid.service.ts']
    assert.match(service, /from '@dafkedd\/eid\/server'/)
    assert.match(service, /verifyEidToken\(/)
    assert.match(service, /createHmac\('sha256', deriveKey\(this\.config\.masterKey\(\), 'oidc identifier v1'\)\)/)
    // OCSP on with real cards; the test PKI only with OIDC_EID=test, never in production
    assert.match(service, /revocation: this\.config\.eid === 'test' \? false : \{ timeoutMs: 5000 \}/)
    assert.match(service, /OIDC_EID=test also trusts test cards: never use it in production/)
    assert.match(service, /await import\('@dafkedd\/eid\/mock'\)/)
    const migrations = backend['src/database/migrations.ts']
    assert.match(migrations, /id: 2,\s+name: 'login with the Belgian eID'/)
    assert.match(migrations, /CREATE TABLE user_identifiers/)
    assert.match(migrations, /PRIMARY KEY \(type, value_hash\),\s+UNIQUE \(user_id, type\)/)
    assert.match(migrations, /ALTER COLUMN password_hash DROP NOT NULL/)
    // The tenant role never gets the identifiers
    assert.doesNotMatch(migrations, /GRANT[^;]*user_identifiers/)
})

test('an eID login is the first factor only: the authenticator app always follows (no loa4)', () => {
    const config = backend['src/oidc/oidc.config.ts']
    assert.doesNotMatch(config, /ACR_EID|loa4/)
    assert.match(config, /EID_AMR: \['sc', 'pin'\]/)
    const service = backend['src/oidc/oidc.service.ts']
    assert.match(service, /return this\.secondStep\(id, interaction, client, user, \[\.\.\.OIDC\.EID_AMR\]\)/)
    assert.match(service, /return !this\.config\.mfaRequired \|\| acr === OIDC\.ACR_MFA$/m)
    // Every account has a password, also one made with the eID
    assert.match(backend['src/oidc/account.service.ts'], /passwordHash: await hashPassword\(input\.password\)/)
    // The nonce of a login lives in its encrypted cookie and works once
    assert.match(service, /const interaction = \{ \.\.\.found\.interaction, eidNonce: null \}/)
    assert.match(backend['src/oidc/interaction.ts'], /eidNonce: string \| null/)
})

test('the eID endpoints are documented and translated in four languages', () => {
    const documented = endpoints({ database: DB, oidc: true }).map(e => `${e.method} ${e.path}`)
    for (const route of [
        'POST /oidc/interaction/:id/eid/challenge',
        'POST /oidc/interaction/:id/eid',
        'GET /oidc/account/registration',
        'POST /oidc/account/eid/challenge',
        'POST /oidc/account/register-eid',
        'GET /me/eid',
        'POST /me/eid/challenge',
        'POST /me/eid',
        'DELETE /me/eid'
    ])
        assert.ok(documented.includes(route), route)
    for (const locale of ['en', 'nl', 'fr', 'de'])
        for (const key of [
            'EID_INVALID',
            'EID_EXPIRED',
            'EID_NOT_LINKED',
            'EID_UNAVAILABLE',
            'EID_ALREADY_LINKED',
            'EID_ONLY_LOGIN'
        ])
            assert.ok(oidc.MESSAGES[locale][key]?.trim(), `${locale} ${key}`)
    const readme = backend['README.md']
    assert.match(readme, /### Belgian eID \(card reader and PIN\)/)
    assert.match(readme, /\| `OIDC_EID` \| `test` \|/)
    assert.match(readme, /\| `user_identifiers` \|/)
})

test('.env turns the eID on in test mode for development; .env.example shows on', () => {
    assert.match(backend['.env'], /^OIDC_EID=test$/m)
    assert.match(backend['.env.example'], /^OIDC_EID=on$/m)
    assert.match(
        backend['.env'],
        /# open: anyone can create an account \(with a new organisation, password or eID\); eid: only with the eID;/
    )
})

test('the backend tests cover the eID with the virtual card of the library', () => {
    const e2e = backend['test/eid.e2e-spec.ts']
    assert.match(e2e, /import \{ MockEidClient, SAMPLE_IDENTITY, SAMPLE_PIN \} from '@dafkedd\/eid\/mock'/)
    assert.match(e2e, /process\.env\.OIDC_EID = 'test'/)
    assert.ok(backend['src/oidc/eid.service.spec.ts'])
    assert.match(backend['test/tenant-isolation.db-spec.ts'], /links one eID per account and one account per eID/)
})

test('the summary and the next steps mention the eID and its virtual card reader', () => {
    const answers = { database: DB, auth: false, oidc: ANSWERS }
    assert.match(
        nestjs
            .summary(answers)
            .map(line => line.text)
            .join('\n'),
        /Belgische eID/
    )
    assert.match(nestjs.next(answers).join('\n'), /npm run eid:mock in \.\/frontend/)
})

// ---------------------------------------------------------------- frontend

test('the frontend contacts the eID program only after a click, and never reads the card', () => {
    const eid = frontend['src/components/eid.tsx']
    assert.match(eid, /from '@dafkedd\/eid\/react'/)
    assert.match(eid, /<EidProvider autoRead=\{false\} photo=\{false\}>/)
    assert.match(eid, /https:\/\/github\.com\/DafkeDD\/DafkeDD_EID\/releases\/latest/)
    // The PIN is cleared after every attempt
    assert.match(eid, /if \(field instanceof HTMLInputElement\) field\.value = ''/)
    const login = frontend['src/components/oidc-login.tsx']
    assert.match(login, /call\('\/eid\/challenge', \{ csrf: state\.csrf \}\)/)
    assert.match(login, /call\('\/eid', \{ csrf: state\.csrf, token \}\)/)
    assert.match(login, /state\.step === 'eid'/)
    assert.match(frontend['src/components/account-forms.tsx'], /api\('register-eid', \{/)
    assert.match(frontend['src/components/security.tsx'], /export function EidSecurity\(\)/)
    const route = frontend['src/app/api/backend/[...path]/route.ts']
    const allowed = new RegExp(/const ALLOWED =\s+\/(.+)\/$/m.exec(route)[1])
    for (const p of ['me/eid', 'me/eid/challenge']) assert.ok(allowed.test(p), p)
})

test('every eID text exists in all four languages', () => {
    const keys = Object.keys(OIDC_MESSAGES.en).filter(key => key.startsWith('eid'))
    assert.ok(keys.length >= 25)
    for (const locale of ['nl', 'fr', 'de'])
        for (const key of keys) assert.ok(OIDC_MESSAGES[locale][key]?.trim(), `${locale} ${key}`)
})

test('the frontend README explains the eID and npm run eid:mock', () => {
    const readme = frontendReadme({ ui: 'none', api: { port: 4000, oidc: true }, apiPort: 4000 })
    assert.match(readme, /npm run eid:mock # virtual eID card reader/)
    assert.match(readme, /\*\*Belgian eID\*\*/)
    assert.doesNotMatch(frontendReadme({ ui: 'none', api: { port: 4000 }, apiPort: 4000 }), /eid:mock/)
})

test('steps with the OIDC server install DafkeDD eID and add npm run eid:mock', async t => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-eid-'))
    t.after(() => fs.rm(projectDir, { recursive: true, force: true }))
    const calls = []
    const exec = async (cmd, args, { cwd } = {}) => {
        calls.push({ line: [cmd, ...args].join(' '), cwd })
        if (cmd === 'npx' && args.includes('create-next-app@latest')) {
            const dir = path.join(cwd, 'frontend')
            await fs.mkdir(path.join(dir, 'src/app'), { recursive: true })
            await fs.writeFile(
                path.join(dir, 'package.json'),
                JSON.stringify({ name: 'frontend', scripts: { dev: 'next dev' } })
            )
            await fs.writeFile(
                path.join(dir, 'next.config.ts'),
                'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {\n  /* config options here */\n};\n\nexport default nextConfig;\n'
            )
            await fs.writeFile(path.join(dir, 'src/app/globals.css'), '@import "tailwindcss";\n')
        }
        return ''
    }
    const steps = await nextjs.steps({ projectDir, answers: { ui: 'none' }, api: { port: 4000, oidc: true }, exec })
    assert.ok(steps.some(step => step.title === 'DafkeDD eID installeren'))
    for (const step of steps) await step.run()
    const install = calls.find(call => call.line === `npm install ${EID_PACKAGE}`)
    assert.equal(install?.cwd, path.join(projectDir, 'frontend'))
    const pkg = JSON.parse(await fs.readFile(path.join(projectDir, 'frontend/package.json'), 'utf8'))
    assert.equal(pkg.scripts['eid:mock'], EID_MOCK_SCRIPT)

    const plain = await nextjs.steps({
        projectDir: await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-eid-')),
        answers: { ui: 'none' },
        exec
    })
    assert.ok(!plain.some(step => step.title === 'DafkeDD eID installeren'))
})

test('npm 12+ refuses packages from a URL: .npmrc allows the ones in package.json (root), older npm gets none', async () => {
    for (const [answer, expected] of [
        ['none\n', true],
        // A warning of npm before the answer (for example: this npm does not support this Node.js version)
        ['npm warn cli npm v12.2.1 does not support Node.js v22.22.0.\r\nnone\r\n', true],
        ['all\n', false],
        ['undefined\n', false],
        ['', false]
    ]) {
        const written = {}
        const calls = []
        const exec = async (cmd, args, options) => {
            calls.push({ line: [cmd, ...args].join(' '), cwd: options?.cwd })
            return answer
        }
        const result = await allowEidDownload('/x/frontend', exec, async (root, rel, content) => {
            written[path.join(root, rel)] = content
        })
        assert.equal(result, expected, answer)
        assert.deepEqual(calls, [{ line: 'npm config get allow-remote', cwd: '/x/frontend' }])
        assert.deepEqual(written, expected ? { [path.join('/x/frontend', '.npmrc')]: ALLOW_REMOTE_NPMRC } : {})
    }
    assert.match(ALLOW_REMOTE_NPMRC, /^allow-remote=root$/m)
})

test('the frontend and the backend ask npm before installing DafkeDD eID', async () => {
    const front = await fs.readFile(new URL('../src/frontends/nextjs.js', import.meta.url), 'utf8')
    const back = await fs.readFile(new URL('../src/backends/nestjs.js', import.meta.url), 'utf8')
    assert.match(front, /await allowEidDownload\(root, exec, write\)\s+await exec\('npm', \['install', EID_PACKAGE\]/)
    assert.match(
        back,
        /await allowEidDownload\(root, exec, write\)\s+await exec\('npm', \['install', \.\.\.oidc\.PACKAGES\.dependencies\]/
    )
})
