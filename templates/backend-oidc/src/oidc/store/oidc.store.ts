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
    /** null: the account logs in with its eID only (it was registered with the eID and never chose a password). */
    passwordHash: string | null
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

export type MemberStatus = 'active' | 'disabled'

export interface TenantMember {
    userId: string
    name: string
    email: string
    emailVerified: boolean
    role: TenantRole
    status: MemberStatus
    /** The last request of this member in this tenant (null: never). */
    lastSeenAt: Date | null
}

/** A role of an app, as its developer defines it: a key for the code, a name per language for the screens. */
export interface AppRole {
    key: string
    names: Record<'en' | 'nl' | 'fr' | 'de', string>
    /** Members without roles given by an admin get the default roles. */
    default: boolean
}

/** An invitation that was not accepted yet. */
export interface Invitation {
    id: string
    tenantId: string
    email: string
    role: TenantRole
    invitedBy: string | null
    /** Name of the person who invited (only filled in by listInvitations). */
    invitedByName?: string | null
    createdAt: Date
    expiresAt: Date
}

/**
 * A way to recognise a person outside email and password. `eid`: the Belgian eID; `valueHash` is an HMAC of the national
 * register number (key derived from OIDC_MASTER_KEY), so the number itself is never stored.
 */
export type IdentifierType = 'eid' | 'external'

export interface UserIdentifier {
    type: IdentifierType
    valueHash: string
    userId: string
    createdAt: Date
    lastUsedAt: Date | null
}

/** A passkey (WebAuthn credential) of an account. */
export interface Passkey {
    id: string
    userId: string
    /** base64url, unique over all accounts */
    credentialId: string
    /** SPKI DER, base64 */
    publicKey: string
    /** COSE algorithm: -7 ES256, -257 RS256, -8 EdDSA */
    algorithm: number
    signCount: number
    name: string
    aaguid: string
    backupEligible: boolean
    backedUp: boolean
    transports: string[]
    createdAt: Date
    lastUsedAt: Date | null
}

export type NewPasskey = Omit<Passkey, 'id' | 'createdAt' | 'lastUsedAt'>

/** Linking an identifier: `taken` when it belongs to another account, `exists` when this account has another one. */
export type LinkResult = 'ok' | 'taken' | 'exists'

/** Result of a change that must never leave a tenant without an admin, or the platform without a superadmin. */
export type ChangeResult = 'ok' | 'not-found' | 'last-admin'

export interface NewAccount {
    email: string
    name: string
    /** null: an account that logs in with its eID only. */
    passwordHash: string | null
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
    /** Our own application: no consent screen. Others ask the user once which data they may have. */
    firstParty: boolean
    /** Back-channel logout: the server POSTs a logout token here when a session with this client ends. */
    backchannelLogoutUri?: string | null
    /** The logout token always has `sid`; true only says the client relies on it. */
    backchannelLogoutSessionRequired?: boolean
    /**
     * The product (licence) this app sells: its access tokens carry the `license` claim of the user. Null: a free app.
     */
    product?: string | null
    /** The roles of this app (defined by its developer); its tokens carry the `roles` of the user. */
    roles?: AppRole[]
}

/** A client as superadmins see it on /admin: where it comes from, whether it is on, how many accounts allowed it. */
export interface ClientSummary extends OidcClient {
    /** file: config/oidc-clients.json (read-only here); admin: made on /admin. */
    source: 'file' | 'admin'
    disabled: boolean
    createdAt: Date
    updatedAt: Date
    /** Accounts that allowed it on the consent screen. */
    consents: number
}

/** What a superadmin can change of a client made on /admin (not its id or type). */
export type ClientChanges = Partial<
    Pick<
        OidcClient,
        | 'name'
        | 'redirectUris'
        | 'postLogoutRedirectUris'
        | 'backchannelLogoutUri'
        | 'scopes'
        | 'grantTypes'
        | 'firstParty'
        | 'product'
    >
>

/** What a user allowed an application that is not our own: these scopes, until revoked on /security. */
export interface Consent {
    clientId: string
    scopes: string[]
    /** With the tenant scope: the organisations the application may see (name and role). */
    tenantIds: string[]
    createdAt: Date
    updatedAt: Date
}

