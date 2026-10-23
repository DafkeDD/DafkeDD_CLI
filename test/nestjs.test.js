import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
    nestjs,
    LOCALES,
    DEFAULT_LOCALE,
    PORT,
    FRONTEND_ORIGIN,
    TRANSLATIONS,
    ENV_EXAMPLE,
    GITIGNORE,
    files,
    buildFiles,
    patchNestCli,
    write
} from '../src/backends/nestjs.js'
import { PRETTIERRC } from '../src/frontends/nextjs.js'

async function tmp(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-nest-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    return dir
}

const exists = file =>
    fs.stat(file).then(
        () => true,
        () => false
    )

const placeholders = text => (text.match(/\{[^}]+\}/g) ?? []).sort()

// ---------------------------------------------------------------- translations

test('server translations exist for exactly nl, fr, en and de, with English as default', () => {
    assert.deepEqual([...LOCALES].sort(), ['de', 'en', 'fr', 'nl'])
    assert.deepEqual(Object.keys(TRANSLATIONS).sort(), ['de', 'en', 'fr', 'nl'])
    assert.equal(DEFAULT_LOCALE, 'en')
})

test('every language has the same namespaces and keys', () => {
    for (const locale of LOCALES) {
        assert.deepEqual(Object.keys(TRANSLATIONS[locale]).sort(), Object.keys(TRANSLATIONS.en).sort(), locale)
        for (const namespace of Object.keys(TRANSLATIONS.en)) {
            assert.deepEqual(
                Object.keys(TRANSLATIONS[locale][namespace]).sort(),
                Object.keys(TRANSLATIONS.en[namespace]).sort(),
                `${locale}/${namespace}`
            )
        }
    }
})

test('every translation is a non-empty string', () => {
    for (const locale of LOCALES) {
        for (const [namespace, messages] of Object.entries(TRANSLATIONS[locale])) {
            for (const [key, value] of Object.entries(messages)) {
                assert.equal(typeof value, 'string', `${locale}/${namespace}.${key}`)
                assert.ok(value.trim().length > 0, `${locale}/${namespace}.${key}`)
            }
        }
    }
})

test('translations keep the same placeholders as English ({id}, {property}, {constraints.0})', () => {
    for (const locale of LOCALES) {
        for (const [namespace, messages] of Object.entries(TRANSLATIONS[locale])) {
            for (const [key, value] of Object.entries(messages)) {
                assert.deepEqual(
                    placeholders(value),
                    placeholders(TRANSLATIONS.en[namespace][key]),
                    `${locale}/${namespace}.${key}`
                )
            }
        }
    }
})

test('error and validation texts exist for everything the generated code uses', () => {
    for (const key of [
        'BAD_REQUEST',
        'UNAUTHORIZED',
        'FORBIDDEN',
        'NOT_FOUND',
        'CONFLICT',
        'INTERNAL',
        'EXAMPLE_NOT_FOUND'
    ]) {
        assert.ok(TRANSLATIONS.en.errors[key], key)
    }
    for (const key of ['IS_STRING', 'NOT_EMPTY', 'MIN_LENGTH', 'IS_EMAIL'])
        assert.ok(TRANSLATIONS.en.validation[key], key)
    assert.ok(TRANSLATIONS.en.common.HELLO)
})

test('translation JSON files are generated for every language and namespace', () => {
    for (const locale of LOCALES) {
        for (const namespace of Object.keys(TRANSLATIONS.en)) {
            const file = files[`src/i18n/${locale}/${namespace}.json`]
            assert.ok(file, `${locale}/${namespace}`)
            assert.deepEqual(JSON.parse(file), TRANSLATIONS[locale][namespace])
        }
    }
})

// ---------------------------------------------------------------- generated code

test('language detection order: ?lang=, then x-lang header, then Accept-Language, English as fallback', () => {
    const module = files['src/app.module.ts']
    const order = ['QueryResolver, options', 'new HeaderResolver', 'AcceptLanguageResolver]'].map(s =>
        module.indexOf(s)
    )
    assert.ok(
        order.every(i => i > -1),
        'all resolvers are configured'
    )
    assert.deepEqual(
        [...order].sort((a, b) => a - b),
        order,
        'resolver order'
    )
    assert.match(module, /fallbackLanguage: 'en'/)
    for (const prefix of ['nl', 'fr', 'de', 'en']) assert.ok(module.includes(`'${prefix}-*': '${prefix}'`), prefix)
})

