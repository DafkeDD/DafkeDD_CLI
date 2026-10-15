import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { BootstrapAdmin } from './store/oidc.store.js'

/** The slug of a tenant name: lowercase letters, digits and dashes, 2 to 63 characters ("Acme Café" -> "acme-cafe"). */
export function slugify(name: string): string {
    const slug =
        name
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 63)
            .replace(/-+$/, '') || 'tenant'
    return slug.length >= 2 ? slug : slug + '-tenant'
}

/** Lifetimes and limits of the OpenID Connect server (seconds unless stated otherwise). */
export const OIDC = {
    SESSION_COOKIE: 'oidc_session',
    COOKIE_PATH: '/oidc',
    /** A running login lives in an encrypted cookie oidc_ia_<id>, one per login (so several tabs work side by side). */
    INTERACTION_COOKIE: 'oidc_ia_',
    INTERACTION_SECONDS: 10 * 60,
    /** The User-Agent of a session is kept for the list of sessions, at most this many characters. */
    USER_AGENT_MAX: 200,
    /** Browsers drop cookies above about 4 KB: a bigger login request is refused with a clear error. */
    MAX_INTERACTION_COOKIE: 3800,
    CODE_SECONDS: 60,
    ACCESS_TOKEN_SECONDS: 10 * 60,
    ID_TOKEN_SECONDS: 5 * 60,
    SESSION_SECONDS: 12 * 60 * 60,
    /**
     * A refresh token lives as long as its session (at most 12 hours). A used one is accepted once more within this
     * many seconds (two requests of the same browser at once); later it counts as stolen: the family and the session end.
     */
    REFRESH_REUSE_GRACE_SECONDS: 30,
    /** A signing key is replaced after 90 days and stays in the JWKS for 14 more days. */
    KEY_ROTATION_DAYS: 90,
    KEY_GRACE_DAYS: 14,
    /** Password login is "level of assurance 1"; with two-factor authentication it is "loa2". */
    ACR_PASSWORD: 'loa1',
    /** Password and a second factor (authenticator app or recovery code). */
    ACR_MFA: 'loa2',
    /** The Belgian eID with its PIN: something you have (the card) and something you know (the PIN). */
    ACR_EID: 'loa4',
    /** How the eID login proves who the user is (RFC 8176): smart card, PIN, and so multi-factor. */
    EID_AMR: ['sc', 'pin', 'mfa'],
    /** An eID challenge (nonce) is valid for 5 minutes. */
    EID_CHALLENGE_SECONDS: 5 * 60,
    /** Lifetimes of the links in emails. */
    VERIFY_EMAIL_SECONDS: 24 * 60 * 60,
    RESET_PASSWORD_SECONDS: 60 * 60,
    INVITATION_SECONDS: 7 * 24 * 60 * 60,
    PASSWORD_MIN: 12,
    PASSWORD_MAX: 128,
    SCOPES: ['openid', 'profile', 'email', 'tenant'],
    LOCALES: ['en', 'nl', 'fr', 'de']
} as const

