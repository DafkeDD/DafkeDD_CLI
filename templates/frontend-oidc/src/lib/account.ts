'use client'

import { useLocale } from 'next-intl'
import { PASPORT_API_URL } from '@/lib/pasport'

export interface Answer {
    status: number
    body: Record<string, unknown>
    /** The translated message of an error (several validation messages on separate lines). */
    message: string
}

async function answer(response: Response): Promise<Answer> {
    const body = ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
    const message = Array.isArray(body.message) ? body.message.join('\n') : String(body.message ?? '')
    return { status: response.status, body, message }
}

/**
 * Calls the account endpoints of the login server (/oidc/account/...) directly: they need no session, only the
 * language of the page (Accept-Language) for translated errors and emails.
 */
export function useAccountApi() {
    const locale = useLocale()
    return async (path: string, body?: object): Promise<Answer> =>
        answer(
            await fetch(`${PASPORT_API_URL}/oidc/account/${path}`, {
                method: body ? 'POST' : 'GET',
                headers: {
                    Accept: 'application/json',
                    'Accept-Language': locale,
                    ...(body ? { 'Content-Type': 'application/json' } : {})
                },
                body: body ? JSON.stringify(body) : undefined
            })
        )
}

/**
 * Calls the protected API (/tenants/current/..., /admin/...) through /api/backend: that route handler adds the access
 * token of the session on the server, so the token never reaches the browser.
 */
export function useBackend() {
    const locale = useLocale()
    return async (path: string, method = 'GET', body?: object): Promise<Answer> =>
        answer(
            await fetch(`/api/backend/${path}`, {
                method,
                headers: {
                    Accept: 'application/json',
                    'Accept-Language': locale,
                    ...(body ? { 'Content-Type': 'application/json' } : {})
                },
                body: body ? JSON.stringify(body) : undefined
            })
        )
}
