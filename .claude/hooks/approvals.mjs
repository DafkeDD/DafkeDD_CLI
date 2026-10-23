// The approvals of the checking agents, per staged tree (git write-tree): a commit (and the merge of its pull request)
// is only allowed for exactly the tree they saw. They live in .git/claude-approvals, so they are never committed.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
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

const git = (args, cwd) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** The tree that a commit would make of what is staged now. */
export const stagedTree = cwd => git(['write-tree'], cwd)

/** The staged paths. */
export const stagedPaths = cwd => git(['diff', '--cached', '--name-only'], cwd).split('\n').filter(Boolean)

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

/** The approvals a tree is still missing, for a change of these paths. */
export const missingFor = (cwd, tree, paths) =>
    required(paths).filter(kind => !existsSync(approvalFile(cwd, kind, tree)))

/**
 * The paths the branch changed since it left developer (origin/developer...HEAD): a fix later on the branch still needs
 * the approvals of everything the pull request will merge. Empty without origin/developer.
 */
export function branchPaths(cwd, base = 'origin/developer') {
    try {
        return git(['diff', '--name-only', `${base}...HEAD`], cwd)
            .split('\n')
            .filter(Boolean)
    } catch {
        return []
    }
}

/** The approvals the staged tree is still missing, for what is staged and what the branch changed before. */
export const missing = cwd => missingFor(cwd, stagedTree(cwd), [...new Set([...stagedPaths(cwd), ...branchPaths(cwd)])])
