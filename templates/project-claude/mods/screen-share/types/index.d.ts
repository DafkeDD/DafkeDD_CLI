/** Whether the screen is masked, and the words (names) to hide besides the patterns. */
export type Share = { isOn: boolean; words: string[] }

declare module 'claude-code' {
    interface PluginState {
        'screen-share': { share: Share }
    }
}
