import { constants, generateKeyPairSync, type KeyObject, sign } from 'node:crypto'
import { allowedUrl, issuerMatches, tenantTemplate } from './external.service.js'
import { importJwks, verifyExternalJwt } from './external-jwt.js'

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

/** A JWS signed like another server would (RS*, PS*, ES*). */
function jws(alg: string, key: KeyObject, header: object = {}, payload: object = { sub: 'a' }) {
    const input = encode({ alg, typ: 'JWT', ...header }) + '.' + encode(payload)
    const hash = 'sha' + alg.slice(2)
    const signature = alg.startsWith('ES')
        ? sign(hash, Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
        : alg.startsWith('PS')
          ? sign(hash, Buffer.from(input), {
                key,
                padding: constants.RSA_PKCS1_PSS_PADDING,
                saltLength: constants.RSA_PSS_SALTLEN_DIGEST
            })
          : sign(hash, Buffer.from(input), key)
    return input + '.' + signature.toString('base64url')
}

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
const jwks = importJwks({
    keys: [
        { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'r1', use: 'sig' },
        { ...p384.publicKey.export({ format: 'jwk' }), kid: 'e1' },
        // Skipped: a private key, an encryption key, an unknown type
        { ...rsa.privateKey.export({ format: 'jwk' }), kid: 'private' },
        { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'enc', use: 'enc' },
        { kty: 'oct', k: 'c2VjcmV0', kid: 'hmac' }
    ]
})

describe('ID tokens of another OpenID Connect server', () => {
    it('reads only public signing keys from its JWKS', () => {
        expect(jwks.map(key => key.kid)).toEqual(['r1', 'e1'])
        expect(() => importJwks({})).toThrow('Invalid JWKS')
    })

    it('verifies RS256, RS512, PS256 and ES384, with the key of the kid', () => {
        for (const [alg, key, kid] of [
            ['RS256', rsa.privateKey, 'r1'],
            ['RS512', rsa.privateKey, 'r1'],
            ['PS256', rsa.privateKey, 'r1'],
            ['ES384', p384.privateKey, 'e1']
        ] as const)
            expect(verifyExternalJwt(jws(alg, key, { kid }), jwks)).toMatchObject({ alg, payload: { sub: 'a' } })
    })

    it('never accepts none, HMAC, a key of another type, an unknown kid or a changed token', () => {
        const unsigned = encode({ alg: 'none' }) + '.' + encode({ sub: 'a' }) + '.x'
        expect(() => verifyExternalJwt(unsigned, jwks)).toThrow('Algorithm not allowed')
        expect(() => verifyExternalJwt(jws('RS256', rsa.privateKey, { alg: 'HS256', kid: 'r1' }), jwks)).toThrow(
            'Algorithm not allowed'
        )
        // ES256 claims to be the RSA key: does not fit
        expect(() => verifyExternalJwt(jws('ES384', p384.privateKey, { kid: 'r1' }), jwks)).toThrow('Unknown key')
        expect(() => verifyExternalJwt(jws('RS256', rsa.privateKey, { kid: 'other' }), jwks)).toThrow('Unknown key')
        const token = jws('RS256', rsa.privateKey, { kid: 'r1' })
        const [header, , signature] = token.split('.')
        expect(() => verifyExternalJwt(`${header}.${encode({ sub: 'b' })}.${signature}`, jwks)).toThrow(
            'Invalid signature'
        )
        expect(() => verifyExternalJwt(jws('RS256', rsa.privateKey, { kid: 'r1', crit: ['x'] }), jwks)).toThrow()
    })

    it('without a kid only when one key fits', () => {
        const one = importJwks({ keys: [rsa.publicKey.export({ format: 'jwk' })] })
        expect(verifyExternalJwt(jws('RS256', rsa.privateKey), one).payload.sub).toBe('a')
        const two = importJwks({
            keys: [rsa.publicKey.export({ format: 'jwk' }), rsa.publicKey.export({ format: 'jwk' })]
        })
        expect(() => verifyExternalJwt(jws('RS256', rsa.privateKey), two)).toThrow('Unknown key')
    })

    it('talks to the other server over https only (http on this computer for development)', () => {
        expect(allowedUrl('https://login.microsoftonline.com/x/v2.0')).toBe(true)
        expect(allowedUrl('http://localhost:8080/realms/demo')).toBe(true)
        expect(allowedUrl('http://127.0.0.1:8080')).toBe(true)
        expect(allowedUrl('http://keycloak.example.com')).toBe(false)
        expect(allowedUrl('not a url')).toBe(false)
        // In production only https, also on this computer
        expect(allowedUrl('http://localhost:8080/realms/demo', true)).toBe(false)
        expect(allowedUrl('https://login.example.com', true)).toBe(true)
    })
})

describe('Microsoft Entra ID for every organisation ({tenantid} in the issuer)', () => {
    const template = 'https://login.microsoftonline.com/{tenantid}/v2.0'
    const tid = '72f988bf-86f1-41af-91ab-2d7cd011db47'

    it('accepts the template only for the configured organizations or common issuer of the same host', () => {
        expect(tenantTemplate(template, 'https://login.microsoftonline.com/organizations/v2.0')).toBe(true)
        expect(tenantTemplate(template, 'https://login.microsoftonline.com/common/v2.0')).toBe(true)
        expect(tenantTemplate(template, 'https://evil.example.com/organizations/v2.0')).toBe(false)
        expect(tenantTemplate(template, 'https://login.microsoftonline.com/other/v2.0')).toBe(false)
        expect(tenantTemplate('https://accounts.google.com', 'https://accounts.google.com')).toBe(false)
    })

    it('wants the issuer of the organisation the token names itself', () => {
        expect(issuerMatches(template, { iss: `https://login.microsoftonline.com/${tid}/v2.0`, tid })).toBe(true)
        expect(issuerMatches(template, { iss: `https://login.microsoftonline.com/${tid}/v2.0` })).toBe(false)
        expect(issuerMatches(template, { iss: 'https://login.microsoftonline.com/x/v2.0', tid: 'x' })).toBe(false)
        expect(
            issuerMatches(template, {
                iss: `https://login.microsoftonline.com/${tid}/v2.0`,
                tid: '00000000-0000-4000-8000-000000000000'
            })
        ).toBe(false)
        // Without a template: exactly the issuer of the discovery document
        expect(issuerMatches('https://accounts.google.com', { iss: 'https://accounts.google.com' })).toBe(true)
        expect(issuerMatches('https://accounts.google.com', { iss: 'https://accounts.google.com/' })).toBe(false)
    })
})
