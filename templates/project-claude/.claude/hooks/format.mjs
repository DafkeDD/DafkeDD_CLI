#!/usr/bin/env node
// PostToolUse hook (Edit, Write) of Claude Code: formats the changed file with Prettier, the one of the nearest
// package (./frontend, ./backend or the repository itself) with its .prettierrc and .prettierignore, so every change
// has the house style. Never blocks: a file Prettier does not know is left as it is.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const FORMATTED = /\.(m?js|cjs|ts|tsx|json|md|css|ya?ml)$/

/** The script of Prettier in a package: run with node itself, no shell (paths with spaces on Windows). */
export const prettierBin = dir => path.join(dir, 'node_modules', 'prettier', 'bin', 'prettier.cjs')

/** The folder of the nearest package with Prettier installed, from the file up to `root`; null when there is none. */
export function prettierRoot(file, root) {
    const top = path.resolve(root)
    let dir = path.dirname(path.resolve(root, file))
    while (dir === top || dir.startsWith(top + path.sep)) {
        if (existsSync(prettierBin(dir))) return dir
        if (dir === top) break
        dir = path.dirname(dir)
    }
    return null
}

async function main() {
    let input = ''
    for await (const chunk of process.stdin) input += chunk
    const call = JSON.parse(input || '{}')
    const file = call.tool_input?.file_path
    const root = process.env.CLAUDE_PROJECT_DIR || call.cwd || process.cwd()
    if (typeof file !== 'string' || !FORMATTED.test(file)) return
    const full = path.resolve(root, file)
    if (path.relative(root, full).startsWith('..') || full.split(path.sep).includes('node_modules')) return
    const dir = prettierRoot(full, root)
    if (!dir) return
    try {
        execFileSync(process.execPath, [prettierBin(dir), '--write', full], { cwd: dir, stdio: 'ignore', shell: false })
    } catch {
        // Not a file Prettier can format (or a syntax error that the tests will report): leave it
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
