import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { BootstrapAdmin } from './store/oidc.store.js'

/** Lifetimes and limits of the OpenID Connect server (seconds unless stated otherwise). */
export const OIDC = {
    SESSION_COOKIE: 'oidc_session',
    COOKIE_PATH: '/oidc',
    /** A running login lives in an encrypted cookie oidc_ia_<id>, one per login (so several tabs work side by side). */
    INTERACTION_COOKIE: 'oidc_ia_',
    INTERACTION_SECONDS: 10 * 60,
    /** Browsers drop cookies above about 4 KB: a bigger login request is refused with a clear error. */
    MAX_INTERACTION_COOKIE: 3800,
    CODE_SECONDS: 60,
    ACCESS_TOKEN_SECONDS: 10 * 60,
    ID_TOKEN_SECONDS: 5 * 60,
    SESSION_SECONDS: 12 * 60 * 60,
    /** A signing key is replaced after 90 days and stays in the JWKS for 14 more days. */
    KEY_ROTATION_DAYS: 90,
    KEY_GRACE_DAYS: 14,
    /** Password login is "level of assurance 1"; MFA comes in a later phase. */
    ACR_PASSWORD: 'loa1',
    SCOPES: ['openid', 'profile', 'email', 'tenant'],
    LOCALES: ['en', 'nl', 'fr', 'de']
} as const

/** Reads the OIDC_* settings from .env. */
@Injectable()
export class OidcConfig {
    constructor(private readonly config: ConfigService) {}

    /** The issuer: the base URL of the OpenID Connect server, without a trailing slash. */
    get issuer(): string {
        return (this.config.get<string>('OIDC_ISSUER') ?? 'http://localhost:__PORT__/oidc').replace(/\/+$/, '')
    }

    /** The audience (aud) of access tokens: the API that accepts them. */
    get audience(): string {
        return this.config.get<string>('OIDC_AUDIENCE') ?? 'http://localhost:__PORT__'
    }

    /**
     * The login page of the frontend (for example http://localhost:3000/login). When set, /oidc/authorize sends the
     * browser there with ?interaction=<id>, and that page talks to the JSON variant of the interaction endpoints.
     * When not set, the server shows its own HTML login page.
     */
    get loginUiUrl(): string | null {
        return this.config.get<string>('OIDC_LOGIN_UI_URL') || null
    }

    get secureCookies(): boolean {
        return this.config.get<string>('NODE_ENV') === 'production'
    }

    /** Maximum login attempts per minute, per IP address and per email address. */
    get loginRateLimit(): number {
        return Number(this.config.get<string>('OIDC_LOGIN_RATE_LIMIT') ?? 10)
    }

    /** The 32-byte key that encrypts the private signing keys in the database and (derived) the login cookies. */
    masterKey(): Buffer {
        const hex = this.config.get<string>('OIDC_MASTER_KEY') ?? ''
        if (!/^[0-9a-f]{64}$/i.test(hex)) {
            throw new Error('OIDC_MASTER_KEY must be 64 hexadecimal characters (32 bytes). See the README.')
        }
        return Buffer.from(hex, 'hex')
    }

    /** The first tenant and its admin, created when the users table is still empty. */
    bootstrapAdmin(): BootstrapAdmin | null {
        const email = this.config.get<string>('OIDC_BOOTSTRAP_ADMIN_EMAIL')
        const passwordHash = this.config.get<string>('OIDC_BOOTSTRAP_ADMIN_PASSWORD_HASH')
        if (!email || !passwordHash) return null
        const tenantName = this.config.get<string>('OIDC_BOOTSTRAP_TENANT') ?? 'My organisation'
        const slug =
            tenantName
                .normalize('NFKD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 63) || 'default'
        return {
            email: email.trim().toLowerCase(),
            name: this.config.get<string>('OIDC_BOOTSTRAP_ADMIN_NAME') ?? 'Admin',
            passwordHash,
            tenantName,
            tenantSlug: slug.length >= 2 ? slug : slug + '-tenant'
        }
    }
}