test('the app wires validation, translated exceptions, config and CORS', () => {
    const setup = files['src/setup.ts']
    assert.match(setup, /I18nValidationPipe/)
    assert.match(setup, /new AllExceptionsFilter\(\), new ValidationExceptionFilter\(\)/)
    assert.match(setup, /enableCors/)
    assert.ok(setup.includes(FRONTEND_ORIGIN))
    assert.match(files['src/app.module.ts'], /ConfigModule\.forRoot\(\{ isGlobal: true \}\)/)
})

test('the exception filters return one JSON shape and translate the message', () => {
    const all = files['src/common/all-exceptions.filter.ts']
    for (const key of [
        'errors.BAD_REQUEST',
        'errors.UNAUTHORIZED',
        'errors.FORBIDDEN',
        'errors.NOT_FOUND',
        'errors.INTERNAL'
    ]) {
        assert.ok(all.includes(key), key)
    }
    assert.match(all, /I18nContext\.current/)
    for (const field of ['statusCode', 'error', 'message', 'path', 'timestamp']) {
        assert.ok(all.includes(field), field)
        assert.ok(files['src/common/validation-exception.filter.ts'].includes(field), field)
    }
    assert.match(files['src/common/app.exception.ts'], /class AppException extends HttpException/)
})

test('Swagger is served on /docs and documents the Accept-Language header', () => {
    const main = files['src/main.ts']
    assert.match(main, /SwaggerModule\.setup\('docs'/)
    assert.match(main, /Accept-Language/)
    for (const locale of LOCALES) assert.ok(main.includes(`"${locale}"`), locale)
})

test('the API runs on port 4000 by default, configurable through .env', () => {
    assert.equal(PORT, 4000)
    assert.match(files['src/main.ts'], /\?\? 4000/)
    assert.match(ENV_EXAMPLE, /^PORT=4000$/m)
    assert.match(ENV_EXAMPLE, /^CORS_ORIGIN=http:\/\/localhost:3000$/m)
    assert.equal(files['.env'], ENV_EXAMPLE)
    assert.equal(files['.env.example'], ENV_EXAMPLE)
})

test('a health endpoint exists', () => {
    assert.match(files['src/health/health.controller.ts'], /@Controller\('health'\)/)
    assert.match(files['src/health/health.controller.ts'], /status: 'ok'/)
})

test('.gitignore keeps node_modules, dist and .env out of git (Nest skips it with --skip-git)', () => {
    assert.equal(files['.gitignore'], GITIGNORE)
    for (const entry of ['node_modules', 'dist', '.env']) assert.ok(GITIGNORE.split('\n').includes(entry), entry)
})

test('the backend is ESM (nodenext): relative imports end in .js and there is no __dirname', () => {
    for (const [rel, content] of Object.entries(files)) {
        if (!rel.endsWith('.ts')) continue
        assert.ok(!content.includes('__dirname'), `${rel} uses __dirname`)
        for (const match of content.matchAll(/from '(\.{1,2}\/[^']+)'/g)) {
            assert.ok(match[1].endsWith('.js'), `${rel}: import '${match[1]}' needs a .js extension`)
        }
    }
})

test('the generated project ships tests for translations, exceptions and the API (all four languages)', () => {
    assert.ok(files['src/i18n/i18n.spec.ts'])
    assert.ok(files['src/common/app.exception.spec.ts'])
    const e2e = files['test/app.e2e-spec.ts']
    for (const text of [
        'Hallo vanuit de API!',
        "Bonjour depuis l'API !",
        'Hallo von der API!',
        'Hello from the API!'
    ]) {
        assert.ok(e2e.includes(text), text)
    }
    assert.match(e2e, /nl-BE/)
    assert.match(e2e, /x-lang/)
    assert.match(e2e, /\?lang=fr/)
})

// ---------------------------------------------------------------- patches

test('patchNestCli copies the translation JSON files to dist and keeps other options', async t => {
    const root = await tmp(t)
    await write(root, 'nest-cli.json', JSON.stringify({ sourceRoot: 'src', compilerOptions: { deleteOutDir: true } }))
    await patchNestCli(root)
    const config = JSON.parse(await fs.readFile(path.join(root, 'nest-cli.json'), 'utf8'))
    assert.equal(config.sourceRoot, 'src')
    assert.equal(config.compilerOptions.deleteOutDir, true)
    assert.deepEqual(config.compilerOptions.assets, [{ include: 'i18n/**/*.json', watchAssets: true }])
})

