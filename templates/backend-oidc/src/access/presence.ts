import type { Presence as ChosenPresence } from '../oidc/store/oidc.store.js'

/**
 * Who is online right now: every authenticated request of an account counts (the frontend sends a heartbeat every
 * minute while a page is open). Kept in memory, per API process: after a restart everybody is "offline" until their
 * next request, at most a minute later.
 */
export const ONLINE_MS = 2 * 60_000

class Presence {
    private readonly seen = new Map<string, number>()
    /** The accounts whose last heartbeat said: no mouse or keyboard for 5 minutes. */
    private readonly idle = new Set<string>()

    /** The account made a request. */
    touch(userId: string) {
        if (this.seen.size > 50_000) this.seen.clear()
        this.seen.set(userId, Date.now())
    }

    /** Whether the account made a request in the last two minutes. */
    isOnline(userId: string) {
        return Date.now() - (this.seen.get(userId) ?? 0) < ONLINE_MS
    }

    /** What the last heartbeat said: the page is open, but nobody used it for a while. */
    setIdle(userId: string, idle: boolean) {
        if (!idle) this.idle.delete(userId)
        else if (this.idle.size < 50_000) this.idle.add(userId)
    }

    isIdle(userId: string) {
        return this.idle.has(userId)
    }

    /** For tests: forget everybody. */
    clear() {
        this.seen.clear()
        this.idle.clear()
    }
}

export const presence = new Presence()

/** The status others see: the chosen one, or ooo (out of office), away (idle while available) or offline. */
export type ShownPresence = ChosenPresence | 'ooo'

export function shownPresence(input: {
    online: boolean
    chosen: ChosenPresence
    idle: boolean
    outOfOffice: boolean
}): ShownPresence {
    // Out of office wins, also while offline: that is when it matters
    if (input.outOfOffice) return 'ooo'
    if (!input.online || input.chosen === 'offline') return 'offline'
    // Like Microsoft Teams: only "available" turns into "away" by itself; a chosen "busy" stays
    if (input.chosen === 'available' && input.idle) return 'away'
    return input.chosen
}
