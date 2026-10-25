import { randomUUID } from 'node:crypto'
import type { NewNotification, NotificationsStore, StoredNotification } from './notifications.store.js'

/** In-memory notifications with the same behaviour as PgNotificationsStore. Used by the tests; never in production. */
export class MemoryNotificationsStore implements NotificationsStore {
    notifications: StoredNotification[] = []
    reads: { userId: string; key: string }[] = []
    private last = 0

    async add(notifications: NewNotification[]) {
        for (const item of notifications)
            this.notifications.push({
                ...item,
                params: { ...item.params },
                nav: { ...item.nav },
                id: randomUUID(),
                // Strictly increasing, so the order is stable within one millisecond
                createdAt: new Date((this.last = Math.max(Date.now(), this.last + 1))),
                readAt: null
            })
    }

    private inScope(item: StoredNotification, userId: string, scopes: (string | null)[]) {
        return item.userId === userId && scopes.includes(item.tenantId)
    }

    async list(userId: string, scopes: (string | null)[], limit: number) {
        return this.notifications
            .filter(item => this.inScope(item, userId, scopes))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, limit)
            .map(item => ({ ...item }))
    }

    async markRead(userId: string, id: string) {
        const found = this.notifications.find(item => item.userId === userId && item.id === id)
        if (!found) return false
        found.readAt ??= new Date()
        return true
    }

    async markAllRead(userId: string, scopes: (string | null)[]) {
        for (const item of this.notifications) if (this.inScope(item, userId, scopes)) item.readAt ??= new Date()
    }

    async readKeys(userId: string, keys: string[]) {
        return new Set(
            this.reads.filter(item => item.userId === userId && keys.includes(item.key)).map(item => item.key)
        )
    }

    async addReads(userId: string, keys: string[]) {
        for (const key of keys)
            if (!this.reads.some(item => item.userId === userId && item.key === key)) this.reads.push({ userId, key })
    }
}
