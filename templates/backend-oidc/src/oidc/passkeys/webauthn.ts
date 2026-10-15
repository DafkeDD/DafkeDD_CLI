import { createHash, createPublicKey, type KeyObject, timingSafeEqual, verify } from 'node:crypto'
import { CborError, type CborMap, decodeCbor, decodeCborPrefix } from './cbor.js'

/**
 * WebAuthn (passkeys), our own code on node:crypto: the registration (navigator.credentials.create) and the login
 * (navigator.credentials.get) of the W3C Web Authentication spec, level 2. No attestation trust: we ask for
 * attestation "none" (privacy), so we only learn the public key, never which device it is.
 */
export class WebAuthnError extends Error {}

/** COSE algorithms we accept: ES256, RS256 and EdDSA (Ed25519). */
export const COSE_ALGORITHMS = [-7, -257, -8] as const
export type CoseAlgorithm = (typeof COSE_ALGORITHMS)[number]

const FLAG_UP = 0x01
const FLAG_UV = 0x04
const FLAG_BE = 0x08
const FLAG_BS = 0x10
const FLAG_AT = 0x40

export interface AuthenticatorData {
    rpIdHash: Buffer
    userPresent: boolean
    userVerified: boolean
    /** Backup eligible: a passkey that can be synced (iCloud Keychain, Google Password Manager, ...). */
    backupEligible: boolean
    backedUp: boolean
    signCount: number
    credential: { id: Buffer; publicKey: CborMap; aaguid: string } | null
}

const bytes = (value: string, what: string): Buffer => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value) || value.length > 65_536)
        throw new WebAuthnError(`${what} is not base64url`)
    return Buffer.from(value, 'base64url')
}

export function parseAuthenticatorData(data: Buffer): AuthenticatorData {
    if (data.length < 37) throw new WebAuthnError('Authenticator data too short')
    const flags = data[32]!
    const result: AuthenticatorData = {
        rpIdHash: data.subarray(0, 32),
        userPresent: (flags & FLAG_UP) !== 0,
        userVerified: (flags & FLAG_UV) !== 0,
        backupEligible: (flags & FLAG_BE) !== 0,
        backedUp: (flags & FLAG_BS) !== 0,
        signCount: data.readUInt32BE(33),
        credential: null
    }
    if (flags & FLAG_AT) {
        if (data.length < 55) throw new WebAuthnError('Attested credential data too short')
        const aaguid = data.subarray(37, 53).toString('hex')
        const idLength = data.readUInt16BE(53)
        if (idLength < 16 || idLength > 1023 || data.length < 55 + idLength)
            throw new WebAuthnError('Bad credential id')
        const id = data.subarray(55, 55 + idLength)
        let key
        try {
            key = decodeCborPrefix(data, 55 + idLength)
        } catch (error) {
            throw new WebAuthnError('Bad public key: ' + (error instanceof Error ? error.message : ''))
        }
        // Extension data (ED flag) may follow; we ask for none and ignore it
        if (!(key.value instanceof Map)) throw new WebAuthnError('Bad public key')
        result.credential = { id: Buffer.from(id), publicKey: key.value, aaguid }
    }
    return result
}

/** A COSE public key as a node KeyObject, and its algorithm. */
export function coseToKey(cose: CborMap): { key: KeyObject; algorithm: CoseAlgorithm } {
    const kty = cose.get(1)
    const alg = cose.get(3)
    const b = (label: number) => {
        const value = cose.get(label)
        if (!(value instanceof Uint8Array)) throw new WebAuthnError('Incomplete public key')
        return Buffer.from(value).toString('base64url')
    }
    try {
        if (kty === 2 && alg === -7 && cose.get(-1) === 1)
            return {
                key: createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b(-2), y: b(-3) }, format: 'jwk' }),
                algorithm: -7
            }
        if (kty === 3 && alg === -257) {
            const key = createPublicKey({ key: { kty: 'RSA', n: b(-1), e: b(-2) }, format: 'jwk' })
            if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new WebAuthnError('RSA key too short')
            return { key, algorithm: -257 }
        }
        if (kty === 1 && alg === -8 && cose.get(-1) === 6)
            return {
                key: createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b(-2) }, format: 'jwk' }),
                algorithm: -8
            }
    } catch (error) {
        if (error instanceof WebAuthnError) throw error
        throw new WebAuthnError('Unreadable public key')
    }
    throw new WebAuthnError('Unsupported key type or algorithm')
}

