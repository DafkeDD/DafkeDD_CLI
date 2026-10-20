import { generateKeyPairSync, sign } from 'node:crypto'
import { JoseError, verifyJwt } from './jose.js'

const es = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const now = 1_800_000_000

function token(header: object, payload: object) {
    const input = part(header) + '.' + part(payload)
    return (
        input +
        '.' +
        sign('sha256', Buffer.from(input), { key: es.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')
    )
}

const options = {
    keys: (kid: string) => (kid === 'k' ? { alg: 'ES256' as const, key: es.publicKey } : undefined),
    algorithms: ['ES256', 'RS256'] as const,
    issuer: 'http://login.test/oidc',
    audience: 'http://login.test',
    typ: 'at+jwt',
    now
}
const claims = { iss: options.issuer, aud: options.audience, exp: now + 60, sub: 'x' }

describe('verifyJwt (access tokens of the login server)', () => {
    it('accepts a good token', () => {
        expect(verifyJwt(token({ alg: 'ES256', kid: 'k', typ: 'at+jwt' }, claims), options).payload.sub).toBe('x')
    })

    it('takes the algorithm from the key, never from the token', () => {
        const rsaKey = { ...options, keys: () => ({ alg: 'RS256' as const, key: rsa.publicKey }) }
        expect(() => verifyJwt(token({ alg: 'ES256', kid: 'k', typ: 'at+jwt' }, claims), rsaKey)).toThrow(JoseError)
    })

    it.each([
        ['an expired token', { ...claims, exp: now - 60 }],
        ['another issuer', { ...claims, iss: 'http://evil.test' }],
        ['another audience', { ...claims, aud: 'http://other.test' }],
        ['no expiry', { iss: claims.iss, aud: claims.aud, sub: 'x' }]
    ])('refuses %s', (_name, payload) => {
        expect(() => verifyJwt(token({ alg: 'ES256', kid: 'k', typ: 'at+jwt' }, payload), options)).toThrow(JoseError)
    })

    it('refuses a token that is not three base64url parts', () => {
        expect(() => verifyJwt('a.b', options)).toThrow(JoseError)
        expect(() => verifyJwt('a.b.c=', options)).toThrow(JoseError)
    })
})
