import { createDecipheriv, createHash, createHmac, pbkdf2Sync, timingSafeEqual, X509Certificate } from 'node:crypto'
import type { CertificateMeta } from './vault.store.js'

/*
 * A small reader of PKCS#12 files (.p12, .pfx, RFC 7292) on node:crypto, without a library: it checks the password (the
 * MAC), decrypts the certificates (PBES2 with AES or 3DES, and the older pbeWithSHAAnd... schemes of Windows and Java,
 * RC2 included) and reads them with X509Certificate. The private key is never decrypted: only its localKeyId is read, to
 * find the certificate that belongs to it.
 */

/** The file is not a PKCS#12 file at all (not even its outer structure can be read). */
export class Pkcs12FormatError extends Error {}
/** The password does not open the file (or what is inside cannot be read). */
export class Pkcs12PasswordError extends Error {}

/* ============================ ASN.1 (BER, also indefinite lengths) ============================ */
type Node = { tag: number; constructed: boolean; cls: number; bytes: Buffer; children: Node[] }

const MAX_DEPTH = 32

function parse(buf: Buffer, offset = 0, depth = 0): { node: Node; next: number } {
    if (depth > MAX_DEPTH || offset + 2 > buf.length) throw new Error('asn1')
    const first = buf[offset]
    const cls = first >> 6
    const constructed = (first & 0x20) !== 0
    let tag = first & 0x1f
    let pos = offset + 1
    if (tag === 0x1f) {
        tag = 0
        for (let i = 0; ; i++) {
            if (pos >= buf.length || i > 3) throw new Error('asn1')
            const b = buf[pos++]
            tag = tag * 128 + (b & 0x7f)
            if (!(b & 0x80)) break
        }
    }
    if (pos >= buf.length) throw new Error('asn1')
    let length = buf[pos++]
    const children: Node[] = []
    if (length === 0x80) {
        // Indefinite length (BER): the children until the end-of-contents 00 00
        if (!constructed) throw new Error('asn1')
        const start = pos
        for (;;) {
            if (pos + 2 > buf.length) throw new Error('asn1')
            if (buf[pos] === 0 && buf[pos + 1] === 0) break
            const { node, next } = parse(buf, pos, depth + 1)
            children.push(node)
            pos = next
        }
        return { node: { tag, constructed, cls, bytes: buf.subarray(start, pos), children }, next: pos + 2 }
    }
    if (length & 0x80) {
        const count = length & 0x7f
        if (count === 0 || count > 4 || pos + count > buf.length) throw new Error('asn1')
        length = 0
        for (let i = 0; i < count; i++) length = length * 256 + buf[pos++]
    }
    const end = pos + length
    if (end > buf.length) throw new Error('asn1')
    const bytes = buf.subarray(pos, end)
    if (constructed) {
        let at = pos
        while (at < end) {
            const { node, next } = parse(buf, at, depth + 1)
            children.push(node)
            at = next
        }
        if (at !== end) throw new Error('asn1')
    }
    return { node: { tag, constructed, cls, bytes, children }, next: end }
}

const SEQUENCE = 0x10
const OID = 0x06
const INTEGER = 0x02

function child(node: Node, index: number): Node {
    const found = node.children[index]
    if (!found) throw new Error('asn1')
    return found
}
/** The content of an OCTET STRING, also a constructed one (BER: the pieces one after the other). */
function octets(node: Node): Buffer {
    if (!node.constructed) return node.bytes
    return Buffer.concat(node.children.map(octets))
}
function oid(node: Node): string {
    if (node.tag !== OID || node.bytes.length === 0) throw new Error('asn1')
    const parts = [Math.floor(node.bytes[0] / 40), node.bytes[0] % 40]
    let value = 0
    for (const b of node.bytes.subarray(1)) {
        value = value * 128 + (b & 0x7f)
        if (!(b & 0x80)) {
            parts.push(value)
            value = 0
        }
    }
    return parts.join('.')
}
function integer(node: Node): number {
    if (node.tag !== INTEGER || node.bytes.length === 0 || node.bytes.length > 6) throw new Error('asn1')
    return node.bytes.reduce((value, b) => value * 256 + b, 0)
}
/** The content of [0] EXPLICIT: its only child. */
function explicit(node: Node): Node {
    if (node.cls !== 2 || node.tag !== 0) throw new Error('asn1')
    return child(node, 0)
}