// ---------------------------------------------------------------- definition

test('the NestJS backend definition is complete', () => {
    assert.equal(nestjs.id, 'nestjs')
    assert.equal(nestjs.label, 'NestJS')
    assert.equal(nestjs.dir, 'backend')
    const next = nestjs.next({ database: null })
    assert.ok(next.includes('cd backend'))
    assert.ok(next.some(line => line.includes('npm run start:dev')))
    assert.ok(next.some(line => line.includes('localhost:4000/docs')))
    assert.deepEqual(nestjs.api, { port: 4000 }, 'the frontend learns the port from the backend definition')
})

// ---------------------------------------------------------------- install flow (fake exec, no network)

/** Fake `exec` that simulates what `nest new` writes, and records every command. */
function fakeExec(calls = []) {
    return async (cmd, args, { cwd } = {}) => {
        calls.push({ line: [cmd, ...args].join(' '), cwd })
        if (cmd === 'npx' && args.includes('@nestjs/cli@latest')) {
            const root = path.join(cwd, 'backend')
            await write(root, 'package.json', JSON.stringify({ name: 'backend', scripts: { test: 'vitest run' } }))
            await write(root, 'nest-cli.json', JSON.stringify({ compilerOptions: { deleteOutDir: true } }))
            await write(root, 'src/app.controller.ts', '// starter')
            await write(root, 'src/app.service.ts', '// starter')
            await write(root, 'src/app.controller.spec.ts', '// starter')
            await write(root, 'test/app.e2e-spec.ts', '// starter')
        }
        return ''
    }
}

const titles = steps => steps.map(s => s.title)
const runAll = async steps => {
    for (const step of steps) await step.run()
}

test('steps (backend only) create, install, configure and verify in the right order', async t => {
    const projectDir = await tmp(t)
    const steps = await nestjs.steps({ projectDir, exec: fakeExec() })
    assert.deepEqual(titles(steps), [
        'NestJS aanmaken',
        'Backend dependencies installeren',
        'i18n, validatie, Swagger en config installeren',
        'Prettier installeren (backend)',
        'i18n en API configureren',
        'Prettier configureren (backend)',
        'Backend controleren (build, lint en tests)'
    ])
    assert.ok(steps.every(s => s.weight > 0))
})

test('steps install the latest packages locally in ./backend', async t => {
    const projectDir = await tmp(t)
    const calls = []
    await runAll(await nestjs.steps({ projectDir, exec: fakeExec(calls) }))
    const lines = calls.map(c => c.line)
    assert.ok(lines[0].startsWith('npx --yes @nestjs/cli@latest new backend'))
    assert.ok(lines[0].includes('--skip-git'))
    assert.ok(lines[0].includes('--package-manager npm'))
    const extras = lines.find(l => l.startsWith('npm install nestjs-i18n@latest'))
    for (const pkg of [
        'class-validator@latest',
        'class-transformer@latest',
        '@nestjs/config@latest',
        '@nestjs/swagger@latest'
    ]) {
        assert.ok(extras.includes(pkg), pkg)
    }
    assert.ok(lines.includes('npm install --save-dev prettier@latest prettier-plugin-tailwindcss@latest'))
    assert.ok(lines.includes('npx --no-install prettier --write .'))
    const backend = path.join(projectDir, 'backend')
    for (const c of calls.filter(c => c.line.startsWith('npm '))) assert.equal(c.cwd, backend, c.line)
    assert.ok(!lines.some(l => /\s(-g|--global)(\s|$)/.test(l)))
})

test('steps verify with build, lint, unit tests and e2e tests, in that order', async t => {
    const projectDir = await tmp(t)
    const calls = []
    await runAll(await nestjs.steps({ projectDir, exec: fakeExec(calls) }))
    const lines = calls.map(c => c.line)
    const tail = lines.slice(lines.indexOf('npm run build'))
    assert.deepEqual(tail, ['npm run build', 'npm run lint', 'npm test', 'npm run test:e2e'])
})

