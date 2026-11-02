import { existsSync, readFileSync } from 'node:fs'

/** The settings of an env file (KEY=value lines), or nothing when the file is not there (the CI has none). */
export function readEnv(file: string): Record<string, string> {
    if (!existsSync(file)) return {}
    return Object.fromEntries(
        readFileSync(file, 'utf8')
            .split('\n')
            .filter(line => /^[A-Z0-9_]+=/.test(line))
            .map(line => [
                line.slice(0, line.indexOf('=')),
                line.slice(line.indexOf('=') + 1).replace(/^['"]|['"]$/g, '')
            ])
    )
}

/** The beginning of the email address of every test account of this run (playwright.config.ts sets E2E_RUN). */
export const accountPrefix = () => `e2e-${process.env.E2E_RUN}-`
