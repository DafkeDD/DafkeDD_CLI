import { randomBytes } from 'node:crypto'
import {
    decrypt,
    encrypt,
    PKCE_CHALLENGE,
    PKCE_VERIFIER,
    pkceChallenge,
    randomToken,
    safeEqual,
    sha256
} from './crypto.js'
import { hashPassword, verifyPassword } from './password.js'

describe('crypto helpers', () => {
    it('computes the PKCE S256 challenge of RFC 7636 appendix B', () => {
        const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
        expect(PKCE_VERIFIER.test(verifier)).toBe(true)
        expect(pkceChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
        expect(PKCE_CHALLENGE.test(pkceChallenge(verifier))).toBe(true)
    })

    it('only accepts code_verifiers of 43 to 128 unreserved characters', () => {
        expect(PKCE_VERIFIER.test('a'.repeat(42))).toBe(false)
        expect(PKCE_VERIFIER.test('a'.repeat(129))).toBe(false)
        expect(PKCE_VERIFIER.test('a'.repeat(42) + '!')).toBe(false)
    })

    it('makes random tokens with 256 bits of entropy', () => {
        expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(randomToken()).not.toBe(randomToken())
    })

    it('hashes and compares in constant time', () => {
        expect(sha256('x')).toHaveLength(64)
        expect(safeEqual('abc', 'abc')).toBe(true)
        expect(safeEqual('abc', 'abd')).toBe(false)
        expect(safeEqual('abc', 'abcd')).toBe(false)
    })

    it('encrypts private keys: only the same master key and key id decrypt them', () => {
        const key = randomBytes(32)
        const sealed = encrypt('secret pem', key, 'kid-1')
        expect(sealed).not.toContain('secret')
        expect(decrypt(sealed, key, 'kid-1')).toBe('secret pem')
        expect(() => decrypt(sealed, randomBytes(32), 'kid-1')).toThrow()
        expect(() => decrypt(sealed, key, 'kid-2')).toThrow()
        expect(encrypt('secret pem', key, 'kid-1')).not.toBe(sealed)
    })
})

describe('passwords', () => {
    it('are stored as a salted scrypt hash and verified', async () => {
        const hash = await hashPassword('correct horse battery')
        expect(hash.startsWith('scrypt$32768$')).toBe(true)
        expect(hash).not.toContain('correct horse battery')
        expect(await verifyPassword('correct horse battery', hash)).toBe(true)
        expect(await verifyPassword('Correct horse battery', hash)).toBe(false)
        expect(await hashPassword('same')).not.toBe(await hashPassword('same'))
    })

    it('reject malformed or abusive hashes instead of throwing', async () => {
        for (const stored of ['', 'plain', 'md5$1$aa$bb', 'scrypt$3$aa$bb', 'scrypt$1073741824$aa$bb']) {
            expect(await verifyPassword('x', stored)).toBe(false)
        }
    })
})