function verifySignature(algorithm: CoseAlgorithm, key: KeyObject, data: Buffer, signature: Buffer): boolean {
    try {
        if (algorithm === -7) return verify('sha256', data, { key, dsaEncoding: 'der' }, signature)
        if (algorithm === -257) return verify('sha256', data, key, signature)
        return verify(null, data, key, signature)
    } catch {
        return false
    }
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest()

interface ClientData {
    type: string
    challenge: string
    origin: string
    crossOrigin?: boolean
}

/** The clientDataJSON: its type, our challenge, and one of our origins (never in an iframe of another site). */
function checkClientData(raw: Buffer, type: string, challenge: string, origins: string[]): ClientData {
    let data: ClientData
    try {
        data = JSON.parse(raw.toString('utf8')) as ClientData
    } catch {
        throw new WebAuthnError('Bad client data')
    }
    if (data.type !== type) throw new WebAuthnError('Wrong ceremony type')
    const expected = Buffer.from(challenge, 'base64url')
    const given = typeof data.challenge === 'string' ? Buffer.from(data.challenge, 'base64url') : Buffer.alloc(0)
    if (expected.length === 0 || given.length !== expected.length || !timingSafeEqual(given, expected))
        throw new WebAuthnError('Wrong challenge')
    if (!origins.includes(data.origin)) throw new WebAuthnError('Wrong origin')
    if (data.crossOrigin === true) throw new WebAuthnError('Cross-origin is not allowed')
    return data
}

function checkAuthenticatorData(data: AuthenticatorData, rpId: string) {
    if (!timingSafeEqual(data.rpIdHash, sha256(rpId))) throw new WebAuthnError('Wrong relying party')
    if (!data.userPresent) throw new WebAuthnError('User not present')
    // Always user verification (PIN, fingerprint, face): a passkey alone is then two factors
    if (!data.userVerified) throw new WebAuthnError('User not verified')
}

export interface Expected {
    challenge: string
    origins: string[]
    rpId: string
}

/** What the browser sends after navigator.credentials.create(). */
export interface RegistrationResponse {
    id: string
    response: { clientDataJSON: string; attestationObject: string; transports?: string[] }
}

export interface NewCredential {
    /** base64url */
    credentialId: string
    /** SPKI DER, base64 */
    publicKey: string
    algorithm: CoseAlgorithm
    signCount: number
    aaguid: string
    backupEligible: boolean
    backedUp: boolean
    transports: string[]
}

/** Checks a registration; returns the new credential to store. */
export function verifyRegistration(credential: RegistrationResponse, expected: Expected): NewCredential {
    const clientData = bytes(credential?.response?.clientDataJSON, 'clientDataJSON')
    checkClientData(clientData, 'webauthn.create', expected.challenge, expected.origins)
    let attestation: CborMap
    try {
        const value = decodeCbor(bytes(credential.response.attestationObject, 'attestationObject'))
        if (!(value instanceof Map)) throw new CborError('Not a map')
        attestation = value
    } catch (error) {
        throw new WebAuthnError('Bad attestation object: ' + (error instanceof Error ? error.message : ''))
    }
    const authData = attestation.get('authData')
    if (!(authData instanceof Uint8Array)) throw new WebAuthnError('No authenticator data')
    // We asked for attestation "none": the statement (if any) is not trusted and not needed
    if (typeof attestation.get('fmt') !== 'string') throw new WebAuthnError('No attestation format')
    const data = parseAuthenticatorData(Buffer.from(authData))
    checkAuthenticatorData(data, expected.rpId)
    if (!data.credential) throw new WebAuthnError('No credential')
    if (credential.id !== data.credential.id.toString('base64url')) throw new WebAuthnError('Credential id mismatch')
    const { key, algorithm } = coseToKey(data.credential.publicKey)
    const transports = Array.isArray(credential.response.transports)
        ? credential.response.transports
              .filter(value => typeof value === 'string' && /^[a-z-]{1,20}$/.test(value))
              .slice(0, 8)
        : []
    return {
        credentialId: data.credential.id.toString('base64url'),
        publicKey: key.export({ format: 'der', type: 'spki' }).toString('base64'),
        algorithm,
        signCount: data.signCount,
        aaguid: data.credential.aaguid,
        backupEligible: data.backupEligible,
        backedUp: data.backedUp,
        transports
    }
}

/** What the browser sends after navigator.credentials.get(). */
export interface AuthenticationResponse {
    id: string
    response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string | null }
}

export interface StoredCredential {
    publicKey: string
    algorithm: number
    signCount: number
    /** The user handle we gave at registration: base64url of the user id. */
    userHandle: string
}

/**
 * Checks a login: the signature over the authenticator data and the hash of the client data, with the stored key.
 * Returns the new signature counter. A counter that does not go up (when the authenticator counts) means a cloned
 * authenticator: refused.
 */
export function verifyAuthentication(
    credential: AuthenticationResponse,
    stored: StoredCredential,
    expected: Expected
): { signCount: number; backedUp: boolean } {
    const clientData = bytes(credential?.response?.clientDataJSON, 'clientDataJSON')
    checkClientData(clientData, 'webauthn.get', expected.challenge, expected.origins)
    const authData = bytes(credential.response.authenticatorData, 'authenticatorData')
    const data = parseAuthenticatorData(authData)
    checkAuthenticatorData(data, expected.rpId)
    const handle = credential.response.userHandle
    if (handle !== undefined && handle !== null && handle !== '' && handle !== stored.userHandle)
        throw new WebAuthnError('Wrong user handle')
    const key = createPublicKey({ key: Buffer.from(stored.publicKey, 'base64'), format: 'der', type: 'spki' })
    const signed = Buffer.concat([authData, sha256(clientData)])
    if (!(COSE_ALGORITHMS as readonly number[]).includes(stored.algorithm)) throw new WebAuthnError('Unknown algorithm')
    if (
        !verifySignature(
            stored.algorithm as CoseAlgorithm,
            key,
            signed,
            bytes(credential.response.signature, 'signature')
        )
    )
        throw new WebAuthnError('Invalid signature')
    if ((data.signCount !== 0 || stored.signCount !== 0) && data.signCount <= stored.signCount)
        throw new WebAuthnError('Signature counter did not increase (cloned authenticator?)')
    return { signCount: data.signCount, backedUp: data.backedUp }
}
