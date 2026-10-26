import { confirm } from '@inquirer/prompts'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import pc from 'picocolors'
import { ensureGitignore, GITIGNORE_LINES } from './claude.js'
import { AUTH_SCREEN_MESSAGES, EID_GATE_MESSAGES, PASSWORD_MESSAGES } from './frontends/pasport-messages.js'
import { SHELL_MESSAGES } from './frontends/oidc.js'
import { PORTAL_MESSAGES } from './frontends/portal-messages.js'
import { kbFiles } from './kb.js'
import { cloneDafkeUi, dafkeUiCli, setupDafkeUi } from './frontends/nextjs.js'
import { isSite, SITE_STARTER_FILES, siteFrontend } from './frontends/site.js'
import { run } from './runner.js'
import { buildManifest, inferProject, managedFiles, manifestProject, MANIFEST, readManifest, sha } from './manifest.js'

/** The suffix of the new version of a file you changed yourself: the CLI never overwrites your changes. */
export const NEW_SUFFIX = '.dafkedd-new'

/**
 * What `update` does with every file the CLI manages, by comparing three versions: on disk, the hash the manifest
 * remembers (what the CLI wrote last time) and the content of this version of the CLI.
 * - `new`: not on disk (and never made before): written;
 * - `deleted`: made before, deleted by you since: left away;
 * - `same`: already the content of this version: nothing;
 * - `updated`: on disk exactly as the CLI wrote it last time: replaced;
 * - `changed`: changed by you (or no manifest to tell): the new version next to it as `<file>.dafkedd-new`;
 * - `removed`: in the manifest, no longer made by the CLI: left alone and reported.
 */
export function planUpdate({ disk, remembered = {}, wanted }) {
    const plan = []
    for (const [rel, content] of Object.entries(wanted)) {
        const current = disk[rel]
        // Made before and deleted since: by you, on purpose; it does not come back
        if (current === undefined && remembered[rel]) plan.push({ rel, action: 'deleted' })
        else if (current === undefined) plan.push({ rel, action: 'new' })
        else if (current === sha(content)) plan.push({ rel, action: 'same' })
        else if (remembered[rel] === current) plan.push({ rel, action: 'updated' })
        else plan.push({ rel, action: 'changed' })
    }
    for (const rel of Object.keys(remembered))
        if (!(rel in wanted) && disk[rel] !== undefined) plan.push({ rel, action: 'removed' })
    return plan.sort((a, b) => a.rel.localeCompare(b.rel))
}

const LABELS = {
    new: 'nieuw',
    updated: 'bijgewerkt',
    changed: `zelf aangepast: nieuwe versie in <bestand>${NEW_SUFFIX}`,
    removed: 'niet meer nodig (niet verwijderd)',
    deleted: 'door jou verwijderd (niet teruggezet; verwijder de regel uit .dafkedd.json om het terug te krijgen)'
}

/**
 * `DafkeDD_CLI update` in the folder of a project: the agents, skills, hooks, pipelines, Terraform and the Pasport design
 * of the frontend (styles, components, shell, protected routes, missing texts) of this version of the CLI, without
 * overwriting what you changed. Without a manifest (a project of an older CLI) it reads what the
 * project is made of from its folders and asks to confirm that first.
 */
