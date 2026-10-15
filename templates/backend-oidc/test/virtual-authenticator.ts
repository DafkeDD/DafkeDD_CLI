import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from 'node:crypto'

/**
 * A virtual passkey device for the tests: makes the answers of navigator.credentials.create() and .get() the way a
 * real authenticator does (CBOR, COSE key, authenticator data, signature), with ES256, RS256 or EdDSA.
 */

export type Cbor = number | string | Buffer | Cbor[] | Map<Cbor, Cbor> | boolean

function head(major: number, length: number): Buffer {
    if (length < 24) return Buffer.from([(major << 5) | length])
    if (length < 0x100) return Buffer.from([(major << 5) | 24, length])
    if (length < 0x10000) {
        const buffer = Buffer.alloc(3)
        buffer[0] = (major << 5) | 25
        buffer.writeUInt16BE(length, 1)
        return buffer
    }
    const buffer = Buffer.alloc(5)
    buffer[0] = (major << 5) | 26
    buffer.writeUInt32BE(length, 1)
    return buffer
}

/** A small CBOR encoder (what an authenticator writes). */
export function encodeCbor(value: Cbor): Buffer {
    if (typeof value === 'boolean') return Buffer.from([value ? 0xf5 : 0xf4])
    if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value)
    if (typeof value === 'string') {
        const text = Buffer.from(value, 'utf8')
        return Buffer.concat([head(3, text.length), text])
    }
    if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value])
    if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(encodeCbor)])
    const parts = [head(5, value.size)]
    for (const [key, item] of value) parts.push(encodeCbor(key), encodeCbor(item))
    return Buffer.concat(parts)
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest()
const b64 = (data: Buffer) => data.toString('base64url')

export type Algorithm = 'ES256' | 'RS256' | 'EdDSA'

export interface VirtualOptions {
    algorithm?: Algorithm
    /** Counts signatures (like a security key); synced passkeys send 0. */
    counting?: boolean
    synced?: boolean
    userVerified?: boolean
}

export class VirtualPasskey {
    readonly id = randomBytes(32)
    readonly privateKey: KeyObject
    readonly publicKey: KeyObject
    readonly algorithm: Algorithm
    counter = 0
    userHandle = ''

    constructor(private readonly options: VirtualOptions = {}) {
        this.algorithm = options.algorithm ?? 'ES256'
        const pair =
            this.algorithm === 'ES256'
                ? generateKeyPairSync('ec', { namedCurve: 'P-256' })
                : this.algorithm === 'RS256'
                  ? generateKeyPairSync('rsa', { modulusLength: 2048 })
                  : generateKeyPairSync('ed25519')
        this.privateKey = pair.privateKey
        this.publicKey = pair.publicKey
    }

    get credentialId() {
        return b64(this.id)
    }

    private cose(): Map<Cbor, Cbor> {
        const jwk = this.publicKey.export({ format: 'jwk' })
        const raw = (value: string | undefined) => Buffer.from(value ?? '', 'base64url')
        if (this.algorithm === 'ES256')
            return new Map<Cbor, Cbor>([
                [1, 2],
                [3, -7],
                [-1, 1],
                [-2, raw(jwk.x)],
                [-3, raw(jwk.y)]
            ])
        if (this.algorithm === 'RS256')
            return new Map<Cbor, Cbor>([
                [1, 3],
                [3, -257],
                [-1, raw(jwk.n)],
                [-2, raw(jwk.e)]
            ])
        return new Map<Cbor, Cbor>([
            [1, 1],
            [3, -8],
            [-1, 6],
            [-2, raw(jwk.x)]
        ])
    }

    private flags(attested: boolean) {
        let flags = 0x01
        if (this.options.userVerified !== false) flags |= 0x04
        if (this.options.synced) flags |= 0x08 | 0x10
        if (attested) flags |= 0x40
        return flags
    }

    private authData(rpId: string, attested: boolean): Buffer {
        const counter = Buffer.alloc(4)
        if (this.options.counting) counter.writeUInt32BE(++this.counter)
        const parts: Buffer[] = [sha256(rpId), Buffer.from([this.flags(attested)]), counter]
        if (attested) {
            const length = Buffer.alloc(2)
            length.writeUInt16BE(this.id.length)
            parts.push(Buffer.alloc(16), length, this.id, encodeCbor(this.cose()))
        }
        return Buffer.concat(parts)
    }

    /** The answer of navigator.credentials.create(options). */
    create(
        options: { challenge: string; rp: { id: string }; user: { id: string } },
        origin: string,
        overrides: { origin?: string; challenge?: string; rpId?: string } = {}
    ) {
        this.userHandle = options.user.id
        const clientData = Buffer.from(
            JSON.stringify({
                type: 'webauthn.create',
                challenge: overrides.challenge ?? options.challenge,
                origin: overrides.origin ?? origin,
                crossOrigin: false
            })
        )
        const attestationObject = encodeCbor(
            new Map<Cbor, Cbor>([
                ['fmt', 'none'],
                ['attStmt', new Map()],
                ['authData', this.authData(overrides.rpId ?? options.rp.id, true)]
            ])
        )
        return {
            id: this.credentialId,
            rawId: this.credentialId,
            type: 'public-key',
            response: {
                clientDataJSON: b64(clientData),
                attestationObject: b64(attestationObject),
                transports: ['internal', 'hybrid']
            }
        }
    }

    /** The answer of navigator.credentials.get(options). */
    get(
        options: { challenge: string; rpId: string },
        origin: string,
        overrides: { origin?: string; challenge?: string; userHandle?: string } = {}
    ) {
        const clientData = Buffer.from(
            JSON.stringify({
                type: 'webauthn.get',
                challenge: overrides.challenge ?? options.challenge,
                origin: overrides.origin ?? origin
            })
        )
        const authenticatorData = this.authData(options.rpId, false)
        const data = Buffer.concat([authenticatorData, sha256(clientData)])
        const signature =
            this.algorithm === 'ES256'
                ? sign('sha256', data, { key: this.privateKey, dsaEncoding: 'der' })
                : this.algorithm === 'RS256'
                  ? sign('sha256', data, this.privateKey)
                  : sign(null, data, this.privateKey)
        return {
            id: this.credentialId,
            rawId: this.credentialId,
            type: 'public-key',
            response: {
                clientDataJSON: b64(clientData),
                authenticatorData: b64(authenticatorData),
                signature: b64(signature),
                userHandle: overrides.userHandle ?? this.userHandle
            }
        }
    }
}