/** The other OpenID Connect server (OIDC_EXTERNAL_*). */
export interface ExternalSettings {
    /** Its issuer, exactly as in its discovery document (https). */
    issuer: string
    clientId: string
    /** Empty: a public client (PKCE only). Otherwise client_secret_basic. */
    clientSecret: string | null
    /** On the button: "Log in with <name>". */
    name: string
    scopes: string
    /** Only this way of logging in. */
    only: boolean
    /**
     * Does a login there count as two-step verification? `external` (default): when its ID token says so (amr "mfa");
     * `trust`: always (it requires two-step verification itself); `local`: never, our own code follows.
     */
    mfa: 'external' | 'trust' | 'local'
    /** A first login there with a verified email address joins the account with that address (default true). */
    linkByEmail: boolean
}

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

    /** The frontend: links in emails go to its pages (/verify-email, /reset-password, /invite). */
    get appUrl(): string {
        return (this.config.get<string>('APP_URL') || 'http://localhost:3000').replace(/\/+$/, '')
    }

    /** The name of the application in emails. */
    get appName(): string {
        return this.config.get<string>('APP_NAME') || 'App'
    }

    /**
     * Two-step verification for every account (OIDC_MFA=required, the default): an account without it sets it up at its
     * next login, before it gets a session. `optional` is only meant for tests and demos.
     */
    get mfaRequired(): boolean {
        return (this.config.get<string>('OIDC_MFA') ?? 'required') !== 'optional'
    }

    /**
     * OIDC_REGISTRATION: `open` (the default): with a password or with the eID; `eid`: only with the eID; `closed`:
     * nobody can create an account, people only join through an invitation.
     */
    get registration(): 'open' | 'eid' | 'closed' {
        const value = this.config.get<string>('OIDC_REGISTRATION') ?? 'open'
        return value === 'eid' || value === 'closed' ? value : 'open'
    }

    /** Can someone create an account themselves (in any way)? */
    get registrationOpen(): boolean {
        return this.registration !== 'closed' && !this.externalOnly
    }

    /**
     * Login with the Belgian eID (OIDC_EID): `off` (the default), `on` (real cards: the Belgian root CAs and an OCSP
     * check), or `test` (also the test cards of the DafkeDD eID bridge with --mock, without OCSP; never in production).
     */
    get eid(): 'off' | 'on' | 'test' {
        const value = this.config.get<string>('OIDC_EID') ?? 'off'
        return value === 'on' || value === 'test' ? value : 'off'
    }

    /**
     * The website that asks for the eID PIN: the bridge signs its origin, and the server only accepts that one. By
     * default the origin of APP_URL (the login page of the frontend); OIDC_EID_ORIGIN overrides it.
     */
    get eidOrigin(): string {
        return new URL(this.config.get<string>('OIDC_EID_ORIGIN') || this.appUrl).origin
    }

    /**
     * Logging in at another OpenID Connect server (federation), or null when OIDC_EXTERNAL_ISSUER is empty. That server
     * proves who the user is; accounts, organisations, roles and licences stay here.
     */
    get external(): ExternalSettings | null {
        // Exactly as in its discovery document (some end with a slash, like Auth0)
        const issuer = (this.config.get<string>('OIDC_EXTERNAL_ISSUER') ?? '').trim()
        const clientId = (this.config.get<string>('OIDC_EXTERNAL_CLIENT_ID') ?? '').trim()
        if (!issuer || !clientId) return null
        const mfa = this.config.get<string>('OIDC_EXTERNAL_MFA') ?? 'external'
        return {
            issuer,
            clientId,
            clientSecret: this.config.get<string>('OIDC_EXTERNAL_CLIENT_SECRET') || null,
            name: this.config.get<string>('OIDC_EXTERNAL_NAME') || new URL(issuer).hostname,
            scopes: this.config.get<string>('OIDC_EXTERNAL_SCOPES') || 'openid profile email',
            only: this.config.get<string>('OIDC_EXTERNAL_ONLY') === 'true',
            mfa: mfa === 'trust' || mfa === 'local' ? mfa : 'external',
            linkByEmail: this.config.get<string>('OIDC_EXTERNAL_LINK_EMAIL') !== 'false'
        }
    }

    /** Passkeys (WebAuthn): OIDC_PASSKEYS=on (default) or off; never when only the other OpenID Connect server is used. */
    get passkeys(): boolean {
        return this.config.get<string>('OIDC_PASSKEYS') !== 'off' && !this.externalOnly
    }

    /** The domain the passkeys belong to (OIDC_PASSKEY_RP_ID): by default the host name of APP_URL (the login page). */
    get passkeyRpId(): string {
        return this.config.get<string>('OIDC_PASSKEY_RP_ID') || new URL(this.appUrl).hostname
    }

    /** Where the browser may use them (OIDC_PASSKEY_ORIGINS, comma separated): by default the origin of APP_URL. */
    get passkeyOrigins(): string[] {
        const value = this.config.get<string>('OIDC_PASSKEY_ORIGINS')
        return value
            ? value
                  .split(',')
                  .map(origin => origin.trim())
                  .filter(Boolean)
            : [new URL(this.appUrl).origin]
    }

    /** Only the other server: no password and no eID login, no registration with them (OIDC_EXTERNAL_ONLY=true). */
    get externalOnly(): boolean {
        return this.external?.only === true
    }

    get production(): boolean {
        return this.config.get<string>('NODE_ENV') === 'production'
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

    /** The superadmin, created when the users table is still empty (it needs no organisation). */
    bootstrapAdmin(): BootstrapAdmin | null {
        const email = this.config.get<string>('OIDC_BOOTSTRAP_ADMIN_EMAIL')
        const passwordHash = this.config.get<string>('OIDC_BOOTSTRAP_ADMIN_PASSWORD_HASH')
        if (!email || !passwordHash) return null
        return {
            email: email.trim().toLowerCase(),
            name: this.config.get<string>('OIDC_BOOTSTRAP_ADMIN_NAME') ?? 'Superadmin',
            passwordHash
        }
    }
}
