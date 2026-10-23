#!/usr/bin/env node
// PreToolUse hook (Bash) of Claude Code: what Claude may do with git and gh in this repository.
// - git commit only with the approvals of the checking agents (reviewer, tester, docs, i18n, and others for the
//   parts they guard) for exactly the staged tree, of the whole branch, and only of what is staged (no -a, no paths);
// - git push only to the branches of the policy in .claude/git-policy.json, never forced, never deleting:
//   { "push": "issue-branches" } (default): a branch per GitHub issue (issue/<number>-<words>), a release in
//   preparation (release/<version>) or an update of Dependabot (dependabot/...), merged with a pull request
//   { "push": "branch", "branch": "developer" }: only that branch
// - gh pr merge only with "merge": "developer" in the policy, and only a pull request of such a branch into developer
//   whose checks on GitHub (the CI) are all green and whose code has every approval; never into main (a merge into
//   main makes a release: that is done by a person). gh release and gh repo delete: never.
// It reads the tool call as JSON on stdin; exit code 2 blocks the call and tells Claude why (stderr).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { AGENTS, missing, missingFor } from './approvals.mjs'

/**
 * The branches agents work on: one per GitHub issue (issue/12 or issue/12-files-module), a release in preparation
 * (release/1.4.0), or an update of Dependabot (dependabot/npm_and_yarn/backend/...). They reach developer through a
 * pull request; the same branches may be merged into developer.
 */
export const ISSUE_BRANCH = /^(issue\/\d+(-[a-z0-9]+)*|release\/\d+\.\d+\.\d+|dependabot\/[\w./-]+)$/
export const MERGEABLE = ISSUE_BRANCH

export const DEFAULT_POLICY = { push: 'issue-branches', merge: null }

/** A check of a pull request that counts as green (a check run's conclusion or a status's state). */
const GREEN = ['SUCCESS', 'NEUTRAL', 'SKIPPED']

/** Are all checks of a pull request finished and green? (At least one: no CI is no green light.) */
export const checksGreen = rollup =>
    Array.isArray(rollup) &&
    rollup.length > 0 &&
    rollup.every(check => GREEN.includes(String(check.conclusion ?? check.state ?? '').toUpperCase()))

/** The policy of the repository (.claude/git-policy.json next to this hook), or the default. */
export function readPolicy(root) {
    try {
        return { ...DEFAULT_POLICY, ...JSON.parse(readFileSync(path.join(root, '.claude', 'git-policy.json'), 'utf8')) }
    } catch {
        return DEFAULT_POLICY
    }
}

/**
 * The commands of a shell command line as lists of words, the way the shell reads them: quotes ('…', "…") and $(…)
 * keep their contents in one word, and ;, &&, ||, | and new lines outside them end a command.
 */
export function shellCommands(line) {
    const commands = []
    let words = []
    let word = ''
    let started = false
    let quote = null
    let depth = 0
    const endWord = () => {
        if (started) words.push(word)
        word = ''
        started = false
    }
    const endCommand = () => {
        endWord()
        if (words.length) commands.push(words)
        words = []
    }
    for (let i = 0; i < line.length; i++) {
        const char = line[i]
        if (quote) {
            if (char === quote && depth === 0) quote = null
            else if (char === '\\' && quote === '"' && i + 1 < line.length) word += line[++i]
            else {
                if (quote === '"' && char === '$' && line[i + 1] === '(') depth++
                else if (quote === '"' && char === ')' && depth > 0) depth--
                word += char
            }
            continue
        }
        if (depth > 0) {
            if (char === '(') depth++
            if (char === ')') depth--
            word += char
            continue
        }
        if (char === "'" || char === '"') {
            quote = char
            started = true
        } else if (char === '$' && line[i + 1] === '(') {
            depth = 1
            word += '$('
            i++
            started = true
        } else if (char === '\\' && i + 1 < line.length) {
            word += line[++i]
            started = true
        } else if (char === ';' || char === '\n') endCommand()
        else if (char === '&' || char === '|') {
            if (line[i + 1] === char) i++
            endCommand()
        } else if (/\s/.test(char)) endWord()
        else {
            word += char
            started = true
        }
    }
    endCommand()
    return commands
}

