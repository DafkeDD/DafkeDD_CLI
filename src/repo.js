import { basename } from 'node:path';
import { existsSync } from 'node:fs';
import { input, select } from '@inquirer/prompts';
import { run } from './runner.js';

export const platforms = {
  github: { id: 'github', label: 'GitHub' },
};

/** Vragen: repo-naam, platform (voorlopig enkel GitHub) en zichtbaarheid. */
export async function askRepo({ projectDir }) {
  const name = await input({
    message: 'Hoe wil je de repo noemen?',
    default: basename(projectDir).replace(/[^\w.-]/g, '-'),
    validate: (v) => /^[\w.-]+$/.test(v.trim()) || 'Gebruik enkel letters, cijfers, punt, streepje of underscore',
  });
  const platform = await select({
    message: 'Op welk platform wil je pushen?',
    choices: Object.values(platforms).map((p) => ({ name: p.label, value: p.id })),
  });
  const visibility = await select({
    message: 'Zichtbaarheid van de repo?',
    choices: [
      { name: 'Private', value: 'private' },
      { name: 'Public', value: 'public' },
    ],
  });
  return { name: name.trim(), platform, visibility };
}

/** Stappen: git init, eerste commit, repo aanmaken en pushen. */
export function repoSteps({ projectDir, repo }) {
  return [
    {
      title: 'Git initialiseren',
      weight: 1,
      run: async () => {
        if (!existsSync(`${projectDir}/.git`)) await run('git', ['init', '-b', 'main'], { cwd: projectDir });
        await run('git', ['add', '-A'], { cwd: projectDir });
        await run('git', ['commit', '-m', 'Initial commit'], { cwd: projectDir });
      },
    },
    {
      title: `Repo "${repo.name}" aanmaken op GitHub en pushen`,
      weight: 2,
      run: async () => {
        try {
          await run('gh', ['auth', 'status'], { cwd: projectDir });
        } catch {
          throw new Error('GitHub CLI (gh) is niet geïnstalleerd of niet ingelogd. Voer "gh auth login" uit en probeer opnieuw.');
        }
        await run('gh', ['repo', 'create', repo.name, `--${repo.visibility}`, '--source=.', '--remote=origin', '--push'], {
          cwd: projectDir,
        });
      },
    },
  ];
}
