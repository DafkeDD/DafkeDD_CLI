import { randomUUID } from 'node:crypto'
import type {
    NewAttachment,
    NewMessage,
    NewTicket,
    Person,
    Ticket,
    TicketAttachment,
    TicketChange,
    TicketFilter,
    TicketMessage,
    TicketNote,
    TicketsStore
} from './tickets.store.js'

/** Names for the tickets: in the tests the MemoryOidcStore and the MemoryBillingStore. */
export interface TicketLookup {
    findUserById(id: string): Promise<{ name: string } | null>
    findTenant(id: string): Promise<{ name: string } | null>
    findProductByCode(code: string): Promise<{ name: string } | null>
}

type Row = Omit<Ticket, 'tenantName' | 'createdBy' | 'appName' | 'assignee' | 'lastMessage'> & {
    createdBy: string
    assigneeId: string | null
}

/** In-memory tickets with the same behaviour as PgTicketsStore. Used by the tests; never in production. */
export class MemoryTicketsStore implements TicketsStore {
    tickets: Row[] = []
    messageRows: {
        id: string
        ticketId: string
        authorId: string
        role: TicketMessage['role']
        body: string
        createdAt: Date
    }[] = []
    noteRows: { id: string; ticketId: string; authorId: string; body: string; mentions: string[]; createdAt: Date }[] =
        []
    attachmentRows: (TicketAttachment & { uploadedBy: string; createdAt: Date })[] = []
    private number = 1000
    private tick = 0

    constructor(private readonly lookup: TicketLookup) {}

    /** Strictly increasing times, so the order is stable within one millisecond. */
    private now() {
        return new Date(Date.now() + this.tick++)
    }

    private async person(id: string | null): Promise<Person | null> {
        if (!id) return null
        const user = await this.lookup.findUserById(id)
        return user ? { id, name: user.name } : null
    }

    private async show(row: Row): Promise<Ticket> {
        const last = this.messageRows.filter(item => item.ticketId === row.id).at(-1)
        return {
            ...row,
            tenantName: (await this.lookup.findTenant(row.tenantId))?.name ?? '',
            createdBy: await this.person(row.createdBy),
            appName: row.appCode ? ((await this.lookup.findProductByCode(row.appCode))?.name ?? null) : null,
            assignee: await this.person(row.assigneeId),
            lastMessage: last ? { role: last.role, text: last.body.slice(0, 1000) } : null
        }
    }

    private visible(scope: string | null, id: string) {
        return this.tickets.find(item => item.id === id && (scope === null || item.tenantId === scope))
    }

    async list(scope: string | null, filter: TicketFilter = {}) {
        const shown = await Promise.all(
            this.tickets
                .filter(
                    item =>
                        (scope === null || item.tenantId === scope) &&
                        (!filter.status || item.status === filter.status) &&
                        (!filter.assigneeId || item.assigneeId === filter.assigneeId) &&
                        (!filter.unassigned || item.assigneeId === null)
                )
                .map(item => this.show(item))
        )
        const q = filter.q?.trim().toLowerCase()
        const number = q ? /^(tic-?)?(\d{1,9})$/.exec(q)?.[2] : undefined
        return shown
            .filter(
                item =>
                    !q ||
                    [item.subject, item.tenantName, item.createdBy?.name ?? ''].some(text =>
                        text.toLowerCase().includes(q)
                    ) ||
                    (number !== undefined && item.number === Number(number))
            )
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.number - a.number)
    }

    async find(scope: string | null, id: string) {
        const row = this.visible(scope, id)
        return row ? this.show(row) : null
    }

    async messages(scope: string | null, ticketId: string) {
        if (!this.visible(scope, ticketId)) return []
        return Promise.all(
            this.messageRows
                .filter(item => item.ticketId === ticketId)
                .map(async ({ authorId, ...rest }) => ({ ...rest, author: await this.person(authorId) }))
        )
    }

    async create(input: NewTicket, message: NewMessage) {
        const now = this.now()
        const id = randomUUID()
        this.tickets.push({
            id,
            number: ++this.number,
            tenantId: input.tenantId,
            createdBy: input.createdBy,
            subject: input.subject,
            appCode: input.appCode,
            status: input.status,
            priority: input.priority,
            assigneeId: input.assigneeId,
            createdAt: now,
            updatedAt: now,
            rating: null
        })
        this.messageRows.push({
            id: randomUUID(),
            ticketId: id,
            ...message,
            authorId: message.authorId,
            createdAt: now
        })
        return id
    }

    private apply(row: Row, change: TicketChange) {
        if (change.status !== undefined) row.status = change.status
        if (change.assigneeId !== undefined) row.assigneeId = change.assigneeId
        row.updatedAt = this.now()
    }

    async addMessage(scope: string | null, ticketId: string, message: NewMessage, change: TicketChange) {
        const row = this.visible(scope, ticketId)
        if (!row) return false
        this.apply(row, change)
        this.messageRows.push({ id: randomUUID(), ticketId, ...message, createdAt: row.updatedAt })
        return true
    }

    async update(scope: string | null, id: string, change: TicketChange) {
        const row = this.visible(scope, id)
        if (!row) return false
        this.apply(row, change)
        return true
    }

    async rate(scope: string | null, id: string, rating: { score: number; comment: string | null }) {
        const row = this.visible(scope, id)
        if (!row) return false
        row.rating = { score: rating.score, comment: rating.comment, ratedAt: this.now() }
        return true
    }

    async notes(ticketId: string): Promise<TicketNote[]> {
        return Promise.all(
            this.noteRows
                .filter(item => item.ticketId === ticketId)
                .map(async ({ authorId, mentions, ...rest }) => ({
                    ...rest,
                    author: await this.person(authorId),
                    mentions: (await Promise.all(mentions.map(id => this.person(id)))).filter(
                        (item): item is Person => item !== null
                    )
                }))
        )
    }

    async addNote(ticketId: string, authorId: string, body: string, mentions: string[]) {
        this.noteRows.push({
            id: randomUUID(),
            ticketId,
            authorId,
            body,
            mentions: [...mentions],
            createdAt: this.now()
        })
    }

    async addAttachment(scope: string | null, attachment: NewAttachment) {
        // Like the policy of Row-Level Security (WITH CHECK): never for another organisation
        if (scope !== null && scope !== attachment.tenantId) throw new Error('row-level security')
        const id = randomUUID()
        this.attachmentRows.push({
            id,
            ...attachment,
            data: Buffer.from(attachment.data),
            size: attachment.data.length,
            createdAt: this.now()
        })
        return id
    }

    async findAttachment(scope: string | null, id: string) {
        const row = this.attachmentRows.find(item => item.id === id && (scope === null || item.tenantId === scope))
        if (!row) return null
        const { uploadedBy: _by, createdAt: _at, ...attachment } = row
        return attachment
    }

    async attachmentsExist(scope: string | null, tenantId: string, ids: string[]) {
        return this.attachmentRows
            .filter(item => item.tenantId === tenantId && (scope === null || item.tenantId === scope))
            .filter(item => ids.includes(item.id))
            .map(item => item.id)
    }
}
