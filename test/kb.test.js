import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { KB_DIR, KB_LOCALES, kbFiles, kbPage, kbPages, kbSteps } from '../src/kb.js'
import { docsIndex } from '../src/docs.js'

test('the knowledge base knows the pages the CLI generates, for each kind of project', () => {
    assert.deepEqual(
        kbPages('app').map(page => page.route),
        ['/', '/login', '/profile']
    )
    const pasport = kbPages('pasport').map(page => page.id)
    for (const id of ['login', 'register', 'profile', 'security', 'members', 'licenses', 'audit', 'admin'])
        assert.ok(pasport.includes(id), id)
    assert.deepEqual(
        kbPages(null).map(page => page.id),
        ['home']
    )
})

test('every page has a title and a purpose in the four languages, all different', () => {
    for (const kind of ['pasport', 'app', null])
        for (const page of kbPages(kind)) {
            assert.deepEqual(Object.keys(page.titles).sort(), [...KB_LOCALES].sort(), page.id)
            assert.deepEqual(Object.keys(page.purposes).sort(), [...KB_LOCALES].sort(), page.id)
            assert.equal(new Set(Object.values(page.purposes)).size, 4, `${page.id}: four translations`)
            assert.match(page.route, /^\//)
            assert.ok(['everyone', 'member', 'admin', 'superadmin'].includes(page.who), page.id)
        }
})

test('a page of the knowledge base: purpose, where and who, screenshots in light and dark, the tables to fill', () => {
    const [members] = kbPages('pasport').filter(page => page.id === 'members')
    const nl = kbPage(members, 'nl')
    assert.match(nl, /^# Gebruikers\n/)
    assert.match(nl, /\*\*Waar\*\*: `\/members` · \*\*Wie\*\*: De beheerder van de organisatie/)
    assert.match(nl, /!\[Gebruikers\]\(\.\.\/screenshots\/nl\/members-light\.png\)/)
    assert.match(nl, /!\[Gebruikers\]\(\.\.\/screenshots\/nl\/members-dark\.png\)/)
    assert.match(nl, /## Wat je hier kunt doen\n\n<!-- kb: .+ -->\n\n\| Element \| Wat het doet \| Wat je dan ziet \|/)
    assert.match(nl, /## Meldingen/)
    assert.match(kbPage(members, 'fr'), /## Ce que vous pouvez faire ici/)
    assert.match(kbPage(members, 'de'), /## Was du hier tun kannst/)
})

test('kbFiles: pages.json, an index per language, a page per page and language, a folder for the screenshots', () => {
    const files = kbFiles({ kind: 'app' })
    const pages = JSON.parse(files[`${KB_DIR}/pages.json`])
    assert.deepEqual(pages[0], {
        id: 'home',
        route: '/',
        who: 'member',
        titles: { en: 'Home', nl: 'Start', fr: 'Accueil', de: 'Start' },
        screenshots: false
    })
    for (const locale of KB_LOCALES) {
        assert.match(files[`${KB_DIR}/${locale}/README.md`], /\(profile\.md\)/)
        for (const page of pages) assert.ok(files[`${KB_DIR}/${locale}/${page.id}.md`], `${locale} ${page.id}`)
        assert.equal(files[`${KB_DIR}/screenshots/${locale}/.gitkeep`], '')
    }
    assert.match(files[`${KB_DIR}/README.md`], /`kb` agent/)
    assert.match(docsIndex([], { kb: true }), /\[kb\/README\.md\]\(kb\/README\.md\)/)
    assert.ok(!docsIndex([]).includes('kb/README.md'))
})

test('kbSteps writes the knowledge base and never overwrites a page that exists', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-kb-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    await fs.mkdir(path.join(dir, KB_DIR, 'nl'), { recursive: true })
    await fs.writeFile(path.join(dir, KB_DIR, 'nl', 'home.md'), 'Mijn eigen tekst\n')
    const [step] = kbSteps({ projectDir: dir, project: { kind: 'app' } })
    assert.match(step.title, /Kennisbank/)
    await step.run()
    assert.equal(await fs.readFile(path.join(dir, KB_DIR, 'nl', 'home.md'), 'utf8'), 'Mijn eigen tekst\n')
    assert.match(await fs.readFile(path.join(dir, KB_DIR, 'fr', 'login.md'), 'utf8'), /^# Se connecter/)
})

test('without Claude Code the README of the knowledge base says how to keep it up to date by hand', () => {
    assert.match(kbFiles({ kind: 'app' })[`${KB_DIR}/README.md`], /`kb` agent/)
    const manual = kbFiles({ kind: 'app', claude: false })[`${KB_DIR}/README.md`]
    assert.ok(!manual.includes('Claude Code'))
    assert.match(manual, /take the screenshots/)
})
