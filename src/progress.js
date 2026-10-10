import cliProgress from 'cli-progress';
import pc from 'picocolors';

/**
 * Eén progressbar voor ALLE stappen.
 * steps: [{ title, weight?, run: async () => void }]
 */
export async function runSteps(steps) {
  const total = steps.reduce((s, st) => s + (st.weight ?? 1), 0);
  const bar = new cliProgress.SingleBar(
    {
      format: `${pc.cyan('{bar}')} {percentage}% | {task}`,
      barCompleteChar: '█',
      barIncompleteChar: '░',
      barsize: 30,
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: false,
    },
    cliProgress.Presets.shades_classic,
  );
  bar.start(total, 0, { task: steps[0]?.title ?? '' });

  let done = 0;
  let current = steps[0];
  try {
    for (const step of steps) {
      current = step;
      bar.update(done, { task: step.title });
      await step.run();
      done += step.weight ?? 1;
      bar.update(done, { task: step.title });
    }
    bar.update(total, { task: pc.green('Klaar!') });
    bar.stop();
  } catch (err) {
    bar.stop();
    console.error(`\n${pc.red('✖ Mislukt bij:')} ${pc.bold(current.title)}`);
    throw err;
  }
}
