import { decrypt, deriveKey, encrypt } from './crypto.js'
import { OIDC } from './oidc.config.js'
import type { AuthorizationParams } from './store/oidc.store.js'

/**
 * A running login (from /oidc/authorize until the code goes back to the client). It is not stored in the database: it
 * lives for at most 10 minutes in an encrypted, httpOnly cookie oidc_ia_<id> that is only sent to
 * /oidc/interaction/<id>. AES-256-GCM makes it unreadable and impossible to change; the id is bound to the ciphertext,
 * so the cookie of one login can never be used for another.
 */
export interface Interaction {
    /** Random, 43 characters; also in the URL of the login page. */
    id: string
    params: AuthorizationParams
    csrf: string
    /** Set after the password was checked, while the user chooses an organisation. */
    userId: string | null
    /** Milliseconds since 1970. */
    expiresAt: number
}

export const INTERACTION_ID = /^[A-Za-z0-9_-]{43}$/

export const interactionCookieName = (id: string): string => OIDC.INTERACTION_COOKIE + id

/** Only the requests of this login get the cookie. */
export const interactionCookiePath = (id: string): string => `${OIDC.COOKIE_PATH}/interaction/${id}`

/** The key for login cookies, derived from OIDC_MASTER_KEY (never the key of the signing keys itself). */
export const interactionKey = (masterKey: Buffer): Buffer => deriveKey(masterKey, 'oidc interaction cookie v1')

const context = (id: string) => 'interaction:' + id

export function sealInteraction(interaction: Interaction, key: Buffer): string {
    const data = { p: interaction.params, c: interaction.csrf, u: interaction.userId, e: interaction.expiresAt }
    return encrypt(JSON.stringify(data), key, context(interaction.id))
}

/** The login of this cookie; null when the id or cookie is missing, changed, of another login or expired. */
export function openInteraction(
    id: string,
    sealed: string | undefined,
    key: Buffer,
    now = Date.now()
): Interaction | null {
    if (!INTERACTION_ID.test(id) || !sealed) return null
    try {
        const data = JSON.parse(decrypt(sealed, key, context(id))) as {
            p: AuthorizationParams
            c: string
            u: string | null
            e: number
        }
        if (typeof data.e !== 'number' || data.e <= now || typeof data.c !== 'string') return null
        return { id, params: data.p, csrf: data.c, userId: data.u ?? null, expiresAt: data.e }
    } catch {
        return null
    }
}
