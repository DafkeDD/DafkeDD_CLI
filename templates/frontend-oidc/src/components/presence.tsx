'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { OwnPresence, PresenceStatus, ShownPresence } from '@/lib/portal'

/** No mouse, keyboard, scrolling or touch for this long: "available" shows as "away" (like Microsoft Teams). */
export const IDLE_MS = 5 * 60_000
/** The last use, shared by the tabs of this browser: working in one tab keeps the others active too. */
const ACTIVITY_KEY = 'pp-last-activity'
const EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

let lastActivity = Date.now()

function lastUse() {
    try {
        return Math.max(lastActivity, Number(localStorage.getItem(ACTIVITY_KEY)) || 0)
    } catch {
        return lastActivity
    }
}

/**
 * The own presence. Every minute a heartbeat (POST /me/heartbeat through /api/backend): online, and idle after 15
 * minutes without use. The chosen status and the out-of-office reply come from GET /me/status; a new status shows at
 * once and goes back when the API refuses it. `shown` is what others see.
 */
export function usePresence() {
    const [view, setView] = useState<OwnPresence | null>(null)
    const [idle, setIdle] = useState(false)
    const idleRef = useRef(false)

    useEffect(() => {
        let alive = true
        fetch('/api/backend/me/status')
            .then(response => (response.ok ? (response.json() as Promise<OwnPresence>) : null))
            .then(body => {
                if (alive && body) setView(body)
            })
            .catch(() => undefined)
        return () => {
            alive = false
        }
    }, [])

    useEffect(() => {
        const beat = () =>
            void fetch('/api/backend/me/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idle: idleRef.current })
            }).catch(() => undefined)
        /** Idle or not (again): true when that changed. */
        const check = () => {
            const now = Date.now() - lastUse() >= IDLE_MS
            if (now === idleRef.current) return false
            idleRef.current = now
            setIdle(now)
            return true
        }
        let shared = 0
        const used = () => {
            lastActivity = Date.now()
            // The other tabs read it; written at most every 10 seconds (mousemove fires often)
            if (lastActivity - shared > 10_000) {
                shared = lastActivity
                try {
                    localStorage.setItem(ACTIVITY_KEY, String(lastActivity))
                } catch {
                    /* storage blocked: only this tab counts */
                }
            }
            // Back after a while: tell it at once, not at the next heartbeat
            if (idleRef.current && check()) beat()
        }
        const visible = () => {
            if (document.visibilityState === 'visible') used()
        }
        beat()
        // Also in a hidden tab: the page is open, so the account stays online (and turns away when nobody uses it)
        const heartbeat = setInterval(() => {
            check()
            beat()
        }, 60_000)
        const watch = setInterval(() => {
            if (check()) beat()
        }, 15_000)
        for (const name of EVENTS) window.addEventListener(name, used, { passive: true, capture: true })
        document.addEventListener('visibilitychange', visible)
        return () => {
            clearInterval(heartbeat)
            clearInterval(watch)
            for (const name of EVENTS) window.removeEventListener(name, used, { capture: true })
            document.removeEventListener('visibilitychange', visible)
        }
    }, [])

    const setStatus = useCallback(
        async (next: PresenceStatus) => {
            const before = view
            if (before) setView({ ...before, status: next })
            const response = await fetch('/api/backend/me/status', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: next })
            }).catch(() => null)
            if (response?.ok) setView((await response.json()) as OwnPresence)
            else setView(before)
        },
        [view]
    )

    const shown: ShownPresence | null = !view
        ? null
        : view.outOfOffice.active
          ? 'ooo'
          : view.status === 'available' && idle
            ? 'away'
            : view.status
    return {
        status: view?.status ?? null,
        outOfOffice: view?.outOfOffice ?? null,
        idle,
        shown,
        setStatus,
        apply: setView
    }
}

/** The heartbeat on its own, for a page without the shell's status menu. Renders nothing. */
export function Presence() {
    usePresence()
    return null
}
