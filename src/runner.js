import { spawn } from 'node:child_process'

const isWin = process.platform === 'win32'

// Op Windows moeten npm/npx via cmd.exe draaien (.cmd-bestanden). Een volledige
// commandostring zonder args-array vermijdt de Node DEP0190-waarschuwing.
export function quote(arg) {
    return /^[\w@./:=+-]+$/.test(arg) ? arg : `"${String(arg).replace(/"/g, '\\"')}"`
}

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
        child.on('error', reject)
        child.on('close', code => {
            if (code === 0) return resolve(out)
            reject(
                new Error(
                    `"${cmd} ${args.join(' ')}" faalde (exit ${code})\n\n${out.trim().split('\n').slice(-25).join('\n')}`
                )
            )
        })
    })
}
