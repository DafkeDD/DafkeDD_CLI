import { basename } from 'node:path'
import { existsSync } from 'node:fs'
import { confirm, input, select } from '@inquirer/prompts'
import { run } from './runner.js'

export const platforms = {
    github: { id: 'github', label: 'GitHub' }
}

export const NAME_PATTERN = /^[\w.-]+$/

/** Returns the login of the authenticated GitHub user, or null when `gh` is unavailable or not logged in. */
export async function ghOwner(cwd, exec = run) {
    try {
        return (await exec('gh', ['api', 'user', '--jq', '.login'], { cwd })).trim() || null
    } catch {
        return null
    }
}

/** True when `<owner>/<name>` already exists on GitHub. */
export async function repoExists(owner, name, cwd, exec = run) {
    try {
        await exec('gh', ['repo', 'view', `${owner}/${name}`], { cwd })
        return true
    } catch {
        return false
    }
}

/**
 * Questions: push right away?, platform (GitHub only for now), repo name and visibility.
 * Returns null when the user does not want to push.
 * `prompts` and `exec` can be injected (used by the tests).
 */
export async function askRepo({ projectDir, prompts = { confirm, input, select }, exec = run }) {
    const push = await prompts.confirm({ message: 'Wil je het project meteen naar een repo pushen?', default: true })
    if (!push) return null

    const platform = await prompts.select({
        message: 'Op welk platform wil je pushen?',
        choices: Object.values(platforms).map(p => ({ name: p.label, value: p.id }))
    })
    const owner = await ghOwner(projectDir, exec)
    const name = await prompts.input({
        message: 'Hoe wil je de repo noemen?',
        default: basename(projectDir).replace(/[^\w.-]/g, '-'),
        validate: async v => {
            const value = v.trim()
            if (!NAME_PATTERN.test(value)) return 'Gebruik enkel letters, cijfers, punt, streepje of underscore'
            if (owner && (await repoExists(owner, value, projectDir, exec)))
                return `De repo "${owner}/${value}" bestaat al, kies een andere naam`
            return true
        }
    })
    const visibility = await prompts.select({
        message: 'Zichtbaarheid van de repo?',
        choices: [
            { name: 'Private', value: 'private' },
            { name: 'Public', value: 'public' }
        ]
    })
    return { name: name.trim(), platform, visibility }
}

/** Steps: git init, first commit, create the repo and push. */
export function repoSteps({ projectDir, repo, exec = run }) {
    return [
        {
            title: 'Git initialiseren',
            weight: 1,
            run: async () => {
                if (!existsSync(`${projectDir}/.git`)) await exec('git', ['init', '-b', 'main'], { cwd: projectDir })
                await exec('git', ['add', '-A'], { cwd: projectDir })
                await exec('git', ['commit', '-m', 'Initial commit'], { cwd: projectDir })
            }
        },
        {
            title: `Repo "${repo.name}" aanmaken op GitHub en pushen`,
            weight: 2,
            run: async () => {
                try {
                    await exec('gh', ['auth', 'status'], { cwd: projectDir })
                } catch {
                    throw new Error(
                        'GitHub CLI (gh) is niet geïnstalleerd of niet ingelogd. Voer "gh auth login" uit en probeer opnieuw.'
                    )
                }
                await exec(
                    'gh',
                    ['repo', 'create', repo.name, `--${repo.visibility}`, '--source=.', '--remote=origin', '--push'],
                    { cwd: projectDir }
                )
            }
        }
    ]
}
