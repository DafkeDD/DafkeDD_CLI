#!/usr/bin/env node
// node .claude/scripts/protect-branches.mjs [owner/name]: protects developer and main on GitHub, so the rules of the
// hooks also hold on GitHub itself: the checks of .github/workflows/ci.yml must be green before a pull request is
// merged, a change goes through a pull request, no force-push and no deleting. An admin (you) can still push in an
// emergency (enforce_admins off). It also turns on private vulnerability reporting (SECURITY.md). Needs the GitHub CLI (gh), logged in, as an admin of the repository. Safe to run again.
// GitHub only protects branches of a private repository with GitHub Pro, Team or Enterprise.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const BRANCHES = ['developer', 'main']

/** The names of the jobs of the CI: the checks GitHub reports on a pull request. */
export function checkNames(ci) {
    const names = []
    let inJobs = false
    for (const line of ci.split(/\r?\n/)) {
        if (/^jobs:\s*$/.test(line)) inJobs = true
        else if (/^\S/.test(line)) inJobs = false
        else if (inJobs) {
            const match = /^ {8}name: (.+?)\s*$/.exec(line)
            if (match) names.push(match[1].replace(/^(['"])(.*)\1$/, '$2'))
        }
    }
    return names
}

/** The body of PUT /repos/{repo}/branches/{branch}/protection. */
export const protection = checks => ({
    required_status_checks: { strict: false, contexts: checks },
    enforce_admins: false,
    // A pull request, but no review needed: the checking agents and the CI are the review
    required_pull_request_reviews: { required_approving_review_count: 0, dismiss_stale_reviews: false },
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false
})

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    let repo = process.argv[2]
    try {
        repo ??= execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
            encoding: 'utf8'
        }).trim()
    } catch {
        console.error('No GitHub repository found here: push the project first, or name it (owner/name).')
        process.exit(1)
    }
    const ci = existsSync('.github/workflows/ci.yml') ? readFileSync('.github/workflows/ci.yml', 'utf8') : ''
    const checks = checkNames(ci)
    let failed = 0
    for (const branch of BRANCHES) {
        const result = spawnSync(
            'gh',
            ['api', '--method', 'PUT', `repos/${repo}/branches/${branch}/protection`, '--input', '-', '--silent'],
            { input: JSON.stringify(protection(checks)), encoding: 'utf8' }
        )
        if (result.status === 0) console.log(`${branch}: protected (checks: ${checks.join(', ') || 'none'})`)
        else {
            failed++
            const message = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim()
            console.error(
                `${branch}: not protected: ${/upgrade|403/i.test(message) ? 'GitHub protects branches of a private repository only with GitHub Pro, Team or Enterprise (or make it public)' : message}`
            )
        }
    }
    // Private vulnerability reporting (SECURITY.md): Security -> Report a vulnerability
    const reporting = spawnSync(
        'gh',
        ['api', '--method', 'PUT', `repos/${repo}/private-vulnerability-reporting`, '--silent'],
        {
            encoding: 'utf8'
        }
    )
    if (reporting.status === 0) console.log('private vulnerability reporting: on')
    else {
        failed++
        console.error(`private vulnerability reporting: not on: ${`${reporting.stderr ?? ''}`.trim()}`)
    }
    if (failed) process.exitCode = 1
}
