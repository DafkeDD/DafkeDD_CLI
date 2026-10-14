import { Injectable } from '@nestjs/common'
import { USERS_TABLE } from '../database/database.constants.js'
import { DatabaseService, type Queryable } from '../database/database.service.js'
import { AUDIT_CATEGORIES } from './audit.actions.js'
import type { AuditDetails } from './audit.actions.js'
import type { AuditEvent, AuditQuery, AuditStore, NewAuditEvent } from './audit.store.js'

const USERS = '"' + USERS_TABLE + '"'

interface Row {
    id: string
    created_at: Date
    tenant_id: string | null
    tenant_name: string | null
    actor_id: string | null
    actor_name: string | null
    actor_email: string | null
    action: string
    target_type: string | null
    target_id: string | null
    target_email: string | null
    details: AuditDetails
    ip: string | null
    user_agent: string | null
}

/**
 * The audit log in PostgreSQL (table audit_events, append-only). The log of one organisation is read with Row-Level
 * Security (DatabaseService.withTenant): its admins can never see events of another organisation.
 */
@Injectable()
export class PgAuditStore implements AuditStore {
    constructor(private readonly database: DatabaseService) {}

    async add(event: NewAuditEvent) {
        await this.database.ready()
        await this.database.query(
            `INSERT INTO audit_events (tenant_id, actor_id, action, target_type, target_id, details, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                event.tenantId,
                event.actorId,
                event.action,
                event.targetType,
                event.targetId,
                JSON.stringify(event.details),
                event.ip,
                event.userAgent
            ]
        )
    }

    async list(query: AuditQuery): Promise<AuditEvent[]> {
        await this.database.ready()
        const where: string[] = []
        const params: unknown[] = []
        const param = (value: unknown) => {
            params.push(value)
            return '$' + params.length
        }
        // Row-Level Security filters the organisation; the WHERE says it too (clearer, and uses the index)
        if (typeof query.tenantId === 'string') where.push(`e.tenant_id = ${param(query.tenantId)}`)
        if (query.tenantId === null) where.push('e.tenant_id IS NULL')
        if (query.actorId) where.push(`e.actor_id = ${param(query.actorId)}`)
        if (query.userId) {
            // Two parameters: the same one as uuid and as text would not have one type
            const actor = param(query.userId)
            const target = param(query.userId)
            where.push(`(e.actor_id = ${actor} OR (e.target_type = 'user' AND e.target_id = ${target}))`)
        }
        const categories = query.categories?.length ? query.categories : AUDIT_CATEGORIES
        where.push(`split_part(e.action, '.', 1) = ANY(${param(categories)})`)
        if (query.before) where.push(`e.id < ${param(query.before)}`)
        const sql = `SELECT e.id::text AS id, e.created_at, e.tenant_id, t.name AS tenant_name, e.actor_id,
            a.name AS actor_name, a.email AS actor_email, e.action, e.target_type, e.target_id,
            u.email AS target_email, e.details, e.ip, e.user_agent
       FROM audit_events e
       LEFT JOIN tenants t ON t.id = e.tenant_id
       LEFT JOIN ${USERS} a ON a.id = e.actor_id
       LEFT JOIN ${USERS} u ON e.target_type = 'user' AND u.id::text = e.target_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.id DESC
      LIMIT ${param(query.limit)}`
        const run = (db: Queryable) => db.query<Row>(sql, params)
        const result =
            typeof query.tenantId === 'string'
                ? await this.database.withTenant(query.tenantId, run)
                : await this.database.query<Row>(sql, params)
        return result.rows.map(row => ({
            id: row.id,
            createdAt: row.created_at,
            tenant: row.tenant_id ? { id: row.tenant_id, name: row.tenant_name } : null,
            actor: row.actor_id ? { id: row.actor_id, name: row.actor_name, email: row.actor_email } : null,
            action: row.action,
            target:
                row.target_type && row.target_id
                    ? { type: row.target_type, id: row.target_id, label: row.target_email }
                    : null,
            details: row.details,
            ip: row.ip,
            userAgent: row.user_agent
        }))
    }

    async purge(before: Date) {
        await this.database.ready()
        return this.database.transaction(async db => {
            // The trigger only lets this transaction delete (append-only otherwise)
            await db.query("SELECT set_config('app.audit_purge', 'on', true)")
            const result = await db.query('DELETE FROM audit_events WHERE created_at < $1', [before])
            return result.rowCount ?? 0
        })
    }
}
