import type { JsonWebKey } from 'node:crypto'
import type { JwsAlgorithm } from '../jose.js'

/** Everything the OpenID Connect server stores. PgOidcStore keeps it in PostgreSQL, MemoryOidcStore in memory (tests). */
export const OIDC_STORE = Symbol('OIDC_STORE')

export interface StoredUser {
    id: string
    email: string
    emailVerified: boolean
    name: string
    locale: string | null
    passwordHash: string
    status: 'active' | 'disabled'
    /** Platform administrator: admin of every tenant. */
    isSuperadmin: boolean
    /** Two-factor authentication is on: the login asks a code of the authenticator app after the password. */
    mfaEnabled: boolean
}

/** Two-factor authentication of one account. */
export interface MfaState {
    /** The TOTP secret, encrypted (null when never set up). */
    secret: string | null
    enabled: boolean
    /** The last time step that was used: older and equal codes are refused. */
    lastStep: number | null
    /** sha256 hashes of the recovery codes that were not used yet. */
    recoveryCodes: string[]
}

/** The role of a user in one tenant. A superadmin is admin in every tenant, without a row in tenant_members. */
export type TenantRole = 'user' | 'admin'
export const TENANT_ROLES: readonly TenantRole[] = ['user', 'admin']

export interface Membership {
    tenantId: string
    slug: string
    name: string
    role: TenantRole
}

export interface Tenant {
    id: string
    slug: string
    name: string
    status: 'active' | 'suspended'
    createdAt: Date
    /** Number of members (only filled in by listTenants). */
    members?: number
}

export interface TenantMember {
    userId: string
    name: string
    email: string
    emailVerified: boolean
    role: TenantRole
}

/** Result of a change that must never leave a tenant without an admin, or the platform without a superadmin. */
export type ChangeResult = 'ok' | 'not-found' | 'last-admin'

export interface NewAccount {
    email: string
    name: string
    passwordHash: string
    emailVerified: boolean
    locale: string | null
}

export interface OidcClient {
    clientId: string
    name: string
    type: 'public' | 'confidential'
    /** sha256 of the secret, only for confidential clients. */
    secretHash: string | null
    redirectUris: string[]
    postLogoutRedirectUris: string[]
    grantTypes: string[]
    scopes: string[]
    firstParty: boolean
}

export interface StoredKey {
    kid: string
    alg: JwsAlgorithm
    publicJwk: JsonWebKey
    /** The private key, encrypted with OIDC_MASTER_KEY. */
    privateKey: string
    status: 'active' | 'retiring'
    createdAt: Date
    retiredAt: Date | null
}

/** The validated parameters of an authorization request. */
export interface AuthorizationParams {
    clientId: string
    redirectUri: string
    scope: string[]
    state: string | null
    nonce: string | null
    codeChallenge: string
    prompt: string[]
    maxAge: number | null
    loginHint: string | null
    tenantHint: string | null
    uiLocales: string[]
}

export interface Session {
    idHash: string
    /** sha256 of the login (interaction) that created the session: a login can create only one session. */
    interactionHash: string
    userId: string
    tenantId: string
    authTime: Date
    acr: string
    amr: string[]
    expiresAt: Date
}

export interface AuthorizationCode {
    codeHash: string
    clientId: string
    userId: string
    tenantId: string
    sessionHash: string
    redirectUri: string
    scope: string
    nonce: string | null
    codeChallenge: string
    authTime: Date
    acr: string
    amr: string[]
    expiresAt: Date
}

export interface BootstrapAdmin {
    email: string
    name: string
    passwordHash: string
    tenantName: string
    tenantSlug: string
}

export interface OidcStore {
    findUserByEmail(email: string): Promise<StoredUser | null>
    findUserById(id: string): Promise<StoredUser | null>
    /** The active tenants the user is a member of (rows in tenant_members; superadmins are handled by the service). */
    listMemberships(userId: string): Promise<Membership[]>

    // ---------------------------------------------------------------- accounts (phase 2)

