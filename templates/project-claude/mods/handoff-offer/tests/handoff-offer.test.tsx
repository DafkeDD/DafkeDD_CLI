import { expect, test } from 'claude-code/testing'

const BAND = {
    plugin: 'handoff-offer',
    component: 'AbovePrompt',
    props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 3,
        bodyColumns: 100,
        scroll: { offset: 0, bodyRows: 20 },
        view: {}
    }
} as const
const context = (percent: number) => ({ tokens: percent * 2000, window: 200_000, percent })

/** What is drawn beneath this mod in the shared band: the engine, or another mod (checks-desk). */
function beneath(on: any) {
    on('ui.render', ($: any, e: any) => {
        const { Text } = $.ui.resolve(e)
        return <Text>engine</Text>
    })
}

test('a full chat shows the offer; the button puts /handoff in the prompt', async ($, on) => {
    const filled: string[] = []
    on('session.measure', (_, e) => ({ changed: e.changed }))
    beneath(on)
    on('prompt.fill', (_, e) => {
        filled.push(e.text)
        return { isFilled: true }
    })
    await $.session.measure({ context: context(82), changed: ['context'], rateLimits: [] })
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
        const ui = await $.ui.mount({ ...BAND, surface })
        expect((await ui.find({ type: 'Text', text: /82% full/ }))?.text).toBe(
            'The chat is 82% full: write the handoff, then go on in a fresh chat. '
        )
        await ui.unmount()
    }
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    await ui.press({ key: 'handoff' })
    expect(filled).toEqual(['/handoff'])
    await ui.unmount()
})

test('below the limit, or put aside with "Not now", the engine draws the band', async ($, on) => {
    on('session.measure', (_, e) => ({ changed: e.changed }))
    beneath(on)
    await $.session.measure({ context: context(40), changed: ['context'], rateLimits: [] })
    let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
    await ui.unmount()
    await $.session.measure({ context: context(90), changed: ['context'], rateLimits: [] })
    ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    await ui.press({ key: 'later' })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
    await ui.unmount()
})

test('the band is shared: the offer is drawn above what the other mods draw there', async ($, on) => {
    on('session.measure', (_, e) => ({ changed: e.changed }))
    beneath(on)
    await $.session.measure({ context: context(80), changed: ['context'], rateLimits: [] })
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /80% full/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
    await ui.unmount()
})

test('while a survey asks something, the offer stays away and only what is beneath is drawn', async ($, on) => {
    on('session.measure', (_, e) => ({ changed: e.changed }))
    beneath(on)
    await $.session.measure({ context: context(90), changed: ['context'], rateLimits: [] })
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'desktop' })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
    expect(await ui.find({ type: 'Text', text: /full/ })).toBeUndefined()
    await ui.unmount()
})
