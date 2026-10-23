import { confirm } from '@inquirer/prompts'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import pc from 'picocolors'
import { ensureGitignore, GITIGNORE_LINES } from './claude.js'
import { kbFiles } from './kb.js'
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
 * `DafkeDD_CLI update` in the folder of a project: the agents, skills, hooks, pipelines and Terraform of this version
 * of the CLI, without overwriting what you changed. Without a manifest (a project of an older CLI) it reads what the
 * project is made of from its folders and asks to confirm that first.
 */
export async function update({ projectDir = process.cwd(), version, prompts = { confirm }, log = console.log } = {}) {
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
    if (!project.claude && !project.cloud) {
        log(pc.dim('Dit project heeft geen Claude Code en geen Google Cloud: niets bij te werken.'))
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
    if (!shown.length && !kbAdded.length) log(`${pc.green('✔')} Alles is al bij met DafkeDD_CLI v${version}.`)
    for (const { rel, action } of shown)
        log(
            `${action === 'changed' || action === 'deleted' ? pc.yellow('!') : pc.green('✔')} ${rel}: ${LABELS[action].replace('<bestand>', rel)}`
        )
    if (kbAdded.length) log(`${pc.green('✔')} Kennisbank: ${kbAdded.length} ontbrekende bestanden toegevoegd`)
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
