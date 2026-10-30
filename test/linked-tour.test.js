import test from 'node:test'
import assert from 'node:assert/strict'
import { files, uiFiles, withApi, LOCALES } from '../src/frontends/nextjs.js'
import { APP_TOUR_MESSAGES, designFiles, oidcFrontendFiles } from '../src/frontends/oidc.js'
import { projectClaudeMd, describeProject } from '../src/claude.js'

const linked = oidcFrontendFiles({ linked: true, appName: 'Planner' })
const portal = oidcFrontendFiles({ apiPort: 4000 })

/** Every key of a nested object, as a.b.c. */
const keys = (object, prefix = '') =>
    Object.entries(object).flatMap(([key, value]) =>
        value && typeof value === 'object' ? keys(value, prefix + key + '.') : [prefix + key]
    )

test('a linked app has the first-login tour, with a step for every page of APP_NAV', () => {
    const tour = linked['src/components/pasport/app-tour.tsx']
    assert.ok(tour, 'app-tour.tsx in a linked app')
    // The steps come from APP_NAV: a new page is a new step by itself
    assert.match(tour, /import \{ APP_NAV \} from '@\/lib\/nav'/)
    assert.match(tour, /APP_NAV\.map\(item => \(\{/)
    assert.match(tour, /targets: \['\.page-head'\]/)
    // A page without a text of its own still gets its step (an older app after update)
    assert.match(tour, /t\.has\(`pages\.\$\{item\.label\}`\)/)
    assert.match(tour, /t\('pageText', \{ page: nav\(item\.label\) \}\)/)
    // The notifications, the account menu, the welcome and the end
    for (const id of ['welcome', 'bell', 'account', 'done']) assert.match(tour, new RegExp(`id: '${id}'`), id)
    assert.match(tour, /targets: \['\.notif-wrap'\]/)
    assert.match(tour, /targets: \['\.tb-user-wrap'\]/)
    // Remembered per account (its opaque id), in the browser
    assert.match(tour, /storageKey=\{'app-tour:' \+ account\}/)
    // Never the email address in the browser's storage
    assert.ok(!/email/.test(tour.replace(/never its email address/, '')), 'no email in app-tour.tsx')
    assert.match(tour, /<GuidedTour/)
})

test('the shell of a linked app shows the tour and its menu item, never for a superadmin', () => {
    const shell = linked['src/components/shell/shell-view.tsx']
    // The account is the opaque id of the session, never its email address
    const appShell = linked['src/components/shell/app-shell.tsx']
    assert.match(appShell, /account: session\.sub,/)
    assert.ok(!/account: session\.email/.test(appShell), 'account is not the email')
    assert.match(shell, /import \{ AppTour \} from '@\/components\/pasport\/app-tour'/)
    assert.match(shell, /\{!user\.superadmin && !admin && <AppTour account=\{user\.account\} name=\{user\.name\} \/>\}/)
    assert.match(
        shell,
        /\.\.\.\(user\.superadmin \|\| admin \? \[\] : \[\{ key: 'tour', name: tour\('menu'\), icon: 'compass', onClick: openTour \}\]\)/
    )
})

test('the customer portal keeps its tour, on the same GuidedTour, remembered as before', () => {
    const tour = portal['src/components/pasport/tour.tsx']
    assert.match(tour, /export function GuidedTour\(/)
    assert.match(tour, /export function Tour\(\{ email, name, admin \}/)
    // Users who saw the tour do not get it again after the update
    assert.match(tour, /storageKey=\{'pp-tour:' \+ email\.toLowerCase\(\)\}/)
    // A page that renders its own shell (AppPage of a linked app) mounts the tour again after a step to another page,
    // and Next.js shows an earlier page (with its old tour) again on the way back: where the open tour is lives outside
    // React, shared by every instance, so it goes on (and from the user menu it stays open)
    assert.match(tour, /^type Place = \{ storageKey: string; index: number; manual: boolean \}$/m)
    assert.match(tour, /^let place: Place \| null = null$/m)
    assert.match(tour, /useSyncExternalStore\(\s*subscribePlace,\s*\(\) => place,\s*\(\) => null\s*\)/)
    assert.match(tour, /const here = shared\?\.storageKey === storageKey \? shared : null/)
    assert.match(tour, /setPlace\(\{ storageKey, index: 0, manual: true \}\)/)
    assert.match(tour, /pushed = null\n\s+setPlace\(null\)/)
    // The router is a new object on every render: kept in a ref, and a page is asked for once (no loop of push)
    assert.match(tour, /const routerRef = useRef\(router\)/)
    assert.match(tour, /if \(pushed !== href\) \{\n\s+pushed = href\n\s+routerRef\.current\.push\(href\)/)
    // Arrived: a step that leaves the page (or the user going back) asks the router again
    assert.match(
        tour,
        /routerRef\.current\.push\(href\)\n\s+\}\n\s+return\n\s+\}\n\s+\/\/ Arrived[^\n]*\n\s+pushed = null/
    )
    // The effect follows the values of the step, not its object (made on every render)
    assert.match(tour, /\}, \[open, index, pathname, href, targets\]\)/)
    // A step without a spotlight sits in the middle by its margins (the pop animation sets its own transform)
    assert.match(tour, /inset: 0,\n\s+margin: 'auto',\n\s+height: 'fit-content'/)
    assert.ok(!/translate\(-50%/.test(tour), 'not centred with a transform')
    // The portal has no tour of a linked app
    assert.equal(portal['src/components/pasport/app-tour.tsx'], undefined)
})

test('the texts of the tour exist in en, nl, fr and de with the same keys, in the messages of a linked app', () => {
    const en = keys(APP_TOUR_MESSAGES.en).sort()
    assert.ok(en.includes('pages.home'))
    for (const locale of LOCALES) {
        assert.deepEqual(keys(APP_TOUR_MESSAGES[locale]).sort(), en, locale)
        for (const key of keys(APP_TOUR_MESSAGES[locale])) {
            const text = key.split('.').reduce((o, k) => o[k], APP_TOUR_MESSAGES[locale])
            assert.ok(typeof text === 'string' && text.trim(), `${locale}: ${key}`)
        }
    }
    // Real translations, not the English copied
    for (const locale of ['nl', 'fr', 'de'])
        for (const key of ['welcomeText', 'bellText', 'accountText', 'doneText', 'pageText'])
            assert.notEqual(APP_TOUR_MESSAGES[locale][key], APP_TOUR_MESSAGES.en[key], `${locale}: ${key}`)
    const all = withApi({ ...files, ...uiFiles }, { oidc: true, port: 4000, linked: { name: 'Planner' } }, { ui: true })
    const nav = all['src/lib/nav.ts'] ?? linked['src/lib/nav.ts']
    const labels = [...nav.matchAll(/label: '([^']+)'/g)].map(match => match[1])
    assert.deepEqual(labels, ['home'])
    for (const locale of LOCALES) {
        const messages = JSON.parse(all[`messages/${locale}.json`])
        assert.deepEqual(messages.AppTour, APP_TOUR_MESSAGES[locale], locale)
        // Every page of APP_NAV has its text in the tour
        for (const label of labels) assert.ok(messages.AppTour.pages[label], `${locale}: ${label}`)
    }
    // The login server does not get the texts of a linked app's tour
    const server = withApi({ ...files, ...uiFiles }, { oidc: true, port: 4000 }, { ui: true })
    assert.equal(JSON.parse(server['messages/en.json']).AppTour, undefined)
})

test('update brings the tour to an existing linked app (a design file)', () => {
    const design = designFiles({ linked: true })
    assert.ok(design['frontend/src/components/pasport/app-tour.tsx'])
    assert.ok(design['frontend/src/components/pasport/tour.tsx'])
    assert.equal(designFiles()['frontend/src/components/pasport/app-tour.tsx'], undefined)
})

test('CLAUDE.md of a linked app names its tour; other apps keep the known gap', () => {
    const app = describeProject({
        name: 'planner',
        frontend: { id: 'next' },
        backend: { id: 'linked' },
        answers: { link: { name: 'Planner' } }
    })
    const flat = projectClaudeMd(app).replace(/\s+/g, ' ')
    assert.match(
        flat,
        /The tour is `AppTour` in `frontend\/src\/components\/pasport\/app-tour\.tsx`: every page of `APP_NAV` is a step, with its text `AppTour\.pages\.<label>` in `frontend\/messages\/\*\.json`\./
    )
    assert.ok(!flat.includes('Known gap: this app does not have the tour yet'))
    const site = describeProject({ name: 'site', frontend: { id: 'next' } })
    assert.match(projectClaudeMd(site).replace(/\s+/g, ' '), /Known gap: this app does not have the tour yet/)
})