test('steps replace the starter files by the i18n versions and write the translations', async t => {
    const projectDir = await tmp(t)
    await runAll(await nestjs.steps({ projectDir, exec: fakeExec() }))
    const root = path.join(projectDir, 'backend')
    assert.ok(!(await exists(path.join(root, 'src/app.service.ts'))), 'starter service removed')
    assert.ok(!(await exists(path.join(root, 'src/app.controller.spec.ts'))), 'starter spec removed')
    assert.match(await fs.readFile(path.join(root, 'src/app.controller.ts'), 'utf8'), /I18nContext/)
    assert.match(await fs.readFile(path.join(root, 'test/app.e2e-spec.ts'), 'utf8'), /API \(e2e\)/)
    for (const locale of LOCALES) {
        for (const namespace of ['common', 'errors', 'validation']) {
            assert.ok(await exists(path.join(root, `src/i18n/${locale}/${namespace}.json`)), `${locale}/${namespace}`)
        }
    }
    assert.ok(await exists(path.join(root, '.gitignore')))
    assert.ok(await exists(path.join(root, '.env')))
    const nestCli = JSON.parse(await fs.readFile(path.join(root, 'nest-cli.json'), 'utf8'))
    assert.deepEqual(nestCli.compilerOptions.assets, [{ include: 'i18n/**/*.json', watchAssets: true }])
})

test('steps configure Prettier with the shared .prettierrc and format scripts', async t => {
    const projectDir = await tmp(t)
    await runAll(await nestjs.steps({ projectDir, exec: fakeExec() }))
    const root = path.join(projectDir, 'backend')
    assert.equal(await fs.readFile(path.join(root, '.prettierrc'), 'utf8'), PRETTIERRC)
    const ignore = (await fs.readFile(path.join(root, '.prettierignore'), 'utf8')).split('\n')
    for (const entry of ['node_modules', 'dist', 'coverage']) assert.ok(ignore.includes(entry), entry)
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
    assert.equal(pkg.scripts.format, 'prettier --write .')
    assert.equal(pkg.scripts['format:check'], 'prettier --check .')
    assert.equal(pkg.scripts.test, 'vitest run', 'existing scripts are kept')
})

test('steps refuse to run when ./backend already exists and delete nothing', async t => {
    const projectDir = await tmp(t)
    await write(projectDir, 'backend/keep.txt', 'mine')
    await assert.rejects(nestjs.steps({ projectDir, exec: fakeExec() }), /bestaat al/)
    assert.equal(await fs.readFile(path.join(projectDir, 'backend/keep.txt'), 'utf8'), 'mine')
})

// ---------------------------------------------------------------- database question

const DB = {
    id: 'postgres',
    mode: 'docker',
    host: 'localhost',
    port: 5433,
    user: 'app',
    password: 'secret',
    database: 'demo',
    project: 'demo'
}

test('ask: "no database" returns no database and asks nothing else', async () => {
    const asked = []
    const prompts = {
        select: async config => {
            asked.push(config.message)
            return 'none'
        }
    }
    assert.deepEqual(await nestjs.ask({ prompts }), { database: null, auth: false, oidc: null })
    assert.equal(asked.length, 1)
})

test('ask: offers PostgreSQL and "no database" and hands over to the database questions', async () => {
    let choices
    const registry = {
        postgres: {
            id: 'postgres',
            label: 'PostgreSQL',
            description: 'x',
            ask: async ({ projectDir }) => ({ id: 'postgres', projectDir })
        }
    }
    const prompts = {
        select: async config => {
            if (config.message.includes('database')) {
                choices = config.choices.map(c => c.value)
                return 'postgres'
            }
            return 'none'
        }
    }
    const result = await nestjs.ask({ projectDir: '/p', prompts, registry })
    assert.deepEqual(choices, ['postgres', 'none'])
    assert.deepEqual(result, { database: { id: 'postgres', projectDir: '/p' }, auth: false, oidc: null })
})

// ---------------------------------------------------------------- generated code with a database

test('buildFiles without a database is the plain set of files', () => {
    assert.equal(buildFiles(null), files)
    assert.ok(!('src/database/database.service.ts' in files))
    assert.ok(!files['src/health/health.controller.ts'].includes('DatabaseService'))
})

