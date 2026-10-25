import { getLocale } from 'next-intl/server'
import { PASPORT_API_URL as API_URL } from '@/lib/pasport'
import type { Session } from '@/lib/oidc'

/**
 * Calls the protected API from a server component with the access token of the session. Returns null when the call
 * fails (the page then renders without that part instead of breaking).
 */
export async function serverApi<T>(session: Session, path: string): Promise<T | null> {
    try {
        const response = await fetch(`${API_URL}/${path}`, {
            headers: {
                Authorization: 'Bearer ' + session.accessToken,
                Accept: 'application/json',
                'Accept-Language': await getLocale()
            },
            cache: 'no-store'
        })
        return response.ok ? ((await response.json()) as T) : null
    } catch {
        return null
    }
}
