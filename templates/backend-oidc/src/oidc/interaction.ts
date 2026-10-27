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
    /** Set after the password was checked (for the second factor and the organisation choice). */
    userId: string | null
    /** The password was right, but the code of the authenticator app (or a recovery code) is still needed. */
    mfaPending: boolean
    /** Two-step verification is required but not set up yet: this login sets it up first (QR code). */
    enrolling: boolean
    /** How the user proved who they are so far (RFC 8176): ["pwd"], or ["pwd", "otp", "mfa"] after the second factor. */
    amr: string[]
    /** The nonce that was given to the eID bridge for this login (used once), or null. */
    eidNonce: string | null
    /** The WebAuthn challenge of a passkey login (used once), or null. */
    passkeyChallenge: string | null
    /**
     * Logged in, waiting for the consent of the user (an application that is not our own): its session (public id)
     * and the organisation of this login (null: the platform). Null otherwise.
     */
    consent?: { sessionId: string; tenantId: string | null } | null
    /**
     * Logged in, but the app sells a product and this account has no licence of it in this organisation: the "no
     * licence" screen (ask a demo, or to the portal). Its session and organisation, like `consent`. Null otherwise.
     */
    license?: { sessionId: string; tenantId: string | null } | null
    /** The User-Agent of the browser that started the login (for the list of sessions), shortened. */
    userAgent: string
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
    const data = {
        p: interaction.params,
        c: interaction.csrf,
        u: interaction.userId,
        m: interaction.mfaPending,
        n: interaction.enrolling,
        a: interaction.amr,
        x: interaction.eidNonce,
        k: interaction.passkeyChallenge,
        o: interaction.consent ?? null,
        l: interaction.license ?? null,
        g: interaction.userAgent,
        e: interaction.expiresAt
    }
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
            m?: boolean
            n?: boolean
            a?: string[]
            x?: string | null
            k?: string | null
            o?: { sessionId?: unknown; tenantId?: unknown } | null
            l?: { sessionId?: unknown; tenantId?: unknown } | null
            g?: string
            e: number
        }
        if (typeof data.e !== 'number' || data.e <= now || typeof data.c !== 'string') return null
        return {
            id,
            params: data.p,
            csrf: data.c,
            userId: data.u ?? null,
            mfaPending: data.m === true,
            enrolling: data.n === true,
            amr: Array.isArray(data.a) ? data.a : [],
            eidNonce: typeof data.x === 'string' ? data.x : null,
            passkeyChallenge: typeof data.k === 'string' ? data.k : null,
            consent:
                data.o && typeof data.o.sessionId === 'string'
                    ? {
                          sessionId: data.o.sessionId,
                          tenantId: typeof data.o.tenantId === 'string' ? data.o.tenantId : null
                      }
                    : null,
            license:
                data.l && typeof data.l.sessionId === 'string'
                    ? {
                          sessionId: data.l.sessionId,
                          tenantId: typeof data.l.tenantId === 'string' ? data.l.tenantId : null
                      }
                    : null,
            userAgent: typeof data.g === 'string' ? data.g : '',
            expiresAt: data.e
        }
    } catch {
        return null
    }
}