/** The git and gh commands of a command line: git without "git" (and without -C dir / -c key=value), gh as "gh:x y". */
export function gitCommands(line) {
    return shellCommands(line)
        .map(words => {
            // Skip environment assignments (FOO=1 git ...)
            const rest = [...words]
            while (rest[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0])) rest.shift()
            return rest
        })
        .filter(words => words[0] === 'git' || words[0] === 'gh')
        .map(words => {
            // gh: its command as one word ("gh pr merge" -> "gh:pr merge")
            if (words[0] === 'gh') return ['gh:' + words.slice(1, 3).join(' '), ...words.slice(3)]
            const rest = words.slice(1)
            while (rest[0] === '-C' || rest[0] === '-c') rest.splice(0, 2)
            return rest
        })
}

/** The options of git commit with a value of their own (that value is never an option or a path). */
const COMMIT_VALUES = [
    '-m',
    '--message',
    '-F',
    '--file',
    '-C',
    '--reuse-message',
    '-c',
    '--reedit-message',
    '--author',
    '--date',
    '--cleanup',
    '-t',
    '--template',
    '--fixup',
    '--squash',
    '--trailer'
]

/** Why a git commit would commit something else than the staged tree, or null. */
function commitScope(args) {
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (COMMIT_VALUES.includes(arg)) {
            i++
            continue
        }
        if (arg === '--')
            return 'git commit with paths is not allowed: it commits something else than what was approved.'
        if (/^--[a-z-]+=/.test(arg) || /^-[mFC]./.test(arg)) continue
        if (['-a', '--all', '-i', '--include', '-o', '--only', '--interactive', '-p', '--patch'].includes(arg))
            return `git commit ${arg} is not allowed: stage the change (git add), let the checking agents approve exactly that, then commit.`
        // Short options together (-am, -av): -a in it commits every changed file
        if (/^-[a-zA-Z]{2,}$/.test(arg) && /[aiop]/.test(arg.slice(1)))
            return `git commit -a is not allowed (${arg}): only what is staged is committed.`
        // Short options together that end with one that takes a value (-sm "message"): the value follows
        if (/^-[a-zA-Z]{2,}$/.test(arg) && /[mFCc]$/.test(arg)) {
            i++
            continue
        }
        if (!arg.startsWith('-'))
            return 'git commit with paths is not allowed: it commits something else than what was approved.'
    }
    return null
}

/** May the policy push to this branch? null when it may, otherwise why not. */
function pushTarget(target, policy) {
    if (policy.push === 'branch') {
        return target === policy.branch ? null : `Push only to ${policy.branch}, not to ${target}.`
    }
    return ISSUE_BRANCH.test(target)
        ? null
        : `Push only to the branch of an issue (issue/<number>-<words>), a release (release/<version>) or Dependabot, not to ${target}: it reaches developer through a pull request.`
}

/** May an agent run this gh pr merge? null when it may, otherwise why not. */
function mayMerge(args, policy, pullRequest) {
    if (!policy.merge) return 'gh pr merge is not allowed here: merging is done by a person.'
    if (args.some(arg => arg === '--admin' || arg.startsWith('--admin=')))
        return 'gh pr merge --admin is not allowed: it skips the protection of the branch.'
    const number = args.find(arg => /^\d+$/.test(arg))
    if (!number) return 'Name the pull request: gh pr merge <number> --squash --delete-branch.'
    const pr = pullRequest(number)
    if (!pr) return `Pull request ${number} could not be read from GitHub (gh auth status?).`
    if (pr.base !== policy.merge)
        return `Pull request ${number} goes into ${pr.base}: agents only merge into ${policy.merge}. A merge into main (a release) is done by a person.`
    if (!MERGEABLE.test(pr.head))
        return `Pull request ${number} comes from ${pr.head}, not from the branch of an issue, a release or Dependabot.`
    if (!pr.green)
        return `The checks of pull request ${number} are not all green (yet): gh pr checks ${number} --watch.`
    if (pr.missing.length)
        return `The code of pull request ${number} lacks the approval of ${pr.missing.map(kind => AGENTS[kind]).join(', ')}.`
    return null
}

/**
 * What to do with a command line: null to allow it, or the reason to block it.
 * `branch` is the current branch, `missingApprovals()` the approvals the staged tree lacks, `policy` the policy, and
 * `pullRequest(number)` what GitHub says about a pull request: { base, head, green, missing } or null.
 */
