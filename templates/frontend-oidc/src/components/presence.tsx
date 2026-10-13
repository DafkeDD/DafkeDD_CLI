'use client'

import { useEffect } from 'react'

/** Every minute while the page is visible: "I am here" (POST /me/heartbeat through /api/backend). Renders nothing. */
export function Presence() {
    useEffect(() => {
        const beat = () => {
            if (document.visibilityState !== 'visible') return
            void fetch('/api/backend/me/heartbeat', { method: 'POST' }).catch(() => undefined)
        }
        beat()
        const timer = setInterval(beat, 60_000)
        document.addEventListener('visibilitychange', beat)
        return () => {
            clearInterval(timer)
            document.removeEventListener('visibilitychange', beat)
        }
    }, [])
    return null
}
