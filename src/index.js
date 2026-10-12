import { readFileSync } from 'node:fs'
import { select } from '@inquirer/prompts'
import pc from 'picocolors'
import { runSteps } from './progress.js'
import { frontends } from './frontends/index.js'
import { backends } from './backends/index.js'
import { askRepo, repoSteps } from './repo.js'
import { docsStep } from './docs.js'

export const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const NONE = 'none'

/** One step that gathers the READMEs of the installed parts into ./docs (only for parts that document themselves). */
function docsSteps({ projectDir, frontend, backend }) {
    const parts = [frontend, backend]
        .filter(item => item?.docsFile)
        .map(item => ({ dir: item.dir, file: item.docsFile, title: item.label }))
    if (parts.length === 0) return []
    const swagger = backend?.api ? `http://localhost:${backend.api.port}/docs` : null
    return [docsStep({ projectDir, parts, swagger })]
}

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
    const backendAnswers = (await backend?.ask?.({ projectDir, hasFrontend: Boolean(frontend) })) ?? {}

    const repo = await ask({ projectDir })

    const steps = [
        // The frontend gets to know the API (url, language link, status card) when a backend is installed.
        ...(frontend
            ? await frontend.steps({
                  projectDir,
                  answers,
                  api: backend ? { ...backend.api, auth: Boolean(backendAnswers.auth) } : null
              })
            : []),
        ...(backend ? await backend.steps({ projectDir, answers: backendAnswers }) : []),
        ...docsSteps({ projectDir, frontend, backend }),
        ...(repo ? repoSteps({ projectDir, repo }) : [])
    ]
    if (steps.length === 0) {
        log(pc.dim('\nNiets te installeren.\n'))
        return
    }

    log('')
    await execute(steps)

    const installed = [
        { item: frontend, answers },
        { item: backend, answers: backendAnswers }
    ].filter(entry => entry.item)
    log('')
    for (const { item, answers: own } of installed) {
        log(`${pc.green('✔')} ${item.label} geïnstalleerd in ${pc.bold('./' + item.dir)}`)
        for (const line of item.summary?.(own) ?? []) log(`${line.ok ? pc.green('✔') : pc.red('✖')} ${line.text}`)
    }
    if (repo) log(`${pc.green('✔')} Gepusht naar GitHub: ${pc.bold(repo.name)}`)
    for (const { item, answers: own } of installed) {
        log(pc.dim(`\n${item.label}:`))
        const lines = typeof item.next === 'function' ? item.next(own) : (item.next ?? [])
        for (const line of lines) log(pc.dim('  ' + line))
    }
    log('')
}
