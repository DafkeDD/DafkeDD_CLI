import { basename } from 'node:path'
import { existsSync } from 'node:fs'
import { confirm, input, select } from '@inquirer/prompts'
import { run } from './runner.js'

export const platforms = {
    github: { id: 'github', label: 'GitHub' }
}

async function ghOwner(cwd) {
    try {
        return (await run('gh', ['api', 'user', '--jq', '.login'], { cwd })).trim() || null
    } catch {
        return null
    }
}

async function repoExists(owner, name, cwd) {
    try {
        await run('gh', ['repo', 'view', `${owner}/${name}`], { cwd })
        return true
    } catch {
        return false
    }
}

/** Vragen: meteen pushen?, repo-naam, platform (voorlopig enkel GitHub) en zichtbaarheid. Geeft null als je niet pusht. */
export async function askRepo({ projectDir }) {
    const push = await confirm({ message: 'Wil je het project meteen naar een repo pushen?', default: true })
    if (!push) return null

    const platform = await select({
        message: 'Op welk platform wil je pushen?',
        choices: Object.values(platforms).map(p => ({ name: p.label, value: p.id }))
    })
    const owner = await ghOwner(projectDir)
    const name = await input({
        message: 'Hoe wil je de repo noemen?',
        default: basename(projectDir).replace(/[^\w.-]/g, '-'),
        validate: async v => {
            const value = v.trim()
            if (!/^[\w.-]+$/.test(value)) return 'Gebruik enkel letters, cijfers, punt, streepje of underscore'
            if (owner && (await repoExists(owner, value, projectDir)))
                return `De repo "${owner}/${value}" bestaat al, kies een andere naam`
            return true
        }
    })
    const visibility = await select({
        message: 'Zichtbaarheid van de repo?',
        choices: [
            { name: 'Private', value: 'private' },
            { name: 'Public', value: 'public' }
        ]
    })
    return { name: name.trim(), platform, visibility }
}

/** Stappen: git init, eerste commit, repo aanmaken en pushen. */
export function repoSteps({ projectDir, repo }) {
    return [
        {
            title: 'Git initialiseren',
            weight: 1,
            run: async () => {
                if (!existsSync(`${projectDir}/.git`)) await run('git', ['init', '-b', 'main'], { cwd: projectDir })
                await run('git', ['add', '-A'], { cwd: projectDir })
                await run('git', ['commit', '-m', 'Initial commit'], { cwd: projectDir })
            }
        },
        {
            title: `Repo "${repo.name}" aanmaken op GitHub en pushen`,
            weight: 2,
            run: async () => {
                try {
                    await run('gh', ['auth', 'status'], { cwd: projectDir })
                } catch {
                    throw new Error(
                        'GitHub CLI (gh) is niet geïnstalleerd of niet ingelogd. Voer "gh auth login" uit en probeer opnieuw.'
                    )
                }
                await run(
                    'gh',
                    ['repo', 'create', repo.name, `--${repo.visibility}`, '--source=.', '--remote=origin', '--push'],
                    {
                        cwd: projectDir
                    }
                )
            }
        }
    ]
}