export async function update({
    projectDir = process.cwd(),
    version,
    prompts = { confirm },
    log = console.log,
    exec = run,
    dafkeUi = { clone: cloneDafkeUi, setup: setupDafkeUi }
} = {}) {
    const manifest = readManifest(projectDir)
    let project = manifest?.project
    if (!project) {
        project = inferProject(projectDir)
        if (!project.frontend && !project.backend) throw new Error('Geen project van DafkeDD_CLI in deze map.')
        log(pc.dim(`Geen ${MANIFEST}: wat ik in deze map zie:`))
        log(pc.dim(`  ${describe(project)}`))
        const ok = await prompts.confirm({
            message: `Klopt dat? Bestanden die afwijken krijgen een ${NEW_SUFFIX}-versie ernaast, niets wordt overschreven`,
            default: true
        })
        if (!ok) return null
    }
    const site = isSite(project)
    const design = project.frontend && (site || project.kind === 'pasport' || project.kind === 'app')
    if (!project.claude && !project.cloud && !design) {
        log(
            pc.dim('Dit project heeft geen Claude Code, geen Google Cloud en geen Pasport-design: niets bij te werken.')
        )
    }
    const wanted = managedFiles(project)
    const disk = {}
    for (const rel of new Set([...Object.keys(wanted), ...Object.keys(manifest?.files ?? {})])) {
        const full = path.join(projectDir, rel)
        if (existsSync(full)) disk[rel] = sha(await fs.readFile(full, 'utf8'))
    }
    const plan = planUpdate({ disk, remembered: manifest?.files ?? {}, wanted })
    for (const { rel, action } of plan) {
        const target = path.join(projectDir, rel)
        if (action === 'new' || action === 'updated') {
            await fs.mkdir(path.dirname(target), { recursive: true })
            await fs.writeFile(target, wanted[rel], rel.endsWith('.sh') ? { mode: 0o755 } : undefined)
        } else if (action === 'changed') await fs.writeFile(target + NEW_SUFFIX, wanted[rel])
    }
    // The pages of the knowledge base that are missing (an existing page is never touched)
    const kbAdded = []
    if (project.frontend)
        for (const [rel, content] of Object.entries(kbFiles(project))) {
            const target = path.join(projectDir, rel)
            if (existsSync(target)) continue
            await fs.mkdir(path.dirname(target), { recursive: true })
            await fs.writeFile(target, content)
            kbAdded.push(rel)
        }
    // A frontend made before every project had the Pasport design: its starters next to what is there, DafkeDD UI,
    // the fonts and the design check
    const migration = site ? await migrateSite({ projectDir, project, exec, dafkeUi }) : null
    // The texts of the design (shell, bell, login screens, page headers) that are missing: added, yours stay
    const textsAdded = design ? await addDesignTexts(projectDir, site ? project : null) : []
    await ensureGitignore(projectDir, project.claude ? GITIGNORE_LINES : [`*${NEW_SUFFIX}`])

    // The manifest remembers what the CLI wrote; a file you changed keeps the hash of the new version, so it is
    // replaced next time only when you took that version over
    const next = await buildManifest({ projectDir, project, version })
    for (const { rel, action } of plan) {
        if (action === 'changed') next.files[rel] = sha(wanted[rel])
        // Remembered, so it stays deleted next time too
        if (action === 'deleted') next.files[rel] = manifest.files[rel]
    }
    next.project = manifestProject(project)
    await fs.writeFile(path.join(projectDir, MANIFEST), JSON.stringify(next, null, 4) + '\n')

    const shown = plan.filter(entry => entry.action !== 'same')
    log('')
    if (!shown.length && !kbAdded.length && !textsAdded.length)
        log(`${pc.green('✔')} Alles is al bij met DafkeDD_CLI v${version}.`)
    for (const { rel, action } of shown)
        log(
            `${action === 'changed' || action === 'deleted' ? pc.yellow('!') : pc.green('✔')} ${rel}: ${LABELS[action].replace('<bestand>', rel)}`
        )
    for (const line of migration?.lines ?? []) log(line)
    if (kbAdded.length) log(`${pc.green('✔')} Kennisbank: ${kbAdded.length} ontbrekende bestanden toegevoegd`)
    for (const file of textsAdded) log(`${pc.green('✔')} ${file}: ontbrekende teksten van het design toegevoegd`)
    if (design && shown.some(entry => entry.rel.startsWith('frontend/')))
        log(
            pc.dim(
                '\nHet Pasport-design is bijgewerkt: controleer met "npm run check:design" en "npm run build" in ./frontend.'
            )
        )
    if (plan.some(entry => entry.action === 'changed'))
        log(
            pc.dim(
                `\nVergelijk elk met: git diff --no-index <bestand> <bestand>${NEW_SUFFIX}\n` +
                    `Neem over wat je wil en verwijder daarna de ${NEW_SUFFIX}-bestanden.`
            )
        )
    log(pc.dim(`\nBekijk alles met "git diff" en commit het op een issue-branch (${MANIFEST} hoort erbij).\n`))
    return plan
}

/** One line: what the project is made of. */
export function describe(project) {
    return [
        project.name,
        project.frontend ? 'frontend' : null,
        project.backend ? `backend (${project.kind})` : null,
        project.database ? `database ${project.database}` : null,
        project.modules
            ? `modules: ${[project.modules.mail && 'mail', project.modules.files && 'files'].filter(Boolean).join(', ') || 'geen'}, ${project.modules.isolation}`
            : null,
        project.claude ? 'Claude Code' : null,
        project.cloud ? 'Google Cloud' : null
    ]
        .filter(Boolean)
        .join(' · ')
}

/** The namespaces of messages/*.json that the files of the Pasport design (DESIGN_FILES) use. */
export const DESIGN_MESSAGES = {
    Shell: SHELL_MESSAGES,
    AuthScreen: AUTH_SCREEN_MESSAGES,
    Password: PASSWORD_MESSAGES,
    EidGate: EID_GATE_MESSAGES,
    Portal: PORTAL_MESSAGES
}

/** Adds what `from` has and `into` misses (also nested); never changes a text that is there. Returns the added keys. */
export function addMissing(into, from, prefix = '') {
    const added = []
    for (const [key, value] of Object.entries(from)) {
        if (!(key in into)) {
            into[key] = value
            added.push(prefix + key)
        } else if (value && typeof value === 'object' && into[key] && typeof into[key] === 'object')
            added.push(...addMissing(into[key], value, prefix + key + '.'))
    }
    return added
}

/**
 * The missing texts of the design in frontend/messages/<locale>.json (4 spaces, as Prettier writes them). `site`: a
 * frontend without the OpenID Connect login, whose texts are those the CLI makes for it now.
 */
