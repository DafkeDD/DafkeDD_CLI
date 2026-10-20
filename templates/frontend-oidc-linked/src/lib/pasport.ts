/**
 * The API of the login server (Pasport) this app is linked to: accounts, members, licences, the heartbeat. The API of
 * this app itself is API_URL (lib/api.ts, NEXT_PUBLIC_API_URL).
 */
export const PASPORT_API_URL = (process.env.NEXT_PUBLIC_PASPORT_API_URL ?? '__PASPORT_API_URL__').replace(/\/+$/, '')
