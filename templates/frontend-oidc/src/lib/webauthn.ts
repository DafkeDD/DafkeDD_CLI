/**
 * Passkeys in the browser (WebAuthn): the options of the API arrive as JSON with base64url fields; the browser wants
 * ArrayBuffers, and its answer goes back as JSON with base64url fields again.
 */

function toBuffer(value: string): ArrayBuffer {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer
}

function toBase64url(buffer: ArrayBuffer | null): string {
    if (!buffer) return ''
    let binary = ''
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Whether this browser can use passkeys at all. */
export function passkeysSupported(): boolean {
    return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && !!navigator.credentials
}

type Descriptor = { type: 'public-key'; id: string; transports?: string[] }

export type CreateOptions = {
    challenge: string
    rp: { id: string; name: string }
    user: { id: string; name: string; displayName: string }
    pubKeyCredParams: { type: 'public-key'; alg: number }[]
    authenticatorSelection?: AuthenticatorSelectionCriteria
    excludeCredentials?: Descriptor[]
    attestation?: AttestationConveyancePreference
    timeout?: number
}

export type GetOptions = {
    challenge: string
    rpId: string
    userVerification?: UserVerificationRequirement
    timeout?: number
}

const descriptor = (item: Descriptor): PublicKeyCredentialDescriptor => ({
    type: item.type,
    id: toBuffer(item.id),
    transports: item.transports as AuthenticatorTransport[] | undefined
})

/** navigator.credentials.create(): a new passkey on this device; its answer as JSON for POST /me/passkeys. */
export async function createPasskey(options: CreateOptions) {
    const credential = (await navigator.credentials.create({
        publicKey: {
            ...options,
            challenge: toBuffer(options.challenge),
            user: { ...options.user, id: toBuffer(options.user.id) },
            excludeCredentials: (options.excludeCredentials ?? []).map(descriptor)
        }
    })) as PublicKeyCredential | null
    if (!credential) throw new DOMException('No passkey', 'NotAllowedError')
    const response = credential.response as AuthenticatorAttestationResponse
    return {
        id: credential.id,
        rawId: toBase64url(credential.rawId),
        type: credential.type,
        response: {
            clientDataJSON: toBase64url(response.clientDataJSON),
            attestationObject: toBase64url(response.attestationObject),
            transports: typeof response.getTransports === 'function' ? response.getTransports() : []
        }
    }
}

/** navigator.credentials.get(): the device shows its passkeys for this site; the answer as JSON for the login. */
export async function getPasskey(options: GetOptions) {
    const credential = (await navigator.credentials.get({
        publicKey: { ...options, challenge: toBuffer(options.challenge) }
    })) as PublicKeyCredential | null
    if (!credential) throw new DOMException('No passkey', 'NotAllowedError')
    const response = credential.response as AuthenticatorAssertionResponse
    return {
        id: credential.id,
        rawId: toBase64url(credential.rawId),
        type: credential.type,
        response: {
            clientDataJSON: toBase64url(response.clientDataJSON),
            authenticatorData: toBase64url(response.authenticatorData),
            signature: toBase64url(response.signature),
            userHandle: toBase64url(response.userHandle)
        }
    }
}

/** The user closed the dialog of the browser, or it timed out (no error message needed beyond "cancelled"). */
export const cancelled = (error: unknown) =>
    error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')