const OIDS = {
    data: '1.2.840.113549.1.7.1',
    encryptedData: '1.2.840.113549.1.7.6',
    keyBag: '1.2.840.113549.1.12.10.1.1',
    shroudedKeyBag: '1.2.840.113549.1.12.10.1.2',
    certBag: '1.2.840.113549.1.12.10.1.3',
    x509Certificate: '1.2.840.113549.1.9.22.1',
    localKeyId: '1.2.840.113549.1.9.21',
    pbes2: '1.2.840.113549.1.5.13',
    pbkdf2: '1.2.840.113549.1.5.12'
}

type Hash = { name: string; v: number }
const SHA1: Hash = { name: 'sha1', v: 64 }
const HASHES: Record<string, Hash> = {
    '1.3.14.3.2.26': SHA1,
    '2.16.840.1.101.3.4.2.4': { name: 'sha224', v: 64 },
    '2.16.840.1.101.3.4.2.1': { name: 'sha256', v: 64 },
    '2.16.840.1.101.3.4.2.2': { name: 'sha384', v: 128 },
    '2.16.840.1.101.3.4.2.3': { name: 'sha512', v: 128 }
}
const PRFS: Record<string, string> = {
    '1.2.840.113549.2.7': 'sha1',
    '1.2.840.113549.2.8': 'sha224',
    '1.2.840.113549.2.9': 'sha256',
    '1.2.840.113549.2.10': 'sha384',
    '1.2.840.113549.2.11': 'sha512'
}
const PBES2_CIPHERS: Record<string, { name: string; keyLength: number }> = {
    '2.16.840.1.101.3.4.1.2': { name: 'aes-128-cbc', keyLength: 16 },
    '2.16.840.1.101.3.4.1.22': { name: 'aes-192-cbc', keyLength: 24 },
    '2.16.840.1.101.3.4.1.42': { name: 'aes-256-cbc', keyLength: 32 },
    '1.2.840.113549.3.7': { name: 'des-ede3-cbc', keyLength: 24 }
}
/** The pbeWithSHAAnd... schemes of PKCS#12 (appendix C): the cipher and its key length. */
const PKCS12_PBE: Record<string, { cipher: 'des-ede3-cbc' | 'rc2'; keyLength: number }> = {
    '1.2.840.113549.1.12.1.3': { cipher: 'des-ede3-cbc', keyLength: 24 },
    '1.2.840.113549.1.12.1.4': { cipher: 'des-ede3-cbc', keyLength: 16 },
    '1.2.840.113549.1.12.1.5': { cipher: 'rc2', keyLength: 16 },
    '1.2.840.113549.1.12.1.6': { cipher: 'rc2', keyLength: 5 }
}

/* ============================ Keys from the password ============================ */
/** The password as PKCS#12 wants it: BMPString (UTF-16 big-endian) with two zero bytes at the end. */
function bmpPassword(password: string): Buffer {
    const out = Buffer.alloc((password.length + 1) * 2)
    for (let i = 0; i < password.length; i++) out.writeUInt16BE(password.charCodeAt(i), i * 2)
    return out
}

