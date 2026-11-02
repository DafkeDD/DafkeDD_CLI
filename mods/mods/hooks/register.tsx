import type { EngineInterface, Register } from 'claude-code'

/*
 * /mods: the mods of this project's marketplace (mods/.claude-plugin/marketplace.json), whether each is on, and the
 * command that switches it. A mod cannot switch plugins itself (the settings are read-only to it), so the pane shows the
 * command for the person: /plugin enable or disable <name>@dafkedd-mods, then /reload-plugins.
 */

export const MARKETPLACE = 'dafkedd-mods'
const PANE = 'mods'

/** The mods of the marketplace, with what each does. */
export const MODS = [
    { name: 'checks-desk', text: 'The checking agents at a glance (/checks)' },
    { name: 'handoff-offer', text: 'Offers the handoff when the chat gets full' },
    { name: 'screen-share', text: 'Hides personal data on screen while recording (/screen-share)' },
    { name: 'replay-theater', text: 'Steps through the edits of the last turn (/replay), by Anthropic' },
    { name: 'mods', text: 'This list (/mods)' }
]

/** Which mods of the marketplace are on (enabledPlugins of the merged settings). */
async function enabled($: EngineInterface): Promise<Record<string, boolean>> {
    const all = ((await $.settings.read({ key: 'enabledPlugins' }).catch(() => ({}))) ?? {}) as Record<string, boolean>
    return Object.fromEntries(MODS.map(mod => [mod.name, all[`${mod.name}@${MARKETPLACE}`] === true]))
}

export const register: Register = on => {
    on('session.start', async ($, e, next) => {
        await $.command.register({ name: 'mods', description: 'Show the mods of this project and how to switch them' })
        return next(e)
    })

    on('command.run', { command: 'mods' }, async $ => {
        await $.ui.open({ id: PANE, title: 'Mods' })
        return { text: 'The mods pane is open.' }
    })

    on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
        const { Box, Text } = $.ui.resolve(e)
        const isOn = await enabled($)
        return (
            <Box flexDirection='column'>
                {MODS.map(mod => (
                    <Box key={mod.name} flexDirection='column' marginBottom={1}>
                        <Text bold>{`${isOn[mod.name] ? 'on ' : 'off'} ${mod.name}`}</Text>
                        <Text dimColor>{mod.text}</Text>
                        <Text
                            dimColor
                        >{`/plugin ${isOn[mod.name] ? 'disable' : 'enable'} ${mod.name}@${MARKETPLACE}`}</Text>
                    </Box>
                ))}
                <Text dimColor>After a change: /reload-plugins</Text>
            </Box>
        )
    })
}