/** A logout token still to deliver: the session that ended, for one client with a back-channel logout URI. */
export interface LogoutJob {
    id: string
    sessionId: string
    userId: string
    clientId: string
    /** How many times it was tried, this one included. */
    attempts: number
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
    /** Public id (uuid): the `sid` claim of the tokens and the id on /me/sessions. Never the cookie value. */
    id: string
    idHash: string
    /** sha256 of the login (interaction) that created the session: a login can create only one session. */
    interactionHash: string
    userId: string
    /** null: a platform session of a superadmin, without an organisation. */
    tenantId: string | null
    authTime: Date
    acr: string
    amr: string[]
    expiresAt: Date
    /** The browser that started the session (User-Agent, at most 300 characters). */
    userAgent: string | null
}

/** An active session as the account itself sees it (/me/sessions). */
export interface SessionSummary {
    id: string
    tenantId: string | null
    tenantName: string | null
    userAgent: string | null
    acr: string
    amr: string[]
    authTime: Date
    createdAt: Date
    lastUsedAt: Date | null
    expiresAt: Date
}

/** A refresh token (only its sha256), bound to a session and a client. */
export interface RefreshToken {
    tokenHash: string
    /** Every rotation stays in the family of the first token: reuse of an old one ends the whole family. */
    familyId: string
    sessionId: string
    clientId: string
    userId: string
    /** null: a platform login of a superadmin. */
    tenantId: string | null
    scope: string
    expiresAt: Date
    usedAt: Date | null
    revokedAt: Date | null
}

/**
 * Using a refresh token: `ok` with the new token; `reused` when an old token came back after the grace period (the
 * family is revoked); `invalid` when it is unknown, expired or revoked.
 */
export type RotateResult =
    { status: 'ok'; token: RefreshToken } | { status: 'reused'; token: RefreshToken } | { status: 'invalid' }

export interface AuthorizationCode {
    codeHash: string
    clientId: string
    userId: string
    /** null: a platform login of a superadmin. */
    tenantId: string | null
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

/** The first account of a new server: the superadmin. It needs no organisation; it creates them on /admin. */
export interface BootstrapAdmin {
    email: string
    name: string
    passwordHash: string
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
    /**
     * Registration with an identifier (the eID): like register, and the identifier is linked in the same transaction.
     * `identifier-taken` (nothing changed) when it belongs to an account already.
     */
    registerWithIdentifier(
        account: NewAccount,
        tenant: { name: string; slug: string },
        identifier: { type: IdentifierType; valueHash: string }
    ): Promise<{ user: StoredUser; tenant: Tenant } | null | 'identifier-taken'>
    /** A new account without a tenant (an accepted invitation). Null when the email address is taken. */
    createUser(account: NewAccount): Promise<StoredUser | null>
    setEmailVerified(userId: string): Promise<void>
    setPassword(userId: string, passwordHash: string): Promise<void>
    /** Grants or revokes superadmin. The last superadmin cannot be revoked (checked under a lock). */
    setSuperadmin(userId: string, superadmin: boolean): Promise<ChangeResult>
    listSuperadmins(): Promise<StoredUser[]>
    /** Ends every session of a user (after a password reset, or turning on two-factor authentication). */
    endUserSessions(userId: string): Promise<void>

    // ---------------------------------------------------------------- identifiers (eID)

    findUserByIdentifier(type: IdentifierType, valueHash: string): Promise<StoredUser | null>
    findIdentifier(userId: string, type: IdentifierType): Promise<UserIdentifier | null>
    linkIdentifier(userId: string, type: IdentifierType, valueHash: string): Promise<LinkResult>
    unlinkIdentifier(userId: string, type: IdentifierType): Promise<boolean>
    /** Records a login with the identifier. */
    touchIdentifier(type: IdentifierType, valueHash: string): Promise<void>

    // ---------------------------------------------------------------- passkeys

