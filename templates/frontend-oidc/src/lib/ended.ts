import { SESSION_SECONDS } from './oidc'

/**
 * Sessions of the login server that ended (back-channel logout), by their sid, until they would have run out anyway.
 * The session cookie of a browser with such a sid no longer counts. In the memory of this server process, on
 * globalThis so the proxy and the route handlers share it; with several processes behind a load balancer, keep this
 * in a shared store (Redis, the database) instead.
 */
const ended = ((globalThis as typeof globalThis & { __oidcEnded?: Map<string, number> }).__oidcEnded ??= new Map<
    string,
    number
>())

export function endSession(sid: string) {
    const now = Date.now()
    if (ended.size > 10_000) for (const [key, until] of ended) if (until < now) ended.delete(key)
    ended.set(sid, now + SESSION_SECONDS * 1000)
}

export function sessionEnded(sid: string | undefined): boolean {
    if (!sid) return false
    const until = ended.get(sid)
    return until !== undefined && until > Date.now()
}
