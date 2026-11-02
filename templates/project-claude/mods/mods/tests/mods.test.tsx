import { expect, test } from 'claude-code/testing'

const PANE = {
    plugin: 'mods',
    component: 'Pane',
    requestId: 'mods',
    props: {
        title: 'Mods',
        isFocused: false,
        bodyColumns: 60,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 },
        view: {}
    }
} as const

test('the pane shows each mod, whether it is on, and the command that switches it', async ($, on) => {
    // The merged settings, as a settings.json is keyed
    on('settings.read', () => ({
        value: { enabledPlugins: { 'checks-desk@dafkedd-mods': true, 'screen-share@dafkedd-mods': false } }
    }))
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
        const ui = await $.ui.mount({ ...PANE, surface })
        expect(await ui.find({ type: 'Text', text: 'on  checks-desk' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: '/plugin disable checks-desk@dafkedd-mods' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: 'off screen-share' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: '/plugin enable screen-share@dafkedd-mods' })).toBeDefined()
        await ui.unmount()
    }
})
