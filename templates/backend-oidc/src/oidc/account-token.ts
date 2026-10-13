import { decrypt, deriveKey, encrypt } from './crypto.js'
import type { TenantRole } from './store/oidc.store.js'

/**
 * The links in emails (verify an email address, reset a password, accept an invitation) carry an encrypted token
 * instead of a row in the database: AES-256-GCM with a key derived from OIDC_MASTER_KEY, bound to its kind, with an
 * expiry inside. Nobody can read, change or forge one, and one kind can never be used as another.
 *
 * - verify: valid while the account still has that email address.
 * - reset: holds a fingerprint of the current password hash, so it works only once: a new password changes the hash.
 * - invite: checked again when accepted (the tenant must be active, the inviter must still be allowed to invite).
 */
export interface AccountTokens {
    verify: { userId: string; email: string }
    reset: { userId: string; fingerprint: string }
    invite: { tenantId: string; email: string; role: TenantRole; invitedBy: string }
}
export type AccountTokenKind = keyof AccountTokens

export const accountTokenKey = (masterKey: Buffer): Buffer => deriveKey(masterKey, 'oidc account token v1')

export function sealAccountToken<K extends AccountTokenKind>(
    kind: K,
    data: AccountTokens[K],
    seconds: number,
    key: Buffer,
    now = Date.now()
): string {
    return encrypt(JSON.stringify({ ...data, exp: now + seconds * 1000 }), key, 'account:' + kind)
}

/** The contents of a token of this kind; null when it is invalid, of another kind or expired. */
export function openAccountToken<K extends AccountTokenKind>(
    kind: K,
    token: unknown,
    key: Buffer,
    now = Date.now()
): AccountTokens[K] | null {
    if (typeof token !== 'string' || token.length > 2000) return null
    try {
        const data = JSON.parse(decrypt(token, key, 'account:' + kind)) as Record<string, unknown>
        if (typeof data.exp !== 'number' || data.exp <= now) return null
        delete data.exp
        return data as unknown as AccountTokens[K]
    } catch {
        return null
    }
}