    /**
     * Registration: a new account, a new tenant and the account as its admin, in one transaction. Returns null (and
     * changes nothing) when the email address is taken. The slug gets a suffix when it exists already.
     */
    register(
        account: NewAccount,
        tenant: { name: string; slug: string }
    ): Promise<{ user: StoredUser; tenant: Tenant } | null>
    /** A new account without a tenant (an accepted invitation). Null when the email address is taken. */
    createUser(account: NewAccount): Promise<StoredUser | null>
    setEmailVerified(userId: string): Promise<void>
    setPassword(userId: string, passwordHash: string): Promise<void>
    /** Grants or revokes superadmin. The last superadmin cannot be revoked (checked under a lock). */
    setSuperadmin(userId: string, superadmin: boolean): Promise<ChangeResult>
    listSuperadmins(): Promise<StoredUser[]>
    /** Ends every session of a user (after a password reset, or turning on two-factor authentication). */
    endUserSessions(userId: string): Promise<void>

    // ---------------------------------------------------------------- two-factor authentication

    getMfa(userId: string): Promise<MfaState | null>
    /** Stores a new secret that still has to be confirmed (two-factor authentication stays off until enableMfa). */
    setMfaSecret(userId: string, encryptedSecret: string): Promise<void>
    enableMfa(userId: string, recoveryCodeHashes: string[], step: number): Promise<void>
    disableMfa(userId: string): Promise<void>
    setRecoveryCodes(userId: string, hashes: string[]): Promise<void>
    /** Records that a time step was used; false when it (or a later one) was used already (two requests at once). */
    useTotpStep(userId: string, step: number): Promise<boolean>
    /** Uses up a recovery code; false when it does not exist (any more). */
    useRecoveryCode(userId: string, hash: string): Promise<boolean>

    // ---------------------------------------------------------------- tenants and members

    findTenant(id: string): Promise<Tenant | null>
    /** Every tenant, with its number of members (for superadmins). */
    listTenants(): Promise<Tenant[]>
    /** A new tenant; the slug gets a suffix when it exists already. */
    createTenant(name: string, slug: string): Promise<Tenant>
    setTenantStatus(id: string, status: Tenant['status']): Promise<boolean>
    /** The role of a user in a tenant (only rows in tenant_members), or null. */
    findMemberRole(tenantId: string, userId: string): Promise<TenantRole | null>
    /** Adds a member; an existing member keeps the higher of both roles. */
    addMember(tenantId: string, userId: string, role: TenantRole): Promise<void>
    /** The members of one tenant. PgOidcStore runs this with Row-Level Security (DatabaseService.withTenant). */
    listMembers(tenantId: string): Promise<TenantMember[]>
    /** Changes a role. A tenant always keeps at least one admin (checked under a lock). */
    setMemberRole(tenantId: string, userId: string, role: TenantRole): Promise<ChangeResult>
    /** Removes a member. A tenant always keeps at least one admin (checked under a lock). */
    removeMember(tenantId: string, userId: string): Promise<ChangeResult>

    findClient(clientId: string): Promise<OidcClient | null>
    upsertClient(client: OidcClient): Promise<void>

    listKeys(): Promise<StoredKey[]>
    /**
     * Makes `key` the active key for its algorithm and marks the previous one as retiring, but only when there is no
     * active key yet or the active one was created before `replaceBefore`. Returns false when nothing changed.
     */
    activateKey(key: StoredKey, replaceBefore: Date): Promise<boolean>

    /**
     * Stores a new session. Returns false (and stores nothing) when a session of the same login exists already: the
     * login cookie cannot be used twice, also not a copy of it.
     */
    createSession(session: Session): Promise<boolean>
    /** Only sessions that did not expire. */
    findSession(idHash: string): Promise<Session | null>
    /** Ends a session. The row stays a while (see deleteExpired), so its login cannot be replayed. */
    endSession(idHash: string): Promise<void>

    createCode(code: AuthorizationCode): Promise<void>
    /** Marks the code as used and returns it; null when it does not exist, expired or was used before. */
    consumeCode(codeHash: string): Promise<AuthorizationCode | null>

    /** Creates the first tenant and its admin, only when there are no users at all. Returns true when it did. */
    bootstrapAdmin(admin: BootstrapAdmin): Promise<boolean>
    /** Removes expired codes, and sessions that ended at least an hour ago (longer than a login cookie lives). */
    deleteExpired(now: Date): Promise<void>
}
