import { spawn } from 'node:child_process';

/** Voert een commando stil uit (in `cwd`) en gooit een fout met de output als het mislukt. */
export function run(cmd, args, { cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, CI: '1', NEXT_TELEMETRY_DISABLED: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(out);
      reject(new Error(`"${cmd} ${args.join(' ')}" faalde (exit ${code})\n\n${out.trim().split('\n').slice(-25).join('\n')}`));
    });
  });
}
