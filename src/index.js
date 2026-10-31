import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { ANSWERS_FILE, readAnswers, saveAnswers, select, useAnswers } from './prompts.js'
import pc from 'picocolors'
import { runSteps } from './progress.js'
import { frontends } from './frontends/index.js'
import { backends } from './backends/index.js'
import { askRepo, githubLines, repoSteps } from './repo.js'
import { docsStep, docsProject } from './docs.js'
import {
    askClaude as askClaudeCode,
    claudeNext,
    claudeSteps,
    DEVELOP_BRANCH,
    describeProject,
    ensureGitignore
} from './claude.js'
import path from 'node:path'
import { kbSteps } from './kb.js'
import { askCloud as askCloudSetup, cloudNext, cloudSteps } from './cloud.js'
import { manifestSteps } from './manifest.js'

export const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const NONE = 'none'

/**
 * The parts that document themselves, with the title of their page in ./docs: `docsTitle` (English, like the docs),
 * otherwise the label of the choice (the linked app has a Dutch label for the question, an English title).
 */
export const docsParts = (...items) =>
    items
        .filter(item => item?.docsFile)
        .map(item => ({ dir: item.dir, file: item.docsFile, title: item.docsTitle ?? item.label }))

/** One step that gathers the READMEs of the installed parts into ./docs (only for parts that document themselves). */
function docsSteps({ projectDir, frontend, backend }) {
    const parts = docsParts(frontend, backend)
    if (parts.length === 0) return []
    const swagger = backend?.api ? `http://localhost:${backend.api.port}/docs` : null
    return [docsStep({ projectDir, parts, swagger, kb: Boolean(frontend) })]
}

// A part with `hidden` is not a choice of its own: another question leads to it (the linked app: the login question)
const choicesOf = (registry, noneLabel) => [
    ...Object.values(registry)
        .filter(item => !item.hidden)
        .map(item => ({ name: item.label, value: item.id, description: item.description })),
    { name: noneLabel, value: NONE }
]

/**
 * Entry point of the CLI. Order of the questions: frontend, backend (+ its database and login), Claude Code, Google
 * Cloud, and last the (optional) GitHub push. Order of the steps: frontend, backend, git/GitHub.
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
    log = console.log,
    /** --answers <file>: the answers of an earlier run (.dafkedd-answers.json); what it misses is asked. */
    answersFile = null
} = {}) {
    if (answersFile) useAnswers(await readAnswers(answersFile), { log })
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
    let backend = backendChoice === NONE ? null : backendRegistry[backendChoice]
    let backendAnswers = (await backend?.ask?.({ projectDir, hasFrontend: Boolean(frontend) })) ?? {}
    // "Log in through your existing Pasport server" in the login question: an app linked to that server, with the
    // database that was already chosen
    if (backendAnswers.switchTo && backendRegistry[backendAnswers.switchTo]) {
        backend = backendRegistry[backendAnswers.switchTo]
        backendAnswers =
            (await backend.ask({ projectDir, hasFrontend: Boolean(frontend), database: backendAnswers.database })) ?? {}
    }

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
    // The simple login: the frontend proves to the API that it passes the address of the browser on (API_PROXY_SECRET)
    const secrets = backendAnswers.auth ? { proxy: randomBytes(32).toString('hex') } : null
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
                              ...(secrets ? { proxySecret: secrets.proxy } : {}),
                              ...(backendAnswers.oidc ? { oidc: true } : {})
                          }
                        : null
              })
            : []),
        ...(backend ? await backend.steps({ projectDir, answers: backendAnswers, secrets }) : []),
        ...docsSteps({ projectDir, frontend, backend }),
        // The knowledge base for the users: every page of the frontend, in four languages, from the first commit on
        ...(frontend ? kbSteps({ projectDir, project: described }) : []),
        ...(project ? claudeSteps({ projectDir, project }) : []),
        ...(cloud ? cloudSteps({ projectDir, project: described }) : []),
        // What the CLI wrote, for a later "update" (only when it manages files: Claude Code or Google Cloud)
        ...(project || cloud ? manifestSteps({ projectDir, project: described, version }) : []),
        // The answers of this run, to make the same project again (DafkeDD_CLI --answers): not committed
        ...(frontend || backend
            ? [
                  {
                      title: `Antwoorden bewaren (${ANSWERS_FILE}, voor --answers)`,
                      weight: 1,
                      run: async () => {
                          await saveAnswers(projectDir, version)
                          await ensureGitignore(projectDir, [ANSWERS_FILE])
                      }
                  }
              ]
            : []),
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
