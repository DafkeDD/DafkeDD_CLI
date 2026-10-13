import {
    base32Decode,
    base32Encode,
    hotp,
    newRecoveryCodes,
    newTotpSecret,
    normalizeRecoveryCode,
    otpauthUrl,
    totpStep,
    verifyTotp
} from './totp.js'

// The secret of the test vectors of RFC 4226 and RFC 6238 (SHA1): ASCII "12345678901234567890"
const RFC_SECRET = Buffer.from('12345678901234567890')

describe('TOTP (RFC 6238)', () => {
    it('base32 round-trips and matches RFC 4648', () => {
        expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI')
        expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar')
        expect(base32Decode('mzxw 6ytb-oi======').toString()).toBe('foobar')
        expect(() => base32Decode('M1')).toThrow('base32')
    })

    it('gives the HOTP values of RFC 4226 appendix D', () => {
        const expected = [
            '755224',
            '287082',
            '359152',
            '969429',
            '338314',
            '254676',
            '287922',
            '162583',
            '399871',
            '520489'
        ]
        expected.forEach((code, counter) => expect(hotp(RFC_SECRET, counter)).toBe(code))
    })

    it('gives the TOTP values of RFC 6238 appendix B (SHA1, 8 digits)', () => {
        const vectors: [number, string][] = [
            [59, '94287082'],
            [1111111109, '07081804'],
            [1111111111, '14050471'],
            [1234567890, '89005924'],
            [2000000000, '69279037'],
            [20000000000, '65353130']
        ]
        for (const [seconds, code] of vectors) expect(hotp(RFC_SECRET, Math.floor(seconds / 30), 8)).toBe(code)
    })

    it('accepts the current code and one step of clock drift, but nothing older or reused', () => {
        const secret = base32Encode(RFC_SECRET)
        const now = 1_234_567_890_000
        const step = totpStep(now)
        const code = hotp(RFC_SECRET, step)
        expect(verifyTotp(secret, code, null, now)).toBe(step)
        expect(verifyTotp(secret, hotp(RFC_SECRET, step - 1), null, now)).toBe(step - 1)
        expect(verifyTotp(secret, hotp(RFC_SECRET, step + 1), null, now)).toBe(step + 1)
        expect(verifyTotp(secret, hotp(RFC_SECRET, step - 2), null, now)).toBeNull()
        // Used before: the same step (or an older one) is refused
        expect(verifyTotp(secret, code, step, now)).toBeNull()
        expect(verifyTotp(secret, hotp(RFC_SECRET, step - 1), step, now)).toBeNull()
        expect(verifyTotp(secret, '12345', null, now)).toBeNull()
        expect(verifyTotp(secret, 'abcdef', null, now)).toBeNull()
        expect(verifyTotp(secret, code.slice(0, 3) + ' ' + code.slice(3), null, now)).toBe(step)
    })

    it('makes 160-bit secrets, an otpauth URL and single-use recovery codes', () => {
        const secret = newTotpSecret()
        expect(secret).toMatch(/^[A-Z2-7]{32}$/)
        expect(base32Decode(secret)).toHaveLength(20)
        const url = new URL(otpauthUrl(secret, 'ada@example.com', 'Acme Shop'))
        expect(url.protocol).toBe('otpauth:')
        expect(url.host).toBe('totp')
        expect(decodeURIComponent(url.pathname)).toBe('/Acme Shop:ada@example.com')
        expect(url.searchParams.get('secret')).toBe(secret)
        expect(url.searchParams.get('issuer')).toBe('Acme Shop')
        const codes = newRecoveryCodes()
        expect(codes).toHaveLength(10)
        expect(new Set(codes).size).toBe(10)
        for (const code of codes) expect(code).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}$/)
        expect(normalizeRecoveryCode(' K7QM-2XPD ')).toBe('k7qm2xpd')
    })
})
