import type { CertificateMeta, VaultEntry, VaultStore } from './vault.store.js'

/** In-memory store with the same behaviour as PgVaultStore. Used by the tests; never in production. */
export class MemoryVaultStore implements VaultStore {
    entries = new Map<string, VaultEntry>()

    async find(userId: string) {
        const entry = this.entries.get(userId)
        return entry ? { ...entry } : null
    }

    async save(entry: Omit<VaultEntry, 'uploadedAt'>) {
        const saved = { ...entry, uploadedAt: new Date() }
        this.entries.set(entry.userId, saved)
        return { ...saved }
    }

    async setPassword(userId: string, passwordEncrypted: Buffer, meta: CertificateMeta) {
        const entry = this.entries.get(userId)
        if (!entry) return false
        Object.assign(entry, meta, { passwordEncrypted })
        return true
    }

    async delete(userId: string) {
        return this.entries.delete(userId)
    }

    /** tenantId → ownerId → delegate ids. */
    delegates = new Map<string, Map<string, Set<string>>>()

    async listDelegates(ownerId: string, tenantId: string) {
        return [...(this.delegates.get(tenantId)?.get(ownerId) ?? [])]
    }

    async setDelegates(ownerId: string, tenantId: string, delegateIds: string[]) {
        const tenant = this.delegates.get(tenantId) ?? new Map<string, Set<string>>()
        tenant.set(ownerId, new Set(delegateIds.filter(id => id !== ownerId)))
        this.delegates.set(tenantId, tenant)
    }

    async ownersFor(delegateId: string, tenantId: string) {
        return [...(this.delegates.get(tenantId) ?? new Map<string, Set<string>>()).entries()]
            .filter(([, ids]) => ids.has(delegateId))
            .map(([owner]) => owner)
    }
}