/** The key derivation of PKCS#12 (RFC 7292, appendix B.2): id 1 a key, 2 an IV, 3 the key of the MAC. */
function pkcs12Kdf(hash: Hash, password: Buffer, salt: Buffer, iterations: number, id: number, length: number) {
    const { v } = hash
    const fill = (data: Buffer) => {
        const out = Buffer.alloc(v * Math.ceil(data.length / v))
        for (let i = 0; i < out.length; i++) out[i] = data[i % data.length]
        return out
    }
    const D = Buffer.alloc(v, id)
    const I = Buffer.concat([fill(salt), fill(password)])
    const parts: Buffer[] = []
    let produced = 0
    for (;;) {
        let A = createHash(hash.name).update(D).update(I).digest()
        for (let i = 1; i < iterations; i++) A = createHash(hash.name).update(A).digest()
        parts.push(A)
        produced += A.length
        if (produced >= length) break
        const B = Buffer.alloc(v)
        for (let i = 0; i < v; i++) B[i] = A[i % A.length]
        // Every block of I: I_j = (I_j + B + 1) mod 2^(8v)
        for (let j = 0; j < I.length; j += v) {
            let carry = 1
            for (let k = v - 1; k >= 0; k--) {
                const sum = I[j + k] + B[k] + carry
                I[j + k] = sum & 0xff
                carry = sum >> 8
            }
        }
    }
    return Buffer.concat(parts).subarray(0, length)
}

/* ============================ RC2 (RFC 2268): older files of Windows, not in OpenSSL 3 ============================ */
const PITABLE = Buffer.from(
    'd978f9c419ddb5ed28e9fd794aa0d89dc67e37832b76538e624c6488448bfba2179a59f587b34f1361456d8d09817d32bd8f40eb86b77b0bf09521225c6b4e8254d66593ce60b21c7356c014a78cf1dc1275ca1f3bbee4d1423dd430a33cb6266fbf0eda4669075727f21d9bbc944303f811c7f690ef3ee706c3d52fc8661ed708e8eade8052eef784aa72ac354d6a2a961ad2715a1549744b9fd05e0418a4ecc2e0416e0f51cbcc2491af50a1f47039997c3a8523b8b47afc02365b255597312d5dfa98e38a92ae05df2910676cbac9d300e6cfe19ea82c6316013f58e289a90d38341bab33ffb0bb480c5fb9b1cd2ec5f3db47e5a59c770aa62068fe7fc1ad',
    'hex'
)

/** RC2 in CBC mode, decrypting (effective key bits: 8 × the key length, as PKCS#12 uses it). */
function rc2Decrypt(key: Buffer, iv: Buffer, data: Buffer): Buffer {
    if (data.length === 0 || data.length % 8) throw new Error('rc2')
    const T = key.length
    const T8 = T
    const TM = 255
    const L = Buffer.alloc(128)
    key.copy(L)
    for (let i = T; i < 128; i++) L[i] = PITABLE[(L[i - 1] + L[i - T]) & 0xff]
    L[128 - T8] = PITABLE[L[128 - T8] & TM]
    for (let i = 127 - T8; i >= 0; i--) L[i] = PITABLE[L[i + 1] ^ L[i + T8]]
    const K = new Uint16Array(64)
    for (let i = 0; i < 64; i++) K[i] = L[2 * i] + 256 * L[2 * i + 1]
    const S = [1, 2, 3, 5]
    const ror = (x: number, s: number) => ((x >>> s) | (x << (16 - s))) & 0xffff
    const out = Buffer.alloc(data.length)
    let prev = Buffer.from(iv)
    for (let off = 0; off < data.length; off += 8) {
        const block = data.subarray(off, off + 8)
        const R = [block.readUInt16LE(0), block.readUInt16LE(2), block.readUInt16LE(4), block.readUInt16LE(6)]
        let j = 63
        const mix = () => {
            for (let i = 3; i >= 0; i--) {
                R[i] = ror(R[i], S[i])
                R[i] = (R[i] - K[j] - (R[(i + 3) % 4] & R[(i + 2) % 4]) - (~R[(i + 3) % 4] & R[(i + 1) % 4])) & 0xffff
                j--
            }
        }
        const mash = () => {
            for (let i = 3; i >= 0; i--) R[i] = (R[i] - K[R[(i + 3) % 4] & 63]) & 0xffff
        }
        for (let r = 0; r < 5; r++) mix()
        mash()
        for (let r = 0; r < 6; r++) mix()
        mash()
        for (let r = 0; r < 5; r++) mix()
        for (let i = 0; i < 4; i++) out.writeUInt16LE(R[i] ^ prev.readUInt16LE(i * 2), off + i * 2)
        prev = Buffer.from(block)
    }
    // PKCS#7 padding
    const pad = out[out.length - 1]
    if (pad < 1 || pad > 8) throw new Error('padding')
    for (let i = out.length - pad; i < out.length; i++) if (out[i] !== pad) throw new Error('padding')
    return out.subarray(0, out.length - pad)
}

