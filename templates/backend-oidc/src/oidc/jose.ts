import { createHash, type JsonWebKey, KeyObject, sign, verify } from 'node:crypto'

/**
 * A small, strict JWT/JWS implementation on node:crypto (RFC 7515, 7517, 7519, 7638).
 * Only RS256 and ES256, only the compact form, and the algorithm always comes from OUR key, never from the token.
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

export const base64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url')

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

export function signJwt(payload: JwtPayload, header: JwtHeader, privateKey: KeyObject): string {
    if (!ALGORITHMS.includes(header.alg)) throw new JoseError('Unsupported algorithm')
    assertKeyMatches(header.alg, privateKey)
    const input = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(payload))
    const data = Buffer.from(input)
    const signature =
        header.alg === 'ES256'
            ? sign('sha256', data, { key: privateKey, dsaEncoding: 'ieee-p1363' })
            : sign('sha256', data, privateKey)
    return input + '.' + base64url(signature)
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

/** RFC 7638 thumbprint: used as the key id. */
export function thumbprint(jwk: JsonWebKey): string {
    let members: Record<string, unknown>
    if (jwk.kty === 'EC') members = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }
    else if (jwk.kty === 'RSA') members = { e: jwk.e, kty: jwk.kty, n: jwk.n }
    else throw new JoseError('Unsupported key type')
    return base64url(createHash('sha256').update(JSON.stringify(members)).digest())
}

/** at_hash / c_hash (OpenID Connect Core 3.1.3.6): left half of the SHA-256 hash, base64url. */
export function halfHash(value: string): string {
    return base64url(createHash('sha256').update(value).digest().subarray(0, 16))
}

/** Decodes a payload WITHOUT checking it. Only for showing a token, never for trusting it. */
export function decodeUnverified(token: string): JwtPayload | null {
    const part = token.split('.')[1]
    if (!part) return null
    try {
        return parseSegment(part) as JwtPayload
    } catch {
        return null
    }
}
