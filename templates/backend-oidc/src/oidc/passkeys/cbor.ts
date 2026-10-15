/**
 * A small, strict CBOR decoder (RFC 8949) for WebAuthn: the attestation object and COSE keys. Only definite lengths,
 * no tags, no floats: what authenticators send. Throws on anything else, on trailing bytes and on too deep nesting.
 */
export class CborError extends Error {}

export type CborValue = number | bigint | string | Uint8Array | boolean | null | CborValue[] | CborMap
export type CborMap = Map<CborValue, CborValue>

const MAX_DEPTH = 16

/** Decodes one CBOR item that fills `bytes` completely. */
export function decodeCbor(bytes: Uint8Array): CborValue {
    const { value, offset } = decodeItem(bytes, 0, 0)
    if (offset !== bytes.length) throw new CborError('Trailing bytes')
    return value
}

/** Decodes the first item; returns where it ends (the authenticator data has the COSE key in the middle). */
export function decodeCborPrefix(bytes: Uint8Array, start = 0): { value: CborValue; offset: number } {
    return decodeItem(bytes, start, 0)
}

function readLength(bytes: Uint8Array, offset: number, info: number): { length: number | bigint; offset: number } {
    if (info < 24) return { length: info, offset }
    const size = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0
    if (size === 0) throw new CborError('Indefinite or reserved length')
    if (offset + size > bytes.length) throw new CborError('Truncated')
    let value = 0n
    for (let i = 0; i < size; i++) value = (value << 8n) | BigInt(bytes[offset + i]!)
    return { length: value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value, offset: offset + size }
}

function decodeItem(bytes: Uint8Array, start: number, depth: number): { value: CborValue; offset: number } {
    if (depth > MAX_DEPTH) throw new CborError('Too deep')
    if (start >= bytes.length) throw new CborError('Truncated')
    const initial = bytes[start]!
    const major = initial >> 5
    const info = initial & 0x1f
    if (major === 7) {
        if (info === 20) return { value: false, offset: start + 1 }
        if (info === 21) return { value: true, offset: start + 1 }
        if (info === 22) return { value: null, offset: start + 1 }
        throw new CborError('Unsupported simple value')
    }
    const { length, offset } = readLength(bytes, start + 1, info)
    if (major === 0) return { value: length, offset }
    if (major === 1) return { value: typeof length === 'bigint' ? -1n - length : -1 - length, offset }
    if (typeof length === 'bigint' || length > bytes.length) throw new CborError('Too long')
    if (major === 2 || major === 3) {
        if (offset + length > bytes.length) throw new CborError('Truncated')
        const slice = bytes.subarray(offset, offset + length)
        return {
            value: major === 2 ? new Uint8Array(slice) : new TextDecoder('utf-8', { fatal: true }).decode(slice),
            offset: offset + length
        }
    }
    if (major === 4) {
        const items: CborValue[] = []
        let next = offset
        for (let i = 0; i < length; i++) {
            const item = decodeItem(bytes, next, depth + 1)
            items.push(item.value)
            next = item.offset
        }
        return { value: items, offset: next }
    }
    if (major === 5) {
        const map: CborMap = new Map()
        let next = offset
        for (let i = 0; i < length; i++) {
            const key = decodeItem(bytes, next, depth + 1)
            const value = decodeItem(bytes, key.offset, depth + 1)
            if (map.has(key.value)) throw new CborError('Duplicate key')
            map.set(key.value, value.value)
            next = value.offset
        }
        return { value: map, offset: next }
    }
    throw new CborError('Tags are not supported')
}
