/** How full the context window was at the last measure, and whether the offer was put aside. */
export type Offer = { percent: number; isDismissed: boolean }

declare module 'claude-code' {
    interface PluginState {
        'handoff-offer': { offer: Offer }
    }
}
