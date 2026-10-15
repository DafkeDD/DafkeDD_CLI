import { randomBytes } from 'node:crypto'
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common'
import { AuditService } from '../../audit/audit.service.js'
import { AppException } from '../../common/app.exception.js'
import { decrypt, deriveKey, encrypt } from '../crypto.js'
import { OidcConfig } from '../oidc.config.js'
import { OIDC_STORE, type OidcStore, type Passkey, type StoredUser } from '../store/oidc.store.js'
import {
    type AuthenticationResponse,
    COSE_ALGORITHMS,
    type RegistrationResponse,
    verifyAuthentication,
    verifyRegistration,
    WebAuthnError
} from './webauthn.js'

/** A ceremony may take this long (the user looks for the key, types a PIN). */
const CHALLENGE_SECONDS = 5 * 60
const MAX_NAME = 60

/** The user handle of an account (WebAuthn user.id): its id, so a passkey always says whose it is. */
export const userHandle = (userId: string) => Buffer.from(userId).toString('base64url')

/** A passkey as the account sees it (never the public key or the counter). */
export function publicPasskey(passkey: Passkey) {
    return {
        id: passkey.id,
        name: passkey.name,
        createdAt: passkey.createdAt,
        lastUsedAt: passkey.lastUsedAt,
        // Synced between devices (iCloud Keychain, Google Password Manager, ...) or bound to one device or key
        synced: passkey.backedUp,
        transports: passkey.transports
    }
}

/**
 * Passkeys: log in with a fingerprint, face or PIN of the device (WebAuthn). Every account adds them on /security;
 * the login page offers "Log in with a passkey". With user verification a passkey is two factors on its own (like
 * the eID): no code of the authenticator app follows.
 */
