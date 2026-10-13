import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Time-based one-time passwords (TOTP, RFC 6238) for two-factor authentication: the 6-digit codes of an authenticator
 * app (Google Authenticator, Microsoft Authenticator, 1Password, ...). Our own code on node:crypto.
 *
 * - The secret is 20 random bytes, shown to the user once as base32 (RFC 4648) and in a QR code (otpauth:// URL).
 * - A code is HOTP (RFC 4226, HMAC-SHA1) of the 30-second time step; one step before and after is accepted (clock drift).
 * - verifyTotp returns the step that matched, so the caller can refuse a code that was already used (replay).
 */
export const TOTP = { DIGITS: 6, PERIOD: 30, WINDOW: 1, ISSUER_MAX: 60 } as const

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buffer: Buffer): string {
    let bits = 0
    let value = 0
    let output = ''
    for (const byte of buffer) {
        value = (value << 8) | byte
        bits += 8
        while (bits >= 5) {
            output += ALPHABET[(value >>> (bits - 5)) & 31]
            bits -= 5
        }
    }
    if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31]
    return output
}

export function base32Decode(text: string): Buffer {
    const clean = text.toUpperCase().replace(/[\s=-]/g, '')
    let bits = 0
    let value = 0
    const bytes: number[] = []
    for (const char of clean) {
        const index = ALPHABET.indexOf(char)
        if (index < 0) throw new Error('Invalid base32')
        value = (value << 5) | index
        bits += 5
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 255)
            bits -= 8
        }
    }
    return Buffer.from(bytes)
}

/** A new secret: 20 random bytes (160 bits, the size RFC 4226 recommends), as base32. */
export const newTotpSecret = (): string => base32Encode(randomBytes(20))

/** HOTP (RFC 4226): the code for one counter value. */
export function hotp(secret: Buffer, counter: number, digits: number = TOTP.DIGITS): string {
    const message = Buffer.alloc(8)
    message.writeBigUInt64BE(BigInt(counter))
    const hash = createHmac('sha1', secret).update(message).digest()
    const offset = (hash[hash.length - 1] ?? 0) & 15
    const binary = hash.readUInt32BE(offset) & 0x7fffffff
    return String(binary % 10 ** digits).padStart(digits, '0')
}

/** The time step of a moment (milliseconds). */
export const totpStep = (now = Date.now()): number => Math.floor(now / 1000 / TOTP.PERIOD)

/**
 * Checks a code against the secret (base32). Returns the matching time step, or null. Only steps after `lastStep`
 * count: a code that was used before (or an older one) is refused.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
    const clean = code.replace(/\s/g, '')
    if (!/^\d{6}$/.test(clean)) return null
    const key = base32Decode(secret)
    const current = totpStep(now)
    let found: number | null = null
    for (let step = current - TOTP.WINDOW; step <= current + TOTP.WINDOW; step++) {
        // Compare every candidate (constant time), so the time taken says nothing about which step matched
        const match = timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(clean))
        if (match && (lastStep === null || step > lastStep) && found === null) found = step
    }
    return found
}

/** The otpauth:// URL that authenticator apps read from the QR code. */
export function otpauthUrl(secret: string, account: string, issuer: string): string {
    const label = encodeURIComponent(issuer.slice(0, TOTP.ISSUER_MAX)) + ':' + encodeURIComponent(account)
    const params = new URLSearchParams({
        secret,
        issuer: issuer.slice(0, TOTP.ISSUER_MAX),
        algorithm: 'SHA1',
        digits: String(TOTP.DIGITS),
        period: String(TOTP.PERIOD)
    })
    return `otpauth://totp/${label}?${params.toString()}`
}

/** Ten recovery codes like "k7qm-2xpd" (40 bits each), for when the phone is lost. Each works once. */
export function newRecoveryCodes(count = 10): string[] {
    return Array.from({ length: count }, () => {
        const code = base32Encode(randomBytes(5)).toLowerCase()
        return code.slice(0, 4) + '-' + code.slice(4, 8)
    })
}

/** Recovery codes are compared without dashes, spaces and case. */
export const normalizeRecoveryCode = (code: string): string => code.toLowerCase().replace(/[^a-z2-7]/g, '')
