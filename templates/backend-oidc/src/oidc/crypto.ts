import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

/** Random, URL-safe string with `bytes` bytes of entropy (codes, session ids, CSRF tokens). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url')

/** SHA-256 of a value, hex. Codes, session ids and client secrets are only stored like this. */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

/** Compares two strings in constant time. */
export function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a)
    const right = Buffer.from(b)
    return left.length === right.length && timingSafeEqual(left, right)
}

/** PKCE (RFC 7636): BASE64URL(SHA256(code_verifier)). */
export const pkceChallenge = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url')

/** A code_verifier: 43 to 128 unreserved characters (RFC 7636 section 4.1). */
export const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/
/** A S256 code_challenge: always 43 base64url characters. */
export const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/

/**
 * AES-256-GCM encryption of private keys with the master key (OIDC_MASTER_KEY). `context` (the key id) is bound to the
 * ciphertext, so an encrypted key cannot be moved to another row.
 */
export function encrypt(plaintext: string, masterKey: Buffer, context: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', masterKey, iv)
    cipher.setAAD(Buffer.from(context))
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join(
        '.'
    )
}

export function decrypt(encrypted: string, masterKey: Buffer, context: string): string {
    const [version, iv, tag, data] = encrypted.split('.')
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unknown encryption format')
    const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(iv, 'base64url'))
    decipher.setAAD(Buffer.from(context))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}

/**
 * A separate 32-byte key for one purpose, derived from the master key with HKDF-SHA256 (RFC 5869). The login cookies
 * never use the key that encrypts the signing keys.
 */
export const deriveKey = (masterKey: Buffer, purpose: string): Buffer =>
    Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), purpose, 32))
