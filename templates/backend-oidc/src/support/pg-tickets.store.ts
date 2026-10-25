import { Injectable } from '@nestjs/common'
import type { QueryResultRow } from 'pg'
import { USERS_TABLE } from '../database/database.constants.js'
import { DatabaseService, type Queryable } from '../database/database.service.js'
import type {
    NewAttachment,
    NewMessage,
    NewTicket,
    Ticket,
    TicketAttachment,
    TicketChange,
    TicketFilter,
    TicketMessage,
    TicketNote,
    TicketsStore
} from './tickets.store.js'

const USERS = '"' + USERS_TABLE + '"'

interface TicketRow extends Omit<Ticket, 'createdBy' | 'assignee' | 'rating'> {
    createdById: string | null
    createdByName: string | null
    assigneeId: string | null
    assigneeName: string | null
    ratingScore: number | null
    ratingComment: string | null
    ratedAt: Date | null
}

const SELECT_TICKETS = `SELECT t.id, t.number, t.tenant_id AS "tenantId", n.name AS "tenantName",
       t.created_by AS "createdById", c.name AS "createdByName", t.subject, t.app_code AS "appCode",
       p.name AS "appName", t.status, t.priority, t.assignee_id AS "assigneeId", a.name AS "assigneeName",
       t.created_at AS "createdAt", t.updated_at AS "updatedAt", t.rating AS "ratingScore",
       t.rating_comment AS "ratingComment", t.rated_at AS "ratedAt",
       (SELECT json_build_object('role', m.role, 'text', left(m.body, 1000)) FROM ticket_messages m
         WHERE m.ticket_id = t.id ORDER BY m.created_at DESC, m.id LIMIT 1) AS "lastMessage"
  FROM tickets t
  JOIN tenants n ON n.id = t.tenant_id
  LEFT JOIN ${USERS} c ON c.id = t.created_by
  LEFT JOIN ${USERS} a ON a.id = t.assignee_id
  LEFT JOIN license_products p ON p.code = t.app_code`

const person = (id: string | null, name: string | null) => (id ? { id, name: name ?? '' } : null)

function ticket(row: TicketRow): Ticket {
    const { createdById, createdByName, assigneeId, assigneeName, ratingScore, ratingComment, ratedAt, ...rest } = row
    return {
        ...rest,
        createdBy: person(createdById, createdByName),
        assignee: person(assigneeId, assigneeName),
        rating:
            ratingScore !== null && ratedAt !== null ? { score: ratingScore, comment: ratingComment, ratedAt } : null
    }
}

/** "SET status = $3, assignee_id = $4" from the fields that are given. */
function changeClause(change: TicketChange, first: number) {
    const columns: [string, unknown][] = []
    if (change.status !== undefined) columns.push(['status', change.status])
    if (change.assigneeId !== undefined) columns.push(['assignee_id', change.assigneeId])
    return {
        sql: [...columns.map(([column], index) => `${column} = $${first + index}`), 'updated_at = now()'].join(', '),
        values: columns.map(([, value]) => value)
    }
}

/**
 * Tickets in PostgreSQL. What an organisation does runs with Row-Level Security (DatabaseService.withTenant): a member
 * can never see or change a ticket of another organisation. The support team (superadmins) works as the owner.
 */
@Injectable()
export class PgTicketsStore implements TicketsStore {
    constructor(private readonly database: DatabaseService) {}

    /** Runs `work` with Row-Level Security of the organisation, or as the owner for the support team (null). */
    private async run<T>(scope: string | null, work: (db: Queryable) => Promise<T>): Promise<T> {
        await this.database.ready()
        return scope === null ? work(this.database) : this.database.withTenant(scope, work)
    }

    private async rows<T extends QueryResultRow>(scope: string | null, text: string, params: unknown[] = []) {
        return this.run(scope, async db => (await db.query<T>(text, params)).rows)
    }

    async list(scope: string | null, filter: TicketFilter = {}) {
        const where: string[] = []
        const params: unknown[] = []
        const param = (value: unknown) => {
            params.push(value)
            return '$' + params.length
        }
        // Row-Level Security filters the organisation; the WHERE says it too (clearer, and uses the index)
        if (scope !== null) where.push(`t.tenant_id = ${param(scope)}`)
        if (filter.status) where.push(`t.status = ${param(filter.status)}`)
        if (filter.assigneeId) where.push(`t.assignee_id = ${param(filter.assigneeId)}`)
        if (filter.unassigned) where.push('t.assignee_id IS NULL')
        const q = filter.q?.trim()
        if (q) {
            const number = /^(tic-?)?(\d{1,9})$/i.exec(q)?.[2]
            const like = param('%' + q.replace(/[\\%_]/g, char => '\\' + char) + '%')
            where.push(
                `(t.subject ILIKE ${like} OR n.name ILIKE ${like} OR c.name ILIKE ${like}` +
                    (number ? ` OR t.number = ${param(Number(number))}` : '') +
                    ')'
            )
        }
        const rows = await this.rows<TicketRow>(
            scope,
            `${SELECT_TICKETS} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY t.updated_at DESC, t.number DESC LIMIT 500`,
            params
        )
        return rows.map(ticket)
    }

    async find(scope: string | null, id: string) {
        const rows = await this.rows<TicketRow>(scope, `${SELECT_TICKETS} WHERE t.id = $1`, [id])
        return rows[0] ? ticket(rows[0]) : null
    }

