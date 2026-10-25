import { describe, expect, it } from 'vitest'
import { isPkcs12, Pkcs12FormatError, Pkcs12PasswordError, readPkcs12 } from './pkcs12.js'

/*
 * Two files of the same test certificate (made with OpenSSL 3, password Geheim1, no real person): the default of today
 * (PBES2 with AES-256 and PBKDF2, a SHA-256 MAC) and -legacy (RC2-40 for the certificates, 3DES for the key, a SHA-1
 * MAC), as older Windows and Java programs still write them.
 */
const MODERN = Buffer.from(
    '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',
    'base64'
)
const LEGACY = Buffer.from(
    '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' +
        'a5YCAggA',
    'base64'
)
const THUMBPRINT = 'F1:02:0F:A0:ED:37:83:AF:BF:89:31:AF:A3:79:6B:96:6A:C1:14:D0'

describe('readPkcs12', () => {
    for (const [name, file] of [
        ['AES (PBES2)', MODERN],
        ['RC2 and 3DES (legacy)', LEGACY]
    ] as const)
        it(`reads the certificate of a ${name} file with its password`, () => {
            expect(isPkcs12(file)).toBe(true)
            const meta = readPkcs12(file, 'Geheim1')
            expect(meta.thumbprint).toBe(THUMBPRINT)
            expect(meta.subject).toBe('CN=Dr Test, O=Pasport test')
            expect(meta.serial).toBe('7A255F69928710B2D68590EF0510C573A18EBCB0')
            expect(meta.validUntil!.getTime()).toBeGreaterThan(Date.now())
            expect(() => readPkcs12(file, 'geheim1')).toThrow(Pkcs12PasswordError)
        })

    it('refuses what is not a PKCS#12 file', () => {
        expect(isPkcs12(Buffer.from('not a certificate'))).toBe(false)
        expect(() => readPkcs12(Buffer.from('not a certificate'), 'x')).toThrow(Pkcs12FormatError)
        // A cut-off file
        expect(() => readPkcs12(MODERN.subarray(0, 200), 'Geheim1')).toThrow()
    })
})