async function addDesignTexts(projectDir, site = null) {
    const added = []
    const generated = site ? siteFrontend(site) : null
    for (const locale of Object.keys(SHELL_MESSAGES)) {
        const file = path.join(projectDir, 'frontend', 'messages', `${locale}.json`)
        if (!existsSync(file)) continue
        const messages = JSON.parse(await fs.readFile(file, 'utf8'))
        const keys = addMissing(
            messages,
            generated
                ? JSON.parse(generated[`messages/${locale}.json`])
                : Object.fromEntries(Object.entries(DESIGN_MESSAGES).map(([name, texts]) => [name, texts[locale]]))
        )
        if (!keys.length) continue
        await fs.writeFile(file, JSON.stringify(messages, null, 4) + '\n')
        added.push(`frontend/messages/${locale}.json (${keys.length})`)
    }
    return added
}

/** The files of a frontend before 0.50.0 that the Pasport design replaces (left alone, reported). */
export const SITE_OBSOLETE_FILES = ['src/components/locale-switcher.tsx', 'src/components/theme-switcher.tsx']

const FONTS = ['@fontsource-variable/hanken-grotesk', '@fontsource-variable/jetbrains-mono']

/**
 * A frontend without the OpenID Connect login made before 0.50.0 (no <AppPage> on its home page) gets what a new
 * project has: the starters (home page, rail, account, login pages) written when missing or next to yours as
 * `.dafkedd-new`, DafkeDD UI when it is not there, the fonts and `npm run check:design`. Nothing of yours is
 * overwritten; a step that cannot run (no network, no git) says what to run yourself.
 */
export async function migrateSite({ projectDir, project, exec = run, dafkeUi }) {
    const root = path.join(projectDir, 'frontend')
    const home = path.join(root, 'src/app/[locale]/page.tsx')
    const lines = []
    const generated = siteFrontend(project)
    const before = !existsSync(home) || !(await fs.readFile(home, 'utf8')).includes('<AppPage')
    if (before) {
        for (const rel of SITE_STARTER_FILES) {
            if (generated[rel] === undefined) continue
            const target = path.join(root, rel)
            if (!existsSync(target)) {
                await fs.mkdir(path.dirname(target), { recursive: true })
                await fs.writeFile(target, generated[rel])
                lines.push(`${pc.green('✔')} frontend/${rel}: nieuw (Pasport-design)`)
            } else if ((await fs.readFile(target, 'utf8')) !== generated[rel]) {
                await fs.writeFile(target + NEW_SUFFIX, generated[rel])
                lines.push(
                    `${pc.yellow('!')} frontend/${rel}: de versie in het Pasport-design staat in frontend/${rel}${NEW_SUFFIX}`
                )
            }
        }
        for (const rel of SITE_OBSOLETE_FILES)
            if (existsSync(path.join(root, rel)))
                lines.push(`${pc.yellow('!')} frontend/${rel}: niet meer nodig in het Pasport-design (niet verwijderd)`)
    }
    // package.json: the design check, and the fonts of the design
    const pkgFile = path.join(root, 'package.json')
    if (existsSync(pkgFile)) {
        const pkg = JSON.parse(await fs.readFile(pkgFile, 'utf8'))
        if (!pkg.scripts?.['check:design']) {
            pkg.scripts = { ...pkg.scripts, 'check:design': 'node scripts/check-design.mjs' }
            await fs.writeFile(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
            lines.push(`${pc.green('✔')} frontend/package.json: npm run check:design toegevoegd`)
        }
        // The design has its own icons: the check refuses another icon set
        for (const name of ['react-icons', 'lucide-react'])
            if (pkg.dependencies?.[name] || pkg.devDependencies?.[name])
                lines.push(
                    `${pc.yellow('!')} frontend/package.json: ${name} hoort niet bij het Pasport-design; gebruik <Icon> en verwijder het daarna (npm uninstall ${name})`
                )
        const missing = FONTS.filter(name => !pkg.dependencies?.[name])
        if (missing.length)
            try {
                await exec('npm', ['install', ...missing.map(name => `${name}@latest`)], { cwd: root })
                lines.push(`${pc.green('✔')} Lettertypen van het design geïnstalleerd (${missing.join(', ')})`)
            } catch {
                lines.push(`${pc.yellow('!')} Installeer zelf in ./frontend: npm install ${missing.join(' ')}`)
            }
    }
    // DafkeDD UI: the theme and the base styles of the design
    if (!existsSync(path.join(root, 'src/components/ui'))) {
        let dir = null
        try {
            dir = await dafkeUi.clone(exec)
            await dafkeUi.setup({ root, exec, cli: dafkeUiCli(dir), all: true })
            lines.push(`${pc.green('✔')} DafkeDD UI geïnstalleerd in ./frontend`)
        } catch {
            lines.push(
                `${pc.yellow('!')} DafkeDD UI kon niet geïnstalleerd worden (git en netwerk nodig): probeer update opnieuw`
            )
        } finally {
            if (dir) await fs.rm(dir, { recursive: true, force: true })
        }
    }
    if (before)
        lines.push(
            pc.dim(
                '\nHet Pasport-design staat in ./frontend: zet je pagina\'s in <AppPage> (zie de .dafkedd-new-bestanden), dan "npm run format" en controleer met "npm run check:design" en "npm run build".'
            )
        )
    return { lines }
}
