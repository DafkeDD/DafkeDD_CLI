// Runs every test/*.test.js with the built-in Node test runner (works on every platform and Node >= 22).
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'test')
const files = readdirSync(dir)
    .filter(f => f.endsWith('.test.js'))
    .sort()
    .map(f => path.join('test', f))

if (files.length === 0) {
    console.error('No test files found in ./test')
    process.exit(1)
}

const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], {
    cwd: root,
    stdio: 'inherit'
})
process.exit(result.status ?? 1)
