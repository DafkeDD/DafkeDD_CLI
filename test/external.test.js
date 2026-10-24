import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFiles } from '../src/backends/nestjs.js'
import * as oidc from '../src/backends/oidc.js'
import { endpoints } from '../src/backends/docs.js'
import { oidcFrontendFiles } from '../src/frontends/oidc.js'

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
    adminPassword: 'x',
    adminPasswordHash: 'scrypt$1$a$b',
    masterKey: 'ab'.repeat(32)
}
const EXTERNAL = {
    issuer: 'https://login.microsoftonline.com/contoso/v2.0',
    clientId: 'app-123',
    clientSecret: 's3cret',
    name: 'Contoso',
    only: false
}
const backend = buildFiles(DB, { oidc: { ...ANSWERS, external: EXTERNAL } })
const frontend = oidcFrontendFiles({ apiPort: 4000 })

/** Answers the questions in order, like a person would. */
function promptsFor(answers) {
    const asked = []
    const answer = async config => {
        asked.push(config)
        return answers.shift()
    }
    return { asked, prompts: { input: answer, select: answer, password: answer } }
}

test('ask: another OpenID Connect server next to the password, or only that one', async () => {
    const { asked, prompts } = promptsFor([
        'admin@example.com',
        'also',
        'https://keycloak.example.com/realms/demo/',
        ' my-app ',
        '',
        'Keycloak'
    ])
    const answers = await oidc.ask({ projectDir: '/p/shop', prompts })
    assert.deepEqual(answers.external, {
        // Exactly as typed (some issuers end with a slash, like Auth0)
        issuer: 'https://keycloak.example.com/realms/demo/',
        clientId: 'my-app',
        clientSecret: '',
        name: 'Keycloak',
        only: false
    })
    assert.match(asked[1].message, /bestaande OIDC-server/)
    assert.deepEqual(
        asked[1].choices.map(choice => choice.value),
        ['no', 'also', 'only']
    )
    // https only, except on this computer
    assert.equal(asked[2].validate('https://login.example.com'), true)
    assert.equal(asked[2].validate('http://localhost:8080/realms/demo'), true)
    assert.notEqual(asked[2].validate('http://login.example.com'), true)
    assert.notEqual(asked[3].validate('  '), true)

    const only = promptsFor(['admin@example.com', 'only', 'https://accounts.google.com', 'g-1', 'secret', ''])
    const google = await oidc.ask({ projectDir: '/p/shop', prompts: only.prompts })
    assert.deepEqual(google.external, {
        issuer: 'https://accounts.google.com',
        clientId: 'g-1',
        clientSecret: 'secret',
        name: 'accounts.google.com',
        only: true
    })
})

test('.env: the other server, its secret only in .env, and the redirect URI to register there', () => {
    const env = oidc.envLines({ ...ANSWERS, external: EXTERNAL }, { port: 4000 })
    assert.match(env, /^OIDC_EXTERNAL_ISSUER=https:\/\/login\.microsoftonline\.com\/contoso\/v2\.0$/m)
    assert.match(env, /^OIDC_EXTERNAL_CLIENT_ID=app-123$/m)
    assert.match(env, /^OIDC_EXTERNAL_CLIENT_SECRET='s3cret'$/m)
    assert.match(env, /^OIDC_EXTERNAL_NAME='Contoso'$/m)
    assert.match(env, /^OIDC_EXTERNAL_ONLY=false$/m)
    assert.match(env, /^OIDC_EXTERNAL_MFA=external$/m)
    assert.match(env, /http:\/\/localhost:4000\/oidc\/external\/callback/)
    const example = oidc.envLines({ ...ANSWERS, external: EXTERNAL }, { port: 4000, example: true })
    assert.ok(!example.includes('s3cret'))
    // Without the other server: the lines are there, empty (turned off)
    assert.match(oidc.envLines(ANSWERS, { port: 4000 }), /^OIDC_EXTERNAL_ISSUER=$/m)
    assert.ok(!backend['.env.example'].includes('s3cret'))
    assert.match(backend['.env'], /^OIDC_EXTERNAL_CLIENT_ID=app-123$/m)
})

test('the backend: our own code for the other server, migration 6, the routes and their documentation', () => {
    for (const rel of [
        'src/oidc/external/external.service.ts',
        'src/oidc/external/external-jwt.ts',
        'src/oidc/external/external-jwt.spec.ts',
        'test/external.e2e-spec.ts'
    ])
        assert.ok(backend[rel], rel)
    assert.match(backend['src/database/migrations.ts'], /id: 6,\s+name: 'login at another OpenID Connect server'/)
    assert.match(backend['src/database/migrations.ts'], /CHECK \(type IN \('eid', 'external'\)\)/)
    const service = backend['src/oidc/external/external.service.ts']
    // PKCE, state and nonce; the ID token is checked with its JWKS, issuer, audience, expiry and nonce
    for (const part of [
        "'code_challenge_method', 'S256'",
        "'state'",
        "'nonce'",
        'Wrong nonce',
        'Wrong audience',
        'Wrong issuer'
    ])
        assert.ok(service.includes(part), part)
    assert.ok(!backend['src/oidc/external/external-jwt.ts'].includes("'HS256'"), 'never HMAC')
    const documented = endpoints({ database: DB, oidc: true }).map(e => `${e.method} ${e.path}`)
    for (const route of [
        'POST /oidc/interaction/:id/external',
        'GET /oidc/external/callback',
        'POST /oidc/interaction/:id/resume'
    ])
        assert.ok(documented.includes(route), route)
    const readme = backend['README.md']
    for (const text of [
        '### Another OpenID Connect server',
        'OIDC_EXTERNAL_ISSUER',
        '/oidc/external/callback',
        'OIDC_EXTERNAL_MFA'
    ])
        assert.ok(readme.includes(text), text)
})

test('the login page of the frontend: "Log in with ...", only that, and going on after the other server', () => {
    const login = frontend['src/components/oidc-login.tsx']
    assert.match(login, /submit\('\/external', \{ csrf: state\.csrf \}\)/)
    assert.match(login, /call\('\/resume', \{ csrf: answer\.csrf \}\)/)
    // Only the other server (no password): its button, no email tab
    assert.match(login, /\(tab === 'eid' && firstTab\) \|\| !state\.password \?/)
    assert.match(frontend['src/app/[locale]/login/page.tsx'], /externalError=\{error\}/)
})
