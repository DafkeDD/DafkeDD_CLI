import { expect, test } from 'claude-code/testing'

import { command, mask, maskDeep, maskTree } from '../hooks/register'

const VIEW = { scroll: { offset: 0, bodyRows: 20 }, view: {} }

test('mask hides e-mail, phone, IBAN, national register and company numbers, amounts and added words', () => {
    expect(mask('Mail anna@example.com or call +32 470 12 34 56.')).toBe('Mail •••• or call ••••.')
    expect(mask('IBAN BE68 5390 0754 7034, paid € 1.250,00 and 300 EUR')).toBe('IBAN ••••, paid •••• and ••••')
    expect(mask('Patient 85.07.30-033.61, company BE 0123.456.789')).toBe('Patient ••••, company ••••')
    expect(mask('Anna Peeters signed', ['Anna Peeters'])).toBe('•••• signed')
    expect(mask('Version 0.54.25 on port 3000, 12 rows')).toBe('Version 0.54.25 on port 3000, 12 rows')
    expect(maskDeep({ rows: [{ email: 'bart@example.com', n: 3 }] })).toEqual({ rows: [{ email: '••••', n: 3 }] })
})

test('an added word is masked only as a whole word', () => {
    expect(mask('Jan and Janssens', ['Jan'])).toBe('•••• and Janssens')
})

test('mask never draws something it cannot read: a text that is no string becomes ••••', () => {
    expect(mask(42 as never)).toBe('••••')
    expect(
        maskTree({ type: 'Box', children: ['to anna@example.com', { type: 'Text', children: ['Jan'] }] }, ['Jan'])
    ).toEqual({ type: 'Box', children: ['to ••••', { type: 'Text', children: ['••••'] }] })
})

test('on and off say what they mean; on twice stays on; an unknown word changes nothing', () => {
    const off = { isOn: false, words: [] }
    const on = command('on', off).state
    expect(on.isOn).toBe(true)
    expect(command('on', on).state.isOn).toBe(true)
    expect(command('off', on).state.isOn).toBe(false)
    expect(command('', on).state.isOn).toBe(false)
    expect(command('aan', on)).toEqual({ state: on, text: expect.stringContaining('/screen-share on') })
    // The reply never puts the hidden word on screen
    const hidden = command('hide Anna Peeters', off)
    expect(hidden.state).toEqual({ isOn: true, words: ['Anna Peeters'] })
    expect(hidden.text).not.toContain('Anna')
})

/** The engine beneath: it draws the text it is handed, or a pane with an e-mail address. */
function engine(on: any) {
    on('command.register', () => ({ value: { command: 'screen-share' } }))
    on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.render', ($: any, e: any) => {
        const { Box, Button, Text } = $.ui.resolve(e)
        if (e.component === 'Pane')
            return (
                <Box>
                    <Text>{'diff of anna@example.com'}</Text>
                    <Button key='next' label='Next: Jan' onPress={() => undefined} />
                </Box>
            )
        if (typeof e.props.text !== 'string') throw new Error('no text')
        return <Text>{e.props.text}</Text>
    })
}

test('on: a message is drawn masked; off: as it is; the stored text never changes', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const row = {
        plugin: 'screen-share',
        component: 'AssistantMessage',
        surface: 'desktop',
        props: { text: 'Invite anna@example.com', isFirstOfReply: true, ...VIEW }
    } as never
    let ui = await $.ui.mount(row)
    expect((await ui.find({ type: 'Text' }))?.text).toBe('Invite anna@example.com')
    await ui.unmount()
    await $.command.run({ command: 'screen-share', args: 'on', origin: 'user' } as never)
    ui = await $.ui.mount(row)
    expect((await ui.find({ type: 'Text' }))?.text).toBe('Invite ••••')
    await ui.unmount()
})

test('on: a pane drawn by another mod (replay-theater) and the output of a command are masked too', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'screen-share', args: 'hide Jan', origin: 'user' } as never)
    const pane = await $.ui.mount({
        plugin: 'screen-share',
        component: 'Pane',
        requestId: 'replay-theater',
        surface: 'desktop',
        props: { title: 'Replay', isFocused: false, bodyColumns: 60, placement: 'dock', ...VIEW }
    } as never)
    expect((await pane.find({ type: 'Text' }))?.text).toBe('diff of ••••')
    expect((await pane.find({ type: 'Button' }))?.props?.label).toBe('Next: ••••')
    await pane.unmount()
    const output = await $.ui.mount({
        plugin: 'screen-share',
        component: 'CommandOutput',
        surface: 'desktop',
        props: { command: 'cost', args: '', text: 'Sent to anna@example.com', isErrored: false }
    } as never)
    expect((await output.find({ type: 'Text' }))?.text).toBe('Sent to ••••')
    await output.unmount()
})

test('on: when drawing a row fails, it is drawn as •••• and never as it was', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'screen-share', args: 'on', origin: 'user' } as never)
    const group = await $.ui.mount({
        plugin: 'screen-share',
        component: 'ToolGroup',
        surface: 'desktop',
        props: { calls: [], isActive: false, isExpanded: false }
    } as never)
    expect((await group.find({ type: 'Text' }))?.text).toBe('••••')
    await group.unmount()
})