    async messages(scope: string | null, ticketId: string) {
        const rows = await this.rows<
            Omit<TicketMessage, 'author'> & { authorId: string | null; authorName: string | null }
        >(
            scope,
            `SELECT m.id, m.ticket_id AS "ticketId", m.author_id AS "authorId", u.name AS "authorName", m.role, m.body,
              m.created_at AS "createdAt"
         FROM ticket_messages m LEFT JOIN ${USERS} u ON u.id = m.author_id
        WHERE m.ticket_id = $1 ORDER BY m.created_at, m.id`,
            [ticketId]
        )
        return rows.map(({ authorId, authorName, ...rest }) => ({ ...rest, author: person(authorId, authorName) }))
    }

    async create(input: NewTicket, message: NewMessage) {
        return this.run(input.tenantId, async db => {
            const { rows } = await db.query<{ id: string }>(
                `INSERT INTO tickets (tenant_id, created_by, subject, app_code, status, priority, assignee_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [
                    input.tenantId,
                    input.createdBy,
                    input.subject,
                    input.appCode,
                    input.status,
                    input.priority,
                    input.assigneeId
                ]
            )
            const id = rows[0]?.id ?? ''
            await db.query(
                'INSERT INTO ticket_messages (ticket_id, tenant_id, author_id, role, body) VALUES ($1, $2, $3, $4, $5)',
                [id, input.tenantId, message.authorId, message.role, message.body]
            )
            return id
        })
    }

    async addMessage(scope: string | null, ticketId: string, message: NewMessage, change: TicketChange) {
        return this.run(scope, async db => {
            const set = changeClause(change, 2)
            const updated = await db.query<{ tenantId: string }>(
                `UPDATE tickets SET ${set.sql} WHERE id = $1 RETURNING tenant_id AS "tenantId"`,
                [ticketId, ...set.values]
            )
            const tenantId = updated.rows[0]?.tenantId
            if (!tenantId) return false
            await db.query(
                'INSERT INTO ticket_messages (ticket_id, tenant_id, author_id, role, body) VALUES ($1, $2, $3, $4, $5)',
                [ticketId, tenantId, message.authorId, message.role, message.body]
            )
            return true
        })
    }

    async update(scope: string | null, id: string, change: TicketChange) {
        const set = changeClause(change, 2)
        const rows = await this.rows(scope, `UPDATE tickets SET ${set.sql} WHERE id = $1 RETURNING 1`, [
            id,
            ...set.values
        ])
        return rows.length > 0
    }

    async rate(scope: string | null, id: string, rating: { score: number; comment: string | null }) {
        const rows = await this.rows(
            scope,
            'UPDATE tickets SET rating = $2, rating_comment = $3, rated_at = now() WHERE id = $1 RETURNING 1',
            [id, rating.score, rating.comment]
        )
        return rows.length > 0
    }

    async notes(ticketId: string) {
        const rows = await this.rows<
            Omit<TicketNote, 'author' | 'mentions'> & {
                authorId: string | null
                authorName: string | null
                mentions: { id: string; name: string }[]
            }
        >(
            null,
            `SELECT k.id, k.ticket_id AS "ticketId", k.author_id AS "authorId", u.name AS "authorName", k.body,
              k.created_at AS "createdAt",
              coalesce((SELECT json_agg(json_build_object('id', x.id, 'name', x.name) ORDER BY x.name)
                          FROM ${USERS} x WHERE x.id = ANY(k.mentions)), '[]') AS mentions
         FROM ticket_notes k LEFT JOIN ${USERS} u ON u.id = k.author_id
        WHERE k.ticket_id = $1 ORDER BY k.created_at, k.id`,
            [ticketId]
        )
        return rows.map(({ authorId, authorName, ...rest }) => ({ ...rest, author: person(authorId, authorName) }))
    }

    async addNote(ticketId: string, authorId: string, body: string, mentions: string[]) {
        await this.rows(
            null,
            'INSERT INTO ticket_notes (ticket_id, author_id, body, mentions) VALUES ($1, $2, $3, $4::uuid[])',
            [ticketId, authorId, body, mentions]
        )
    }

    async addAttachment(scope: string | null, attachment: NewAttachment) {
        const rows = await this.rows<{ id: string }>(
            scope,
            `INSERT INTO ticket_attachments (tenant_id, uploaded_by, filename, content_type, size, data)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [
                attachment.tenantId,
                attachment.uploadedBy,
                attachment.filename,
                attachment.contentType,
                attachment.data.length,
                attachment.data
            ]
        )
        return rows[0]?.id ?? ''
    }

    async findAttachment(scope: string | null, id: string) {
        const rows = await this.rows<TicketAttachment>(
            scope,
            `SELECT id, tenant_id AS "tenantId", filename, content_type AS "contentType", size, data
         FROM ticket_attachments WHERE id = $1`,
            [id]
        )
        return rows[0] ?? null
    }

    async attachmentsExist(scope: string | null, tenantId: string, ids: string[]) {
        if (ids.length === 0) return []
        const rows = await this.rows<{ id: string }>(
            scope,
            'SELECT id FROM ticket_attachments WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
            [tenantId, ids]
        )
        return rows.map(row => row.id)
    }
}
