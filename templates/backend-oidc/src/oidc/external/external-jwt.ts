import { constants, createPublicKey, type JsonWebKey, type KeyObject, verify } from 'node:crypto'
import { JoseError, type JwtPayload } from '../jose.js'

/**
 * Verifies the ID token of ANOTHER OpenID Connect server (federation). Our own tokens use only RS256 and ES256
 * (src/oidc/jose.ts); other servers may also sign with RS384/512, PS256/384/512 or ES384/512. Never "none" or HMAC:
 * the algorithm must be an asymmetric one and must fit the key from their JWKS.
 */
export const EXTERNAL_ALGORITHMS = [
    'RS256',
    'RS384',
    'RS512',
    'PS256',
    'PS384',
    'PS512',
    'ES256',
    'ES384',
    'ES512'
] as const
export type ExternalAlgorithm = (typeof EXTERNAL_ALGORITHMS)[number]

const HASH = { '256': 'sha256', '384': 'sha384', '512': 'sha512' } as const
const CURVE = { ES256: 'prime256v1', ES384: 'secp384r1', ES512: 'secp521r1' } as const
const SIGNATURE_LENGTH = { ES256: 64, ES384: 96, ES512: 132 } as const
const SEGMENT = /^[A-Za-z0-9_-]+$/

export interface ExternalKey {
    kid: string | null
    key: KeyObject
    /** The alg of the JWK, when the server says it. */
    alg: string | null
}

/** The usable keys of a JWKS document: public RSA and EC keys for signatures. */
export function importJwks(document: unknown): ExternalKey[] {
    const keys = (document as { keys?: unknown } | null)?.keys
    if (!Array.isArray(keys)) throw new JoseError('Invalid JWKS')
    const result: ExternalKey[] = []
    for (const jwk of keys as (JsonWebKey & { kid?: unknown; use?: unknown; alg?: unknown })[]) {
        if (jwk.use !== undefined && jwk.use !== 'sig') continue
        if (jwk.kty !== 'RSA' && jwk.kty !== 'EC') continue
        if ('d' in jwk) continue
        try {
            const key = createPublicKey({ key: jwk, format: 'jwk' })
            result.push({
                kid: typeof jwk.kid === 'string' ? jwk.kid : null,
                key,
                alg: typeof jwk.alg === 'string' ? jwk.alg : null
            })
        } catch {
            // A key we cannot read is skipped
        }
    }
    return result
}

function fits(alg: ExternalAlgorithm, key: KeyObject): boolean {
    if (alg.startsWith('RS') || alg.startsWith('PS'))
        return key.asymmetricKeyType === 'rsa' && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === CURVE[alg as keyof typeof CURVE]
}

function parse(segment: string): Record<string, unknown> {
    try {
        const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
        if (typeof value === 'object' && value !== null && !Array.isArray(value))
            return value as Record<string, unknown>
    } catch {
        // below
    }
    throw new JoseError('Malformed token')
}

/**
 * Checks the signature of a compact JWS with one of `keys` (by kid; without a kid only when there is one key that
 * fits). Returns the header and the payload; the claims are checked by the caller.
 */
export function verifyExternalJwt(token: string, keys: ExternalKey[]): { alg: ExternalAlgorithm; payload: JwtPayload } {
    if (typeof token !== 'string' || token.length > 16_384) throw new JoseError('Malformed token')
    const parts = token.split('.')
    if (parts.length !== 3 || !parts.every(part => SEGMENT.test(part))) throw new JoseError('Malformed token')
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string]
    const header = parse(headerPart)
    const alg = header.alg
    if (typeof alg !== 'string' || !(EXTERNAL_ALGORITHMS as readonly string[]).includes(alg))
        throw new JoseError('Algorithm not allowed')
    const algorithm = alg as ExternalAlgorithm
    if ('crit' in header) throw new JoseError('Unsupported critical header')
    const usable = keys.filter(entry => fits(algorithm, entry.key) && (entry.alg === null || entry.alg === algorithm))
    const candidates =
        typeof header.kid === 'string'
            ? usable.filter(entry => entry.kid === header.kid)
            : usable.length === 1
              ? usable
              : []
    const entry = candidates[0]
    if (!entry) throw new JoseError('Unknown key')

    const data = Buffer.from(headerPart + '.' + payloadPart)
    const signature = Buffer.from(signaturePart, 'base64url')
    const hash = HASH[algorithm.slice(2) as keyof typeof HASH]
    let valid: boolean
    if (algorithm.startsWith('ES')) {
        valid =
            signature.length === SIGNATURE_LENGTH[algorithm as keyof typeof SIGNATURE_LENGTH] &&
            verify(hash, data, { key: entry.key, dsaEncoding: 'ieee-p1363' }, signature)
    } else if (algorithm.startsWith('PS')) {
        valid = verify(
            hash,
            data,
            { key: entry.key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST },
            signature
        )
    } else valid = verify(hash, data, entry.key, signature)
    if (!valid) throw new JoseError('Invalid signature')
    return { alg: algorithm, payload: parse(payloadPart) as JwtPayload }
}
