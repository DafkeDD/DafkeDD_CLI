import cliProgress from 'cli-progress'
import pc from 'picocolors'

/**
 * Eén progressbar voor ALLE stappen. Tijdens een stap loopt de balk geleidelijk
 * door (nooit voorbij het einde van die stap), zodat hij nooit "vastzit".
 * steps: [{ title, weight?, run: async () => void }]
 */
export async function runSteps(steps) {
    const weightOf = s => s.weight ?? 1
    const total = steps.reduce((sum, s) => sum + weightOf(s), 0)

    const bar = new cliProgress.SingleBar(
        {
            format: `${pc.cyan('{bar}')} {percentage}% | {task}`,
            barCompleteChar: '█',
            barIncompleteChar: '░',
            barsize: 30,
            hideCursor: true,
            clearOnComplete: false,
            stopOnComplete: false,
            forceRedraw: true
        },
        cliProgress.Presets.shades_classic
    )
    bar.start(total, 0, { task: steps[0]?.title ?? '' })

    let done = 0
    let current = steps[0]
    let value = 0
    let timer

    try {
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i]
            current = step
            const label = `${step.title} (${i + 1}/${steps.length})`
            const ceiling = done + weightOf(step) * 0.95

            value = done
            bar.update(value, { task: label })
            // Loopt langzaam richting het einde van de stap, maar nooit erover.
            timer = setInterval(() => {
                value += (ceiling - value) * 0.04
                bar.update(value, { task: label })
            }, 200)

            try {
                await step.run()
            } finally {
                clearInterval(timer)
            }

            done += weightOf(step)
            bar.update(done, { task: label })
        }
        bar.update(total, { task: pc.green('Klaar!') })
        bar.stop()
    } catch (err) {
        clearInterval(timer)
        bar.stop()
        console.error(`\n${pc.red('✖ Mislukt bij:')} ${pc.bold(current.title)}`)
        throw err
    }
}
