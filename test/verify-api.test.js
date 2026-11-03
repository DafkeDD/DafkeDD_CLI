import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
    apiEnv,
    backendSteps,
    e2eClients,
    SPEC_COMMAND,
    specEnv,
    specRan,
    SUPERADMIN_EMAIL
} from '../scripts/verify-api.mjs'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('verify pasport: the frontend of the browser tests becomes a client of the API, next to npm run dev', () => {
    const json = read('templates/backend-oidc/config/oidc-clients.json')
    const frontend = JSON.parse(e2eClients(json)).clients.find(client => client.clientId === 'frontend')
    assert.deepEqual(frontend.redirectUris, [
        'http://localhost:3000/api/auth/callback',
        'http://localhost:3199/api/auth/callback'
    ])
    assert.deepEqual(frontend.postLogoutRedirectUris, ['http://localhost:3000', 'http://localhost:3199'])
    assert.equal(frontend.backchannelLogoutUri, 'http://localhost:3199/api/auth/backchannel-logout')
    // The rest of the client stays as it is (first party: no consent screen)
    assert.equal(frontend.firstParty, true)
    assert.equal(frontend.type, 'public')
    // The port of the browser tests is that of playwright.config.ts
    assert.match(
        read('templates/frontend-oidc/playwright.config.ts'),
        /const PORT = Number\(process\.env\.E2E_PORT \?\? 3199\)/
    )
})

test('verify pasport: the API for the spec runs without two-step verification, with the login screen of the tests', () => {
    assert.deepEqual(apiEnv({ apiPort: 4000, clientsFile: '/x/clients.json' }), {
        PORT: '4000',
        OIDC_ISSUER: 'http://localhost:4000/oidc',
        OIDC_LOGIN_UI_URL: 'http://localhost:3199/login',
        APP_URL: 'http://localhost:3199',
        CORS_ORIGIN: 'http://localhost:3199',
        OIDC_MFA: 'optional',
        OIDC_CLIENTS_FILE: '/x/clients.json'
    })
    // The settings exist in the API (src/oidc/oidc.config.ts and oidc.service.ts)
    const config = read('templates/backend-oidc/src/oidc/oidc.config.ts')
    for (const name of ['OIDC_LOGIN_UI_URL', 'APP_URL', 'OIDC_MFA', 'OIDC_ISSUER'])
        assert.ok(config.includes(`'${name}'`), name)
    assert.ok(read('templates/backend-oidc/src/oidc/oidc.service.ts').includes("'OIDC_CLIENTS_FILE'"))
    assert.ok(read('src/backends/nestjs.js').includes("config.get<string>('CORS_ORIGIN')"))
    // The spec gets the API on this machine, the password of this run and the built frontend
    assert.deepEqual(specEnv({ apiPort: 4000, password: 'pw' }), {
        E2E_API: 'http://localhost:4000',
        E2E_DEMO_PASSWORD: 'pw',
        E2E_NO_BUILD: '1'
    })
    assert.deepEqual(SPEC_COMMAND, ['npx', ['--no-install', 'playwright', 'test', 'e2e/api.spec.ts']])
})

test('verify pasport: the demo data and the superadmin get the password of this run', () => {
    assert.deepEqual(backendSteps('pw'), [
        ['npm', ['run', 'demo:clear']],
        ['npm', ['run', 'demo:data', '--', '--password', 'pw']],
        [
            'npm',
            [
                'run',
                'oidc:user',
                '--',
                '--superadmin',
                '--email',
                SUPERADMIN_EMAIL,
                '--name',
                'Support',
                '--password',
                'pw'
            ]
        ]
    ])
    // The superadmin the spec logs in with by default
    assert.ok(read('templates/frontend-oidc/e2e/api.spec.ts').includes(`?? '${SUPERADMIN_EMAIL}'`))
})

test('verify pasport: the spec must really run, a skipped or flaky one fails verify', () => {
    assert.equal(specRan('  3 passed (41.2s)'), true)
    assert.equal(specRan('  3 skipped'), false)
    assert.equal(specRan('  2 passed (30s)'), false)
    assert.equal(specRan('  1 flaky\n  2 passed'), false)
    assert.equal(specRan('  1 failed\n  2 passed'), false)
    assert.equal(specRan(''), false)
    // Three passed is not enough when another test was skipped, flaky or failed next to them
    assert.equal(specRan('  3 passed\n  1 skipped'), false)
    assert.equal(specRan('  1 flaky\n  3 passed'), false)
    assert.equal(specRan('  1 failed\n  3 passed'), false)
})

