import { HttpStatus, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AppException } from '../common/app.exception.js'
import { PasportConfig } from './pasport.config.js'

/** The eHealth certificate of a doctor, as the vault of the login server gives it to this app. */
export interface VaultCredentials {
    filename: string
    /** The .p12 file, base64. Keep it in memory only: never log, cache or send it to a browser. */
    p12Base64: string
    password: string
    thumbprint: string
    subject: string | null
    issuer: string | null
    serial: string | null
    validUntil: string | null
}

/** A doctor whose certificate the logged in account may use (`self`: its own; `ready`: certificate and password there). */
export interface VaultDoctor {
    id: string
    name: string | null
    email: string
    self: boolean
    ready: boolean
}

/**
 * The eHealth vault lives on the login server only: doctors put their certificate there (/vault on the login server),
 * and this app asks for it, server to server, when it calls eHealth for that doctor. POST /vault/credentials with the
 * client id and secret of this app (OIDC_CLIENT_SECRET) and the access token of the doctor issued to this app: a
 * leaked secret alone gives nothing. A colleague (the secretariat) uses the certificate of a doctor who chose it
 * there (doctorId). The login server checks that the app sells a product that needs the vault and
 * that the organisation has a licence of it.
 */
@Injectable()
export class PasportVault {
    constructor(
        private readonly pasport: PasportConfig,
        private readonly config: ConfigService
    ) {}

    /** Is the vault set up for this app (a confidential app: OIDC_CLIENT_SECRET)? */
    get enabled(): boolean {
        return Boolean(this.secret)
    }

    private get secret(): string {
        return (this.config.get<string>('OIDC_CLIENT_SECRET') ?? '').trim()
    }

    /**
     * The certificate of the doctor whose access token this is, or (doctorId) of a doctor of the organisation who chose
     * this account on /vault of the login server (the secretariat). Throws a translated AppException.
     */
    async credentials(accessToken: string, doctorId?: string | null): Promise<VaultCredentials> {
        return this.post<VaultCredentials>('/vault/credentials', doctorId ? { accessToken, doctorId } : { accessToken })
    }

    /** The doctors whose certificate this account may use: itself when it is a doctor, and who chose it. */
    async doctors(accessToken: string): Promise<VaultDoctor[]> {
        return this.post<VaultDoctor[]>('/vault/doctors', { accessToken })
    }

    private async post<T>(path: string, body: Record<string, string>): Promise<T> {
        if (!this.enabled) throw new AppException('errors.VAULT_NOT_SET_UP', HttpStatus.SERVICE_UNAVAILABLE)
        // The client id of this app: the first of OIDC_CLIENT_IDS (its own frontend)
        const clientId = this.pasport.clientIds[0] ?? ''
        const basic = Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(this.secret)}`).toString(
            'base64'
        )
        let response: Response
        try {
            response = await fetch(this.pasport.audience + path, {
                method: 'POST',
                headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                redirect: 'error',
                signal: AbortSignal.timeout(10_000)
            })
        } catch {
            throw new AppException('errors.VAULT_UNAVAILABLE', HttpStatus.BAD_GATEWAY)
        }
        if (response.ok) return (await response.json()) as T
        // Why not, in the words of this app (the login server answers in its own language)
        if (response.status === HttpStatus.NOT_FOUND) throw new AppException('errors.VAULT_EMPTY', HttpStatus.NOT_FOUND)
        if (response.status === HttpStatus.FORBIDDEN)
            throw new AppException('errors.VAULT_NOT_ALLOWED', HttpStatus.FORBIDDEN)
        if (response.status === HttpStatus.CONFLICT)
            throw new AppException('errors.VAULT_NOT_READY', HttpStatus.CONFLICT)
        throw new AppException('errors.VAULT_UNAVAILABLE', HttpStatus.BAD_GATEWAY)
    }
}