/** Decrypts the content of EncryptedData with its AlgorithmIdentifier. */
function decrypt(algorithm: Node, data: Buffer, password: string): Buffer {
    const id = oid(child(algorithm, 0))
    const params = child(algorithm, 1)
    if (id === OIDS.pbes2) {
        const kdf = child(params, 0)
        const scheme = child(params, 1)
        if (oid(child(kdf, 0)) !== OIDS.pbkdf2) throw new Error('kdf')
        const kdfParams = child(kdf, 1)
        const salt = octets(child(kdfParams, 0))
        const iterations = integer(child(kdfParams, 1))
        const prfNode = kdfParams.children.slice(2).find(node => node.tag === SEQUENCE)
        const prf = prfNode ? PRFS[oid(child(prfNode, 0))] : 'sha1'
        const cipher = PBES2_CIPHERS[oid(child(scheme, 0))]
        if (!prf || !cipher) throw new Error('cipher')
        const iv = octets(child(scheme, 1))
        // PBES2 takes the password as UTF-8 bytes (not the BMPString of PKCS#12)
        const key = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, cipher.keyLength, prf)
        const decipher = createDecipheriv(cipher.name, key, iv)
        return Buffer.concat([decipher.update(data), decipher.final()])
    }
    const pbe = PKCS12_PBE[id]
    if (!pbe) throw new Error('cipher')
    const salt = octets(child(params, 0))
    const iterations = integer(child(params, 1))
    const pass = bmpPassword(password)
    const key = pkcs12Kdf(SHA1, pass, salt, iterations, 1, pbe.keyLength)
    const iv = pkcs12Kdf(SHA1, pass, salt, iterations, 2, 8)
    if (pbe.cipher === 'rc2') return rc2Decrypt(key, iv, data)
    // Two-key 3DES: K1 K2 K1
    const full = key.length === 16 ? Buffer.concat([key, key.subarray(0, 8)]) : key
    const decipher = createDecipheriv('des-ede3-cbc', full, iv)
    return Buffer.concat([decipher.update(data), decipher.final()])
}

/* ============================ PKCS#12 ============================ */
function parseSequence(der: Buffer): Node {
    const { node } = parse(der)
    if (node.cls !== 0 || node.tag !== SEQUENCE || !node.constructed) throw new Error('asn1')
    return node
}

/** Is the outer structure of this file PKCS#12 (ASN.1: a SEQUENCE with version 3 and its content)? */
export function isPkcs12(der: Buffer): boolean {
    try {
        const pfx = parseSequence(der)
        return integer(child(pfx, 0)) === 3 && oid(child(child(pfx, 1), 0)).startsWith('1.2.840.113549.1.7.')
    } catch {
        return false
    }
}

/** The MAC of the file (HMAC with a key from the password): a wrong password fails here. */
function checkMac(macData: Node, content: Buffer, password: string) {
    let matches: (pass: Buffer) => boolean
    try {
        const digestInfo = child(macData, 0)
        const hash = HASHES[oid(child(child(digestInfo, 0), 0))]
        if (!hash) throw new Error('mac')
        const expected = octets(child(digestInfo, 1))
        const salt = octets(child(macData, 1))
        const iterations = macData.children[2] ? integer(child(macData, 2)) : 1
        const size = createHash(hash.name).digest().length
        matches = pass => {
            const key = pkcs12Kdf(hash, pass, salt, iterations, 3, size)
            const mac = createHmac(hash.name, key).update(content).digest()
            return mac.length === expected.length && timingSafeEqual(mac, expected)
        }
    } catch {
        throw new Pkcs12FormatError('The MAC of the PKCS#12 file cannot be read')
    }
    // An empty password: some programs use no bytes at all instead of the two zero bytes
    if (!matches(bmpPassword(password)) && !(password === '' && matches(Buffer.alloc(0))))
        throw new Pkcs12PasswordError('The password does not open the PKCS#12 file')
}

