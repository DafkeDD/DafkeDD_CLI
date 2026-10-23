#!/usr/bin/env node
// npm run labels: creates (or updates) the labels the plan and implement skills use on DafkeDD/DafkeDD_CLI.
// Needs the GitHub CLI (gh), logged in with access to the repository. Safe to run again.
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const REPO = 'DafkeDD/DafkeDD_CLI'

export const LABELS = [
    ['spec', '5319e7', 'A spec: the why, the what and its tickets'],
    ['type:feature', '0d9488', 'Something new or different'],
    ['type:bug', 'dc2626', 'Something that does not work'],
    ['type:chore', '8a93a6', 'Upkeep: dependencies, tooling, docs only'],
    ['area:frontend', '2563eb', 'The generated Next.js frontends (frontend agent)'],
    ['area:backend', '7c3aed', 'The generated NestJS backends (nestjs agent)'],
    ['area:database', 'd97706', 'Migrations, Row-Level Security, queries (postgresql agent)'],
    ['area:cli', '0f766e', 'The questions, steps and generation of the CLI itself'],
    ['area:docs', '475063', 'README, generated docs, the central docs project'],
    ['status:ready', '16a34a', 'Can be built'],
    ['status:blocked', 'fde68a', 'Waits for another ticket or a decision'],
    ['status:in-progress', 'bfdbfe', 'Being built']
]

/** The gh calls that create or update every label. */
export const commands = (repo = REPO) =>
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
    let failed = 0
    for (const args of commands()) {
        const result = spawnSync('gh', args, { stdio: 'inherit', shell: process.platform === 'win32' })
        if (result.status !== 0) failed++
    }
    if (failed) {
        console.error(`${failed} labels failed: is gh installed and logged in (gh auth login)?`)
        process.exitCode = 1
    } else console.log(`${LABELS.length} labels ready on ${REPO}`)
}
