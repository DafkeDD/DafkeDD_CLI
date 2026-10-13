import { generateKeyPairSync, KeyObject, sign } from 'node:crypto'
import {
    base64url,
    halfHash,
    JoseError,
    signJwt,
    thumbprint,
    verifyJwt,
    type JwsAlgorithm,
    type VerifyOptions
} from './jose.js'

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const ISSUER = 'https://issuer.example.com'
const now = Math.floor(Date.now() / 1000)

const keys: Record<string, { alg: JwsAlgorithm; key: KeyObject }> = {
    rsa: { alg: 'RS256', key: rsa.publicKey },
    ec: { alg: 'ES256', key: ec.publicKey }
}

const options = (overrides: Partial<VerifyOptions> = {}): VerifyOptions => ({
    keys: kid => keys[kid],
    algorithms: ['RS256', 'ES256'],
    issuer: ISSUER,
    audience: 'client',
    ...overrides
})

const claims = { iss: ISSUER, sub: 'user-1', aud: 'client', iat: now, exp: now + 300 }

describe('jose', () => {
    it.each([
        ['RS256', 'rsa', rsa.privateKey],
        ['ES256', 'ec', ec.privateKey]
    ] as const)('signs and verifies %s', (alg, kid, privateKey) => {
        const token = signJwt(claims, { alg, kid, typ: 'JWT' }, privateKey)
        const { header, payload } = verifyJwt(token, options())
        expect(header).toEqual({ alg, kid, typ: 'JWT' })
        expect(payload).toEqual(claims)
    })

    it('rejects a changed payload', () => {
        const [header, , signature] = signJwt(claims, { alg: 'ES256', kid: 'ec', typ: 'JWT' }, ec.privateKey).split('.')
        const forged = header + '.' + base64url(JSON.stringify({ ...claims, sub: 'admin' })) + '.' + signature
        expect(() => verifyJwt(forged, options())).toThrow('Invalid signature')
    })

    it('rejects alg "none" and HS256, even when the key id exists', () => {
        for (const alg of ['none', 'HS256']) {
            const token =
                base64url(JSON.stringify({ alg, kid: 'rsa' })) + '.' + base64url(JSON.stringify(claims)) + '.c2ln'
            expect(() => verifyJwt(token, options())).toThrow('Algorithm not allowed')
        }
    })

    it('never trusts the algorithm of the token: the key decides (no algorithm confusion)', () => {
        const header = base64url(JSON.stringify({ alg: 'ES256', kid: 'rsa', typ: 'JWT' }))
        const body = base64url(JSON.stringify(claims))
        const signature = sign('sha256', Buffer.from(header + '.' + body), {
            key: ec.privateKey,
            dsaEncoding: 'ieee-p1363'
        })
        expect(() => verifyJwt(header + '.' + body + '.' + base64url(signature), options())).toThrow(
            'does not match the key'
        )
    })

    it('refuses to sign with a key that does not fit the algorithm', () => {
        expect(() => signJwt(claims, { alg: 'ES256', kid: 'x', typ: 'JWT' }, rsa.privateKey)).toThrow(JoseError)
        expect(() => signJwt(claims, { alg: 'RS256', kid: 'x', typ: 'JWT' }, ec.privateKey)).toThrow(JoseError)
    })

    it('checks expiry, issuer, audience, type and unknown keys', () => {
        const token = (payload: Record<string, unknown>, kid = 'ec', typ = 'JWT') =>
            signJwt(payload, { alg: 'ES256', kid, typ }, ec.privateKey)
        expect(() => verifyJwt(token({ ...claims, exp: now - 60 }), options())).toThrow('expired')
        expect(() => verifyJwt(token({ ...claims, exp: undefined }), options())).toThrow('Missing expiry')
        expect(() => verifyJwt(token({ ...claims, iss: 'https://evil.example.com' }), options())).toThrow('issuer')
        expect(() => verifyJwt(token({ ...claims, aud: 'other' }), options())).toThrow('audience')
        expect(() => verifyJwt(token({ ...claims, iat: now + 3600 }), options())).toThrow('future')
        expect(() => verifyJwt(token(claims), options({ typ: 'at+jwt' }))).toThrow('type')
        expect(() => verifyJwt(token(claims, 'unknown'), options())).toThrow('Unknown key')
        expect(verifyJwt(token({ ...claims, aud: ['other', 'client'] }), options()).payload.sub).toBe('user-1')
    })

    it('rejects malformed tokens without crashing', () => {
        for (const token of ['', 'a.b', 'a.b.c.d', '!!.??.**', 'eyJ.eyJ.', 'x'.repeat(20_000)]) {
            expect(() => verifyJwt(token, options())).toThrow(JoseError)
        }
    })

    it('computes RFC 7638 thumbprints from the required members only', () => {
        const jwk = ec.publicKey.export({ format: 'jwk' })
        expect(thumbprint(jwk)).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(thumbprint({ ...jwk, kid: 'ignored', use: 'sig' })).toBe(thumbprint(jwk))
        expect(thumbprint(rsa.publicKey.export({ format: 'jwk' }))).not.toBe(thumbprint(jwk))
    })

    it('computes at_hash as the left half of SHA-256', () => {
        expect(halfHash('token')).toHaveLength(22)
        expect(halfHash('token')).toBe(halfHash('token'))
        expect(halfHash('token')).not.toBe(halfHash('token2'))
    })
})
