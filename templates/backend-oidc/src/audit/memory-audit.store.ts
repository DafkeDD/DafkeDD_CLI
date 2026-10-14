import { AUDIT_CATEGORIES } from './audit.actions.js'
import type { AuditEvent, AuditQuery, AuditStore, NewAuditEvent } from './audit.store.js'

/** Names for the events: in the tests the MemoryOidcStore. */
interface Lookup {
    findUserById(id: string): Promise<{ name: string; email: string } | null>
    findTenant(id: string): Promise<{ name: string } | null>
}

/** In-memory audit log with the same behaviour as PgAuditStore. Used by the tests; never in production. */
export class MemoryAuditStore implements AuditStore {
    readonly events: (NewAuditEvent & { id: number; createdAt: Date })[] = []
    private next = 1

    constructor(private readonly lookup?: Lookup) {}

    async add(event: NewAuditEvent) {
        this.events.push({ ...event, details: { ...event.details }, id: this.next++, createdAt: new Date() })
    }

    async list(query: AuditQuery): Promise<AuditEvent[]> {
        const categories = query.categories?.length ? query.categories : AUDIT_CATEGORIES
        const found = this.events
            .filter(
                event =>
                    (query.tenantId === undefined || event.tenantId === query.tenantId) &&
                    (!query.actorId || event.actorId === query.actorId) &&
                    (!query.userId ||
                        event.actorId === query.userId ||
                        (event.targetType === 'user' && event.targetId === query.userId)) &&
                    categories.some(category => event.action.startsWith(category + '.')) &&
                    (!query.before || event.id < Number(query.before))
            )
            .sort((a, b) => b.id - a.id)
            .slice(0, query.limit)
        return Promise.all(found.map(event => this.show(event)))
    }

    async purge(before: Date) {
        const keep = this.events.filter(event => event.createdAt >= before)
        const removed = this.events.length - keep.length
        this.events.splice(0, this.events.length, ...keep)
        return removed
    }

    private async show(event: NewAuditEvent & { id: number; createdAt: Date }): Promise<AuditEvent> {
        const actor = event.actorId ? await this.lookup?.findUserById(event.actorId) : null
        const tenant = event.tenantId ? await this.lookup?.findTenant(event.tenantId) : null
        const target =
            event.targetType === 'user' && event.targetId ? await this.lookup?.findUserById(event.targetId) : null
        return {
            id: String(event.id),
            createdAt: event.createdAt,
            tenant: event.tenantId ? { id: event.tenantId, name: tenant?.name ?? null } : null,
            actor: event.actorId ? { id: event.actorId, name: actor?.name ?? null, email: actor?.email ?? null } : null,
            action: event.action,
            target:
                event.targetType && event.targetId
                    ? { type: event.targetType, id: event.targetId, label: target?.email ?? null }
                    : null,
            details: { ...event.details },
            ip: event.ip,
            userAgent: event.userAgent
        }
    }
}
