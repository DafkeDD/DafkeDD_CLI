import { randomUUID } from 'node:crypto'
import type {
    NewPasskey,
    Passkey,
    AuthorizationCode,
    BootstrapAdmin,
    ChangeResult,
    IdentifierType,
    Invitation,
    LinkResult,
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
    keys: StoredKey[] = []
    sessions = new Map<string, Session & { createdAt: Date; lastUsedAt: Date | null }>()
    refreshTokens = new Map<string, RefreshToken>()
    mfa = new Map<string, MfaState>()
    codes = new Map<string, AuthorizationCode & { usedAt: Date | null; refreshFamily?: string }>()
    identifiers: UserIdentifier[] = []

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
        return this.clients.get(clientId) ?? null
    }

    async upsertClient(client: OidcClient) {
        this.clients.set(client.clientId, client)
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
        session.expiresAt = new Date()
        return true
    }

    async endOtherUserSessions(userId: string, keepId: string | null) {
        const now = new Date()
        let ended = 0
        for (const session of this.sessions.values())
            if (session.userId === userId && session.id !== keepId && session.expiresAt > now) {
                session.expiresAt = now
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
        if (session && session.expiresAt > new Date()) session.expiresAt = new Date()
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
        for (const session of this.sessions.values())
            if (session.userId === userId && session.expiresAt > now) session.expiresAt = now
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

    async touchMember(tenantId: string, userId: string) {
        const member = this.member(tenantId, userId)
        if (member) member.lastSeenAt = new Date()
    }

    async endTenantSessions(tenantId: string, userId: string) {
        const now = new Date()
        for (const session of this.sessions.values())
            if (session.tenantId === tenantId && session.userId === userId && session.expiresAt > now)
                session.expiresAt = now
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
        for (const [id, session] of this.sessions) if (session.expiresAt.getTime() <= ended) this.sessions.delete(id)
        for (const [id, code] of this.codes) if (code.expiresAt <= now) this.codes.delete(id)
        for (const [hash, token] of this.refreshTokens) if (token.expiresAt <= now) this.refreshTokens.delete(hash)
        this.invitations = this.invitations.filter(item => item.expiresAt > now)
    }
}