/** The engine beneath every row: it draws every string of the props it is handed, or throws when asked to. */
function rows(on: any, failing: string[] = []) {
    on('command.register', () => ({ value: { command: 'screen-share' } }))
    on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.render', ($: any, e: any) => {
        if (failing.includes(e.component)) throw new Error('beneath fails')
        const { Text } = $.ui.resolve(e)
        const { text, input, output } = e.props
        const shown = text ?? input ?? output ?? 'to anna@example.com'
        return <Text>{typeof shown === 'string' ? shown : JSON.stringify(shown)}</Text>
    })
}

const ROWS = [
    ['UserMessage', { text: 'to anna@example.com', ...VIEW }],
    ['ToolUse', { tool: 'Bash', input: { command: 'mail anna@example.com' }, ...VIEW }],
    ['ToolResult', { tool: 'Bash', output: 'sent to anna@example.com', ...VIEW }],
    ['AbovePrompt', { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, ...VIEW }],
    ['Placed', { bodyColumns: 60, ...VIEW }]
] as const
/** Every row screen-share hooks: the five above and the four with tests of their own. */
const ALL = [
    ...ROWS,
    ['AssistantMessage', { text: 'to anna@example.com', isFirstOfReply: true, ...VIEW }],
    ['CommandOutput', { command: 'cost', args: '', text: 'to anna@example.com', isErrored: false }],
    ['ToolGroup', { calls: [], isActive: false, isExpanded: false }],
    ['Pane', { title: 'Replay', isFocused: false, bodyColumns: 60, placement: 'dock', ...VIEW }]
] as const

test('on: the other rows are masked: a sent prompt, a tool call and result, the band, a tree', async ($, on) => {
    rows(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'screen-share', args: 'on', origin: 'user' } as never)
    for (const [component, props] of ROWS) {
        const ui = await $.ui.mount({ plugin: 'screen-share', component, surface: 'desktop', props } as never)
        const text = (await ui.find({ type: 'Text' }))?.text ?? ''
        expect(text.includes('anna@example.com') ? component : '').toBe('')
        expect(text.includes('••••') ? '' : component).toBe('')
        await ui.unmount()
    }
})

test('on: when what is drawn beneath a pane or the band fails, it is drawn as ••••', async ($, on) => {
    rows(on, ['Pane', 'AbovePrompt'])
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'screen-share', args: 'on', origin: 'user' } as never)
    const pane = await $.ui.mount({
        plugin: 'screen-share',
        component: 'Pane',
        requestId: 'replay-theater',
        surface: 'desktop',
        props: { title: 'Replay', isFocused: false, bodyColumns: 60, placement: 'dock', ...VIEW }
    } as never)
    expect((await pane.find({ type: 'Text' }))?.text).toBe('••••')
    await pane.unmount()
    const band = await $.ui.mount({
        plugin: 'screen-share',
        component: 'AbovePrompt',
        surface: 'desktop',
        props: ROWS[3][1]
    } as never)
    expect((await band.find({ type: 'Text' }))?.text).toBe('••••')
    await band.unmount()
})

test('when the hook itself fails (its state is unreadable), the row is •••• and never as it was', async ($, on) => {
    rows(on)
    // The engine answers no state: reading it throws inside the hook, before anything is masked
    on('state.get', () => ({ value: null }) as never)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    for (const [component, props] of ALL) {
        const ui = await $.ui.mount({ plugin: 'screen-share', component, surface: 'desktop', props } as never)
        expect((await ui.find({ type: 'Text' }))?.text).toBe('••••')
        await ui.unmount()
    }
})

test('on: a folded group of tool calls is unfolded, so its count line with paths is never drawn', async ($, on) => {
    on('command.register', () => ({ value: { command: 'screen-share' } }))
    on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
    on('ui.status', () => ({ value: undefined }))
    // The engine beneath: folded, its line shows a path with a name; unfolded, it draws the (masked) rows
    on('ui.render', ($: any, e: any) => {
        const { Text } = $.ui.resolve(e)
        return <Text>{e.props.isExpanded ? 'rows' : 'Read /home/anna@example.com/notes.txt'}</Text>
    })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'screen-share', args: 'on', origin: 'user' } as never)
    const ui = await $.ui.mount({
        plugin: 'screen-share',
        component: 'ToolGroup',
        surface: 'desktop',
        props: { calls: [], isActive: false, isExpanded: false }
    } as never)
    expect((await ui.find({ type: 'Text' }))?.text).toBe('rows')
    await ui.unmount()
})

test('on: when only the masked drawing fails beneath, the row is •••• and never redrawn as it was', async ($, on) => {
    on('command.register', () => ({ value: { command: 'screen-share' } }))
    on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
    on('ui.status', () => ({ value: undefined }))
    // Beneath fails for a masked text and draws anything else: a retry with the real text would show it
    on('ui.render', ($: any, e: any) => {
        const { Text } = $.ui.resolve(e)
        if (String(e.props.text ?? '').includes('••••')) throw new Error('cannot draw a mask')
        return <Text>{String(e.props.text)}</Text>
    })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'screen-share', args: 'on', origin: 'user' } as never)
    const row = await $.ui.mount({
        plugin: 'screen-share',
        component: 'UserMessage',
        surface: 'desktop',
        props: ROWS[0][1]
    } as never)
    expect((await row.find({ type: 'Text' }))?.text).toBe('••••')
    await row.unmount()
})
