// The approvals of the checking agents, per staged tree (git write-tree): a commit (and the merge of its pull request)
// is only allowed for the tree they saw, or a later one that only changed files outside their scope (OUT_OF_SCOPE).
// They live in .git/claude-approvals, so they are never committed.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Every agent that can approve (each records it with .claude/hooks/approve.mjs <kind>). */
export const KINDS = ['review', 'tests', 'docs', 'i18n', 'security', 'qa', 'a11y', 'privacy']
/** The agent of each approval. */
export const AGENTS = {
    review: 'reviewer',
    tests: 'tester',
    docs: 'docs',
    i18n: 'i18n',
    security: 'security',
    qa: 'qa',
    a11y: 'a11y',
    privacy: 'privacy'
}
/** Always needed for a commit. */
export const ALWAYS = ['review', 'tests', 'docs', 'i18n']
/** A staged path that needs the security agent too: login, tokens, tenants, payments, uploads, the database, hooks. */
export const SENSITIVE =
    /(oidc|auth|pasport|passkey|mfa|eid|session|token|cookie|access|guard|tenan|billing|mollie|license|licence|files?\/|upload|database|migrat|crypto|secret|\.claude\/hooks|proxy)/i

/**
 * A time from the environment that can only make `max` shorter (the tests): a whole number of ms, at least 1. Anything
 * else (0, a negative number, a fraction below 1, no number) is ignored: a timeout of 0 would mean no timeout at all.
 */
export function shorter(max, value) {
    const ms = Math.floor(Number(value))
    return Number.isFinite(ms) && ms >= 1 ? Math.min(max, ms) : max
}

/**
 * The time budget of a hook run (ms): Claude Code lets a command through when the hook runs past its `timeout`
 * (.claude/settings.json: 120 s), so every git and gh call of the guard together stops at DEADLINE, and a call that
 * runs out throws (the guard then blocks: it fails closed). HOOK_DEADLINE_MS can only make it shorter (the tests).
 */
export const DEADLINE = shorter(90_000, process.env.HOOK_DEADLINE_MS)
const started = Date.now()

/** A call that ran out of time: never read as "not approved" or "nothing", always rethrown. */
export const timedOut = error => error?.code === 'ETIMEDOUT' || Boolean(error?.signal)

/** The timeout of the next call: at most `max`, never past the deadline of the run; none left throws. */
export function callTimeout(max) {
    const left = DEADLINE - (Date.now() - started)
    if (left < 1) throw Object.assign(new Error('the time of the hook is up'), { code: 'ETIMEDOUT' })
    // Never 0 (no timeout) or below: at least 1 ms, at most `max`
    return Math.max(1, Math.min(max, left))
}

/** One git call: at most 10 s (HOOK_GIT_TIMEOUT_MS only shorter), and within the deadline of the run. */
export const GIT_TIMEOUT = shorter(10_000, process.env.HOOK_GIT_TIMEOUT_MS)
const git = (args, cwd) =>
    execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: callTimeout(GIT_TIMEOUT)
    }).trim()

/** The tree that a commit would make of what is staged now. */
export const stagedTree = cwd => git(['write-tree'], cwd)

/**
 * The paths of `git diff` (`args` are its revisions): every path of the whole repository (--no-relative, also from a
 * subfolder or with diff.relative), a rename as its old and its new path (--no-renames: moving a guard into docs/ still
 * shows the guard), NUL-separated so no name is quoted.
 */
const diffPaths = (cwd, args) =>
    git(['diff', '--name-only', '--no-renames', '--no-relative', '-z', ...args], cwd)
        .split('\0')
        .filter(Boolean)

/** The staged paths. */
export const stagedPaths = cwd => diffPaths(cwd, ['--cached'])

const folder = cwd => path.resolve(cwd, git(['rev-parse', '--git-path', 'claude-approvals'], cwd))

export const approvalFile = (cwd, kind, tree) => path.join(folder(cwd), `${kind}-${tree}`)

/**
 * A staged path of a generated project that needs the qa agent too (it clicks through the screens and looks in the
 * database): the pages, components and texts of ./frontend, the controllers and the database of ./backend.
 */
export const BEHAVIOUR = /^(frontend\/(src|messages)\/|backend\/src\/(.+\.controller\.ts$|database\/|.+\/pg-.+\.ts$))/