type Bag = { type: string; value: Node; keyId: string | null }

function bagsOf(safeContents: Buffer): Bag[] {
    return parseSequence(safeContents).children.map(bag => {
        const attributes = bag.children[2]?.children ?? []
        const keyIdAttribute = attributes.find(attribute => oid(child(attribute, 0)) === OIDS.localKeyId)
        const keyIdValue = keyIdAttribute ? child(keyIdAttribute, 1).children[0] : undefined
        return {
            type: oid(child(bag, 0)),
            value: explicit(child(bag, 1)),
            keyId: keyIdValue ? octets(keyIdValue).toString('hex') : null
        }
    })
}

/**
 * Opens a PKCS#12 file (.p12, .pfx) with its password and reads its certificate: the one that belongs to the private
 * key (same localKeyId), else the first one that is not a CA. Throws Pkcs12FormatError or Pkcs12PasswordError.
 */
export function readPkcs12(der: Buffer, password: string): CertificateMeta {
    let authSafe: Buffer
    let macData: Node | undefined
    try {
        const pfx = parseSequence(der)
        if (integer(child(pfx, 0)) !== 3) throw new Error('version')
        const contentInfo = child(pfx, 1)
        // A PKCS#12 file protected by a signature instead of a password is not supported
        if (oid(child(contentInfo, 0)) !== OIDS.data) throw new Error('signed')
        authSafe = octets(explicit(child(contentInfo, 1)))
        macData = pfx.children[2]
    } catch {
        throw new Pkcs12FormatError('Not a PKCS#12 file')
    }
    if (macData) checkMac(macData, authSafe, password)
    const bags: Bag[] = []
    try {
        for (const info of parseSequence(authSafe).children) {
            const type = oid(child(info, 0))
            const content = explicit(child(info, 1))
            if (type === OIDS.data) bags.push(...bagsOf(octets(content)))
            else if (type === OIDS.encryptedData) {
                const encryptedContentInfo = child(content, 1)
                const encrypted = encryptedContentInfo.children[2]
                if (encrypted)
                    bags.push(...bagsOf(decrypt(child(encryptedContentInfo, 1), octets(encrypted), password)))
            }
        }
    } catch {
        throw new Pkcs12PasswordError('The password does not open the PKCS#12 file')
    }
    const keyIds = new Set(
        bags.filter(bag => bag.type === OIDS.keyBag || bag.type === OIDS.shroudedKeyBag).map(bag => bag.keyId)
    )
    const certificates = bags
        .filter(bag => bag.type === OIDS.certBag)
        .flatMap(bag => {
            try {
                if (oid(child(bag.value, 0)) !== OIDS.x509Certificate) return []
                const x509 = new X509Certificate(octets(explicit(child(bag.value, 1))))
                return [{ x509, keyId: bag.keyId }]
            } catch {
                return []
            }
        })
    const chosen =
        certificates.find(item => item.keyId !== null && keyIds.has(item.keyId)) ??
        certificates.find(item => !item.x509.ca) ??
        certificates[0]
    if (!chosen) throw new Pkcs12PasswordError('The PKCS#12 file has no certificate')
    const { x509 } = chosen
    return {
        thumbprint: x509.fingerprint.toUpperCase(),
        subject: x509.subject.split('\n').filter(Boolean).join(', '),
        issuer: x509.issuer.split('\n').filter(Boolean).join(', '),
        serial: x509.serialNumber.toUpperCase(),
        validUntil: new Date(x509.validTo)
    }
}
