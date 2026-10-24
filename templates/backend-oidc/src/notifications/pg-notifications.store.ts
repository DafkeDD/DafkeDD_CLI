import { Injectable } from '@nestjs/common'
import type { QueryResultRow } from 'pg'
import { DatabaseService } from '../database/database.service.js'
import type { NewNotification, NotificationsStore, StoredNotification } from './notifications.store.js'

const COLUMNS =
    'id, user_id AS "userId", tenant_id AS "tenantId", kind, params, link, created_at AS "createdAt", read_at AS "readAt"'

/** "(tenant_id = ANY($n) OR tenant_id IS NULL)" for the scopes (organisations and/or the platform). */
function scopeClause(scopes: (string | null)[], index: number) {
    const tenants = scopes.filter((scope): scope is string => scope !== null)
    const parts = [`tenant_id = ANY($${index}::uuid[])`]
    if (scopes.includes(null)) parts.push('tenant_id IS NULL')
    return { sql: '(' + parts.join(' OR ') + ')', value: tenants }
}

/**
 * Notifications in PostgreSQL. They belong to an account (user_id), so they are read as the owner of the tables with
 * the account in the WHERE (also the platform ones of superadmins, which have no organisation).
 */
@Injectable()
export class PgNotificationsStore implements NotificationsStore {
    constructor(private readonly database: DatabaseService) {}

    private async query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<T[]> {
        await this.database.ready()
        return (await this.database.query<T>(text, params)).rows
    }

    async add(notifications: NewNotification[]) {
        if (notifications.length === 0) return
        await this.query(
            `INSERT INTO notifications (user_id, tenant_id, kind, params, link)
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::jsonb[], $5::text[])`,
            [
                notifications.map(item => item.userId),
                notifications.map(item => item.tenantId),
                notifications.map(item => item.kind),
                notifications.map(item => JSON.stringify(item.params)),
                notifications.map(item => item.link)
            ]
        )
    }

    list(userId: string, scopes: (string | null)[], limit: number) {
        const scope = scopeClause(scopes, 2)
        return this.query<StoredNotification>(
            `SELECT ${COLUMNS} FROM notifications WHERE user_id = $1 AND ${scope.sql}
        ORDER BY created_at DESC, id LIMIT $3`,
            [userId, scope.value, limit]
        )
    }

    async markRead(userId: string, id: string) {
        const rows = await this.query(
            'UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE user_id = $1 AND id = $2 RETURNING 1',
            [userId, id]
        )
        return rows.length > 0
    }

    async markAllRead(userId: string, scopes: (string | null)[]) {
        const scope = scopeClause(scopes, 2)
        await this.query(
            `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND ${scope.sql}`,
            [userId, scope.value]
        )
    }

    async purge(before: Date) {
        const rows = await this.query('DELETE FROM notifications WHERE created_at < $1 RETURNING 1', [before])
        return rows.length
    }
}
