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
    frontendLinkFiles,
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

// ---------------------------------------------------------------- frontend link

test('the frontend link sends the selected language to the API', () => {
    const api = frontendLinkFiles['src/lib/api.ts']
    assert.match(api, /Accept-Language/)
    assert.match(api, /localhost:4000/)
    assert.match(api, /class ApiError/)
    const hook = frontendLinkFiles['src/lib/use-api.ts']
    assert.match(hook, /^'use client'/)
    assert.match(hook, /useLocale/)
    assert.match(hook, /from '\.\/api'/, 'frontend (bundler resolution) imports have no .js extension')
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
    assert.ok(nestjs.next.includes('cd backend'))
    assert.ok(nestjs.next.some(line => line.includes('npm run start:dev')))
    assert.ok(nestjs.next.some(line => line.includes('localhost:4000/docs')))
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

test('steps (with a frontend) add the language link before Prettier runs', async t => {
    const projectDir = await tmp(t)
    await write(projectDir, 'frontend/package.json', '{}')
    const calls = []
    const steps = await nestjs.steps({ projectDir, frontendDir: 'frontend', exec: fakeExec(calls) })
    const names = titles(steps)
    assert.ok(names.includes('Taalkoppeling met de frontend'))
    assert.ok(names.indexOf('Taalkoppeling met de frontend') < names.indexOf('Prettier configureren (backend)'))
    await runAll(steps)
    const api = await fs.readFile(path.join(projectDir, 'frontend/src/lib/api.ts'), 'utf8')
    assert.match(api, /Accept-Language/)
    assert.ok(await exists(path.join(projectDir, 'frontend/src/lib/use-api.ts')))
    const format = calls.find(c => c.line === 'npx --no-install prettier --write src/lib')
    assert.equal(format.cwd, path.join(projectDir, 'frontend'))
})

test('steps (without a frontend) do not add the language link step', async t => {
    const projectDir = await tmp(t)
    const names = titles(await nestjs.steps({ projectDir, frontendDir: null, exec: fakeExec() }))
    assert.ok(!names.includes('Taalkoppeling met de frontend'))
})

test('the language link is skipped when the frontend folder is missing', async t => {
    const projectDir = await tmp(t)
    const steps = await nestjs.steps({ projectDir, frontendDir: 'frontend', exec: fakeExec() })
    await steps.find(s => s.title === 'Taalkoppeling met de frontend').run()
    assert.ok(!(await exists(path.join(projectDir, 'frontend'))))
})

test('steps refuse to run when ./backend already exists and delete nothing', async t => {
    const projectDir = await tmp(t)
    await write(projectDir, 'backend/keep.txt', 'mine')
    await assert.rejects(nestjs.steps({ projectDir, exec: fakeExec() }), /bestaat al/)
    assert.equal(await fs.readFile(path.join(projectDir, 'backend/keep.txt'), 'utf8'), 'mine')
})
