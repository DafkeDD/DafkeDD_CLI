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
}

export interface Membership {
    tenantId: string
    slug: string
    name: string
    roles: string[]
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

export interface Interaction {
    idHash: string
    clientId: string
    params: AuthorizationParams
    csrf: string
    userId: string | null
    expiresAt: Date
}

export interface Session {
    idHash: string
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
    /** The active tenants the user belongs to. */
    listMemberships(userId: string): Promise<Membership[]>

    findClient(clientId: string): Promise<OidcClient | null>
    upsertClient(client: OidcClient): Promise<void>

    listKeys(): Promise<StoredKey[]>
    /**
     * Makes `key` the active key for its algorithm and marks the previous one as retiring, but only when there is no
     * active key yet or the active one was created before `replaceBefore`. Returns false when nothing changed.
     */
    activateKey(key: StoredKey, replaceBefore: Date): Promise<boolean>

    createInteraction(interaction: Interaction): Promise<void>
    /** Only interactions that did not expire. */
    findInteraction(idHash: string): Promise<Interaction | null>
    setInteractionUser(idHash: string, userId: string): Promise<void>
    deleteInteraction(idHash: string): Promise<void>

    createSession(session: Session): Promise<void>
    /** Only sessions that did not expire. */
    findSession(idHash: string): Promise<Session | null>
    deleteSession(idHash: string): Promise<void>

    createCode(code: AuthorizationCode): Promise<void>
    /** Marks the code as used and returns it; null when it does not exist, expired or was used before. */
    consumeCode(codeHash: string): Promise<AuthorizationCode | null>

    /** Creates the first tenant and its admin, only when there are no users at all. Returns true when it did. */
    bootstrapAdmin(admin: BootstrapAdmin): Promise<boolean>
    /** Removes expired interactions, sessions and codes. */
    deleteExpired(now: Date): Promise<void>
}
