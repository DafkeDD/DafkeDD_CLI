import { randomUUID } from 'node:crypto'
import type {
    AppRole,
    NewPasskey,
    Passkey,
    AuthorizationCode,
    BootstrapAdmin,
    ChangeResult,
    ClientChanges,
    ClientSummary,
    Consent,
    IdentifierType,
    Invitation,
    LinkResult,
    LogoutJob,
    MemberStatus,
    Membership,
    MfaState,
    RefreshToken,
    RotateResult,
    NewAccount,
    OidcClient,
    OidcStore,
    Session,
    SessionSummary,
    StoredKey,
    StoredUser,
    Tenant,
    TenantMember,
    TenantRole,
    UserIdentifier
} from './oidc.store.js'

/** In-memory store with the same behaviour as PgOidcStore. Used by the tests; never in production. */
export class MemoryOidcStore implements OidcStore {
    users: StoredUser[] = []
    tenants: Tenant[] = []
    members: { tenantId: string; userId: string; role: TenantRole; status: MemberStatus; lastSeenAt: Date | null }[] =
        []
    invitations: Invitation[] = []
    clients = new Map<string, OidcClient>()
    clientInfo = new Map<string, { source: 'file' | 'admin'; disabled: boolean; createdAt: Date; updatedAt: Date }>()
    keys: StoredKey[] = []
    sessions = new Map<string, Session & { createdAt: Date; lastUsedAt: Date | null }>()
    refreshTokens = new Map<string, RefreshToken>()
    mfa = new Map<string, MfaState>()
    codes = new Map<string, AuthorizationCode & { usedAt: Date | null; refreshFamily?: string }>()
    identifiers: UserIdentifier[] = []
    consents: (Consent & { userId: string })[] = []
    usedInteractions = new Map<string, Date>()
    linkCodes = new Map<string, { clientId: string; expiresAt: Date; usedAt: Date | null }>()
    sessionClients: { sessionId: string; clientId: string }[] = []
    logoutQueue: (LogoutJob & { nextAt: number; createdAt: number })[] = []
    private logoutIds = 0

    /** An active session ends: like the trigger of PostgreSQL, a logout token for each client that hears about it. */
    private end(session: Session, now = new Date()) {
        if (session.expiresAt <= now) return
        session.expiresAt = now
        for (const link of this.sessionClients.filter(item => item.sessionId === session.id))
            if (this.clients.get(link.clientId)?.backchannelLogoutUri)
                this.logoutQueue.push({
                    id: String(++this.logoutIds),
                    sessionId: session.id,
                    userId: session.userId,
                    clientId: link.clientId,
                    attempts: 0,
                    nextAt: now.getTime(),
                    createdAt: now.getTime()
                })
    }

    /** Test helper: adds a user (and memberships). */
    addUser(
        user: Omit<StoredUser, 'id' | 'status' | 'emailVerified' | 'locale' | 'isSuperadmin' | 'mfaEnabled'> &
            Partial<StoredUser>
    ): StoredUser {
        const row: StoredUser = {
            id: randomUUID(),
            status: 'active',
            emailVerified: true,
            locale: null,
            isSuperadmin: false,
            mfaEnabled: false,
            ...user
        }
        this.users.push(row)
        return row
    }

    /** Test helper: adds a tenant. */
    addTenant(slug: string, name = slug, status: Tenant['status'] = 'active'): Tenant {
        const tenant: Tenant = { id: randomUUID(), slug, name, status, createdAt: new Date() }
        this.tenants.push(tenant)
        return tenant
    }

    /** Test helper: makes a user a member of a tenant. */
    addMembership(tenantId: string, userId: string, role: TenantRole = 'user') {
        this.members.push({ tenantId, userId, role, status: 'active', lastSeenAt: null })
    }

    async findUserByEmail(email: string) {
        return this.users.find(user => user.email.toLowerCase() === email.toLowerCase()) ?? null
    }

