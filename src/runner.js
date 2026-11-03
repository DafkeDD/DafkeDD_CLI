import { spawn } from 'node:child_process'

const isWin = process.platform === 'win32'

// Op Windows moeten npm/npx via cmd.exe draaien (.cmd-bestanden). Een volledige
// commandostring zonder args-array vermijdt de Node DEP0190-waarschuwing.
export function quote(arg) {
    return /^[\w@./:=+-]+$/.test(arg) ? arg : `"${String(arg).replace(/"/g, '\\"')}"`
}

/**
 * The values of `--password <value>` and `--password=<value>` in these arguments (the demo data, oidc:user): they are
 * never shown in an error.
 */
export function secretsOf(args) {
    const secrets = []
    args.forEach((arg, index) => {
        if (arg === '--password' && args[index + 1]) secrets.push(String(args[index + 1]))
        else if (String(arg).startsWith('--password=') && arg.length > '--password='.length)
            secrets.push(String(arg).slice('--password='.length))
    })
    return secrets
}

/** `text` with every secret replaced by ***: also in the output, where npm prints the command of a script. */
export const masked = (text, secrets) =>
    // The longest first: a password that is part of another never leaves a piece of the other one
    [...new Set(secrets)]
        .sort((a, b) => b.length - a.length)
        .reduce((result, secret) => result.split(secret).join('***'), text)

/** Voert een commando stil uit (in `cwd`) en gooit een fout met de output als het mislukt. */
export function run(cmd, args, { cwd, env } = {}) {
    return new Promise((resolve, reject) => {
        // No colour codes in the output (npm 12 sets FORCE_COLOR for its scripts); NO_COLOR next to FORCE_COLOR
        // would make Node warn, so only FORCE_COLOR=0 is passed on
        const { NO_COLOR, ...inherited } = process.env
        void NO_COLOR
        const options = {
            cwd,
            env: {
                ...inherited,
                FORCE_COLOR: '0',
                CI: '1',
                NEXT_TELEMETRY_DISABLED: '1',
                NODE_NO_WARNINGS: '1',
                npm_config_update_notifier: 'false',
                ...env
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        }
        const child = isWin
            ? spawn([cmd, ...args].map(quote).join(' '), { ...options, shell: true })
            : spawn(cmd, args, options)

        let out = ''
        child.stdout.on('data', d => (out += d))
        child.stderr.on('data', d => (out += d))
        // A command that cannot start: its error (spawnargs, message) holds the arguments, so a new one without them
        child.on('error', error => {
            const secrets = secretsOf(args)
            reject(
                secrets.length ? Object.assign(new Error(masked(error.message, secrets)), { code: error.code }) : error
            )
        })
        child.on('close', code => {
            if (code === 0) return resolve(out)
            // A password of the arguments is never in the error: not in the command, not in its output
            const secrets = secretsOf(args)
            reject(
                new Error(
                    masked(
                        `"${cmd} ${args.join(' ')}" faalde (exit ${code})\n\n${out.trim().split('\n').slice(-25).join('\n')}`,
                        secrets
                    )
                )
            )
        })
    })
}
