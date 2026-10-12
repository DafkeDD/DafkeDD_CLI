import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { nestjs, buildFiles, LOCALES, TRANSLATIONS, write } from '../src/backends/nestjs.js'
import {
    authFiles,
    usersTable,
    ERRORS,
    VALIDATION,
    PACKAGES,
    COOKIE,
    SESSION_SECONDS,
    EXAMPLE_SECRET,
    envLines
} from '../src/backends/auth.js'
import { AUTH_MESSAGES, authFiles as frontendAuthFiles } from '../src/frontends/auth.js'
import { files as nextFiles, uiFiles, withApi, MESSAGES } from '../src/frontends/nextjs.js'

const DB = {
    id: 'postgres',
    mode: 'docker',
    host: 'localhost',
    port: 5432,
    user: 'app',
    password: 'secret',
    database: 'shop',
    project: 'shop'
}
const SECRET = 'a'.repeat(96)
const build = () => buildFiles(DB, { auth: { jwtSecret: SECRET } })

async function tmp(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-auth-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    return dir
}

const exists = file =>
    fs.stat(file).then(
        () => true,
        () => false
    )

// ---------------------------------------------------------------- the users table

test('the users table is the name of the database followed by "users"', () => {
    assert.equal(usersTable('shop'), 'shopusers')
    assert.equal(usersTable('testje1'), 'testje1users')
    assert.equal(usersTable('My_Db'), 'My_Dbusers')
})

test('a table name longer than the PostgreSQL limit (63) is refused', () => {
    assert.throws(() => usersTable('x'.repeat(59)), /63/)
    assert.equal(usersTable('x'.repeat(58)).length, 63)
})

test('the generated backend knows its table name and creates exactly ONE table (no test table)', () => {
    const all = build()
    assert.match(all['src/users/users.table.ts'], /USERS_TABLE = 'shopusers'/)
    const creates = Object.entries(all)
        .filter(([rel]) => !rel.includes('.spec.') && !rel.includes('-spec.'))
        .flatMap(([rel, content]) => [...content.matchAll(/CREATE TABLE/g)].map(() => rel))
    assert.deepEqual(creates, ['src/users/users.service.ts'])
    const sql = all['src/users/users.service.ts']
    assert.match(sql, /CREATE TABLE IF NOT EXISTS/)
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS/)
    assert.match(sql, /lower\(email\)/)
    assert.match(sql, /password_hash text NOT NULL/)
    assert.match(sql, /gen_random_uuid\(\)/)
})

