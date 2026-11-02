import { expect, test } from 'claude-code/testing'

const VIEW = { scroll: { offset: 0, bodyRows: 20 }, view: {} }
const BAND = {
    plugin: 'checks-desk',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, ...VIEW }
} as const
const PANE = {
    plugin: 'checks-desk',
    component: 'Pane',
    requestId: 'checks-desk',
    props: { title: 'Checks', isFocused: false, bodyColumns: 60, placement: 'dock', ...VIEW }
} as const
const TREE = '4f0a499466b4718ec2b7c8813dc5756bf0378994'

const EARLIER = '9c1e2b7d0a5f4e3c2b1a09f8e7d6c5b4a3928170'

/** The engine beneath the mod: a staged tree, the approval files, a running docs agent, and the band beneath. */
function engine(on: any, approved: string[], isGit = true, earlier: string[] = []) {
    on('command.register', () => ({ value: { command: 'checks' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
    on('process.run', (_: unknown, e: { argv: string[] }) => ({
        value: {
            exitCode: isGit ? 0 : 128,
            stderr: isGit ? '' : 'not a git repository',
            stdout: !isGit ? '' : e.argv.includes('write-tree') ? `${TREE}\n` : '.git/claude-approvals\n',
            isStdoutTruncated: false,
            isStderrTruncated: false
        }
    }))
    on('fs.list', (_: unknown, e: { path: string }) => ({
        value: e.path.endsWith('.git/claude-approvals')
            ? [
                  ...approved.map(kind => ({ name: `${kind}-${TREE}`, type: 'file' })),
                  ...earlier.map(kind => ({ name: `${kind}-${EARLIER}`, type: 'file' })),
                  // Not a tree: never an approval
                  { name: 'security-notes', type: 'file' }
              ]
            : []
    }))
    on('ui.render', ($: any, e: any) => {
        const { Text } = $.ui.resolve(e)
        return <Text>engine</Text>
    })
    on('agent.list', () => ({
        value: [
            { id: '1', description: 'Review', type: 'reviewer', status: 'completed' },
            { id: '2', description: 'Docs', type: 'docs', status: 'running' }
        ]
    }))
}

test('the bar shows every check of the staged tree, on every surface', async ($, on) => {
    engine(on, ['review', 'tests'])
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
        const ui = await $.ui.mount({ ...BAND, surface })
        expect((await ui.find({ type: 'Text', text: /✓ review/ }))?.text).toBe('✓ review  ✓ tests  … docs  · i18n ')
        await ui.unmount()
    }
})

test('the pane has a card per check: approved, running, not run', async ($, on) => {
    engine(on, ['review'])
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: 'approved for the staged tree' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'running' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'not run yet' })).toBeDefined()
    // security never ran and is not needed by itself: no card
    expect(await ui.find({ type: 'Text', text: /security/ })).toBeUndefined()
    await ui.unmount()
})

test('without a staged tree (no git) the bar stays away', async ($, on) => {
    engine(on, [], false)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
    await ui.unmount()
})

test('an approval for an earlier tree shows as such: the commit hook decides if it still counts', async ($, on) => {
    engine(on, [], true, ['review', 'i18n'])
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await band.find({ type: 'Text', text: /✗ review/ }))?.text).toBe('✗ review  · tests  … docs  ≈ i18n ')
    await band.unmount()
    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    // Only for a check whose earlier approval the commit hook may take: the review always needs this tree
    expect(await pane.find({ type: 'Text', text: /^approved for an earlier tree/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'ran, not approved for this tree: read its report' })).toBeDefined()
    // A file in the folder that is not named after a tree (security-notes) is no earlier approval: no security card
    expect(await pane.find({ type: 'Text', text: /security/ })).toBeUndefined()
    await pane.unmount()
})

test('the to-do list of the session: created and updated tasks, how many are done and in progress', async ($, on) => {
    engine(on, ['review'])
    on('tool.call', (_: unknown, e: any) =>
        e.tool === 'TaskCreate'
            ? { result: { task: { id: e.subject, subject: e.subject } } }
            : { result: { success: true, taskId: e.taskId } }
    )
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    for (const subject of ['Write tests', 'Build it', 'Check it'])
        await $.tool.call({ tool: 'TaskCreate', subject, description: subject, tool_use_id: subject } as never)
    await $.tool.call({ tool: 'TaskUpdate', taskId: 'Write tests', status: 'completed', tool_use_id: 'u1' } as never)
    await $.tool.call({ tool: 'TaskUpdate', taskId: 'Build it', status: 'in_progress', tool_use_id: 'u2' } as never)
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: 'Tasks 1 of 3 done, 1 in progress' })).toBeDefined()
    // The band is shared: what is drawn beneath stays, below these lines
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
    // Never a subject: screen-share cannot mask what is drawn above it
    expect(await ui.find({ type: 'Text', text: /Build it/ })).toBeUndefined()
    await ui.unmount()
})

test('while a survey asks something, the checks stay away and only what is beneath is drawn', async ($, on) => {
    engine(on, ['review', 'tests'])
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'desktop' })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
    expect(await ui.find({ type: 'Text', text: /review/ })).toBeUndefined()
    await ui.unmount()
})
