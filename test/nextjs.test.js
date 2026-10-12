import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
    nextjs,
    MESSAGES,
    LOCALES,
    DEFAULT_LOCALE,
    UI_BRANCH,
    UI_REPO,
    PRETTIERRC,
    PRETTIERIGNORE,
    files,
    uiFiles,
    UI_GLOBALS_CSS,
    API_MESSAGES,
    apiFiles,
    withApi,
    patchNextConfig,
    patchGlobalsCss,
    write
} from '../src/frontends/nextjs.js'

async function tmp(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-next-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    return dir
}

const exists = file =>
    fs.stat(file).then(
        () => true,
        () => false
    )

const NEXT_CONFIG = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"] } } },
};

export default nextConfig;
`

const GLOBALS_CSS = `@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #171717;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    --foreground: #ededed;
  }
}

body {
  background: var(--background);
}
`

// ---------------------------------------------------------------- translations

const keysOf = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) => (typeof v === 'object' ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`]))

test('translations exist for exactly nl, fr, en and de', () => {
    assert.deepEqual([...LOCALES].sort(), ['de', 'en', 'fr', 'nl'])
    assert.deepEqual(Object.keys(MESSAGES).sort(), ['de', 'en', 'fr', 'nl'])
})

test('English is the default language', () => {
    assert.equal(DEFAULT_LOCALE, 'en')
})

test('every language has exactly the same translation keys', () => {
    const reference = keysOf(MESSAGES.en).sort()
    for (const locale of LOCALES) assert.deepEqual(keysOf(MESSAGES[locale]).sort(), reference, locale)
})

test('every translation is a non-empty string', () => {
    for (const locale of LOCALES) {
        for (const key of keysOf(MESSAGES[locale])) {
            const value = key.split('.').reduce((o, k) => o[k], MESSAGES[locale])
            assert.equal(typeof value, 'string', `${locale}.${key}`)
            assert.ok(value.trim().length > 0, `${locale}.${key}`)
        }
    }
})

test('the settings dropdowns are translated (language, theme, light, dark, system)', () => {
    for (const locale of LOCALES) {
        for (const key of ['language', 'theme', 'light', 'dark', 'system']) {
            assert.ok(MESSAGES[locale].Settings[key], `${locale}.Settings.${key}`)
        }
    }
})

test('the example page text is translated, including the stack cards', () => {
    for (const locale of LOCALES) {
        for (const key of [
            'title',
            'description',
            'start',
            'docs',
            'stackNext',
            'stackTailwind',
            'stackIntl',
            'stackIcons'
        ]) {
            assert.ok(MESSAGES[locale].HomePage[key], `${locale}.HomePage.${key}`)
        }
    }
})

test('the messages files are generated from MESSAGES for all four languages', () => {
    for (const locale of LOCALES) {
        const file = files[`messages/${locale}.json`]
        assert.ok(file, `messages/${locale}.json`)
        assert.deepEqual(JSON.parse(file), MESSAGES[locale])
    }
})

// ---------------------------------------------------------------- generated files

test('routing has no locale prefix in the URL and English as default', () => {
    const routing = files['src/i18n/routing.ts']
    assert.match(routing, /localePrefix: 'never'/)
    assert.match(routing, /defaultLocale: 'en'/)
    for (const locale of LOCALES) assert.ok(routing.includes(`"${locale}"`), locale)
})

test('next 16 proxy.ts is generated instead of middleware.ts', () => {
    assert.ok(files['src/proxy.ts'])
    assert.equal(files['src/middleware.ts'], undefined)
    assert.equal(files['middleware.ts'], undefined)
})

test('the plain variant has locale + theme switchers that do not depend on DafkeDD UI', () => {
    for (const key of [
        'src/components/theme-switcher.tsx',
        'src/components/locale-switcher.tsx',
        'src/components/theme-script.tsx'
    ]) {
        assert.ok(files[key], key)
        assert.ok(!files[key].includes('@/components/ui'), key)
    }
    assert.match(files['src/components/theme-switcher.tsx'], /light/)
    assert.match(files['src/components/theme-switcher.tsx'], /dark/)
    assert.match(files['src/components/theme-switcher.tsx'], /system/)
})