    async findUserById(id: string) {
        return this.users.find(user => user.id === id) ?? null
    }

    async listMemberships(userId: string): Promise<Membership[]> {
        return this.members
            .flatMap(member => {
                const tenant = this.tenants.find(candidate => candidate.id === member.tenantId)
                return member.userId === userId && member.status === 'active' && tenant?.status === 'active'
                    ? [{ tenantId: tenant.id, slug: tenant.slug, name: tenant.name, role: member.role }]
                    : []
            })
            .sort((a, b) => a.name.localeCompare(b.name))
    }

    async findClient(clientId: string) {
        return this.clientInfo.get(clientId)?.disabled ? null : (this.clients.get(clientId) ?? null)
    }

    async upsertClient(client: OidcClient) {
        const info = this.clientInfo.get(client.clientId)
        if (info?.source === 'admin') return false
        this.clients.set(client.clientId, client)
        const now = new Date()
        this.clientInfo.set(client.clientId, {
            source: 'file',
            disabled: info?.disabled ?? false,
            createdAt: info?.createdAt ?? now,
            updatedAt: now
        })
        return true
    }

    private summary(client: OidcClient): ClientSummary {
        const info = this.clientInfo.get(client.clientId) ?? {
            source: 'file' as const,
            disabled: false,
            createdAt: new Date(),
            updatedAt: new Date()
        }
        return {
            ...client,
            ...info,
            consents: this.consents.filter(item => item.clientId === client.clientId).length
        }
    }

    async listClients() {
        return [...this.clients.values()]
            .map(client => this.summary(client))
            .sort((a, b) => b.source.localeCompare(a.source) || a.name.localeCompare(b.name))
    }

    async findClientSummary(clientId: string) {
        const client = this.clients.get(clientId)
        return client ? this.summary(client) : null
    }

    async createClient(client: OidcClient) {
        if (this.clients.has(client.clientId)) return false
        this.clients.set(client.clientId, client)
        const now = new Date()
        this.clientInfo.set(client.clientId, { source: 'admin', disabled: false, createdAt: now, updatedAt: now })
        return true
    }

    private adminClient(clientId: string) {
        const info = this.clientInfo.get(clientId)
        const client = this.clients.get(clientId)
        return info?.source === 'admin' && client ? { info, client } : null
    }

