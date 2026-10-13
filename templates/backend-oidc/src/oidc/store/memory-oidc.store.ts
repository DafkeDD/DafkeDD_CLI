import { randomUUID } from 'node:crypto'
import type {
    AuthorizationCode,
    BootstrapAdmin,
    ChangeResult,
    Membership,
    MfaState,
    NewAccount,
    OidcClient,
    OidcStore,
    Session,
    StoredKey,
    StoredUser,
    Tenant,
    TenantMember,
    TenantRole
} from './oidc.store.js'

/** In-memory store with the same behaviour as PgOidcStore. Used by the tests; never in production. */
export class MemoryOidcStore implements OidcStore {
    users: StoredUser[] = []
    tenants: Tenant[] = []
    members: { tenantId: string; userId: string; role: TenantRole }[] = []
    clients = new Map<string, OidcClient>()
    keys: StoredKey[] = []
    sessions = new Map<string, Session>()
    mfa = new Map<string, MfaState>()
    codes = new Map<string, AuthorizationCode & { usedAt: Date | null }>()

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
        this.members.push({ tenantId, userId, role })
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
                return member.userId === userId && tenant?.status === 'active'
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
        this.sessions.set(session.idHash, { ...session })
        return true
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

    async bootstrapAdmin(admin: BootstrapAdmin) {
        if (this.users.length > 0) return false
        const tenant =
            this.tenants.find(existing => existing.slug === admin.tenantSlug) ??
            this.addTenant(admin.tenantSlug, admin.tenantName)
        const user = this.addUser({
            email: admin.email,
            name: admin.name,
            passwordHash: admin.passwordHash,
            isSuperadmin: true
        })
        this.addMembership(tenant.id, user.id, 'admin')
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

    async findMemberRole(tenantId: string, userId: string) {
        return this.members.find(member => member.tenantId === tenantId && member.userId === userId)?.role ?? null
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
                              role: member.role
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
        change: (member: { tenantId: string; userId: string; role: TenantRole }) => void
    ): ChangeResult {
        const members = this.members.filter(member => member.tenantId === tenantId)
        const target = members.find(member => member.userId === userId)
        if (!target) return 'not-found'
        if (losesAdmin && target.role === 'admin' && members.filter(member => member.role === 'admin').length === 1)
            return 'last-admin'
        change(target)
        return 'ok'
    }

    async deleteExpired(now: Date) {
        const ended = now.getTime() - 60 * 60 * 1000
        for (const [id, session] of this.sessions) if (session.expiresAt.getTime() <= ended) this.sessions.delete(id)
        for (const [id, code] of this.codes) if (code.expiresAt <= now) this.codes.delete(id)
    }
}
