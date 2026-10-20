import { API_URL } from './api'

/**
 * The API of the login server (Pasport): accounts, members, licences, the heartbeat. On the login server itself that
 * is its own API; an app linked to it has an API of its own and sets NEXT_PUBLIC_PASPORT_API_URL.
 */
export const PASPORT_API_URL = (process.env.NEXT_PUBLIC_PASPORT_API_URL ?? API_URL).replace(/\/+$/, '')
