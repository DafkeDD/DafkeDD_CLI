import { select } from '@inquirer/prompts';
import pc from 'picocolors';
import { runSteps } from './progress.js';
import { frontends } from './frontends/index.js';

export async function main() {
  const projectDir = process.cwd();

  console.log(pc.bold('\nDafkeDD_CLI') + pc.dim('  (alles wordt lokaal in dit project geïnstalleerd, nooit globaal)'));
  console.log(pc.dim(`Projectmap: ${projectDir}\n`));

  const choice = await select({
    message: 'Welke frontend wil je installeren?',
    choices: Object.values(frontends).map((f) => ({
      name: f.label,
      value: f.id,
      description: f.description,
    })),
  });

  const frontend = frontends[choice];
  const answers = (await frontend.ask?.({ projectDir })) ?? {};
  const steps = await frontend.steps({ projectDir, answers });

  console.log('');
  await runSteps(steps);

  console.log(`\n${pc.green('✔')} ${frontend.label} geïnstalleerd in ${pc.bold('./' + frontend.dir)}`);
  for (const line of frontend.next ?? []) console.log(pc.dim('  ' + line));
  console.log('');
}