/** A staged path of a generated project that changes a screen: the a11y agent checks it. */
export const SCREEN = /^frontend\/(src|messages)\//
/** A staged path of a generated project that changes what is stored: the privacy agent checks it. */
export const STORED = /^backend\/src\/(database\/|.+\/pg-.+\.ts$)/

/** The approvals a commit of these paths needs. */
export const required = paths => [
    ...ALWAYS,
    ...(paths.some(file => SENSITIVE.test(file)) ? ['security'] : []),
    ...(paths.some(file => BEHAVIOUR.test(file)) ? ['qa'] : []),
    ...(paths.some(file => SCREEN.test(file)) ? ['a11y'] : []),
    ...(paths.some(file => STORED.test(file)) ? ['privacy'] : [])
]

/** Records that `kind` approved the staged tree. */
export function approve(cwd, kind) {
    if (!KINDS.includes(kind)) throw new Error(`Unknown approval ${kind} (${KINDS.join(', ')})`)
    const tree = stagedTree(cwd)
    mkdirSync(folder(cwd), { recursive: true })
    writeFileSync(approvalFile(cwd, kind, tree), new Date().toISOString() + '\n')
    return tree
}

/**
 * Documentation only: a markdown file, but never CLAUDE.md (also CLAUDE.local.md) or one under .claude/ (also
 * templates/project-claude/.claude), in any case (Windows does not tell Claude.md from CLAUDE.md): those are the rules
 * and the instructions of the agents, not documentation.
 */
const docsOnly = file =>
    /\.md$/.test(file) && !/(^|\/)claude(\.[^/]*)?\.md$/i.test(file) && !/(^|\/)\.claude\//i.test(file)

/** The two docs generators of the CLI: documentation of the API and the frontend (no server, no text of an app). */
const DOCS_GENERATORS = ['src/backends/docs.js', 'src/frontends/docs.js']

/**
 * The files that do not concern a check: when only those changed since it approved a tree, its approval still counts.
 * The review, the tests, the docs check and qa always look at the last tree.
 */
export const OUT_OF_SCOPE = {
    // No text of the app: documentation, the tests of the CLI and its docs generators
    i18n: file => docsOnly(file) || /^test\//.test(file) || DOCS_GENERATORS.includes(file),
    security: docsOnly,
    a11y: docsOnly,
    // docs/privacy.md is the register the privacy agent checks: never out of its scope
    privacy: file => docsOnly(file) && file !== 'docs/privacy.md'
}

/** The name of a tree (SHA-1 or SHA-256): nothing else in the folder is compared. */
const TREE = /^[0-9a-f]{40}([0-9a-f]{24})?$/

/** The files that differ between two trees. */
const changedBetween = (cwd, from, to) => diffPaths(cwd, ['--end-of-options', from, to])

/** Did `kind` approve this tree, or an earlier one from which only files outside its scope changed? */
export function approved(cwd, kind, tree) {
    if (existsSync(approvalFile(cwd, kind, tree))) return true
    const scope = OUT_OF_SCOPE[kind]
    if (!scope) return false
    let earlier = []
    try {
        earlier = readdirSync(folder(cwd))
            .filter(name => name.startsWith(kind + '-'))
            .map(name => name.slice(kind.length + 1))
            .filter(name => TREE.test(name))
    } catch {
        return false
    }
    return earlier.some(from => {
        try {
            return changedBetween(cwd, from, tree).every(scope)
        } catch (error) {
            // Out of time: the guard blocks; a tree git no longer knows: it does not count
            if (timedOut(error)) throw error
            return false
        }
    })
}

/** The approvals a tree is still missing, for a change of these paths. */
export const missingFor = (cwd, tree, paths) => required(paths).filter(kind => !approved(cwd, kind, tree))

/**
 * The paths the branch changed since it left developer (origin/developer...HEAD): a fix later on the branch still needs
 * the approvals of everything the pull request will merge. Empty without origin/developer.
 */
export function branchPaths(cwd, base = 'origin/developer') {
    try {
        return diffPaths(cwd, [`${base}...HEAD`])
    } catch (error) {
        // Out of time: never "nothing changed" (fewer approvals); without origin/developer: nothing to add
        if (timedOut(error)) throw error
        return []
    }
}

/** The approvals the staged tree is still missing, for what is staged and what the branch changed before. */
export const missing = cwd => missingFor(cwd, stagedTree(cwd), [...new Set([...stagedPaths(cwd), ...branchPaths(cwd)])])