test('the theme is applied through data-theme and survives a language change', () => {
    assert.match(files['src/components/theme-script.tsx'], /data-theme/)
    assert.match(files['src/components/theme-script.tsx'], /MutationObserver/)
    assert.match(uiFiles['src/components/theme-script.tsx'], /MutationObserver/)
    assert.match(uiFiles['src/components/theme-script.tsx'], /lui-theme/)
})

test('the theme script is injected via useServerInsertedHTML (no React script-tag warning)', () => {
    assert.match(files['src/components/theme-script.tsx'], /useServerInsertedHTML/)
    assert.match(uiFiles['src/components/theme-script.tsx'], /useServerInsertedHTML/)
})

test('the DafkeDD UI variant uses UI components, react-icons and the floating settings pill', () => {
    const page = uiFiles['src/app/[locale]/page.tsx']
    assert.match(page, /@\/components\/ui/)
    assert.match(page, /react-icons\/lu/)
    const layout = uiFiles['src/app/[locale]/layout.tsx']
    assert.match(layout, /ThemeProvider/)
    assert.match(layout, /fixed bottom-6/)
    assert.match(layout, /<LocaleSwitcher \/>/)
    assert.match(layout, /<ThemeSwitcher \/>/)
})

test('the UI globals.css loads Tailwind, the UI styles and the data-theme dark variant', () => {
    assert.match(UI_GLOBALS_CSS, /@import 'tailwindcss'/)
    assert.match(UI_GLOBALS_CSS, /components\/ui\/ui\.css/)
    assert.match(UI_GLOBALS_CSS, /@custom-variant dark/)
})

test('DafkeDD UI is fetched from the developer branch', () => {
    assert.equal(UI_BRANCH, 'developer')
    assert.match(UI_REPO, /DafkeDD\/DafkeDD_UI/)
})

test('.prettierrc contains the agreed settings and is valid JSON', () => {
    const rc = JSON.parse(PRETTIERRC)
    assert.equal(rc.arrowParens, 'avoid')
    assert.equal(rc.singleQuote, true)
    assert.equal(rc.jsxSingleQuote, true)
    assert.equal(rc.tabWidth, 4)
    assert.equal(rc.trailingComma, 'none')
    assert.equal(rc.semi, false)
    assert.equal(rc.proseWrap, 'always')
    assert.equal(rc.printWidth, 120)
    assert.deepEqual(rc.plugins, ['prettier-plugin-tailwindcss'])
})

test('.prettierignore skips generated files that tools rewrite', () => {
    for (const entry of ['node_modules', '.next', 'AGENTS.md', 'next-env.d.ts', 'src/components/ui']) {
        assert.ok(PRETTIERIGNORE.split('\n').includes(entry), entry)
    }
})

// ---------------------------------------------------------------- patches

test('patchNextConfig wraps the config with the next-intl plugin and keeps the Tailwind rule', async t => {
    const root = await tmp(t)
    await fs.writeFile(path.join(root, 'next.config.ts'), NEXT_CONFIG)
    await patchNextConfig(root)
    const out = await fs.readFile(path.join(root, 'next.config.ts'), 'utf8')
    assert.match(out, /import createNextIntlPlugin from 'next-intl\/plugin'/)
    assert.match(out, /const withNextIntl = createNextIntlPlugin\(\)/)
    assert.match(out, /export default withNextIntl\(nextConfig\)/)
    assert.match(out, /@tailwindcss\/turbopack/)
})

test('patchNextConfig is idempotent', async t => {
    const root = await tmp(t)
    await fs.writeFile(path.join(root, 'next.config.ts'), NEXT_CONFIG)
    await patchNextConfig(root)
    const once = await fs.readFile(path.join(root, 'next.config.ts'), 'utf8')
    await patchNextConfig(root)
    assert.equal(await fs.readFile(path.join(root, 'next.config.ts'), 'utf8'), once)
})

test('patchNextConfig fails loudly when next.config.ts has an unexpected shape', async t => {
    const root = await tmp(t)
    await fs.writeFile(path.join(root, 'next.config.ts'), 'module.exports = {}\n')
    await assert.rejects(patchNextConfig(root), /next\.config\.ts/)
})

