import { readFileSync } from 'node:fs'
import { select } from '@inquirer/prompts'
import pc from 'picocolors'
import { runSteps } from './progress.js'
import { frontends } from './frontends/index.js'
import { backends } from './backends/index.js'
import { askRepo, githubLines, repoSteps } from './repo.js'
import { docsStep, docsProject } from './docs.js'
import { askClaude as askClaudeCode, claudeNext, claudeSteps, DEVELOP_BRANCH, describeProject } from './claude.js'
import path from 'node:path'
import { kbSteps } from './kb.js'
import { askCloud as askCloudSetup, cloudNext, cloudSteps } from './cloud.js'
import { manifestSteps } from './manifest.js'

export const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const NONE = 'none'

/** One step that gathers the READMEs of the installed parts into ./docs (only for parts that document themselves). */
function docsSteps({ projectDir, frontend, backend }) {
    const parts = [frontend, backend]
        .filter(item => item?.docsFile)
        .map(item => ({ dir: item.dir, file: item.docsFile, title: item.label }))
    if (parts.length === 0) return []
    const swagger = backend?.api ? `http://localhost:${backend.api.port}/docs` : null
    return [docsStep({ projectDir, parts, swagger, kb: Boolean(frontend) })]
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
    askClaude = askClaudeCode,
    askCloud = askCloudSetup,
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

    // Claude Code: agents, skills, hooks and the pipelines (only for a project with something in it)
    const claude = frontend || backend ? await askClaude({ projectDir }) : false
    const described = describeProject({ name: path.basename(projectDir), frontend, backend, answers: backendAnswers })
    const project = claude ? described : null
    // Google Cloud: Terraform, Dockerfiles and the GitHub button to start and stop it (only with a frontend or a backend)
    const cloud = frontend || backend ? await askCloud({ projectDir }) : false
    described.cloud = Boolean(cloud)
    described.claude = Boolean(claude)

    const repo = await ask({ projectDir })

    // What the GitHub steps did (labels, protection of the branches), for the summary
    const github = {}
    const steps = [
        // The frontend gets to know the API (url, language link, status card) when a backend is installed.
        ...(frontend
            ? await frontend.steps({
                  projectDir,
                  answers,
                  api: backend?.apiFor
                      ? backend.apiFor(backendAnswers)
                      : backend
                        ? {
                              ...backend.api,
                              auth: Boolean(backendAnswers.auth),
                              ...(backendAnswers.oidc ? { oidc: true } : {})
                          }
                        : null
              })
            : []),
        ...(backend ? await backend.steps({ projectDir, answers: backendAnswers }) : []),
        ...docsSteps({ projectDir, frontend, backend }),
        // The knowledge base for the users: every page of the frontend, in four languages, from the first commit on
        ...(frontend ? kbSteps({ projectDir, project: described }) : []),
        ...(project ? claudeSteps({ projectDir, project }) : []),
        ...(cloud ? cloudSteps({ projectDir, project: described }) : []),
        // What the CLI wrote, for a later "update" (only when it manages files: Claude Code or Google Cloud)
        ...(project || cloud ? manifestSteps({ projectDir, project: described, version }) : []),
        ...(repo
            ? repoSteps({
                  projectDir,
                  repo,
                  developer: project ? DEVELOP_BRANCH : null,
                  labels: Boolean(project),
                  results: github
              })
            : [])
    ]
    if (steps.length === 0) {
        log(pc.dim('\nNiets te installeren.\n'))
        return
    }

    log('')
    await execute(steps)

    const installed = [
        { item: frontend, answers },
        { item: backend, answers: backendAnswers },
        { item: docsSteps({ projectDir, frontend, backend }).length > 0 ? docsProject : null, answers: {} }
    ].filter(entry => entry.item)
    log('')
    for (const { item, answers: own } of installed) {
        // A part without a folder of its own (linked to an existing server) only reports its result lines
        if (item.dir) log(`${pc.green('✔')} ${item.label} geïnstalleerd in ${pc.bold('./' + item.dir)}`)
        for (const line of item.summary?.(own) ?? []) log(`${line.ok ? pc.green('✔') : pc.red('✖')} ${line.text}`)
    }
    if (project)
        log(
            `${pc.green('✔')} Claude Code toegevoegd: CLAUDE.md, .claude/ (agents, skills, hooks) en .github/ (CI, release, issues)`
        )
    if (repo)
        log(
            `${pc.green('✔')} Gepusht naar GitHub: ${pc.bold(repo.name)}${project ? ` (standaardbranch ${DEVELOP_BRANCH}; een merge naar main maakt een release)` : ''}`
        )
    for (const line of githubLines(github)) log(`${line.ok ? pc.green('✔') : pc.yellow('!')} ${line.text}`)
    for (const { item, answers: own } of installed) {
        log(pc.dim(`\n${item.label}:`))
        const lines = typeof item.next === 'function' ? item.next(own) : (item.next ?? [])
        for (const line of lines) log(pc.dim('  ' + line))
    }
    if (project) {
        log(pc.dim('\nClaude Code:'))
        for (const line of claudeNext({ repo: Boolean(repo) })) log(pc.dim('  ' + line))
    }
    if (cloud) {
        log(pc.dim('\nGoogle Cloud (infra/README.md):'))
        for (const line of cloudNext()) log(pc.dim('  ' + line))
    }
    log('')
}
