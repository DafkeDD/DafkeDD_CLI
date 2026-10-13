import { Injectable } from '@nestjs/common'
import { OidcConfig } from './oidc.config.js'

const WINDOW_MS = 60_000

/**
 * Counts login attempts per key (an IP address, an email address) in a sliding window of one minute, in memory.
 * With several API instances each instance counts on its own; a shared counter in the database follows in a later phase.
 */
@Injectable()
export class LoginLimiter {
    private readonly attempts = new Map<string, number[]>()

    constructor(private readonly config: OidcConfig) {}

    /** Registers an attempt for every key. Returns false when one of them is over the limit. */
    allow(keys: string[], now = Date.now()): boolean {
        this.prune(now)
        let allowed = true
        for (const key of keys) {
            const recent = (this.attempts.get(key) ?? []).filter(time => now - time < WINDOW_MS)
            recent.push(now)
            this.attempts.set(key, recent)
            if (recent.length > this.config.loginRateLimit) allowed = false
        }
        return allowed
    }

    /** Forgets every attempt (used by the tests). */
    clear(): void {
        this.attempts.clear()
    }

    private prune(now: number) {
        if (this.attempts.size < 10_000) return
        for (const [key, times] of this.attempts) {
            if (times.every(time => now - time >= WINDOW_MS)) this.attempts.delete(key)
        }
    }
}