test('patchGlobalsCss adds the data-theme dark variant and replaces the media query', async t => {
    const root = await tmp(t)
    await write(root, 'src/app/globals.css', GLOBALS_CSS)
    await patchGlobalsCss(root)
    const out = await fs.readFile(path.join(root, 'src/app/globals.css'), 'utf8')
    assert.match(out, /@custom-variant dark/)
    assert.match(out, /\[data-theme='dark'\] \{/)
    assert.ok(!out.includes('prefers-color-scheme'))
    assert.match(out, /--background: #0a0a0a/)
})

test('patchGlobalsCss adds default dark colors when the template has no media query', async t => {
    const root = await tmp(t)
    await write(root, 'src/app/globals.css', '@import "tailwindcss";\n')
    await patchGlobalsCss(root)
    const out = await fs.readFile(path.join(root, 'src/app/globals.css'), 'utf8')
    assert.match(out, /\[data-theme='dark'\]/)
    assert.match(out, /--foreground: #ededed/)
})

test('patchGlobalsCss is idempotent', async t => {
    const root = await tmp(t)
    await write(root, 'src/app/globals.css', GLOBALS_CSS)
    await patchGlobalsCss(root)
    const once = await fs.readFile(path.join(root, 'src/app/globals.css'), 'utf8')
    await patchGlobalsCss(root)
    assert.equal(await fs.readFile(path.join(root, 'src/app/globals.css'), 'utf8'), once)
})

test('write creates missing folders', async t => {
    const root = await tmp(t)
    await write(root, 'a/b/c.txt', 'hi')
    assert.equal(await fs.readFile(path.join(root, 'a/b/c.txt'), 'utf8'), 'hi')
})

// ---------------------------------------------------------------- the frontend definition

test('the Next.js frontend definition is complete', () => {
    assert.equal(nextjs.id, 'nextjs')
    assert.equal(nextjs.label, 'Next.js')
    assert.equal(nextjs.dir, 'frontend')
    assert.deepEqual(nextjs.next, ['cd frontend', 'npm run dev'])
    assert.match(nextjs.description, /react-icons/)
    assert.match(nextjs.description, /Prettier/)
})

test('ask offers all components, init only, or no DafkeDD UI', async () => {
    let config
    const answer = await nextjs.ask({
        prompts: {
            select: async c => {
                config = c
                return 'all'
            }
        }
    })
    assert.deepEqual(answer, { ui: 'all' })
    assert.deepEqual(
        config.choices.map(c => c.value),
        ['all', 'init', 'none']
    )
})

// ---------------------------------------------------------------- the install flow (fake exec, no network)

/** Fake `exec` that simulates what create-next-app, git clone and the dafke-ui CLI do on disk. */
function fakeExec(calls = [], { failClone = false } = {}) {
    const exec = async (cmd, args, { cwd } = {}) => {
        calls.push({ line: [cmd, ...args].join(' '), cwd })
        if (cmd === 'npx' && args.includes('create-next-app@latest')) {
            const dir = path.join(cwd, 'frontend')
            await write(dir, 'package.json', JSON.stringify({ name: 'frontend', scripts: { dev: 'next dev' } }))
            await write(dir, 'next.config.ts', NEXT_CONFIG)
            await write(dir, 'src/app/globals.css', GLOBALS_CSS)
            await write(dir, 'src/app/page.tsx', 'export default function Page() { return null }')
            await write(dir, 'src/app/layout.tsx', 'export default function Layout() { return null }')
        }
        if (cmd === 'git' && args[0] === 'clone') {
            if (failClone) throw new Error('clone failed')
            await write(args.at(-1), 'packages/cli/bin/dafke-ui.mjs', '// stub')
        }
        return ''
    }
    return exec
}

const titles = steps => steps.map(s => s.title)

async function runAll(steps) {
    for (const step of steps) await step.run()
}

test('steps (no UI) install, configure and check in the right order', async t => {
    const projectDir = await tmp(t)
    const steps = await nextjs.steps({ projectDir, answers: { ui: 'none' }, exec: fakeExec() })
    assert.deepEqual(titles(steps), [
        'Next.js + Tailwind CSS aanmaken',
        'Dependencies installeren',
        'next-intl installeren',
        'react-icons installeren',
        'Prettier installeren',
        'next-intl configureren',
        'Prettier configureren',
        'Project controleren (build)'
    ])
    assert.ok(steps.every(s => s.weight > 0))
})

test('steps (no UI) install the latest versions of all packages in ./frontend', async t => {
    const projectDir = await tmp(t)
    const calls = []
    await runAll(await nextjs.steps({ projectDir, answers: { ui: 'none' }, exec: fakeExec(calls) }))
    const lines = calls.map(c => c.line)
    assert.ok(lines.some(l => l.startsWith('npx --yes create-next-app@latest frontend')))
    assert.ok(lines.includes('npm install next-intl@latest'))
    assert.ok(lines.includes('npm install react-icons@latest'))
    assert.ok(lines.includes('npm install --save-dev prettier@latest prettier-plugin-tailwindcss@latest'))
    assert.ok(lines.includes('npx --no-install prettier --write .'))
    assert.ok(lines.includes('npm run build'))
    // everything after create-next-app runs inside ./frontend, never globally
    const frontend = path.join(projectDir, 'frontend')
    for (const c of calls.filter(c => c.line.startsWith('npm '))) assert.equal(c.cwd, frontend, c.line)
    assert.ok(!lines.some(l => /\s(-g|--global)(\s|$)/.test(l)))
})

test('steps (no UI) write the i18n files, four message files, Prettier config and patches', async t => {
    const projectDir = await tmp(t)
    await runAll(await nextjs.steps({ projectDir, answers: { ui: 'none' }, exec: fakeExec() }))
    const root = path.join(projectDir, 'frontend')
    for (const rel of [
        'src/i18n/routing.ts',
        'src/i18n/navigation.ts',
        'src/i18n/request.ts',
        'src/proxy.ts',
        '.prettierrc',
        '.prettierignore'
    ]) {
        assert.ok(await exists(path.join(root, rel)), rel)
    }
    for (const locale of LOCALES) assert.ok(await exists(path.join(root, `messages/${locale}.json`)), locale)
    assert.ok(await exists(path.join(root, 'src/app/[locale]/page.tsx')))
    assert.ok(!(await exists(path.join(root, 'src/app/page.tsx'))), 'default page is removed')
    assert.ok(!(await exists(path.join(root, 'src/app/layout.tsx'))), 'default layout is removed')
    assert.match(await fs.readFile(path.join(root, 'next.config.ts'), 'utf8'), /withNextIntl\(nextConfig\)/)
    assert.match(await fs.readFile(path.join(root, 'src/app/globals.css'), 'utf8'), /data-theme/)
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
    assert.equal(pkg.scripts.format, 'prettier --write .')
    assert.equal(pkg.scripts['format:check'], 'prettier --check .')
    assert.equal(pkg.scripts.dev, 'next dev', 'existing scripts are kept')
    assert.ok(!(await exists(path.join(root, 'dafke-ui.json'))), 'no DafkeDD UI when not requested')
})

test('steps (UI: all) fetch DafkeDD UI from developer and install every component', async t => {
    const projectDir = await tmp(t)
    const calls = []
    const steps = await nextjs.steps({ projectDir, answers: { ui: 'all' }, exec: fakeExec(calls) })
    assert.ok(titles(steps).includes('DafkeDD UI ophalen'))
    assert.ok(titles(steps).includes('DafkeDD UI installeren'))
    await runAll(steps)
    const lines = calls.map(c => c.line)
    const clone = lines.find(l => l.startsWith('git clone'))
    assert.ok(clone.includes('--branch developer'), clone)
    assert.ok(clone.includes(UI_REPO), clone)
    assert.ok(lines.some(l => /dafke-ui\.mjs init --yes$/.test(l)))
    assert.ok(lines.some(l => /dafke-ui\.mjs add --all$/.test(l)))
    const root = path.join(projectDir, 'frontend')
    assert.ok(await exists(path.join(root, 'dafke-ui.json')))
    assert.equal(await fs.readFile(path.join(root, 'src/app/globals.css'), 'utf8'), UI_GLOBALS_CSS)
    assert.match(await fs.readFile(path.join(root, 'src/app/[locale]/page.tsx'), 'utf8'), /@\/components\/ui/)
})

test('steps (UI: all) remove the temporary clone afterwards', async t => {
    const projectDir = await tmp(t)
    const calls = []
    await runAll(await nextjs.steps({ projectDir, answers: { ui: 'all' }, exec: fakeExec(calls) }))
    const cloneDir = calls
        .find(c => c.line.startsWith('git clone'))
        .line.split(' ')
        .at(-1)
    assert.ok(!(await exists(cloneDir)))
})

test('steps (UI: init) do not add components and still load the UI stylesheet', async t => {
    const projectDir = await tmp(t)
    const calls = []
    await runAll(await nextjs.steps({ projectDir, answers: { ui: 'init' }, exec: fakeExec(calls) }))
    const lines = calls.map(c => c.line)
    assert.ok(lines.some(l => /dafke-ui\.mjs init --yes$/.test(l)))
    assert.ok(!lines.some(l => l.includes(' add --all')))
    const css = await fs.readFile(path.join(projectDir, 'frontend/src/app/globals.css'), 'utf8')
    assert.match(css, /@import "\.\.\/components\/ui\/ui\.css";/)
})

test('steps clean up the temporary clone and rethrow when cloning fails', async t => {
    const projectDir = await tmp(t)
    const calls = []
    const steps = await nextjs.steps({ projectDir, answers: { ui: 'all' }, exec: fakeExec(calls, { failClone: true }) })
    const fetchStep = steps.find(s => s.title === 'DafkeDD UI ophalen')
    await assert.rejects(fetchStep.run(), /clone failed/)
    const cloneDir = calls
        .find(c => c.line.startsWith('git clone'))
        .line.split(' ')
        .at(-1)
    assert.ok(!(await exists(cloneDir)))
})

test('steps refuse to run when ./frontend already exists and delete nothing', async t => {
    const projectDir = await tmp(t)
    await write(projectDir, 'frontend/keep.txt', 'mine')
    await assert.rejects(nextjs.steps({ projectDir, answers: { ui: 'none' }, exec: fakeExec() }), /bestaat al/)
    assert.equal(await fs.readFile(path.join(projectDir, 'frontend/keep.txt'), 'utf8'), 'mine')
})

test('globals.css loads the DafkeDD UI stylesheet exactly once (regression: duplicate import)', async t => {
    for (const ui of ['all', 'init']) {
        const projectDir = await tmp(t)
        await runAll(await nextjs.steps({ projectDir, answers: { ui }, exec: fakeExec() }))
        const css = await fs.readFile(path.join(projectDir, 'frontend/src/app/globals.css'), 'utf8')
        assert.equal(css.match(/components\/ui\/ui\.css/g).length, 1, ui)
    }
})

// ---------------------------------------------------------------- backend connection

const API = { port: 4000 }

test('the API status texts exist in nl, fr, en and de with the same keys', () => {
    assert.deepEqual(Object.keys(API_MESSAGES).sort(), ['de', 'en', 'fr', 'nl'])
    for (const locale of LOCALES) {
        assert.deepEqual(Object.keys(API_MESSAGES[locale]).sort(), Object.keys(API_MESSAGES.en).sort(), locale)
        for (const [key, value] of Object.entries(API_MESSAGES[locale])) assert.ok(value.trim(), `${locale}.${key}`)
    }
})

test('the API client sends the selected language and uses the port of the backend', () => {
    const api = apiFiles({ port: 4321 })['src/lib/api.ts']
    assert.match(api, /Accept-Language/)
    assert.match(api, /localhost:4321/)
    assert.match(api, /NEXT_PUBLIC_API_URL/)
    assert.match(api, /class ApiError/)
    const hook = apiFiles(API)['src/lib/use-api.ts']
    assert.match(hook, /^'use client'/)
    assert.match(hook, /useLocale/)
    assert.match(hook, /from '\.\/api'/, 'bundler imports have no .js extension')
})

test('the status card shows the API message and language, the database state and translated server errors', () => {
    const card = apiFiles(API)['src/components/api-status.tsx']
    assert.match(card, /^'use client'/)
    assert.match(card, /useApi\(\)/)
    assert.match(card, /'\/health'/)
    assert.match(card, /status === 503/, 'a 503 means the database is down')
    assert.match(card, /error\.message/, 'the server message is already in the selected language')
    for (const key of Object.keys(API_MESSAGES.en)) {
        if (key !== 'hint' || card.includes("t('hint')")) assert.ok(card.includes(`t('${key}')`), key)
    }
})

test('withApi adds the files, the card on the page and the texts in four languages (plain variant)', () => {
    const result = withApi(files, API, { ui: false })
    for (const rel of ['src/lib/api.ts', 'src/lib/use-api.ts', 'src/components/api-status.tsx'])
        assert.ok(rel in result, rel)
    const page = result['src/app/[locale]/page.tsx']
    assert.match(page, /import \{ ApiStatus \} from '@\/components\/api-status'/)
    assert.match(page, /<ApiStatus \/>/)
    for (const locale of LOCALES) {
        const messages = JSON.parse(result[`messages/${locale}.json`])
        assert.deepEqual(messages.ApiStatus, API_MESSAGES[locale])
        assert.deepEqual(messages.HomePage, MESSAGES[locale].HomePage, 'existing texts are kept')
    }
})

test('withApi adds the card to the DafkeDD UI page as well', () => {
    const result = withApi({ ...files, ...uiFiles }, API, { ui: true })
    const page = result['src/app/[locale]/page.tsx']
    assert.equal(page.match(/<ApiStatus \/>/g).length, 1)
    assert.match(page, /import \{ ApiStatus \}/)
})

test('withApi does not change the original files', () => {
    const before = files['src/app/[locale]/page.tsx']
    withApi(files, API, { ui: false })
    assert.equal(files['src/app/[locale]/page.tsx'], before)
    assert.ok(!before.includes('ApiStatus'))
})

test('withApi fails loudly when a page template changes', () => {
    assert.throws(
        () => withApi({ ...files, 'src/app/[locale]/page.tsx': 'nothing here' }, API, { ui: false }),
        /Template changed/
    )
})

test('steps (with a backend) write the API client, the status card and extra texts', async t => {
    const projectDir = await tmp(t)
    const exec = async (cmd, args, { cwd } = {}) => {
        if (cmd === 'npx' && args.includes('create-next-app@latest')) {
            const root = path.join(cwd, 'frontend')
            await write(root, 'package.json', JSON.stringify({ name: 'frontend', scripts: {} }))
            await write(root, 'next.config.ts', NEXT_CONFIG)
            await write(root, 'src/app/globals.css', GLOBALS_CSS)
            await write(root, 'src/app/page.tsx', '// starter')
            await write(root, 'src/app/layout.tsx', '// starter')
        }
        return ''
    }
    for (const step of await nextjs.steps({ projectDir, answers: { ui: 'none' }, api: API, exec })) await step.run()
    const root = path.join(projectDir, 'frontend')
    assert.match(await fs.readFile(path.join(root, 'src/lib/api.ts'), 'utf8'), /Accept-Language/)
    assert.match(await fs.readFile(path.join(root, 'src/app/[locale]/page.tsx'), 'utf8'), /<ApiStatus \/>/)
    const nl = JSON.parse(await fs.readFile(path.join(root, 'messages/nl.json'), 'utf8'))
    assert.equal(nl.ApiStatus.online, 'Verbonden')
})

test('steps (without a backend) leave the frontend free of API code', async t => {
    const projectDir = await tmp(t)
    const exec = async (cmd, args, { cwd } = {}) => {
        if (cmd === 'npx' && args.includes('create-next-app@latest')) {
            const root = path.join(cwd, 'frontend')
            await write(root, 'package.json', JSON.stringify({ name: 'frontend', scripts: {} }))
            await write(root, 'next.config.ts', NEXT_CONFIG)
            await write(root, 'src/app/globals.css', GLOBALS_CSS)
        }
        return ''
    }
    for (const step of await nextjs.steps({ projectDir, answers: { ui: 'none' }, api: null, exec })) await step.run()
    const root = path.join(projectDir, 'frontend')
    assert.ok(!(await exists(path.join(root, 'src/lib/api.ts'))))
    assert.ok(!(await exists(path.join(root, 'src/components/api-status.tsx'))))
    assert.ok(!('ApiStatus' in JSON.parse(await fs.readFile(path.join(root, 'messages/en.json'), 'utf8'))))
})
