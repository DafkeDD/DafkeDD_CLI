import type { FileIndex, FileInfo } from './file-index.js'

/** The descriptions of the files in memory (the tests), per organisation. */
export class MemoryFileIndex implements FileIndex {
    private readonly files = new Map<string, Map<string, FileInfo>>()

    private of(tenantId: string) {
        let files = this.files.get(tenantId)
        if (!files) this.files.set(tenantId, (files = new Map()))
        return files
    }

    find(tenantId: string, id: string) {
        return Promise.resolve(this.of(tenantId).get(id) ?? null)
    }

    list(tenantId: string) {
        const all = [...this.of(tenantId).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        return Promise.resolve(all.slice(0, 100))
    }

    add(tenantId: string, info: FileInfo) {
        this.of(tenantId).set(info.id, info)
        return Promise.resolve(info)
    }

    remove(tenantId: string, id: string) {
        return Promise.resolve(this.of(tenantId).delete(id))
    }
}
