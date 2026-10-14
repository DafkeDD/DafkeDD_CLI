import type { AuditCategory, AuditDetails, AuditTargetType } from './audit.actions.js'

export const AUDIT_STORE = Symbol('AUDIT_STORE')

export interface NewAuditEvent {
    tenantId: string | null
    actorId: string | null
    action: string
    targetType: AuditTargetType | null
    targetId: string | null
    details: AuditDetails
    ip: string | null
    userAgent: string | null
}

/** An event as it is shown: with the names of the organisation, of who did it and of the user it is about. */
export interface AuditEvent {
    /** Increasing number (as text): newer events have a higher id. */
    id: string
    createdAt: Date
    tenant: { id: string; name: string | null } | null
    actor: { id: string; name: string | null; email: string | null } | null
    action: string
    target: { type: string; id: string; label: string | null } | null
    details: AuditDetails
    ip: string | null
    userAgent: string | null
}

export interface AuditQuery {
    /** One organisation (read with Row-Level Security); `null`: only the platform and account events; left out: all. */
    tenantId?: string | null
    /** Events done by this account. */
    actorId?: string
    /** Events of this account: done by it, or about it (a failed login on its email address). */
    userId?: string
    categories?: AuditCategory[]
    /** Only events older than this id (the `next` of the page before). */
    before?: string
    limit: number
}

/** Storage of the audit log: append-only (an event never changes); old events are purged after the retention. */
export interface AuditStore {
    add(event: NewAuditEvent): Promise<void>
    /** Newest first, at most `limit`. */
    list(query: AuditQuery): Promise<AuditEvent[]>
    /** Removes the events from before `before`; returns how many. */
    purge(before: Date): Promise<number>
}