test('verify pasport runs the spec after the demo data, with the database only', () => {
    const verify = read('scripts/verify-apps.mjs')
    const ok = verify.indexOf("variant.backend.answers.database.connection === 'ok'")
    const demo = verify.indexOf("for (const script of ['demo:data', 'demo:data', 'demo:clear', 'demo:data'])", ok)
    const spec = verify.indexOf('await apiSpec(projectDir, demo.password)', demo)
    const noDb = verify.indexOf("} else if (flags['require-db'])", spec)
    assert.ok(ok > 0 && demo > ok && spec > demo && noDb > spec, 'the spec runs in the branch with a database')
    // The step runs whenever the demo data was added and the frontend has browser tests (not behind another condition)
    assert.match(
        verify,
        /\n {12}if \(demo && pkg\.scripts\?\.\['test:e2e'\]\) \{\n {16}log\([^\n]+\)\n {16}await apiSpec\(projectDir, demo\.password\)\n/
    )
    // apiSpec fails when the spec did not really run, and always stops its API
    const body = verify.slice(
        verify.indexOf('async function apiSpec'),
        verify.indexOf('\n}\n', verify.indexOf('async function apiSpec'))
    )
    assert.ok(body.includes('if (!specRan(output)) throw new Error'))
    // ... with the steps, the clients and the settings of verify-api.mjs, each tested above
    for (const call of [
        'for (const [cmd, args] of backendSteps(password)) await run(cmd, args, { cwd: backend })',
        "e2eClients(await fs.readFile(path.join(backend, 'config', 'oidc-clients.json'), 'utf8'))",
        'env: apiEnv({ apiPort, clientsFile }),',
        'env: specEnv({ apiPort, password })'
    ])
        assert.ok(
            body.split('\n').some(line => line.trim() === call),
            call
        )
    assert.match(
        body,
        /\} finally \{\n(?:\s*\/\/[^\n]*\n)?\s*api\?\.kill\(\)\n\s*await fs\.rm\(clientsFile, \{ force: true \}\)/
    )
    assert.ok(body.indexOf('try {') < body.indexOf("api = await serve('node', ['dist/main']"))
})

test('waitUntil waits until a check holds, and fails after its tries (the superadmin of the first start)', async () => {
    const { waitUntil } = await import('../scripts/verify-api.mjs')
    let calls = 0
    assert.equal(await waitUntil(async () => ++calls >= 3, { tries: 5, delay: 1 }), true)
    assert.equal(calls, 3)
    calls = 0
    await assert.rejects(
        waitUntil(async () => (++calls, false), { tries: 4, delay: 1 }),
        /did not happen/
    )
    assert.equal(calls, 4)
    // A check that throws (the table is not there yet) counts as not yet
    let tries = 0
    assert.equal(
        await waitUntil(
            async () => {
                if (++tries < 2) throw new Error('relation does not exist')
                return true
            },
            { tries: 3, delay: 1 }
        ),
        true
    )
    // ... and it was asked again after the error: an error is never taken for the superadmin being there
    assert.equal(tries, 2)
})

test('verify keeps the API of the first start running until its superadmin is there (it is made after /health)', () => {
    const verify = read('scripts/verify-apps.mjs')
    // The API answers /health before onApplicationBootstrap has made the superadmin (prepare() is not awaited)
    assert.match(
        read('templates/backend-oidc/src/oidc/oidc.service.ts'),
        /onApplicationBootstrap\(\) \{[\s\S]*?this\.prepare\(\)\.catch/
    )
    const start = verify.slice(
        verify.indexOf('async function startsOnPort'),
        verify.indexOf('\n}\n', verify.indexOf('async function startsOnPort'))
    )
    // After /health, and before the kill of the finally
    assert.ok(start.indexOf('if (answer)') < start.indexOf('if (ready) await waitUntil(ready'))
    assert.ok(start.indexOf('if (ready) await waitUntil(ready') < start.indexOf('child.kill()'))
    // The login server with a database waits for its superadmin
    assert.ok(
        verify.includes(
            'await checkExtras(projectDir, project, firstStartReady(variant.backend?.answers, backend, superadminFound))'
        )
    )
    // superadminFound compares with superadminMatches, and superadminExists throws when it finds none
    assert.ok(verify.includes('        return superadminMatches(rows, oidc)\n'))
    assert.match(verify, /if \(!\(await superadminFound\(dir, database, oidc\)\)\)\n\s+throw new Error\(`No superadmin/)
})

test('the first start of a login server with its database waits for the superadmin, no other variant', async () => {
    const { firstStartReady, superadminMatches } = await import('../scripts/verify-api.mjs')
    const oidc = { adminEmail: 'admin@example.com', adminPasswordHash: 'scrypt$1$a$b' }
    const database = { database: 'p', connection: 'ok' }
    const calls = []
    const find = async (...args) => (calls.push(args), true)
    const ready = firstStartReady({ oidc, database }, '/x/backend', find)
    assert.equal(typeof ready, 'function')
    assert.equal(await ready(), true)
    assert.deepEqual(calls, [['/x/backend', database, oidc]])
    // No login server, no superadmin in .env, or no database reached: nothing to wait for
    assert.equal(firstStartReady(undefined, '/x', find), null)
    assert.equal(firstStartReady({ oidc: null, database }, '/x', find), null)
    assert.equal(firstStartReady({ oidc: { ...oidc, adminEmail: '' }, database }, '/x', find), null)
    assert.equal(firstStartReady({ oidc, database: { ...database, connection: 'failed' } }, '/x', find), null)
    assert.equal(firstStartReady({ oidc, database: null }, '/x', find), null)
    // The row of the users table: only the hash of the CLI counts
    assert.equal(superadminMatches([{ password_hash: 'scrypt$1$a$b' }], oidc), true)
    assert.equal(superadminMatches([{ password_hash: 'scrypt$1$other' }], oidc), false)
    assert.equal(superadminMatches([], oidc), false)
    assert.equal(superadminMatches([{ password_hash: null }], { adminPasswordHash: null }), false)
})