export function decide(line, { branch, missingApprovals, policy = DEFAULT_POLICY, pullRequest = () => null }) {
    const commands = gitCommands(line)
    const subcommands = commands.map(words => words[0])
    for (const words of commands) {
        const [sub, ...args] = words
        if (sub === 'commit') {
            if (args.includes('--dry-run')) continue
            const scope = commitScope(args)
            if (scope) return scope
            if (subcommands.includes('add'))
                return 'Stage first (git add) in a separate step: the checking agents approve what is staged, then commit.'
            if (policy.push === 'issue-branches' && !ISSUE_BRANCH.test(branch))
                return `Commit on the branch of the issue, not on ${branch || 'this branch'}: git switch -c issue/<number>-<words> first.`
            const lacking = missingApprovals()
            if (lacking.length)
                return `No commit without approval of the staged change: ${lacking.join(', ')} missing. Run the agents ${lacking.map(kind => AGENTS[kind]).join(', ')} on it (each records its approval with .claude/hooks/approve.mjs).`
        }
        if (sub === 'gh:pr merge') {
            const reason = mayMerge(args, policy, pullRequest)
            if (reason) return reason
            continue
        }
        // Releases are a person's decision, never an agent's
        if (['gh:release create', 'gh:release delete', 'gh:repo delete'].includes(sub))
            return `${sub.slice(3)} is not allowed: releases are done by a person.`
        if (sub === 'push') {
            const flags = args.filter(arg => arg.startsWith('-'))
            if (
                flags.some(
                    flag =>
                        /^(-f|--force.*|--delete|-d|--mirror|--all|--prune|--tags)$/.test(flag) ||
                        /^-[a-zA-Z]*[fd]/.test(flag)
                )
            )
                return `Pushing with ${flags.join(' ')} is not allowed: only a normal push.`
            const positional = args.filter(arg => !arg.startsWith('-'))
            const refspecs = positional.slice(1)
            if (refspecs.length === 0) {
                const reason = pushTarget(branch, policy)
                if (reason) return reason
                continue
            }
            for (const refspec of refspecs) {
                if (refspec.startsWith('+')) return 'A forced refspec (+) is not allowed.'
                // :branch (an empty source) deletes the branch on the remote
                if (refspec.includes(':') && refspec.split(':')[0] === '')
                    return `git push ${refspec} deletes a branch on the remote: that is not allowed.`
                let target = refspec
                    .split(':')
                    .pop()
                    .replace(/^refs\/heads\//, '')
                // git push origin HEAD: the current branch
                if (target === 'HEAD') target = branch
                const reason = pushTarget(target || refspec, policy)
                if (reason) return reason
            }
        }
    }
    return null
}

const git = (args, cwd) => {
    try {
        return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
        return ''
    }
}

const gh = (args, cwd) =>
    execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: false })

async function main() {
    let input = ''
    for await (const chunk of process.stdin) input += chunk
    const call = JSON.parse(input || '{}')
    const line = call.tool_input?.command
    if (typeof line !== 'string' || !/\b(git|gh)\b/.test(line)) return
    const cwd = call.cwd || process.cwd()
    const root = process.env.CLAUDE_PROJECT_DIR || git(['rev-parse', '--show-toplevel'], cwd) || cwd
    const reason = decide(line, {
        // symbolic-ref also knows the branch of a repository without commits yet
        branch: git(['symbolic-ref', '--short', 'HEAD'], cwd) || git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
        missingApprovals: () => missing(cwd),
        policy: readPolicy(root),
        pullRequest: number => {
            try {
                const pr = JSON.parse(
                    gh(['pr', 'view', number, '--json', 'baseRefName,headRefName,headRefOid,statusCheckRollup'], cwd)
                )
                // Every file of the pull request (gh pr diff has no limit of 100 files, --json files has)
                const files = gh(['pr', 'diff', number, '--name-only'], cwd).split(/\r?\n/).filter(Boolean)
                const tree = git(['rev-parse', `${pr.headRefOid}^{tree}`], cwd)
                return {
                    base: pr.baseRefName,
                    head: pr.headRefName,
                    green: checksGreen(pr.statusCheckRollup),
                    // The approvals were given for the tree of the last commit of the branch
                    missing: tree ? missingFor(cwd, tree, files) : ['review']
                }
            } catch {
                return null
            }
        }
    })
    if (reason) {
        console.error(reason)
        process.exitCode = 2
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
