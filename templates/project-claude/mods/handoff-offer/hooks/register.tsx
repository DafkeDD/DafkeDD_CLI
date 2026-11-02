import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Offer } from '../types'

/*
 * When the context window of the chat gets full, a bar above the prompt offers to write the handoff: the `handoff`
 * skill writes .claude/handoff.md, and a fresh chat starts from it with everything that matters. It only offers: the
 * button puts `/handoff` in the prompt, and the person sends it. No model call, no file written by the mod itself.
 */

/** From this share of the window (percent) the offer shows. */
export const FROM = 75

const offer = atom({ plugin: 'handoff-offer', key: 'offer' } as const, { percent: 0, isDismissed: false } as Offer)

/** Shows the offer: full enough, not put aside, and nothing else asking the person (a survey). */
export const isShown = (state: Offer, hasSurvey: boolean) => !hasSurvey && !state.isDismissed && state.percent >= FROM

export const register: Register = on => {
    // After each turn of the main chat the engine measures the window: keep the share, redraw when it changes
    on('session.measure', async ($, e, next) => {
        const percent = Math.round(e.context.percent ?? 0)
        await update($, offer, state => ({ ...state, percent }))
        return next(e)
    })

    // A compact or a fresh start empties the window: the offer comes back the next time it gets full
    on('session.start', async ($, e, next) => {
        await update($, offer, () => ({ percent: 0, isDismissed: false }))
        return next(e)
    })

    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
        const state = await read($, offer)
        // The band is shared: what the other mods draw there stays, below the offer
        const below = await next(e)
        if (!isShown(state, e.props.hasSurvey)) return below
        const { Box, Button, Text } = $.ui.resolve(e)
        return (
            <Box flexDirection='column'>
                <Box>
                    <Text>The chat is {state.percent}% full: write the handoff, then go on in a fresh chat. </Text>
                    <Button
                        key='handoff'
                        label='Write the handoff'
                        onPress={() => $.prompt.fill({ text: '/handoff' })}
                    />
                    <Text> </Text>
                    <Button
                        key='later'
                        label='Not now'
                        onPress={() => update($, offer, s => ({ ...s, isDismissed: true }))}
                    />
                </Box>
                {below}
            </Box>
        )
    })
}