test('SQL only uses parameters for values and the table name comes from one constant', () => {
    const service = authFiles('shopusers')['src/users/users.service.ts']
    for (const placeholder of ['$1, $2, $3', 'lower($1)', 'id = $1'])
        assert.ok(service.includes(placeholder), placeholder)
    assert.ok(!/(\+|\$\{)\s*(input|email|dto|name)\b/.test(service), 'no values glued into SQL')
})

// ---------------------------------------------------------------- security of the backend code

test('passwords are hashed with scrypt, a random salt and a constant-time comparison', () => {
    const password = authFiles('t')['src/auth/password.ts']
    assert.match(password, /scrypt/)
    assert.match(password, /randomBytes\(16\)/)
    assert.match(password, /timingSafeEqual/)
    assert.ok(!/createHash|md5|sha1/i.test(password))
})

test('the session is a signed JWT in an httpOnly, SameSite=Lax cookie that is Secure in production', () => {
    const files = authFiles('t')
    const controller = files['src/auth/auth.controller.ts']
    assert.match(controller, /httpOnly: true/)
    assert.match(controller, /sameSite: 'lax'/)
    assert.match(controller, /NODE_ENV'\) === 'production'/)
    assert.match(files['src/auth/auth.constants.ts'], new RegExp(`'${COOKIE}'`))
    assert.match(files['src/auth/auth.constants.ts'], new RegExp(String(SESSION_SECONDS)))
    assert.match(files['src/auth/auth.module.ts'], /getOrThrow<string>\('JWT_SECRET'\)/, 'no fallback secret')
})

test('login and register are rate limited, logout and me are not (the frontend polls /auth/me)', () => {
    const controller = authFiles('t')['src/auth/auth.controller.ts']
    assert.equal(controller.match(/UseGuards\(ThrottlerGuard\)/g).length, 2)
    assert.match(controller, /@Post\('register'\)[^]*?@UseGuards\(ThrottlerGuard\)\s+async register/)
    assert.match(controller, /@Post\('login'\)[^]*?@UseGuards\(ThrottlerGuard\)\s+async login/)
})

test('an unknown email takes as long as a wrong password and gives the same error', () => {
    const service = authFiles('t')['src/auth/auth.service.ts']
    assert.match(service, /DUMMY_HASH/)
    assert.match(service, /user\?\.passwordHash \?\? DUMMY_HASH/)
    assert.equal(service.match(/errors\.INVALID_CREDENTIALS/g).length, 1, 'one single error for both cases')
})

test('the API never returns the password hash', () => {
    const files = authFiles('t')
    assert.match(files['src/users/users.service.ts'], /export const publicUser/)
    assert.match(files['src/auth/auth.controller.ts'], /return publicUser\(user\)/)
    assert.match(files['src/auth/auth.service.ts'], /user: publicUser\(user\)/)
})

test('registration is validated (lengths limited, email normalised, unknown fields refused by the global pipe)', () => {
    const dto = authFiles('t')['src/auth/dto/register.dto.ts']
    assert.match(dto, /@MinLength\(8/)
    assert.equal(dto.match(/@MaxLength/g).length, 3)
    assert.match(dto, /toLowerCase\(\)/)
    assert.match(buildFiles(DB)['src/setup.ts'], /forbidNonWhitelisted: true/)
})

test('a duplicate email is caught twice: before inserting and by the unique index (code 23505)', () => {
    const service = authFiles('t')['src/auth/auth.service.ts']
    assert.match(service, /findByEmail\(dto\.email\)/)
    assert.match(service, /23505/)
})

test('the generated code is ESM-safe: relative imports end in .js', () => {
    for (const [rel, content] of Object.entries(authFiles('t'))) {
        for (const [, spec] of content.matchAll(/from '(\.[^']*)'/g)) assert.ok(spec.endsWith('.js'), `${rel}: ${spec}`)
    }
})

test('the generated project ships tests for hashing, the users table and the whole login flow', () => {
    const files = authFiles('t')
    assert.ok('src/auth/password.spec.ts' in files)
    assert.ok('src/users/users.service.spec.ts' in files)
    const e2e = files['test/auth.e2e-spec.ts']
    for (const text of [
        'register',
        'login',
        '/auth/me',
        '/auth/logout',
        'HttpOnly',
        'scrypt$',
        '.expect(429)',
        '.expect(409)',
        'forged'
    ]) {
        assert.ok(e2e.includes(text), text)
    }
    for (const locale of LOCALES) {
        for (const key of ['INVALID_CREDENTIALS', 'EMAIL_TAKEN', 'TOO_MANY_REQUESTS']) {
            assert.ok(e2e.includes(JSON.stringify(ERRORS[locale][key])), `${locale} ${key}`)
        }
    }
})

// ---------------------------------------------------------------- translations

test('login errors and validation texts exist in nl, fr, en and de with the same keys', () => {
    for (const set of [ERRORS, VALIDATION]) {
        assert.deepEqual(Object.keys(set).sort(), [...LOCALES].sort())
        for (const locale of LOCALES) {
            assert.deepEqual(Object.keys(set[locale]).sort(), Object.keys(set.en).sort(), locale)
            for (const value of Object.values(set[locale])) assert.ok(value.trim())
        }
    }
    for (const key of Object.keys(ERRORS.en)) {
        assert.equal(new Set(LOCALES.map(l => ERRORS[l][key])).size, 4, `${key} has four different translations`)
    }
})

test('with login the translation files get the extra texts and keep the existing ones', () => {
    const all = build()
    for (const locale of LOCALES) {
        const errors = JSON.parse(all[`src/i18n/${locale}/errors.json`])
        const validation = JSON.parse(all[`src/i18n/${locale}/validation.json`])
        for (const key of Object.keys(TRANSLATIONS[locale].errors)) assert.ok(key in errors, `${locale} ${key}`)
        for (const key of Object.keys(ERRORS[locale])) assert.ok(errors[key], `${locale} ${key}`)
        assert.ok(errors.DATABASE_UNAVAILABLE, 'the database error is still there')
        assert.ok(validation.MAX_LENGTH && validation.IS_EMAIL, locale)
        assert.deepEqual(Object.keys(errors).sort(), Object.keys(JSON.parse(all['src/i18n/en/errors.json'])).sort())
    }
})

// ---------------------------------------------------------------- wiring

test('buildFiles (login) wires the module, cookies, the 429 translation and the secret', () => {
    const all = build()
    assert.match(all['src/app.module.ts'], /import \{ AuthModule \} from '\.\/auth\/auth\.module\.js'/)
    assert.match(all['src/app.module.ts'], /DatabaseModule,\n\s+AuthModule,/)
    assert.match(all['src/setup.ts'], /import cookieParser from 'cookie-parser'/)
    assert.match(all['src/setup.ts'], /app\.use\(cookieParser\(\)\)/)
    assert.match(all['src/common/all-exceptions.filter.ts'], /429: 'errors\.TOO_MANY_REQUESTS'/)
    assert.match(all['test/app.e2e-spec.ts'], /JWT_SECRET \?\?= /)
})

test('JWT_SECRET goes into .env only; .env.example holds a placeholder', () => {
    const all = build()
    assert.ok(all['.env'].includes(`JWT_SECRET='${SECRET}'`))
    assert.ok(!all['.env.example'].includes(SECRET))
    assert.ok(all['.env.example'].includes(`JWT_SECRET='${EXAMPLE_SECRET}'`))
    assert.match(all['.env'], /AUTH_RATE_LIMIT=10/)
    assert.match(envLines({ jwtSecret: 'x' }), /JWT_SECRET='x'/)
})

test('login without a database is refused', () => {
    assert.throws(() => buildFiles(null, { auth: { jwtSecret: 'x' } }), /database/)
})

test('without login the backend has no auth files, no cookie parser and no secret', () => {
    const all = buildFiles(DB)
    assert.ok(!Object.keys(all).some(rel => rel.startsWith('src/auth/') || rel.startsWith('src/users/')))
    assert.ok(!all['src/setup.ts'].includes('cookieParser'))
    assert.ok(!all['.env'].includes('JWT_SECRET'))
})

// ---------------------------------------------------------------- the question

function confirmPrompts(answer) {
    const asked = []
    return {
        asked,
        prompts: {
            select: async () => 'postgres',
            confirm: async config => {
                asked.push(config)
                return answer
            }
        }
    }
}

const registry = {
    postgres: { id: 'postgres', label: 'PostgreSQL', description: 'x', ask: async () => ({ ...DB }) }
}

test('with a frontend and a database the CLI asks about the test login pages and names the table', async () => {
    const { prompts, asked } = confirmPrompts(true)
    const result = await nestjs.ask({ hasFrontend: true, prompts, registry })
    assert.equal(result.auth, true)
    assert.equal(asked.length, 1)
    assert.match(asked[0].message, /login/i)
    assert.ok(asked[0].message.includes('shopusers'), 'the user sees the table name')
    assert.equal(asked[0].default, true)
})

test('the answer "no" gives no login pages', async () => {
    const { prompts } = confirmPrompts(false)
    assert.equal((await nestjs.ask({ hasFrontend: true, prompts, registry })).auth, false)
})

test('without a frontend the login question is not asked', async () => {
    const { prompts, asked } = confirmPrompts(true)
    const result = await nestjs.ask({ hasFrontend: false, prompts, registry })
    assert.equal(result.auth, false)
    assert.equal(asked.length, 0)
})

test('without a database the login question is not asked', async () => {
    const asked = []
    const prompts = {
        select: async () => 'none',
        confirm: async config => asked.push(config)
    }
    const result = await nestjs.ask({ hasFrontend: true, prompts, registry })
    assert.deepEqual(result, { database: null, auth: false })
    assert.equal(asked.length, 0)
})

// ---------------------------------------------------------------- install flow

function fakeExec(calls = []) {
    return async (cmd, args, { cwd } = {}) => {
        calls.push({ line: [cmd, ...args].join(' '), cwd })
        if (cmd === 'npx' && args.includes('@nestjs/cli@latest')) {
            const root = path.join(cwd, 'backend')
            await write(root, 'package.json', JSON.stringify({ name: 'backend', scripts: { test: 'vitest run' } }))
            await write(root, 'nest-cli.json', JSON.stringify({ compilerOptions: {} }))
        }
        return ''
    }
}

const runAll = async steps => {
    for (const step of steps) await step.run()
}

test('steps (login) install the login packages locally, right after the database driver', async t => {
    const projectDir = await tmp(t)
    const calls = []
    const steps = await nestjs.steps({
        projectDir,
        answers: { database: { ...DB }, auth: true },
        secret: () => SECRET,
        exec: fakeExec(calls)
    })
    const names = steps.map(s => s.title)
    assert.ok(
        names.indexOf('Login-pakketten installeren (JWT, cookies, rate limiting)') >
            names.indexOf('Database-driver installeren (PostgreSQL)')
    )
    await runAll(steps)
    const lines = calls.map(c => c.line)
    assert.ok(lines.includes(`npm install ${PACKAGES.dependencies.join(' ')}`))
    assert.ok(lines.includes(`npm install --save-dev ${PACKAGES.devDependencies.join(' ')}`))
    for (const c of calls.filter(c => c.line.includes('@nestjs/jwt')))
        assert.equal(c.cwd, path.join(projectDir, 'backend'))
})

test('steps (login) write the pages of the API and a generated secret that is different every time', async t => {
    const first = await tmp(t)
    const second = await tmp(t)
    for (const dir of [first, second]) {
        await runAll(
            await nestjs.steps({ projectDir: dir, answers: { database: { ...DB }, auth: true }, exec: fakeExec() })
        )
    }
    const read = dir => fs.readFile(path.join(dir, 'backend/.env'), 'utf8')
    const [a, b] = [await read(first), await read(second)]
    const secretOf = text => text.match(/JWT_SECRET='([^']+)'/)[1]
    assert.match(secretOf(a), /^[0-9a-f]{96}$/, '48 random bytes as hex')
    assert.notEqual(secretOf(a), secretOf(b))
    assert.ok(await exists(path.join(first, 'backend/src/auth/auth.controller.ts')))
    assert.ok(await exists(path.join(first, 'backend/src/users/users.service.ts')))
})

test('steps without login install nothing extra', async t => {
    const projectDir = await tmp(t)
    const calls = []
    const steps = await nestjs.steps({
        projectDir,
        answers: { database: { ...DB }, auth: false },
        exec: fakeExec(calls)
    })
    assert.ok(!steps.some(s => s.title.startsWith('Login')))
    await runAll(steps)
    assert.ok(!calls.some(c => c.line.includes('@nestjs/jwt')))
})

test('"auth" without a database does nothing (the login needs the users table)', async t => {
    const projectDir = await tmp(t)
    const steps = await nestjs.steps({ projectDir, answers: { database: null, auth: true }, exec: fakeExec() })
    assert.ok(!steps.some(s => s.title.startsWith('Login')))
})

test('the end of the run mentions the login pages and the table name', () => {
    const answers = { database: { ...DB }, auth: true }
    assert.ok(nestjs.summary(answers).some(line => line.ok && line.text.includes('shopusers')))
    assert.ok(nestjs.next(answers).some(line => line.includes('localhost:3000/login')))
    assert.ok(!nestjs.next({ database: { ...DB }, auth: false }).some(line => line.includes('/login')))
})

// ---------------------------------------------------------------- frontend pages

const API = { port: 4000, auth: true }

test('the login texts of the frontend exist in nl, fr, en and de with the same keys', () => {
    assert.deepEqual(Object.keys(AUTH_MESSAGES).sort(), [...LOCALES].sort())
    for (const locale of LOCALES) {
        assert.deepEqual(Object.keys(AUTH_MESSAGES[locale]).sort(), Object.keys(AUTH_MESSAGES.en).sort(), locale)
        for (const value of Object.values(AUTH_MESSAGES[locale])) assert.ok(value.trim())
        assert.match(AUTH_MESSAGES[locale].signedInAs, /\{name\}/, `${locale} keeps the {name} placeholder`)
    }
})

test('the frontend has a login, register and profile page and the components behind them', () => {
    const files = frontendAuthFiles()
    for (const rel of [
        'src/app/[locale]/login/page.tsx',
        'src/app/[locale]/register/page.tsx',
        'src/app/[locale]/profile/page.tsx',
        'src/components/auth-form.tsx',
        'src/components/profile.tsx',
        'src/components/auth-links.tsx'
    ]) {
        assert.ok(rel in files, rel)
    }
    assert.match(files['src/app/[locale]/login/page.tsx'], /<AuthForm mode="login" \/>/)
    assert.match(files['src/app/[locale]/register/page.tsx'], /<AuthForm mode="register" \/>/)
    assert.match(files['src/app/[locale]/profile/page.tsx'], /<Profile \/>/)
    for (const rel of ['login', 'register', 'profile']) {
        assert.match(
            files[`src/app/[locale]/${rel}/page.tsx`],
            /setRequestLocale\(locale\)/,
            'static rendering per locale'
        )
    }
})

test('the form talks to the auth endpoints and shows the translated error of the server', () => {
    const form = frontendAuthFiles()['src/components/auth-form.tsx']
    assert.match(form, /^'use client'/)
    assert.match(form, /\/auth\/register/)
    assert.match(form, /\/auth\/login/)
    assert.match(form, /router\.push\('\/profile'\)/)
    assert.match(form, /err\.message/, 'the server message is already in the selected language')
    assert.match(form, /autoComplete=\{isRegister \? 'new-password' : 'current-password'\}/)
    assert.match(form, /type="password"/)
    assert.match(form, /minLength=\{isRegister \? 8/)
})

test('the profile page loads the user from the API and sends anonymous visitors to the login page', () => {
    const profile = frontendAuthFiles()['src/components/profile.tsx']
    assert.match(profile, /'\/auth\/me'/)
    assert.match(profile, /status === 401\) router\.replace\('\/login'\)/)
    assert.match(profile, /\/auth\/logout/)
})

test('the pages use the locale-aware navigation of next-intl, and spacing without margins', () => {
    for (const [rel, content] of Object.entries(frontendAuthFiles())) {
        if (!rel.startsWith('src/components/')) continue
        for (const [, spec] of content.matchAll(/from '(@\/i18n\/[^']+)'/g))
            assert.equal(spec, '@/i18n/navigation', rel)
        assert.ok(!/<(h1|h2|p)[^>]*\bm[bt]-/.test(content), `${rel}: DafkeDD UI resets heading margins, use gap`)
    }
})

test('the API client sends the cookie along and shows lists of validation messages', () => {
    const api = withApi(nextFiles, API, { ui: false })['src/lib/api.ts']
    assert.match(api, /credentials: 'include'/)
    assert.match(api, /Array\.isArray\(body\?\.message\)/)
})

test('withApi (login) adds the pages, the texts and the links on the home page, for both variants', () => {
    for (const [name, base, ui] of [
        ['plain', nextFiles, false],
        ['DafkeDD UI', { ...nextFiles, ...uiFiles }, true]
    ]) {
        const result = withApi(base, API, { ui })
        assert.ok('src/app/[locale]/login/page.tsx' in result, name)
        const page = result['src/app/[locale]/page.tsx']
        assert.match(page, /import \{ AuthLinks \} from '@\/components\/auth-links'/, name)
        assert.equal(page.match(/<AuthLinks \/>/g).length, 1, name)
        for (const locale of LOCALES) {
            const messages = JSON.parse(result[`messages/${locale}.json`])
            assert.deepEqual(messages.Auth, AUTH_MESSAGES[locale], `${name} ${locale}`)
            assert.deepEqual(messages.HomePage, MESSAGES[locale].HomePage)
        }
    }
})

test('withApi without login adds no login pages, links or texts', () => {
    const result = withApi(nextFiles, { port: 4000, auth: false }, { ui: false })
    assert.ok(!Object.keys(result).some(rel => /login|register|profile|auth-/.test(rel)))
    assert.ok(!result['src/app/[locale]/page.tsx'].includes('AuthLinks'))
    assert.ok(!('Auth' in JSON.parse(result['messages/en.json'])))
})
