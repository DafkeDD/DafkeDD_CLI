import { readFileSync } from 'node:fs'
import { select } from '@inquirer/prompts'
import pc from 'picocolors'
import { runSteps } from './progress.js'
import { frontends } from './frontends/index.js'
import { backends } from './backends/index.js'
import { askRepo, repoSteps } from './repo.js'

export const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const NONE = 'none'

const choicesOf = (registry, noneLabel) => [
    ...Object.values(registry).map(item => ({ name: item.label, value: item.id, description: item.description })),
    { name: noneLabel, value: NONE }
]

/**
 * Entry point of the CLI. Order of the questions: frontend (+ its options, e.g. DafkeDD UI), backend,
 * and last the (optional) GitHub push. Order of the steps: frontend, backend, git/GitHub.
 * Everything is injectable so the tests can run it without prompts.
 */
export async function main({
    projectDir = process.cwd(),
    prompts = { select },
    ask = askRepo,
    registry = frontends,
    backendRegistry = backends,
    execute = runSteps,
    log = console.log
} = {}) {
    log(
        pc.bold('\nDafkeDD_CLI') +
            pc.dim(` v${version}`) +
            pc.dim('  (alles wordt lokaal in dit project geïnstalleerd, nooit globaal)')
    )
    log(pc.dim(`Projectmap: ${projectDir}\n`))

    const frontendChoice = await prompts.select({
        message: 'Welke frontend wil je installeren?',
        choices: choicesOf(registry, 'Geen frontend')
    })
    const frontend = frontendChoice === NONE ? null : registry[frontendChoice]
    const answers = (await frontend?.ask?.({ projectDir })) ?? {}

    const backendChoice = await prompts.select({
        message: 'Welke backend wil je installeren?',
        choices: choicesOf(backendRegistry, 'Geen backend')
    })
    const backend = backendChoice === NONE ? null : backendRegistry[backendChoice]
    const backendAnswers = (await backend?.ask?.({ projectDir })) ?? {}

    const repo = await ask({ projectDir })

    const steps = [
        ...(frontend ? await frontend.steps({ projectDir, answers }) : []),
        ...(backend
            ? await backend.steps({ projectDir, answers: backendAnswers, frontendDir: frontend?.dir ?? null })
            : []),
        ...(repo ? repoSteps({ projectDir, repo }) : [])
    ]
    if (steps.length === 0) {
        log(pc.dim('\nNiets te installeren.\n'))
        return
    }

    log('')
    await execute(steps)

    const installed = [frontend, backend].filter(Boolean)
    log('')
    for (const item of installed) log(`${pc.green('✔')} ${item.label} geïnstalleerd in ${pc.bold('./' + item.dir)}`)
    if (repo) log(`${pc.green('✔')} Gepusht naar GitHub: ${pc.bold(repo.name)}`)
    for (const item of installed) {
        log(pc.dim(`\n${item.label}:`))
        for (const line of item.next ?? []) log(pc.dim('  ' + line))
    }
    log('')
}