test('buildFiles (database) wires the database module, health check, env files and translations', () => {
    const all = buildFiles(DB)
    assert.match(all['src/app.module.ts'], /import \{ DatabaseModule \} from '\.\/database\/database\.module\.js'/)
    assert.match(all['src/app.module.ts'], /ConfigModule\.forRoot\(\{ isGlobal: true \}\),\n\s+DatabaseModule,/)
    assert.match(all['src/health/health.controller.ts'], /errors\.DATABASE_UNAVAILABLE/)
    assert.match(all['src/health/health.controller.ts'], /SERVICE_UNAVAILABLE/)
    for (const rel of ['.env', '.env.example']) {
        for (const key of ['DATABASE_HOST', 'DATABASE_PORT', 'DATABASE_USER', 'DATABASE_PASSWORD', 'DATABASE_NAME']) {
            assert.ok(all[rel].includes(key), `${rel} ${key}`)
        }
        assert.ok(all[rel].includes(`PORT=${PORT}`), 'the API settings stay in place')
    }
    assert.ok(all['.env'].includes("DATABASE_PASSWORD='secret'"))
    assert.ok(!all['.env.example'].includes('secret'), 'the password never ends up in .env.example')
    assert.ok(GITIGNORE.split('\n').includes('.env'), '.env (with the password) is not committed')
})

test('buildFiles (database) adds a translated database error to every language', () => {
    const all = buildFiles(DB)
    const texts = new Set()
    for (const locale of LOCALES) {
        const errors = JSON.parse(all[`src/i18n/${locale}/errors.json`])
        assert.ok(errors.DATABASE_UNAVAILABLE?.trim(), locale)
        assert.deepEqual(Object.keys(errors).sort(), Object.keys(JSON.parse(all['src/i18n/en/errors.json'])).sort())
        for (const key of Object.keys(TRANSLATIONS[locale].errors)) assert.ok(key in errors, `${locale} ${key}`)
        texts.add(errors.DATABASE_UNAVAILABLE)
    }
    assert.equal(texts.size, 4, 'four different translations')
})

test('buildFiles (database) tests the health check with a fake database in all four languages', () => {
    const e2e = buildFiles(DB)['test/app.e2e-spec.ts']
    assert.match(e2e, /overrideProvider\(DatabaseService\)/)
    assert.match(e2e, /database: 'up'/)
    assert.match(e2e, /\.expect\(503\)/)
    for (const locale of LOCALES) {
        assert.ok(
            e2e.includes(JSON.parse(buildFiles(DB)[`src/i18n/${locale}/errors.json`]).DATABASE_UNAVAILABLE),
            locale
        )
    }
})

test('the database code is ESM-safe (.js imports) and has its own unit test', () => {
    const all = buildFiles(DB)
    for (const rel of Object.keys(all).filter(
        r => r.startsWith('src/database/') || r === 'src/health/health.controller.ts'
    )) {
        for (const [, spec] of all[rel].matchAll(/from '(\.[^']*)'/g))
            assert.ok(spec.endsWith('.js'), `${rel}: ${spec}`)
    }
    assert.ok('src/database/database.service.spec.ts' in all)
    assert.ok(!all['src/database/database.service.ts'].includes('__dirname'))
})

// ---------------------------------------------------------------- install flow with a database

test('steps (database) install the driver right after the other packages, before Prettier', async t => {
    const projectDir = await tmp(t)
    const steps = await nestjs.steps({ projectDir, answers: { database: { ...DB } }, exec: fakeExec() })
    const names = titles(steps)
    assert.ok(names.includes('Database-driver installeren (PostgreSQL)'))
    assert.ok(names.indexOf('Database-driver installeren (PostgreSQL)') < names.indexOf('i18n en API configureren'))
})

test('steps (database) install pg and its types locally and write scripts, compose and env files', async t => {
    const projectDir = await tmp(t)
    const calls = []
    await runAll(await nestjs.steps({ projectDir, answers: { database: { ...DB } }, exec: fakeExec(calls) }))
    const lines = calls.map(c => c.line)
    assert.ok(lines.includes('npm install pg@latest'))
    assert.ok(lines.includes('npm install --save-dev @types/pg@latest'))
    const root = path.join(projectDir, 'backend')
    for (const c of calls.filter(c => c.line.startsWith('npm install pg') || c.line.includes('@types/pg')))
        assert.equal(c.cwd, root)
    assert.ok(await exists(path.join(root, 'docker-compose.yml')))
    assert.ok(await exists(path.join(root, 'src/database/database.service.ts')))
    assert.ok(await exists(path.join(root, 'scripts/db-check.mjs')))
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
    for (const script of ['db:check', 'db:up', 'db:down']) assert.ok(pkg.scripts[script], script)
    assert.equal(pkg.scripts.test, 'vitest run', 'existing scripts are kept')
    assert.match(await fs.readFile(path.join(root, '.env'), 'utf8'), /DATABASE_PORT=5433/)
})