    /** null when the credential id exists already (also of another account). At most 20 per account. */
    addPasskey(passkey: NewPasskey): Promise<Passkey | null>
    listPasskeys(userId: string): Promise<Passkey[]>
    findPasskey(credentialId: string): Promise<Passkey | null>
    /**
     * Records a login: the new signature counter and the backup state. False when the counter did not go up in the
     * meantime (two logins with the same counter at once: a clone), checked in the same statement.
     */
    usePasskey(id: string, signCount: number, backedUp: boolean): Promise<boolean>
    renamePasskey(userId: string, id: string, name: string): Promise<boolean>
    deletePasskey(userId: string, id: string): Promise<boolean>

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
    /** The role of an active member of a tenant (only rows in tenant_members), or null (no member, or disabled). */
    findMemberRole(tenantId: string, userId: string): Promise<TenantRole | null>
    /** The membership row (also when disabled), or null. */
    findMember(tenantId: string, userId: string): Promise<{ role: TenantRole; status: MemberStatus } | null>
    /** Adds a member; an existing member keeps the higher of both roles. */
    addMember(tenantId: string, userId: string, role: TenantRole): Promise<void>
    /** The members of one tenant. PgOidcStore runs this with Row-Level Security (DatabaseService.withTenant). */
    listMembers(tenantId: string): Promise<TenantMember[]>
    /** Changes a role. A tenant always keeps at least one admin (checked under a lock). */
    setMemberRole(tenantId: string, userId: string, role: TenantRole): Promise<ChangeResult>
    /** Removes a member. A tenant always keeps at least one admin (checked under a lock). */
    removeMember(tenantId: string, userId: string): Promise<ChangeResult>
    /** Disables or enables a member. A tenant always keeps at least one active admin. */
    setMemberStatus(tenantId: string, userId: string, status: MemberStatus): Promise<ChangeResult>
    /**
     * The roles given to the members of a tenant in an app (only members that got roles). PgOidcStore runs this with
     * Row-Level Security.
     */
    listAppRoles(tenantId: string, clientId: string): Promise<{ userId: string; roles: string[] }[]>
    /** The roles given to one member in an app, or null when none were given (then the default roles apply). */
    findAppRoles(tenantId: string, clientId: string, userId: string): Promise<string[] | null>
    /** Gives a member these roles in an app (an empty list is "no roles"); null goes back to the default roles. */
    setAppRoles(tenantId: string, clientId: string, userId: string, roles: string[] | null, by: string): Promise<void>
    /** The roles an app defines (its developer pushes them with a link code). Only apps made on /admin. */
    setClientRoles(clientId: string, roles: AppRole[]): Promise<boolean>
    /** Records that a member is active right now (who is online). */
    touchMember(tenantId: string, userId: string): Promise<void>
    /** Ends the sessions of a user in one tenant (after disabling or removing the member). */
    endTenantSessions(tenantId: string, userId: string): Promise<void>

    // ---------------------------------------------------------------- invitations (Row-Level Security)

    /** Creates an invitation, or renews the open one for the same email address (new role, inviter and expiry). */
    saveInvitation(invitation: Omit<Invitation, 'id' | 'createdAt' | 'invitedByName'>): Promise<Invitation>
    /** Open invitations of a tenant that did not expire, newest first, with the name of the inviter. */
    listInvitations(tenantId: string): Promise<Invitation[]>
    /** An open invitation that did not expire, or null. */
    findInvitation(tenantId: string, id: string): Promise<Invitation | null>
    /** A new expiry (sending the invitation again); null when it does not exist (any more). */
    renewInvitation(tenantId: string, id: string, expiresAt: Date): Promise<Invitation | null>
    deleteInvitation(tenantId: string, id: string): Promise<boolean>

    /** Only enabled clients: a disabled one cannot log anyone in. */
    findClient(clientId: string): Promise<OidcClient | null>
    /** A client of config/oidc-clients.json; false (nothing changed) when a client made on /admin has that id. */
    upsertClient(client: OidcClient): Promise<boolean>

    // ---------------------------------------------------------------- clients on /admin (superadmins)

    listClients(): Promise<ClientSummary[]>
    /** Also a disabled one. */
    findClientSummary(clientId: string): Promise<ClientSummary | null>
    /** A new client made on /admin; false when the id exists already. */
    createClient(client: OidcClient, createdBy: string): Promise<boolean>
    /** Only clients made on /admin; false otherwise. */
    updateClient(clientId: string, changes: ClientChanges): Promise<boolean>
    /** A new secret (sha256) for a confidential client made on /admin. */
    setClientSecret(clientId: string, secretHash: string): Promise<boolean>
    /** Disabling also revokes its refresh tokens and unused codes at once. Only clients made on /admin. */
    setClientDisabled(clientId: string, disabled: boolean): Promise<boolean>
    /** Removes a client made on /admin with everything of it (codes, refresh tokens, consents). */
    deleteClient(clientId: string): Promise<boolean>
    /** A one-time link code (sha256) for an app made on /admin; earlier unused codes of that app stop. */
    createLinkCode(codeHash: string, clientId: string, createdBy: string, expiresAt: Date): Promise<void>
    /** Uses a link code once: its client id, or null when unknown, used, expired or the app is disabled. */
    useLinkCode(codeHash: string): Promise<string | null>
    /** Adds addresses to an app made on /admin (kept unique); the back-channel URI only when it has none yet. */
    addClientUris(
        clientId: string,
        uris: { redirectUris: string[]; postLogoutRedirectUris: string[]; backchannelLogoutUri: string | null }
    ): Promise<boolean>

