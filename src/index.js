import { readFileSync } from 'node:fs'
import { select } from '@inquirer/prompts'
import pc from 'picocolors'
import { runSteps } from './progress.js'
import { frontends } from './frontends/index.js'
import { askRepo, repoSteps } from './repo.js'

export const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/**
 * Entry point of the CLI. Order of the questions: frontend, frontend options (e.g. DafkeDD UI),
 * and last the (optional) GitHub push. Everything is injectable so the tests can run it without prompts.
 */
export async function main({
    projectDir = process.cwd(),
    prompts = { select },
    ask = askRepo,
    registry = frontends,
    execute = runSteps,
    log = console.log
} = {}) {
    log(
        pc.bold('\nDafkeDD_CLI') +
            pc.dim(` v${version}`) +
            pc.dim('  (alles wordt lokaal in dit project geïnstalleerd, nooit globaal)')
    )
    log(pc.dim(`Projectmap: ${projectDir}\n`))

    const choice = await prompts.select({
        message: 'Welke frontend wil je installeren?',
        choices: Object.values(registry).map(f => ({
            name: f.label,
            value: f.id,
            description: f.description
        }))
    })

    const frontend = registry[choice]
    const answers = (await frontend.ask?.({ projectDir })) ?? {}
    const repo = await ask({ projectDir })
    const steps = [...(await frontend.steps({ projectDir, answers })), ...(repo ? repoSteps({ projectDir, repo }) : [])]

    log('')
    await execute(steps)

    log(`\n${pc.green('✔')} ${frontend.label} geïnstalleerd in ${pc.bold('./' + frontend.dir)}`)
    if (repo) log(`${pc.green('✔')} Gepusht naar GitHub: ${pc.bold(repo.name)}`)
    for (const line of frontend.next ?? []) log(pc.dim('  ' + line))
    log('')
}
