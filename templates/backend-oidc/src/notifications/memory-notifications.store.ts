import { randomUUID } from 'node:crypto'
import type { NewNotification, NotificationsStore, StoredNotification } from './notifications.store.js'

/** In-memory notifications with the same behaviour as PgNotificationsStore. Used by the tests; never in production. */
export class MemoryNotificationsStore implements NotificationsStore {
    notifications: StoredNotification[] = []
    private last = 0

    async add(notifications: NewNotification[]) {
        for (const item of notifications)
            this.notifications.push({
                ...item,
                params: { ...item.params },
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

    async purge(before: Date) {
        const count = this.notifications.length
        this.notifications = this.notifications.filter(item => item.createdAt >= before)
        return count - this.notifications.length
    }
}