test('steps (no database) install no driver and write no database files', async t => {
    const projectDir = await tmp(t)
    const calls = []
    const steps = await nestjs.steps({ projectDir, answers: { database: null }, exec: fakeExec(calls) })
    await runAll(steps)
    assert.ok(!titles(steps).some(name => name.startsWith('Database')))
    assert.ok(!calls.some(c => c.line.includes(' pg@')))
    assert.ok(!(await exists(path.join(projectDir, 'backend/docker-compose.yml'))))
    assert.ok(!(await exists(path.join(projectDir, 'backend/src/database'))))
})

test('steps (local database) test the connection last and report success', async t => {
    const projectDir = await tmp(t)
    const database = { ...DB, mode: 'local' }
    const calls = []
    const steps = await nestjs.steps({ projectDir, answers: { database }, exec: fakeExec(calls) })
    assert.equal(titles(steps).at(-1), 'Databaseverbinding testen')
    await runAll(steps)
    assert.equal(calls.at(-1).line, 'npm run db:check')
    assert.equal(database.connection, 'ok')
    assert.deepEqual(nestjs.summary({ database }), [
        { ok: true, text: 'Verbonden met PostgreSQL op localhost:5433/demo' }
    ])
    assert.ok(
        !(await exists(path.join(projectDir, 'backend/docker-compose.yml'))),
        'no compose file for a local database'
    )
})

test('steps (local database) survive an unreachable database and report it at the end', async t => {
    const projectDir = await tmp(t)
    const database = { ...DB, mode: 'local' }
    const base = fakeExec()
    const exec = async (cmd, args, options) => {
        if (args.join(' ') === 'run db:check') throw new Error('ECONNREFUSED')
        return base(cmd, args, options)
    }
    await runAll(await nestjs.steps({ projectDir, answers: { database }, exec }))
    assert.equal(database.connection, 'failed')
    const [line] = nestjs.summary({ database })
    assert.equal(line.ok, false)
    assert.match(line.text, /db:check/)
})

test('steps (docker database) do not try to connect and explain how to start it', async t => {
    const projectDir = await tmp(t)
    const database = { ...DB }
    const steps = await nestjs.steps({ projectDir, answers: { database }, exec: fakeExec() })
    assert.ok(!titles(steps).includes('Databaseverbinding testen'))
    assert.ok(nestjs.next({ database }).some(line => line.includes('npm run db:up')))
    assert.equal(nestjs.summary({ database })[0].ok, true)
})

test('next steps for a local database mention the connection test, not Docker', () => {
    const next = nestjs.next({ database: { ...DB, mode: 'local' } })
    assert.ok(next.some(line => line.includes('npm run db:check')))
    assert.ok(!next.some(line => line.includes('db:up')))
})

test('only unexpected errors are logged as crashes, deliberate HttpExceptions are not', () => {
    const filter = files['src/common/all-exceptions.filter.ts']
    assert.match(filter, /if \(!\(exception instanceof HttpException\) && !refused\)\s+this\.logger\.error/)
})

test('a body the parser refuses (too large, not JSON) is answered with its 4xx status and never logged as a crash', () => {
    const all = files['src/common/all-exceptions.filter.ts']
    assert.match(all, /413: 'errors\.PAYLOAD_TOO_LARGE'/)
    assert.match(all, /function parserStatus\(error: unknown\)/)
    assert.match(all, /!\(exception instanceof HttpException\) && !refused/)
    for (const locale of LOCALES) assert.ok(TRANSLATIONS[locale].errors.PAYLOAD_TOO_LARGE, locale)
})

test('the validation texts cover the usual class-validator decorators in every language', () => {
    const keys = [
        'IS_IN',
        'IS_OBJECT',
        'IS_INT',
        'IS_NUMBER',
        'MIN',
        'MAX',
        'MATCHES',
        'IS_BOOLEAN',
        'IS_UUID',
        'IS_DATE',
        'IS_ARRAY',
        'ARRAY_MAX_SIZE',
        'MAX_LENGTH'
    ]
    for (const locale of LOCALES) {
        const validation = JSON.parse(files[`src/i18n/${locale}/validation.json`])
        for (const key of keys) assert.ok(validation[key]?.includes('{property}'), `${locale} ${key}`)
    }
    for (const key of keys) assert.equal(new Set(LOCALES.map(l => TRANSLATIONS[l].validation[key])).size, 4, key)
})