    async updateClient(clientId: string, changes: ClientChanges) {
        const found = this.adminClient(clientId)
        if (!found) return false
        const defined = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined))
        this.clients.set(clientId, { ...found.client, ...defined })
        found.info.updatedAt = new Date()
        return true
    }

    async setClientSecret(clientId: string, secretHash: string) {
        const found = this.adminClient(clientId)
        if (!found || found.client.type !== 'confidential') return false
        this.clients.set(clientId, { ...found.client, secretHash })
        found.info.updatedAt = new Date()
        return true
    }

    async setClientDisabled(clientId: string, disabled: boolean) {
        const found = this.adminClient(clientId)
        if (!found) return false
        found.info.disabled = disabled
        found.info.updatedAt = new Date()
        if (disabled) {
            for (const token of this.refreshTokens.values())
                if (token.clientId === clientId && !token.revokedAt) token.revokedAt = new Date()
            for (const [hash, code] of this.codes) if (code.clientId === clientId) this.codes.delete(hash)
        }
        return true
    }

    async createLinkCode(codeHash: string, clientId: string, _createdBy: string, expiresAt: Date) {
        for (const [hash, code] of this.linkCodes)
            if (code.clientId === clientId && !code.usedAt) this.linkCodes.delete(hash)
        this.linkCodes.set(codeHash, { clientId, expiresAt, usedAt: null })
    }

    async useLinkCode(codeHash: string) {
        const code = this.linkCodes.get(codeHash)
        if (!code || code.usedAt || code.expiresAt <= new Date()) return null
        const info = this.clientInfo.get(code.clientId)
        if (info?.source !== 'admin' || info.disabled) return null
        code.usedAt = new Date()
        return code.clientId
    }

    async addClientUris(
        clientId: string,
        uris: { redirectUris: string[]; postLogoutRedirectUris: string[]; backchannelLogoutUri: string | null }
    ) {
        const found = this.adminClient(clientId)
        if (!found) return false
        this.clients.set(clientId, {
            ...found.client,
            redirectUris: [...new Set([...found.client.redirectUris, ...uris.redirectUris])],
            postLogoutRedirectUris: [
                ...new Set([...found.client.postLogoutRedirectUris, ...uris.postLogoutRedirectUris])
            ],
            backchannelLogoutUri: found.client.backchannelLogoutUri ?? uris.backchannelLogoutUri
        })
        return true
    }

    async deleteClient(clientId: string) {
        if (!this.adminClient(clientId)) return false
        this.clients.delete(clientId)
        this.clientInfo.delete(clientId)
        for (const [hash, token] of this.refreshTokens) if (token.clientId === clientId) this.refreshTokens.delete(hash)
        for (const [hash, code] of this.codes) if (code.clientId === clientId) this.codes.delete(hash)
        this.consents = this.consents.filter(item => item.clientId !== clientId)
        this.sessionClients = this.sessionClients.filter(item => item.clientId !== clientId)
        this.logoutQueue = this.logoutQueue.filter(job => job.clientId !== clientId)
        return true
    }

    async findConsent(userId: string, clientId: string) {
        const row = this.consents.find(item => item.userId === userId && item.clientId === clientId)
        return row
            ? {
                  clientId: row.clientId,
                  scopes: [...row.scopes],
                  tenantIds: [...row.tenantIds],
                  createdAt: row.createdAt,
                  updatedAt: row.updatedAt
              }
            : null
    }

    async saveConsent(userId: string, clientId: string, scopes: string[], tenantId: string | null = null) {
        const row = this.consents.find(item => item.userId === userId && item.clientId === clientId)
        const now = new Date()
        const tenants = tenantId ? [tenantId] : []
        if (row) {
            row.scopes = [...new Set([...row.scopes, ...scopes])].sort()
            row.tenantIds = [...new Set([...row.tenantIds, ...tenants])]
            row.updatedAt = now
        } else
            this.consents.push({
                userId,
                clientId,
                scopes: [...new Set(scopes)].sort(),
                tenantIds: tenants,
                createdAt: now,
                updatedAt: now
            })
    }

    async useInteraction(interactionHash: string, expiresAt: Date) {
        const until = this.usedInteractions.get(interactionHash)
        if (until && until > new Date()) return false
        this.usedInteractions.set(interactionHash, expiresAt)
        return true
    }

    async listConsents(userId: string) {
        return this.consents
            .filter(item => item.userId === userId && this.clients.has(item.clientId))
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
            .map(item => ({
                clientId: item.clientId,
                clientName: this.clients.get(item.clientId)!.name,
                scopes: [...item.scopes],
                tenantIds: [...item.tenantIds],
                createdAt: item.createdAt,
                updatedAt: item.updatedAt
            }))
    }

    async deleteConsent(userId: string, clientId: string) {
        const before = this.consents.length
        this.consents = this.consents.filter(item => !(item.userId === userId && item.clientId === clientId))
        if (this.consents.length === before) return false
        for (const token of this.refreshTokens.values())
            if (token.userId === userId && token.clientId === clientId && !token.revokedAt) token.revokedAt = new Date()
        return true
    }

    async addSessionClient(sessionId: string, clientId: string) {
        if (!this.sessionClients.some(item => item.sessionId === sessionId && item.clientId === clientId))
            this.sessionClients.push({ sessionId, clientId })
    }

    async claimLogouts(limit: number, maxAttempts: number) {
        const now = Date.now()
        const due = this.logoutQueue.filter(job => job.nextAt <= now && job.attempts < maxAttempts).slice(0, limit)
        for (const job of due) {
            job.nextAt = now + 30_000 * 4 ** job.attempts
            job.attempts++
        }
        return due.map(({ id, sessionId, userId, clientId, attempts }) => ({
            id,
            sessionId,
            userId,
            clientId,
            attempts
        }))
    }

    async finishLogout(id: string) {
        this.logoutQueue = this.logoutQueue.filter(job => job.id !== id)
    }

    async listKeys() {
        return [...this.keys]
    }

    async activateKey(key: StoredKey, replaceBefore: Date) {
        const active = this.keys.find(existing => existing.alg === key.alg && existing.status === 'active')
        if (active && active.createdAt >= replaceBefore) return false
        if (active) {
            active.status = 'retiring'
            active.retiredAt = key.createdAt
        }
        this.keys.push(key)
        return true
    }

    async createSession(session: Session) {
        for (const existing of this.sessions.values())
            if (existing.interactionHash === session.interactionHash) return false
        this.sessions.set(session.idHash, { ...session, createdAt: new Date(), lastUsedAt: null })
        return true
    }

    private activeSession(id: string) {
        const now = new Date()
        return [...this.sessions.values()].find(session => session.id === id && session.expiresAt > now)
    }

    async findSessionById(id: string) {
        return this.activeSession(id) ?? null
    }

    async touchSession(id: string) {
        const session = this.activeSession(id)
        if (session) session.lastUsedAt = new Date()
    }

    async listUserSessions(userId: string): Promise<SessionSummary[]> {
        const now = new Date()
        return [...this.sessions.values()]
            .filter(session => session.userId === userId && session.expiresAt > now)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map(session => ({
                id: session.id,
                tenantId: session.tenantId,
                tenantName: this.tenants.find(tenant => tenant.id === session.tenantId)?.name ?? null,
                userAgent: session.userAgent,
                acr: session.acr,
                amr: session.amr,
                authTime: session.authTime,
                createdAt: session.createdAt,
                lastUsedAt: session.lastUsedAt,
                expiresAt: session.expiresAt
            }))
    }

    async endUserSession(userId: string, id: string) {
        const session = this.activeSession(id)
        if (session?.userId !== userId) return false
        this.end(session)
        return true
    }

    async endOtherUserSessions(userId: string, keepId: string | null) {
        const now = new Date()
        let ended = 0
        for (const session of this.sessions.values())
            if (session.userId === userId && session.id !== keepId && session.expiresAt > now) {
                this.end(session, now)
                ended++
            }
        return ended
    }

    // ---------------------------------------------------------------- refresh tokens

    async createRefreshToken(token: Omit<RefreshToken, 'usedAt' | 'revokedAt'>) {
        this.refreshTokens.set(token.tokenHash, { ...token, usedAt: null, revokedAt: null })
    }

    async findRefreshToken(tokenHash: string) {
        const token = this.refreshTokens.get(tokenHash)
        return token ? { ...token } : null
    }

    async rotateRefreshToken(
        tokenHash: string,
        next: { tokenHash: string; scope: string; expiresAt: Date },
        graceMs: number
    ): Promise<RotateResult> {
        const token = this.refreshTokens.get(tokenHash)
        const now = new Date()
        if (!token || token.revokedAt || token.expiresAt <= now) return { status: 'invalid' }
        if (token.usedAt && now.getTime() - token.usedAt.getTime() > graceMs) {
            await this.revokeRefreshFamily(token.familyId)
            return { status: 'reused', token: { ...token } }
        }
        token.usedAt ??= now
        // Within the grace period the successor exists already (the same one): keep it as it is
        const existing = this.refreshTokens.get(next.tokenHash)
        if (existing?.revokedAt) return { status: 'invalid' }
        const successor: RefreshToken = existing ?? { ...token, ...next, usedAt: null, revokedAt: null }
        this.refreshTokens.set(next.tokenHash, successor)
        return { status: 'ok', token: { ...successor } }
    }

    async revokeRefreshFamily(familyId: string) {
        const now = new Date()
        for (const token of this.refreshTokens.values()) if (token.familyId === familyId) token.revokedAt ??= now
    }

    async findSession(idHash: string) {
        const session = this.sessions.get(idHash)
        return session && session.expiresAt > new Date() ? session : null
    }

    async endSession(idHash: string) {
        const session = this.sessions.get(idHash)
        if (session) this.end(session)
    }

    async createCode(code: AuthorizationCode) {
        this.codes.set(code.codeHash, { ...code, usedAt: null })
    }

    async consumeCode(codeHash: string) {
        const code = this.codes.get(codeHash)
        if (!code || code.usedAt || code.expiresAt <= new Date()) return null
        code.usedAt = new Date()
        return { ...code, usedAt: undefined }
    }

    async setCodeRefreshFamily(codeHash: string, familyId: string) {
        const code = this.codes.get(codeHash)
        if (code) code.refreshFamily = familyId
    }

    async usedCodeRefreshFamily(codeHash: string) {
        const code = this.codes.get(codeHash)
        return code?.usedAt ? (code.refreshFamily ?? null) : null
    }

    async bootstrapAdmin(admin: BootstrapAdmin) {
        if (this.users.length > 0) return false
        this.addUser({ email: admin.email, name: admin.name, passwordHash: admin.passwordHash, isSuperadmin: true })
        return true
    }

    // ---------------------------------------------------------------- accounts

    private freeSlug(slug: string) {
        let candidate = slug
        while (this.tenants.some(tenant => tenant.slug === candidate))
            candidate = slug.slice(0, 57) + '-' + Math.random().toString(16).slice(2, 6)
        return candidate
    }

    async register(account: NewAccount, tenant: { name: string; slug: string }) {
        if (await this.findUserByEmail(account.email)) return null
        const user = this.addUser({ ...account })
        const created = this.addTenant(this.freeSlug(tenant.slug), tenant.name)
        this.addMembership(created.id, user.id, 'admin')
        return { user, tenant: created }
    }

    async registerWithIdentifier(
        account: NewAccount,
        tenant: { name: string; slug: string },
        identifier: { type: IdentifierType; valueHash: string }
    ) {
        if (this.identifiers.some(row => row.type === identifier.type && row.valueHash === identifier.valueHash))
            return 'identifier-taken' as const
        const created = await this.register(account, tenant)
        if (created) await this.linkIdentifier(created.user.id, identifier.type, identifier.valueHash)
        return created
    }

    // ---------------------------------------------------------------- identifiers (eID)

    async findUserByIdentifier(type: IdentifierType, valueHash: string) {
        const row = this.identifiers.find(item => item.type === type && item.valueHash === valueHash)
        return row ? ((await this.findUserById(row.userId)) ?? null) : null
    }

    async findIdentifier(userId: string, type: IdentifierType) {
        const row = this.identifiers.find(item => item.userId === userId && item.type === type)
        return row ? { ...row } : null
    }

    async linkIdentifier(userId: string, type: IdentifierType, valueHash: string): Promise<LinkResult> {
        const owner = this.identifiers.find(item => item.type === type && item.valueHash === valueHash)
        if (owner) return owner.userId === userId ? 'ok' : 'taken'
        if (this.identifiers.some(item => item.userId === userId && item.type === type)) return 'exists'
        this.identifiers.push({ type, valueHash, userId, createdAt: new Date(), lastUsedAt: null })
        return 'ok'
    }

    async unlinkIdentifier(userId: string, type: IdentifierType) {
        const before = this.identifiers.length
        this.identifiers = this.identifiers.filter(item => !(item.userId === userId && item.type === type))
        return this.identifiers.length < before
    }

    async touchIdentifier(type: IdentifierType, valueHash: string) {
        const row = this.identifiers.find(item => item.type === type && item.valueHash === valueHash)
        if (row) row.lastUsedAt = new Date()
    }

    passkeys: Passkey[] = []

    async addPasskey(passkey: NewPasskey) {
        if (this.passkeys.some(item => item.credentialId === passkey.credentialId)) return null
        if (this.passkeys.filter(item => item.userId === passkey.userId).length >= 20) return null
        const row: Passkey = { ...passkey, id: randomUUID(), createdAt: new Date(), lastUsedAt: null }
        this.passkeys.push(row)
        return { ...row }
    }

    async listPasskeys(userId: string) {
        return this.passkeys.filter(item => item.userId === userId).map(item => ({ ...item }))
    }

    async findPasskey(credentialId: string) {
        const found = this.passkeys.find(item => item.credentialId === credentialId)
        return found ? { ...found } : null
    }

    async usePasskey(id: string, signCount: number, backedUp: boolean) {
        const row = this.passkeys.find(item => item.id === id)
        if (!row) return false
        if ((signCount !== 0 || row.signCount !== 0) && signCount <= row.signCount) return false
        Object.assign(row, { signCount, backedUp, lastUsedAt: new Date() })
        return true
    }

    async renamePasskey(userId: string, id: string, name: string) {
        const row = this.passkeys.find(item => item.id === id && item.userId === userId)
        if (row) row.name = name
        return Boolean(row)
    }

    async deletePasskey(userId: string, id: string) {
        const before = this.passkeys.length
        this.passkeys = this.passkeys.filter(item => !(item.id === id && item.userId === userId))
        return this.passkeys.length < before
    }

    async createUser(account: NewAccount) {
        if (await this.findUserByEmail(account.email)) return null
        return this.addUser({ ...account })
    }

    async setEmailVerified(userId: string) {
        const user = this.users.find(candidate => candidate.id === userId)
        if (user) user.emailVerified = true
    }

    async setPassword(userId: string, passwordHash: string) {
        const user = this.users.find(candidate => candidate.id === userId)
        if (user) user.passwordHash = passwordHash
    }

    async setSuperadmin(userId: string, superadmin: boolean): Promise<ChangeResult> {
        const user = this.users.find(candidate => candidate.id === userId)
        if (!user) return 'not-found'
        if (!superadmin && user.isSuperadmin && this.users.filter(candidate => candidate.isSuperadmin).length === 1)
            return 'last-admin'
        user.isSuperadmin = superadmin
        return 'ok'
    }

    async listSuperadmins() {
        return this.users.filter(user => user.isSuperadmin).sort((a, b) => a.name.localeCompare(b.name))
    }

    async endUserSessions(userId: string) {
        const now = new Date()
        for (const session of this.sessions.values()) if (session.userId === userId) this.end(session, now)
    }

    // ---------------------------------------------------------------- two-factor authentication

    private user(userId: string) {
        return this.users.find(candidate => candidate.id === userId)
    }

    async getMfa(userId: string) {
        if (!this.user(userId)) return null
        const state = this.mfa.get(userId)
        return state
            ? { ...state, recoveryCodes: [...state.recoveryCodes] }
            : { secret: null, enabled: false, lastStep: null, recoveryCodes: [] }
    }

    async setMfaSecret(userId: string, encryptedSecret: string) {
        this.mfa.set(userId, { secret: encryptedSecret, enabled: false, lastStep: null, recoveryCodes: [] })
        const user = this.user(userId)
        if (user) user.mfaEnabled = false
    }

    async enableMfa(userId: string, recoveryCodeHashes: string[], step: number) {
        const state = this.mfa.get(userId)
        const user = this.user(userId)
        if (!state?.secret || !user) return
        Object.assign(state, { enabled: true, lastStep: step, recoveryCodes: [...recoveryCodeHashes] })
        user.mfaEnabled = true
    }

    async disableMfa(userId: string) {
        this.mfa.delete(userId)
        const user = this.user(userId)
        if (user) user.mfaEnabled = false
    }

    async setRecoveryCodes(userId: string, hashes: string[]) {
        const state = this.mfa.get(userId)
        if (state) state.recoveryCodes = [...hashes]
    }

    async useTotpStep(userId: string, step: number) {
        const state = this.mfa.get(userId)
        if (!state || (state.lastStep !== null && state.lastStep >= step)) return false
        state.lastStep = step
        return true
    }

    async useRecoveryCode(userId: string, hash: string) {
        const state = this.mfa.get(userId)
        const index = state?.recoveryCodes.indexOf(hash) ?? -1
        if (!state || index < 0) return false
        state.recoveryCodes.splice(index, 1)
        return true
    }

    // ---------------------------------------------------------------- tenants

    async findTenant(id: string) {
        return this.tenants.find(tenant => tenant.id === id) ?? null
    }

    async listTenants() {
        return this.tenants
            .map(tenant => ({
                ...tenant,
                members: this.members.filter(member => member.tenantId === tenant.id).length
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
    }

    async createTenant(name: string, slug: string) {
        return this.addTenant(this.freeSlug(slug), name)
    }

    async setTenantStatus(id: string, status: Tenant['status']) {
        const tenant = this.tenants.find(candidate => candidate.id === id)
        if (tenant) tenant.status = status
        return Boolean(tenant)
    }

    private member(tenantId: string, userId: string) {
        return this.members.find(member => member.tenantId === tenantId && member.userId === userId)
    }

    async findMemberRole(tenantId: string, userId: string) {
        const member = this.member(tenantId, userId)
        return member?.status === 'active' ? member.role : null
    }

    async findMember(tenantId: string, userId: string) {
        const member = this.member(tenantId, userId)
        return member ? { role: member.role, status: member.status } : null
    }

    /** The roles of members in apps: tenant|client|user → roles. */
    appRoles = new Map<string, string[]>()

    async setClientRoles(clientId: string, roles: AppRole[]) {
        const found = this.adminClient(clientId)
        if (!found) return false
        this.clients.set(clientId, { ...found.client, roles })
        found.info.updatedAt = new Date()
        return true
    }

    async listAppRoles(tenantId: string, clientId: string) {
        return [...this.appRoles.entries()]
            .map(([key, roles]) => ({ key: key.split('|'), roles }))
            .filter(({ key }) => key[0] === tenantId && key[1] === clientId && this.member(tenantId, key[2]!))
            .map(({ key, roles }) => ({ userId: key[2]!, roles: [...roles] }))
    }

    async findAppRoles(tenantId: string, clientId: string, userId: string) {
        if (!this.member(tenantId, userId)) return null
        const roles = this.appRoles.get([tenantId, clientId, userId].join('|'))
        return roles ? [...roles] : null
    }

    async setAppRoles(tenantId: string, clientId: string, userId: string, roles: string[] | null) {
        const key = [tenantId, clientId, userId].join('|')
        if (roles === null) this.appRoles.delete(key)
        else this.appRoles.set(key, [...roles])
    }

    async touchMember(tenantId: string, userId: string) {
        const member = this.member(tenantId, userId)
        if (member) member.lastSeenAt = new Date()
    }

    async endTenantSessions(tenantId: string, userId: string) {
        const now = new Date()
        for (const session of this.sessions.values())
            if (session.tenantId === tenantId && session.userId === userId) this.end(session, now)
    }

    async setMemberStatus(tenantId: string, userId: string, status: MemberStatus) {
        return this.changeMember(tenantId, userId, status === 'disabled', member => {
            member.status = status
        })
    }

    // ---------------------------------------------------------------- invitations

    async saveInvitation(invitation: Omit<Invitation, 'id' | 'createdAt' | 'invitedByName'>) {
        const existing = this.invitations.find(
            item => item.tenantId === invitation.tenantId && item.email.toLowerCase() === invitation.email.toLowerCase()
        )
        if (existing) {
            Object.assign(existing, { ...invitation, createdAt: new Date() })
            return { ...existing }
        }
        const row: Invitation = { ...invitation, id: randomUUID(), createdAt: new Date() }
        this.invitations.push(row)
        return { ...row }
    }

    async listInvitations(tenantId: string) {
        const now = new Date()
        return this.invitations
            .filter(item => item.tenantId === tenantId && item.expiresAt > now)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map(item => ({
                ...item,
                invitedByName: this.users.find(user => user.id === item.invitedBy)?.name ?? null
            }))
    }

    async findInvitation(tenantId: string, id: string) {
        const found = this.invitations.find(item => item.tenantId === tenantId && item.id === id)
        return found && found.expiresAt > new Date() ? { ...found } : null
    }

    async renewInvitation(tenantId: string, id: string, expiresAt: Date) {
        const found = this.invitations.find(item => item.tenantId === tenantId && item.id === id)
        if (!found) return null
        found.expiresAt = expiresAt
        return { ...found }
    }

    async deleteInvitation(tenantId: string, id: string) {
        const index = this.invitations.findIndex(item => item.tenantId === tenantId && item.id === id)
        if (index < 0) return false
        this.invitations.splice(index, 1)
        return true
    }

    async addMember(tenantId: string, userId: string, role: TenantRole) {
        const existing = this.members.find(member => member.tenantId === tenantId && member.userId === userId)
        if (!existing) this.addMembership(tenantId, userId, role)
        else if (role === 'admin') existing.role = 'admin'
    }

    async listMembers(tenantId: string): Promise<TenantMember[]> {
        return this.members
            .filter(member => member.tenantId === tenantId)
            .flatMap(member => {
                const user = this.users.find(candidate => candidate.id === member.userId)
                return user
                    ? [
                          {
                              userId: user.id,
                              name: user.name,
                              email: user.email,
                              emailVerified: user.emailVerified,
                              role: member.role,
                              status: member.status,
                              lastSeenAt: member.lastSeenAt
                          }
                      ]
                    : []
            })
            .sort((a, b) => a.name.localeCompare(b.name))
    }

    async setMemberRole(tenantId: string, userId: string, role: TenantRole) {
        return this.changeMember(tenantId, userId, role === 'user', member => {
            member.role = role
        })
    }

    async removeMember(tenantId: string, userId: string) {
        return this.changeMember(tenantId, userId, true, member => {
            this.members.splice(this.members.indexOf(member), 1)
        })
    }

    private changeMember(
        tenantId: string,
        userId: string,
        losesAdmin: boolean,
        change: (member: MemoryOidcStore['members'][number]) => void
    ): ChangeResult {
        const members = this.members.filter(member => member.tenantId === tenantId)
        const target = members.find(member => member.userId === userId)
        if (!target) return 'not-found'
        const isActiveAdmin = (member: { role: TenantRole; status: MemberStatus }) =>
            member.role === 'admin' && member.status === 'active'
        if (losesAdmin && isActiveAdmin(target) && members.filter(isActiveAdmin).length === 1) return 'last-admin'
        change(target)
        return 'ok'
    }

    async deleteExpired(now: Date) {
        const ended = now.getTime() - 60 * 60 * 1000
        for (const [id, session] of this.sessions)
            if (session.expiresAt.getTime() <= ended) {
                this.sessions.delete(id)
                this.sessionClients = this.sessionClients.filter(item => item.sessionId !== session.id)
            }
        this.logoutQueue = this.logoutQueue.filter(job => job.createdAt > now.getTime() - 24 * 60 * 60 * 1000)
        for (const [id, code] of this.codes) if (code.expiresAt <= now) this.codes.delete(id)
        for (const [hash, token] of this.refreshTokens) if (token.expiresAt <= now) this.refreshTokens.delete(hash)
        this.invitations = this.invitations.filter(item => item.expiresAt > now)
    }
}