    // ---------------------------------------------------------------- consent and back-channel logout

    findConsent(userId: string, clientId: string): Promise<Consent | null>
    /** Adds the scopes (and the organisation, when not null) to what the user allowed this client. */
    saveConsent(userId: string, clientId: string, scopes: string[], tenantId?: string | null): Promise<void>
    /** The applications the user allowed, with their names, newest first. */
    listConsents(userId: string): Promise<(Consent & { clientName: string })[]>
    /**
     * Revokes a consent and, in the same transaction, every refresh token of that client for this user. False when
     * there was none.
     */
    deleteConsent(userId: string, clientId: string): Promise<boolean>
    /** Marks a login (sha256 of its id) as answered; false when it was answered before. */
    useInteraction(interactionHash: string, expiresAt: Date): Promise<boolean>
    /** Remembers that this client got a code in this session (it hears about the end of the session). */
    addSessionClient(sessionId: string, clientId: string): Promise<void>
    /**
     * Takes up to `limit` logout tokens that are due, for this process only (others skip them), and schedules their
     * next try in case this one fails. Only jobs with fewer than `maxAttempts` tries.
     */
    claimLogouts(limit: number, maxAttempts: number): Promise<LogoutJob[]>
    /** Delivered: forget it. */
    finishLogout(id: string): Promise<void>

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
    /** By its public id (the sid claim); only sessions that did not expire. */
    findSessionById(id: string): Promise<Session | null>
    /** Records that the session was used (the access token reached the API, or a refresh). */
    touchSession(id: string): Promise<void>
    /** The active sessions of an account, newest first, with the name of their tenant. */
    listUserSessions(userId: string): Promise<SessionSummary[]>
    /** Ends one session of this account; false when it is not (or no longer) an active session of it. */
    endUserSession(userId: string, id: string): Promise<boolean>
    /** Ends every session of the account except `keepId`; returns how many ended. */
    endOtherUserSessions(userId: string, keepId: string | null): Promise<number>

    // ---------------------------------------------------------------- refresh tokens

    createRefreshToken(token: Omit<RefreshToken, 'usedAt' | 'revokedAt'>): Promise<void>
    findRefreshToken(tokenHash: string): Promise<RefreshToken | null>
    /**
     * Uses a refresh token once and stores its successor (same family, session, client, user and tenant), under a lock.
     * The successor is derived from the token, so a token used before gives the SAME successor again within `graceMs`
     * (two requests of the same browser at once): never a second chain. Later it is reuse: the family is revoked.
     */
    rotateRefreshToken(
        tokenHash: string,
        next: { tokenHash: string; scope: string; expiresAt: Date },
        graceMs: number
    ): Promise<RotateResult>
    revokeRefreshFamily(familyId: string): Promise<void>
    /** Ends a session. The row stays a while (see deleteExpired), so its login cannot be replayed. */
    endSession(idHash: string): Promise<void>

    createCode(code: AuthorizationCode): Promise<void>
    /** Marks the code as used and returns it; null when it does not exist, expired or was used before. */
    consumeCode(codeHash: string): Promise<AuthorizationCode | null>
    /** Remembers the refresh token family a code gave. */
    setCodeRefreshFamily(codeHash: string, familyId: string): Promise<void>
    /** The refresh token family of a code that was used already (null: unknown, unused or none). */
    usedCodeRefreshFamily(codeHash: string): Promise<string | null>

    /** Creates the first account as superadmin, only when there are no users at all. Returns true when it did. */
    bootstrapAdmin(admin: BootstrapAdmin): Promise<boolean>
    /** Removes expired codes and invitations, and sessions that ended at least an hour ago (longer than a login cookie). */
    deleteExpired(now: Date): Promise<void>
}
