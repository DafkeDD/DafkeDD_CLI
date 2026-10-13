import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import QRCode from 'qrcode'
import { AppException } from '../common/app.exception.js'
import { decrypt, deriveKey, encrypt, sha256 } from './crypto.js'
import { LoginLimiter } from './login-limiter.js'
import { OidcConfig } from './oidc.config.js'
import { OIDC_STORE, type OidcStore, type StoredUser } from './store/oidc.store.js'
import { newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, otpauthUrl, verifyTotp } from './totp.js'

/** What the authenticator app needs: the secret (to type it in), the otpauth:// URL and the same as a QR code (SVG). */
export interface MfaSetup {
    secret: string
    otpauthUrl: string
    qrSvg: string
}

/** How a second factor was proven: a code of the authenticator app, or a recovery code. */
export type SecondFactor = 'totp' | 'recovery'

/** RFC 8176 authentication method references after a successful second factor. */
export const MFA_AMR: Record<SecondFactor, string[]> = { totp: ['pwd', 'otp', 'mfa'], recovery: ['pwd', 'mfa'] }

const hashRecovery = (code: string) => sha256('recovery:' + normalizeRecoveryCode(code))

/**
 * Two-factor authentication with an authenticator app (TOTP, see totp.ts). The secret is stored encrypted with a key
 * derived from OIDC_MASTER_KEY and bound to the account; recovery codes only as hashes. Every code works once.
 */
@Injectable()
export class MfaService {
    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly config: OidcConfig,
        private readonly limiter: LoginLimiter
    ) {}

    private key() {
        return deriveKey(this.config.masterKey(), 'oidc totp secret v1')
    }

    private invalidCode(): never {
        throw new AppException('oidc.MFA_INVALID_CODE', HttpStatus.BAD_REQUEST)
    }

    async status(userId: string) {
        const state = await this.store.getMfa(userId)
        return { enabled: Boolean(state?.enabled), recoveryCodesLeft: state?.enabled ? state.recoveryCodes.length : 0 }
    }

    /** Starts setting up: a new secret, the otpauth URL and a QR code (SVG) for the authenticator app. */
    async setup(userId: string) {
        const user = await this.store.findUserById(userId)
        if (!user) throw new AppException('errors.UNAUTHORIZED', HttpStatus.UNAUTHORIZED)
        if (user.mfaEnabled) throw new AppException('oidc.MFA_ALREADY_ENABLED', HttpStatus.CONFLICT)
        const secret = newTotpSecret()
        await this.store.setMfaSecret(user.id, encrypt(secret, this.key(), 'totp:' + user.id))
        return this.presentation(secret, user.email)
    }

    /** The secret that is being set up (again, for example after a wrong code), or a new one when there is none. */
    async pendingSetup(user: StoredUser) {
        const state = await this.store.getMfa(user.id)
        if (!state?.secret || state.enabled) return this.setup(user.id)
        return this.presentation(decrypt(state.secret, this.key(), 'totp:' + user.id), user.email)
    }

    private async presentation(secret: string, account: string): Promise<MfaSetup> {
        const url = otpauthUrl(secret, account, this.config.appName)
        const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
        return { secret, otpauthUrl: url, qrSvg }
    }

    /**
     * Confirms the setup with a first code: two-factor authentication is on from now on. Returns ten recovery codes,
     * shown once. Every other session of the account ends, so it logs in again with the second factor.
     */
    async enable(userId: string, code: string) {
        const state = await this.store.getMfa(userId)
        if (state?.enabled) throw new AppException('oidc.MFA_ALREADY_ENABLED', HttpStatus.CONFLICT)
        if (!state?.secret) throw new AppException('oidc.MFA_SETUP_FIRST', HttpStatus.BAD_REQUEST)
        this.limit(userId)
        const step = verifyTotp(decrypt(state.secret, this.key(), 'totp:' + userId), code, null)
        if (step === null) this.invalidCode()
        const recoveryCodes = newRecoveryCodes()
        await this.store.enableMfa(userId, recoveryCodes.map(hashRecovery), step)
        await this.store.endUserSessions(userId)
        return { enabled: true as const, recoveryCodes }
    }

    /** Turns two-factor authentication off; needs a valid code (or a recovery code). Not when it is required. */
    async disable(userId: string, code: string) {
        if (this.config.mfaRequired) throw new AppException('oidc.MFA_REQUIRED', HttpStatus.FORBIDDEN)
        if (!(await this.check(userId, code))) this.invalidCode()
        await this.store.disableMfa(userId)
        return { enabled: false as const }
    }

    /**
     * Removes two-step verification of an account (a superadmin, when someone lost their phone and recovery codes). Every
     * session ends; with OIDC_MFA=required the account sets it up again at its next login.
     */
    async reset(userId: string) {
        await this.store.disableMfa(userId)
        await this.store.endUserSessions(userId)
    }

    /** New recovery codes (the old ones stop working); needs a valid code. */
    async regenerateRecoveryCodes(userId: string, code: string) {
        if (!(await this.check(userId, code))) this.invalidCode()
        const recoveryCodes = newRecoveryCodes()
        await this.store.setRecoveryCodes(userId, recoveryCodes.map(hashRecovery))
        return { recoveryCodes }
    }

    private limit(userId: string) {
        if (!this.limiter.allow(['mfa:' + userId]))
            throw new AppException('oidc.TOO_MANY_ATTEMPTS', HttpStatus.TOO_MANY_REQUESTS)
    }

    /**
     * Checks a second factor: a 6-digit code of the authenticator app, or a recovery code. Each works only once.
     * Returns how it was proven, or null. Rate limited per account (throws oidc.TOO_MANY_ATTEMPTS).
     */
    async check(userId: string, code: string): Promise<SecondFactor | null> {
        const state = await this.store.getMfa(userId)
        if (!state?.enabled || !state.secret || typeof code !== 'string') return null
        this.limit(userId)
        const step = verifyTotp(decrypt(state.secret, this.key(), 'totp:' + userId), code, state.lastStep)
        if (step !== null) return (await this.store.useTotpStep(userId, step)) ? 'totp' : null
        const recovery = normalizeRecoveryCode(code)
        if (recovery.length === 8 && (await this.store.useRecoveryCode(userId, hashRecovery(code)))) return 'recovery'
        return null
    }
}