@Injectable()
export class PasskeyService {
    private readonly logger = new Logger('Passkeys')
    /**
     * Login challenges used already (until they expire): the login cookie forgets its challenge, but an old copy of
     * that cookie must not replay a captured answer (synced passkeys do not count signatures). Per process.
     */
    private readonly used = new Map<string, number>()

    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly config: OidcConfig,
        private readonly audit: AuditService
    ) {}

    get enabled(): boolean {
        return this.config.passkeys
    }

    assertEnabled() {
        if (!this.enabled) throw new AppException('oidc.PASSKEYS_DISABLED', HttpStatus.NOT_FOUND)
    }

    private get key() {
        return deriveKey(this.config.masterKey(), 'oidc passkey challenge v1')
    }

    /** A new random challenge (32 bytes, base64url). */
    challenge(): string {
        return randomBytes(32).toString('base64url')
    }

    private expected(challenge: string) {
        return { challenge, origins: this.config.passkeyOrigins, rpId: this.config.passkeyRpId }
    }

    // ---------------------------------------------------------------- adding one (logged in, on /security)

    /** The options for navigator.credentials.create(), and the challenge sealed for this account (5 minutes). */
    async registrationOptions(userId: string) {
        this.assertEnabled()
        const user = await this.store.findUserById(userId)
        if (!user) throw new AppException('errors.UNAUTHORIZED', HttpStatus.UNAUTHORIZED)
        const challenge = this.challenge()
        const existing = await this.store.listPasskeys(userId)
        return {
            token: encrypt(
                JSON.stringify({ c: challenge, e: Date.now() + CHALLENGE_SECONDS * 1000 }),
                this.key,
                'passkey:register:' + userId
            ),
            options: {
                challenge,
                rp: { id: this.config.passkeyRpId, name: this.config.appName },
                user: { id: userHandle(user.id), name: user.email, displayName: user.name },
                pubKeyCredParams: COSE_ALGORITHMS.map(alg => ({ type: 'public-key', alg })),
                // A passkey: the account is on the device (discoverable), and always with PIN, fingerprint or face
                authenticatorSelection: {
                    residentKey: 'required',
                    requireResidentKey: true,
                    userVerification: 'required'
                },
                excludeCredentials: existing.map(passkey => ({
                    type: 'public-key',
                    id: passkey.credentialId,
                    transports: passkey.transports
                })),
                attestation: 'none',
                timeout: CHALLENGE_SECONDS * 1000
            }
        }
    }

    private openToken(token: unknown, userId: string): string {
        try {
            if (typeof token !== 'string' || token.length > 1000) throw new Error('invalid')
            const data = JSON.parse(decrypt(token, this.key, 'passkey:register:' + userId)) as {
                c?: unknown
                e?: unknown
            }
            if (typeof data.c !== 'string' || typeof data.e !== 'number' || data.e <= Date.now())
                throw new Error('expired')
            return data.c
        } catch {
            throw new AppException('oidc.PASSKEY_EXPIRED', HttpStatus.BAD_REQUEST)
        }
    }

    /** Checks and stores the new passkey of this account. */
    async register(userId: string, input: { token: string; credential: unknown; name?: string }) {
        this.assertEnabled()
        const challenge = this.openToken(input.token, userId)
        let created
        try {
            created = verifyRegistration(input.credential as RegistrationResponse, this.expected(challenge))
        } catch (error) {
            if (!(error instanceof WebAuthnError)) throw error
            this.logger.warn('Passkey not added: ' + error.message)
            throw new AppException('oidc.PASSKEY_INVALID', HttpStatus.BAD_REQUEST)
        }
        const name = input.name?.trim().slice(0, MAX_NAME) || 'Passkey'
        const saved = await this.store.addPasskey({ userId, name, ...created })
        if (!saved) throw new AppException('oidc.PASSKEY_EXISTS', HttpStatus.CONFLICT)
        await this.audit.record('account.passkey_added', {
            tenantId: null,
            actorId: userId,
            target: { type: 'user', id: userId },
            details: { name, synced: created.backedUp }
        })
        return publicPasskey(saved)
    }

    async list(userId: string) {
        return { enabled: this.enabled, passkeys: (await this.store.listPasskeys(userId)).map(publicPasskey) }
    }

    async rename(userId: string, id: string, name: string) {
        if (!(await this.store.renamePasskey(userId, id, name.trim().slice(0, MAX_NAME))))
            throw new AppException('oidc.PASSKEY_NOT_FOUND', HttpStatus.NOT_FOUND)
        return { id, name: name.trim().slice(0, MAX_NAME) }
    }

    /** Removes a passkey; not the last way to log in (no password, eID or other server, and no other passkey). */
    async remove(userId: string, id: string) {
        const [user, passkeys, eid, external] = await Promise.all([
            this.store.findUserById(userId),
            this.store.listPasskeys(userId),
            this.store.findIdentifier(userId, 'eid'),
            this.store.findIdentifier(userId, 'external')
        ])
        const passkey = passkeys.find(item => item.id === id)
        if (!passkey) throw new AppException('oidc.PASSKEY_NOT_FOUND', HttpStatus.NOT_FOUND)
        if (!user?.passwordHash && !eid && !external && passkeys.length === 1)
            throw new AppException('oidc.PASSKEY_LAST_LOGIN', HttpStatus.CONFLICT)
        await this.store.deletePasskey(userId, id)
        await this.audit.record('account.passkey_removed', {
            tenantId: null,
            actorId: userId,
            target: { type: 'user', id: userId },
            details: { name: passkey.name }
        })
    }

    // ---------------------------------------------------------------- logging in

    /** The options for navigator.credentials.get(): any passkey of this site (the device shows the accounts). */
    loginOptions(challenge: string) {
        return {
            challenge,
            rpId: this.config.passkeyRpId,
            userVerification: 'required',
            timeout: CHALLENGE_SECONDS * 1000
        }
    }

    /** Marks a login challenge as used; false when it was used before. */
    private consume(challenge: string): boolean {
        const now = Date.now()
        if (this.used.size > 10_000) for (const [key, until] of this.used) if (until <= now) this.used.delete(key)
        if ((this.used.get(challenge) ?? 0) > now) return false
        this.used.set(challenge, now + 2 * CHALLENGE_SECONDS * 1000)
        return true
    }

    /** Checks a passkey login; the account, or an error key. A challenge works once. */
    async authenticate(credential: unknown, challenge: string): Promise<StoredUser | string> {
        if (!this.consume(challenge)) return 'oidc.PASSKEY_EXPIRED'
        const response = credential as AuthenticationResponse
        const id = typeof response?.id === 'string' ? response.id : ''
        const passkey = id && id.length <= 1400 ? await this.store.findPasskey(id) : null
        if (!passkey) return 'oidc.PASSKEY_UNKNOWN'
        let result
        try {
            result = verifyAuthentication(
                response,
                {
                    publicKey: passkey.publicKey,
                    algorithm: passkey.algorithm,
                    signCount: passkey.signCount,
                    userHandle: userHandle(passkey.userId)
                },
                this.expected(challenge)
            )
        } catch (error) {
            if (!(error instanceof WebAuthnError)) throw error
            this.logger.warn('Passkey login refused: ' + error.message)
            return 'oidc.PASSKEY_INVALID'
        }
        if (!(await this.store.usePasskey(passkey.id, result.signCount, result.backedUp))) {
            this.logger.warn('Passkey login refused: the signature counter did not increase')
            return 'oidc.PASSKEY_INVALID'
        }
        return (await this.store.findUserById(passkey.userId)) ?? 'oidc.PASSKEY_UNKNOWN'
    }
}
