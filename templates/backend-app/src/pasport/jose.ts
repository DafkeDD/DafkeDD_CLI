import { KeyObject, verify } from 'node:crypto'

/**
 * Checks JWTs of the login server with node:crypto only (RFC 7515, 7519): the same strict code as the login server
 * itself. Only RS256 and ES256, only the compact form, and the algorithm always comes from the key, never the token.
 */
export type JwsAlgorithm = 'RS256' | 'ES256'
export const ALGORITHMS: readonly JwsAlgorithm[] = ['RS256', 'ES256']

export class JoseError extends Error {}

export interface JwtHeader {
    alg: JwsAlgorithm
    kid: string
    typ: string
}

export type JwtPayload = Record<string, unknown> & {
    iss?: string
    sub?: string
    aud?: string | string[]
    exp?: number
    nbf?: number
    iat?: number
}

export interface VerifyKey {
    alg: JwsAlgorithm
    key: KeyObject
}

export interface VerifyOptions {
    /** Looks up a key by its kid; undefined when unknown. */
    keys: (kid: string) => VerifyKey | undefined
    algorithms: readonly JwsAlgorithm[]
    issuer: string
    audience?: string
    typ?: string
    /** Current time in seconds (for tests). */
    now?: number
    /** Allowed clock difference in seconds. */
    clockTolerance?: number
}

const MAX_TOKEN_LENGTH = 16_384
const SEGMENT = /^[A-Za-z0-9_-]+$/

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

/** Throws when the key does not fit the algorithm (an RSA key for ES256, a P-384 key, ...). */
export function assertKeyMatches(alg: JwsAlgorithm, key: KeyObject): void {
    if (alg === 'RS256' && key.asymmetricKeyType === 'rsa' && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048)
        return
    if (alg === 'ES256' && key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1')
        return
    throw new JoseError(`The key does not fit ${alg}`)
}

function parseSegment(segment: string): Record<string, unknown> {
    let value: unknown
    try {
        value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
    } catch {
        throw new JoseError('Malformed token')
    }
    if (!isObject(value)) throw new JoseError('Malformed token')
    return value
}

/** Checks the signature and the standard claims. Returns the header and the payload, or throws a JoseError. */
export function verifyJwt(token: string, options: VerifyOptions): { header: JwtHeader; payload: JwtPayload } {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) throw new JoseError('Malformed token')
    const parts = token.split('.')
    if (parts.length !== 3 || !parts.every(part => SEGMENT.test(part))) throw new JoseError('Malformed token')
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string]

    const header = parseSegment(headerPart)
    const { alg, kid, typ } = header
    if (typeof alg !== 'string' || !options.algorithms.includes(alg as JwsAlgorithm)) {
        throw new JoseError('Algorithm not allowed')
    }
    if ('crit' in header) throw new JoseError('Unsupported critical header')
    if (typeof kid !== 'string') throw new JoseError('Missing key id')
    if (options.typ !== undefined && typ !== options.typ) throw new JoseError('Wrong token type')

    const entry = options.keys(kid)
    if (!entry) throw new JoseError('Unknown key')
    if (entry.alg !== alg) throw new JoseError('The algorithm does not match the key')
    assertKeyMatches(entry.alg, entry.key)

    const data = Buffer.from(headerPart + '.' + payloadPart)
    const signature = Buffer.from(signaturePart, 'base64url')
    const valid =
        entry.alg === 'ES256'
            ? signature.length === 64 &&
              verify('sha256', data, { key: entry.key, dsaEncoding: 'ieee-p1363' }, signature)
            : verify('sha256', data, entry.key, signature)
    if (!valid) throw new JoseError('Invalid signature')

    const payload = parseSegment(payloadPart) as JwtPayload
    const now = options.now ?? Math.floor(Date.now() / 1000)
    const tolerance = options.clockTolerance ?? 30
    if (typeof payload.exp !== 'number') throw new JoseError('Missing expiry')
    if (now - tolerance >= payload.exp) throw new JoseError('Token expired')
    if (typeof payload.nbf === 'number' && now + tolerance < payload.nbf) throw new JoseError('Token not valid yet')
    if (typeof payload.iat === 'number' && now + tolerance < payload.iat)
        throw new JoseError('Token issued in the future')
    if (payload.iss !== options.issuer) throw new JoseError('Wrong issuer')
    if (options.audience !== undefined) {
        const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
        if (!audiences.includes(options.audience)) throw new JoseError('Wrong audience')
    }
    return { header: { alg: alg as JwsAlgorithm, kid, typ: typeof typ === 'string' ? typ : '' }, payload }
}
