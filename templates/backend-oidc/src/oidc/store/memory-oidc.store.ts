import { randomUUID } from 'node:crypto'
import type {
    AuthorizationCode,
    BootstrapAdmin,
    Interaction,
    Membership,
    OidcClient,
    OidcStore,
    Session,
    StoredKey,
    StoredUser
} from './oidc.store.js'

interface Tenant {
    id: string
    slug: string
    name: string
    status: 'active' | 'suspended'
}

/** In-memory store with the same behaviour as PgOidcStore. Used by the tests; never in production. */
export class MemoryOidcStore implements OidcStore {
    users: StoredUser[] = []
    tenants: Tenant[] = []
    members: { tenantId: string; userId: string; roles: string[] }[] = []
    clients = new Map<string, OidcClient>()
    keys: StoredKey[] = []
    interactions = new Map<string, Interaction>()
    sessions = new Map<string, Session>()
    codes = new Map<string, AuthorizationCode & { usedAt: Date | null }>()

    /** Test helper: adds a user (and memberships). */
    addUser(user: Omit<StoredUser, 'id' | 'status' | 'emailVerified' | 'locale'> & Partial<StoredUser>): StoredUser {
        const row: StoredUser = { id: randomUUID(), status: 'active', emailVerified: true, locale: null, ...user }
        this.users.push(row)
        return row
    }

    /** Test helper: adds a tenant. */
    addTenant(slug: string, name = slug, status: Tenant['status'] = 'active'): Tenant {
        const tenant = { id: randomUUID(), slug, name, status }
        this.tenants.push(tenant)
        return tenant
    }

    /** Test helper: makes a user a member of a tenant. */
    addMember(tenantId: string, userId: string, roles: string[] = []) {
        this.members.push({ tenantId, userId, roles })
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
                    ? [{ tenantId: tenant.id, slug: tenant.slug, name: tenant.name, roles: member.roles }]
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

    async createInteraction(interaction: Interaction) {
        this.interactions.set(interaction.idHash, interaction)
    }

    async findInteraction(idHash: string) {
        const interaction = this.interactions.get(idHash)
        return interaction && interaction.expiresAt > new Date() ? interaction : null
    }

    async setInteractionUser(idHash: string, userId: string) {
        const interaction = this.interactions.get(idHash)
        if (interaction) interaction.userId = userId
    }

    async deleteInteraction(idHash: string) {
        this.interactions.delete(idHash)
    }

    async createSession(session: Session) {
        this.sessions.set(session.idHash, session)
    }

    async findSession(idHash: string) {
        const session = this.sessions.get(idHash)
        return session && session.expiresAt > new Date() ? session : null
    }

    async deleteSession(idHash: string) {
        this.sessions.delete(idHash)
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
        const user = this.addUser({ email: admin.email, name: admin.name, passwordHash: admin.passwordHash })
        this.addMember(tenant.id, user.id, ['admin'])
        return true
    }

    async deleteExpired(now: Date) {
        for (const [id, interaction] of this.interactions)
            if (interaction.expiresAt <= now) this.interactions.delete(id)
        for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(id)
        for (const [id, code] of this.codes) if (code.expiresAt <= now) this.codes.delete(id)
    }
}
