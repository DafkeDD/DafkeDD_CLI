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
}
