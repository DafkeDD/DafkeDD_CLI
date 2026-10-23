#!/usr/bin/env node
// node .claude/scripts/setup-labels.mjs [owner/name]: creates (or updates) the labels the plan and implement skills
// use, on the GitHub repository of this project. Needs the GitHub CLI (gh), logged in. Safe to run again.
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const LABELS = [
    ['spec', '5319e7', 'A spec: the why, the what and its tickets'],
    ['type:feature', '0d9488', 'Something new or different'],
    ['type:bug', 'dc2626', 'Something that does not work'],
    ['type:chore', '8a93a6', 'Upkeep: dependencies, tooling, docs only'],
    ['area:frontend', '2563eb', './frontend (frontend agent)'],
    ['area:backend', '7c3aed', './backend (nestjs agent)'],
    ['area:database', 'd97706', 'Migrations, Row-Level Security, queries (postgresql agent)'],
    ['area:docs', '475063', 'READMEs and ./docs'],
    ['status:ready', '16a34a', 'Can be built'],
    ['status:blocked', 'fde68a', 'Waits for another issue or a decision'],
    ['status:in-progress', 'bfdbfe', 'Being built']
]

/** The gh calls that create or update every label of `repo`. */
export const commands = repo =>
    LABELS.map(([name, color, description]) => [
        'label',
        'create',
        name,
        '--repo',
        repo,
        '--color',
        color,
        '--description',
        description,
        '--force'
    ])

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    // gh is an .exe on Windows too: no shell needed (and none wanted: the descriptions have spaces)
    const shell = false
    let repo = process.argv[2]
    try {
        repo ??= execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
            encoding: 'utf8',
            shell
        }).trim()
    } catch {
        console.error('No GitHub repository found here: push the project first, or name it (owner/name).')
        process.exit(1)
    }
    let failed = 0
    for (const args of commands(repo)) if (spawnSync('gh', args, { stdio: 'inherit', shell }).status !== 0) failed++
    if (failed) {
        console.error(`${failed} labels failed: is gh installed and logged in (gh auth login)?`)
        process.exitCode = 1
    } else console.log(`${LABELS.length} labels ready on ${repo}`)
}
