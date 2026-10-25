import { createHmac } from 'node:crypto'
import { HttpStatus, Injectable, Logger } from '@nestjs/common'
import {
    BELGIUM_ROOT_CAS,
    createNonce,
    EidVerifyError,
    type EidTrustOptions,
    verifyEidToken
} from '@dafkedd/eid/server'
import { AppException } from '../common/app.exception.js'
import { decrypt, deriveKey, encrypt } from './crypto.js'
import { OIDC, OidcConfig } from './oidc.config.js'

/** "85073100323" as "85.07.31-003.23" (other lengths as they are). */
export function formatNationalNumber(digits: string): string {
    const d = digits.replace(/\D/g, '')
    if (d.length !== 11) return d
    return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4, 6)}-${d.slice(6, 9)}.${d.slice(9)}`
}

/** What an eID challenge is for: registering a new account, or linking the eID to the logged in account. */
export type EidPurpose = 'register' | 'link'

/**
 * The person of a verified eID login. The national register number only leaves this service as a hash (to find the
 * account) and encrypted (shown to the account itself on its profile).
 */
export interface EidPerson {
    /** HMAC-SHA256 of the national register number (user_identifiers.value_hash). */
    valueHash: string
    /** The national register number (only digits), encrypted: see sealNationalNumber. */
    rrnEncrypted: string
    /** The address on the card, when the bridge gives it (the login token does not: null). */
    address: string | null
    firstNames: string
    lastName: string
    /** "Jan Pieter Specimen". */
    name: string
}

/** A new challenge: `nonce` goes to the eID bridge, `challenge` (encrypted, with the nonce inside) comes back with the token. */
export interface EidChallenge {
    challenge: string
    nonce: string
    expiresAt: string
}

/**
 * The Belgian eID (with the DafkeDD eID bridge on the PC of the user, see https://github.com/DafkeDD/DafkeDD_EID).
 *
 * The browser asks a nonce, the bridge lets the card sign it after the PIN, and this service checks the token
 * (@dafkedd/eid/server): the signature, our origin, the nonce, the certificate chain up to the Belgian root CAs and
 * (OIDC_EID=on) the OCSP status of the certificate. Nonces are not stored: a login keeps it in its encrypted cookie,
 * registration and linking get it back in an encrypted challenge that expires after 5 minutes.
 */
@Injectable()
export class EidService {
    private readonly logger = new Logger(EidService.name)
    private trust: Promise<EidTrustOptions> | null = null

    constructor(private readonly config: OidcConfig) {
        if (config.eid === 'test' && config.production)
            throw new Error('OIDC_EID=test also trusts test cards: never use it in production. Use OIDC_EID=on.')
    }

    /** OIDC_EID on or test, and not only the other OpenID Connect server (OIDC_EXTERNAL_ONLY). */
    get enabled(): boolean {
        return this.config.eid !== 'off' && !this.config.externalOnly
    }

    assertEnabled(): void {
        if (!this.enabled) throw new AppException('oidc.EID_DISABLED', HttpStatus.NOT_FOUND)
    }

    /** A nonce for the bridge: 32 random bytes in base64 (44 characters). */
    nonce(): string {
        return createNonce()
    }

    private get challengeKey(): Buffer {
        return deriveKey(this.config.masterKey(), 'oidc eid challenge v1')
    }

    /** A challenge for registration or linking. `userId` binds a link challenge to one account. */
    challenge(purpose: EidPurpose, userId = '', now = Date.now()): EidChallenge {
        this.assertEnabled()
        const nonce = this.nonce()
        const expiresAt = now + OIDC.EID_CHALLENGE_SECONDS * 1000
        const challenge = encrypt(
            JSON.stringify({ n: nonce, e: expiresAt }),
            this.challengeKey,
            `eid:${purpose}:${userId}`
        )
        return { challenge, nonce, expiresAt: new Date(expiresAt).toISOString() }
    }

    /** The nonce of a challenge; oidc.EID_EXPIRED when it is invalid, expired, or for another purpose or account. */
    openChallenge(challenge: unknown, purpose: EidPurpose, userId = '', now = Date.now()): string {
        try {
            if (typeof challenge !== 'string' || challenge.length > 1000) throw new Error('invalid')
            const data = JSON.parse(decrypt(challenge, this.challengeKey, `eid:${purpose}:${userId}`)) as {
                n?: unknown
                e?: unknown
            }
            if (typeof data.n !== 'string' || typeof data.e !== 'number' || data.e <= now) throw new Error('expired')
            return data.n
        } catch {
            throw new AppException('oidc.EID_EXPIRED', HttpStatus.BAD_REQUEST)
        }
    }

    private get proofKey(): Buffer {
        return deriveKey(this.config.masterKey(), 'oidc eid proof v1')
    }

    /**
     * A verified eID person, encrypted for the next step of the same flow (the browser keeps it, for example while the
     * invitee of an invitation chooses a password). `bind` ties it to one flow (the invitation); it expires after
     * OIDC.EID_PROOF_SECONDS.
     */
    sealPerson(person: EidPerson, bind: string, now = Date.now()): string {
        const expiresAt = now + OIDC.EID_PROOF_SECONDS * 1000
        return encrypt(JSON.stringify({ p: person, e: expiresAt }), this.proofKey, `eid:proof:${bind}`)
    }

    /** The person of sealPerson; oidc.EID_EXPIRED when it is invalid, expired or for another flow. */
    openPerson(sealed: unknown, bind: string, now = Date.now()): EidPerson {
        try {
            if (typeof sealed !== 'string' || sealed.length > 4000) throw new Error('invalid')
            const data = JSON.parse(decrypt(sealed, this.proofKey, `eid:proof:${bind}`)) as {
                p?: EidPerson
                e?: unknown
            }
            if (typeof data.e !== 'number' || data.e <= now || typeof data.p?.valueHash !== 'string')
                throw new Error('expired')
            return data.p
        } catch {
            throw new AppException('oidc.EID_EXPIRED', HttpStatus.BAD_REQUEST)
        }
    }

    /**
     * Checks the token of the bridge for this nonce. Throws oidc.EID_INVALID (401) when it is not valid, and
     * oidc.EID_UNAVAILABLE (503) when the OCSP service of the eID could not be reached (fail closed).
     */
    async verify(token: unknown, nonce: string): Promise<EidPerson> {
        this.assertEnabled()
        try {
            const identity = await verifyEidToken({
                token,
                nonce,
                origin: this.config.eidOrigin,
                trust: await this.trustOptions(),
                revocation: this.config.eid === 'test' ? false : { timeoutMs: 5000 }
            })
            const firstNames = identity.firstNames.trim()
            const lastName = identity.lastName.trim()
            return {
                valueHash: this.hash(identity.nationalNumber),
                rrnEncrypted: this.sealNationalNumber(identity.nationalNumber),
                address: null,
                firstNames,
                lastName,
                name: [firstNames, lastName].filter(Boolean).join(' ')
            }
        } catch (error) {
            if (!EidVerifyError.is(error)) throw error
            // The code says what went wrong (for the log); the user only hears that the eID login failed
            this.logger.warn(`eID login refused: ${error.code}`)
            if (error.code === 'config-invalid') throw error
            if (error.code === 'revocation-unavailable')
                throw new AppException('oidc.EID_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE)
            throw new AppException('oidc.EID_INVALID', HttpStatus.UNAUTHORIZED)
        }
    }

    /** HMAC-SHA256 of a national register number (only digits), with a key derived from OIDC_MASTER_KEY. */
    hash(nationalNumber: string): string {
        return createHmac('sha256', deriveKey(this.config.masterKey(), 'oidc identifier v1'))
            .update('eid:' + nationalNumber.replace(/\D/g, ''))
            .digest('base64url')
    }

    private get rrnKey(): Buffer {
        return deriveKey(this.config.masterKey(), 'oidc national number v1')
    }

    /** The national register number (only digits), encrypted (AES-256-GCM, a key derived from OIDC_MASTER_KEY). */
    sealNationalNumber(nationalNumber: string): string {
        return encrypt(nationalNumber.replace(/\D/g, ''), this.rrnKey, 'rrn')
    }

    /** The national register number as "YY.MM.DD-XXX.XX"; null when it cannot be read. */
    openNationalNumber(encrypted: string | null): string | null {
        if (!encrypted) return null
        try {
            return formatNationalNumber(decrypt(encrypted, this.rrnKey, 'rrn'))
        } catch {
            return null
        }
    }

    /** on: the Belgian root CAs (the default of the library). test: also the test PKI of the bridge with --mock. */
    private trustOptions(): Promise<EidTrustOptions> {
        this.trust ??= (async () => {
            if (this.config.eid !== 'test') return {}
            const { TEST_CITIZEN_CA, TEST_ROOT_CA } = await import('@dafkedd/eid/mock')
            return { roots: [...BELGIUM_ROOT_CAS, TEST_ROOT_CA], intermediates: [TEST_CITIZEN_CA] }
        })()
        return this.trust
    }
}
