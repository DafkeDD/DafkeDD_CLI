import { HttpStatus, Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import { AuditService } from '../audit/audit.service.js'
import { BillingService } from '../billing/billing.service.js'
import { AppException } from '../common/app.exception.js'
import { type NotificationView, NotificationsService, type Viewer } from '../notifications/notifications.service.js'
import { OIDC_STORE, type OidcStore, outOfOfficeActive } from '../oidc/store/oidc.store.js'
import { attachmentRefs, preview } from './rich-text.js'
import {
    type ImageType,
    type MessageRole,
    type Ticket,
    type TicketChange,
    type TicketPriority,
    type TicketStatus,
    TICKETS_STORE,
    type TicketsStore
} from './tickets.store.js'

/** The text of a message in a notification: its first 140 characters (without markup). */
const PREVIEW = 140
/** The last message in the lists: its first 200 characters (without markup). */
const LAST_MESSAGE = 200
/** The largest image in a message: 2 MiB. */
export const IMAGE_MAX_BYTES = 2_097_152
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The type of an image from its first bytes (what the upload says is ignored); null: not PNG, JPEG, GIF or WebP. */
export function imageType(data: Buffer): ImageType | null {
    const ascii = (start: number, end: number) => data.subarray(start, end).toString('latin1')
    if (data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png'
    if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
    if (ascii(0, 4) === 'GIF8') return 'image/gif'
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
    return null
}

/** The base name of a file, without control characters, quotes or path separators; at most 200 characters. */
export function safeFilename(name: string) {
    const base = name.trim().split(/[\\/]/).pop() ?? ''
    const safe = base
        .replace(/[\p{Cc}\p{Cf}"*:<>?|]/gu, '')
        .replace(/^\.+/, '')
        .trim()
        .slice(0, 200)
    return safe || 'image'
}

export const ticketNumber = (number: number) => `TIC-${number}`

/** Who does something with a ticket. */
export interface TicketActor {
    userId: string
    /** The organisation of the caller (customer routes). */
    tenantId: string
}

/**
 * Support tickets: members of an organisation ask a question (about an app, or in general), the support team
 * (superadmins) answers, claims, closes and keeps internal notes. Members only ever see the tickets of their own
 * organisation (Row-Level Security). No emails: the customer gets a notification when support answers, and the
 * superadmins that are online get one when a new ticket comes in.
 */
/** Notifications of the support team about one ticket (params.ticketId). */
const SUPPORT_KINDS = new Set<string>(['ticket.created', 'ticket.customer_reply', 'ticket.closed'])

@Injectable()
export class TicketsService implements OnModuleInit {
    constructor(
        @Inject(TICKETS_STORE) private readonly store: TicketsStore,
        @Inject(OIDC_STORE) private readonly oidc: OidcStore,
        private readonly billing: BillingService,
        private readonly notifications: NotificationsService,
        private readonly audit: AuditService
    ) {}

    onModuleInit() {
        this.notifications.addFilter((viewer, items) => this.onlyMine(viewer, items))
    }

    /**
     * A superadmin only sees the support notifications of tickets that are theirs or that nobody handles yet: once
     * another superadmin took a ticket, its notifications are gone from my bell.
     */
    private async onlyMine(viewer: Viewer, items: NotificationView[]) {
        if (!viewer.superadmin) return items
        const ticketOf = (item: NotificationView) =>
            SUPPORT_KINDS.has(item.kind) && typeof item.params.ticketId === 'string' ? item.params.ticketId : null
        const ids = [...new Set(items.map(ticketOf).filter((id): id is string => id !== null))]
        const others = new Set<string>()
        for (const id of ids) {
            const ticket = await this.store.find(null, id)
            if (ticket?.assignee && ticket.assignee.id !== viewer.userId) others.add(id)
        }
        return items.filter(item => {
            const id = ticketOf(item)
            return id === null || !others.has(id)
        })
    }

    // ---------------------------------------------------------------- shapes

    /** A ticket as the lists show it (without the conversation). */
    private summary(ticket: Ticket) {
        return {
            id: ticket.id,
            number: ticketNumber(ticket.number),
            subject: ticket.subject,
            tenant: { id: ticket.tenantId, name: ticket.tenantName },
            customer: ticket.createdBy,
            app: ticket.appCode ? (ticket.appName ?? ticket.appCode) : null,
            appCode: ticket.appCode,
            status: ticket.status,
            priority: ticket.priority,
            assignee: ticket.assignee,
            createdAt: ticket.createdAt,
            updatedAt: ticket.updatedAt,
            lastMessage: ticket.lastMessage
                ? { role: ticket.lastMessage.role, text: preview(ticket.lastMessage.text, LAST_MESSAGE) }
                : null,
            rating: ticket.rating
        }
    }

    /** A ticket with its conversation, as the organisation sees it (scope: its id) or the support team (null). */
    private async detail(scope: string | null, id: string) {
        const ticket = await this.store.find(scope, id)
        if (!ticket) throw new AppException('support.TICKET_NOT_FOUND', HttpStatus.NOT_FOUND)
        const { lastMessage: _last, ...summary } = this.summary(ticket)
        const messages = (await this.store.messages(scope, id)).map(message => ({
            id: message.id,
            from: message.author,
            role: message.role,
            text: message.body,
            createdAt: message.createdAt
        }))
        return { ...summary, assigneeOutOfOffice: await this.assigneeOutOfOffice(ticket, scope !== null), messages }
    }

    /**
     * The out-of-office reply of the superadmin handling the ticket, while it is on: the customers get the external
     * message, the support team the internal one. null when nobody handles it or that superadmin is not away.
     */
    private async assigneeOutOfOffice(ticket: Ticket, customer: boolean) {
        if (!ticket.assignee) return null
        const ooo = await this.oidc.findOutOfOffice(ticket.assignee.id)
        if (!outOfOfficeActive(ooo)) return null
        return { until: ooo.until, message: customer ? ooo.externalMessage : ooo.internalMessage }
    }

    /** A ticket for the support team: also its internal notes. */
    private async full(id: string) {
        const notes = (await this.store.notes(id)).map(note => ({
            id: note.id,
            from: note.author,
            text: note.body,
            mentions: note.mentions,
            createdAt: note.createdAt
        }))
        return { ...(await this.detail(null, id)), notes }
    }

    private async ticket(scope: string | null, id: string) {
        const ticket = await this.store.find(scope, id)
        if (!ticket) throw new AppException('support.TICKET_NOT_FOUND', HttpStatus.NOT_FOUND)
        return ticket
    }

    /** null (a general question), or the code of an existing product. */
    private async appCode(code: string | null | undefined) {
        if (!code) return null
        if (!(await this.billing.products()).some(product => product.code === code))
            throw new AppException('support.APP_NOT_FOUND', HttpStatus.NOT_FOUND)
        return code
    }

    /**
     * Every image the text refers to (![name](att:<id>)) must be an attachment of the organisation of the ticket:
     * 400 support.ATTACHMENT_UNKNOWN otherwise.
     */
    private async checkImages(scope: string | null, tenantId: string, text: string) {
        const refs = attachmentRefs(text).map(id => id.toLowerCase())
        if (refs.length === 0) return
        const valid = refs.filter(id => UUID.test(id))
        const found = new Set(
            valid.length === refs.length ? await this.store.attachmentsExist(scope, tenantId, valid) : []
        )
        if (refs.some(id => !found.has(id)))
            throw new AppException('support.ATTACHMENT_UNKNOWN', HttpStatus.BAD_REQUEST)
    }

    /**
     * Checks and stores an uploaded image (base64, a data: URL prefix is allowed): PNG, JPEG, GIF or WebP from its
     * first bytes, at most 2 MiB. The file name is reduced to a safe base name.
     */
    private async storeImage(
        scope: string | null,
        tenantId: string,
        userId: string,
        input: { filename: string; dataBase64: string }
    ) {
        const base64 = input.dataBase64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
        const invalid = () => new AppException('support.IMAGE_INVALID', HttpStatus.BAD_REQUEST)
        if (!BASE64.test(base64)) throw invalid()
        const data = Buffer.from(base64, 'base64')
        if (data.length === 0) throw invalid()
        if (data.length > IMAGE_MAX_BYTES)
            throw new AppException('support.IMAGE_TOO_LARGE', HttpStatus.PAYLOAD_TOO_LARGE)
        const contentType = imageType(data)
        if (!contentType) throw invalid()
        const filename = safeFilename(input.filename)
        const id = await this.store.addAttachment(scope, { tenantId, uploadedBy: userId, filename, contentType, data })
        return { id, filename, contentType, size: data.length }
    }

    private async image(scope: string | null, id: string) {
        const attachment = await this.store.findAttachment(scope, id)
        if (!attachment || (scope !== null && attachment.tenantId !== scope))
            throw new AppException('support.ATTACHMENT_NOT_FOUND', HttpStatus.NOT_FOUND)
        return { filename: attachment.filename, contentType: attachment.contentType, data: attachment.data }
    }

    private record(
        action:
            | 'support.ticket_created'
            | 'support.message_added'
            | 'support.ticket_claimed'
            | 'support.ticket_closed'
            | 'support.ticket_reopened'
            | 'support.note_added'
            | 'support.ticket_rated',
        ticket: Pick<Ticket, 'id' | 'number' | 'tenantId'>,
        details: Record<string, string | number | boolean | null> = {},
        internal = false
    ) {
        // Internal steps of the support team (claims, notes) are not in the log of the organisation
        return this.audit.record(action, {
            tenantId: internal ? null : ticket.tenantId,
            target: { type: 'ticket', id: ticket.id },
            details: { number: ticketNumber(ticket.number), ...details }
        })
    }

    // ---------------------------------------------------------------- the organisation (members)

    async listForTenant(tenantId: string) {
        return (await this.store.list(tenantId)).map(ticket => this.summary(ticket))
    }

    getForTenant(tenantId: string, id: string) {
        return this.detail(tenantId, id)
    }

    /** A new question of a member: open, normal priority; the superadmins that are online get a notification. */
    async create(actor: TicketActor, input: { subject: string; appCode?: string | null; text: string }) {
        const appCode = await this.appCode(input.appCode)
        await this.checkImages(actor.tenantId, actor.tenantId, input.text)
        const id = await this.store.create(
            {
                tenantId: actor.tenantId,
                createdBy: actor.userId,
                subject: input.subject.trim(),
                appCode,
                status: 'open',
                priority: 'normal',
                assigneeId: null
            },
            { authorId: actor.userId, role: 'customer', body: input.text.trim() }
        )
        const ticket = await this.ticket(actor.tenantId, id)
        await this.record('support.ticket_created', ticket, { by: 'customer', app: appCode })
        await this.notifications.toOnlineSupport(
            'ticket.created',
            {
                ticketId: ticket.id,
                number: ticketNumber(ticket.number),
                tenant: ticket.tenantName,
                subject: ticket.subject
            },
            { screen: 'admin-ticket', id: ticket.id }
        )
        return this.detail(actor.tenantId, id)
    }

    /** A message of a member: the ticket is open again (it needs the support team). Not on a closed ticket. */
    async replyAsCustomer(actor: TicketActor, id: string, text: string) {
        const ticket = await this.ticket(actor.tenantId, id)
        if (ticket.status === 'closed') throw new AppException('support.TICKET_CLOSED', HttpStatus.CONFLICT)
        await this.checkImages(actor.tenantId, actor.tenantId, text)
        await this.store.addMessage(
            actor.tenantId,
            id,
            { authorId: actor.userId, role: 'customer', body: text.trim() },
            { status: 'open' }
        )
        await this.record('support.message_added', ticket, { role: 'customer' })
        await this.tellSupport(ticket, actor.userId, text.trim())
        return this.detail(actor.tenantId, id)
    }

    /** An image a member puts in a message of the organisation: { id, filename, contentType, size }. */
    uploadForTenant(actor: TicketActor, input: { filename: string; dataBase64: string }) {
        return this.storeImage(actor.tenantId, actor.tenantId, actor.userId, input)
    }

    /** An image of the organisation (with Row-Level Security): { filename, contentType, data }. */
    attachmentForTenant(tenantId: string, id: string) {
        return this.image(tenantId, id)
    }

    async closeForTenant(tenantId: string, id: string, userId: string | null = null) {
        await this.setStatus(tenantId, id, 'closed', 'customer', userId)
        return this.detail(tenantId, id)
    }

    async reopenForTenant(tenantId: string, id: string) {
        await this.setStatus(tenantId, id, 'open', 'customer')
        return this.detail(tenantId, id)
    }

    /**
     * The customer rates how the ticket went (1 to 5, an optional comment): only a closed ticket. Rating again
     * overwrites it; reopening keeps it.
     */
    async rateForTenant(tenantId: string, id: string, input: { score: number; comment?: string | null }) {
        const ticket = await this.ticket(tenantId, id)
        if (ticket.status !== 'closed') throw new AppException('support.TICKET_NOT_CLOSED', HttpStatus.CONFLICT)
        await this.store.rate(tenantId, id, { score: input.score, comment: input.comment?.trim() || null })
        await this.record('support.ticket_rated', ticket, { score: input.score })
        return this.detail(tenantId, id)
    }

    /**
     * Closes, or reopens a closed ticket (to `status`). Closed by someone else (the customer, another superadmin): the
     * superadmin handling it gets a notification.
     */
    private async setStatus(
        scope: string | null,
        id: string,
        status: TicketStatus,
        by: MessageRole,
        userId: string | null = null
    ) {
        const ticket = await this.ticket(scope, id)
        const reopen = status !== 'closed'
        if (reopen ? ticket.status === 'closed' : ticket.status !== 'closed') {
            await this.store.update(scope, id, { status })
            await this.record(reopen ? 'support.ticket_reopened' : 'support.ticket_closed', ticket, { by })
            if (!reopen && ticket.assignee && ticket.assignee.id !== userId) {
                const closer = userId ? await this.oidc.findUserById(userId) : null
                await this.notifications.toSupport(
                    ticket.assignee.id,
                    'ticket.closed',
                    {
                        ticketId: ticket.id,
                        number: ticketNumber(ticket.number),
                        tenant: ticket.tenantName,
                        subject: ticket.subject,
                        from: closer?.name ?? null
                    },
                    { screen: 'admin-ticket', id: ticket.id }
                )
            }
        }
    }

    // ---------------------------------------------------------------- the support team (superadmins)

    async list(filter: { status?: TicketStatus; assignee?: 'me' | 'none'; q?: string }, userId: string) {
        const tickets = await this.store.list(null, {
            status: filter.status,
            assigneeId: filter.assignee === 'me' ? userId : undefined,
            unassigned: filter.assignee === 'none',
            q: filter.q
        })
        return tickets.map(ticket => this.summary(ticket))
    }

    get(id: string) {
        return this.full(id)
    }

    /**
     * A ticket the support team opens for an organisation (a phone call): from the superadmin, as support, assigned to
     * them and in progress. The admins of the organisation get the message like a reply.
     */
    async createAsSupport(
        userId: string,
        input: { tenantId: string; subject: string; appCode?: string | null; priority: TicketPriority; text: string }
    ) {
        const tenant = await this.oidc.findTenant(input.tenantId)
        if (!tenant) throw new AppException('oidc.TENANT_NOT_FOUND', HttpStatus.NOT_FOUND)
        const appCode = await this.appCode(input.appCode)
        await this.checkImages(null, tenant.id, input.text)
        const id = await this.store.create(
            {
                tenantId: tenant.id,
                createdBy: userId,
                subject: input.subject.trim(),
                appCode,
                status: 'in_progress',
                priority: input.priority,
                assigneeId: userId
            },
            { authorId: userId, role: 'support', body: input.text.trim() }
        )
        const ticket = await this.ticket(null, id)
        await this.record('support.ticket_created', ticket, { by: 'support', app: appCode, priority: input.priority })
        await this.tellCustomer(ticket, userId, input.text.trim())
        return this.full(id)
    }

    /** Takes a ticket: assigned to me, and in progress when it was open. */
    async claim(userId: string, id: string) {
        const ticket = await this.ticket(null, id)
        const change: TicketChange = { assigneeId: userId }
        if (ticket.status === 'open') change.status = 'in_progress'
        await this.store.update(null, id, change)
        await this.record('support.ticket_claimed', ticket, { from: ticket.assignee?.id ?? null }, true)
        return this.full(id)
    }

    /** An answer of support: the ticket is answered (and mine when nobody had it); the customer is told. */
    async replyAsSupport(userId: string, id: string, text: string) {
        const ticket = await this.ticket(null, id)
        if (ticket.status === 'closed') throw new AppException('support.TICKET_CLOSED', HttpStatus.CONFLICT)
        await this.checkImages(null, ticket.tenantId, text)
        const change: TicketChange = { status: 'answered' }
        if (!ticket.assignee) change.assigneeId = userId
        await this.store.addMessage(null, id, { authorId: userId, role: 'support', body: text.trim() }, change)
        await this.record('support.message_added', ticket, { role: 'support' })
        await this.tellCustomer(ticket, userId, text.trim())
        return this.full(id)
    }

    async close(id: string, userId: string | null = null) {
        await this.setStatus(null, id, 'closed', 'support', userId)
        return this.full(id)
    }

    /** A closed ticket is in progress again. */
    async reopen(id: string) {
        await this.setStatus(null, id, 'in_progress', 'support')
        return this.full(id)
    }

    /** An internal note; it may mention members of the support team (superadmins only). */
    async addNote(userId: string, id: string, input: { text: string; mentions?: string[] }) {
        const ticket = await this.ticket(null, id)
        const mentions = [...new Set(input.mentions ?? [])]
        const team = new Set((await this.supportTeam()).map(user => user.id))
        if (mentions.some(mention => !team.has(mention)))
            throw new AppException('support.MENTION_NOT_SUPPORT', HttpStatus.BAD_REQUEST)
        await this.store.addNote(id, userId, input.text.trim(), mentions)
        await this.record('support.note_added', ticket, { mentions: mentions.length }, true)
        return this.full(id)
    }

    /** An image support puts in a message for an organisation (it must exist): { id, filename, contentType, size }. */
    async uploadAsSupport(userId: string, tenantId: string, input: { filename: string; dataBase64: string }) {
        const tenant = await this.oidc.findTenant(tenantId)
        if (!tenant) throw new AppException('oidc.TENANT_NOT_FOUND', HttpStatus.NOT_FOUND)
        return this.storeImage(null, tenant.id, userId, input)
    }

    /** An image of any organisation: { filename, contentType, data }. */
    attachment(id: string) {
        return this.image(null, id)
    }

    /**
     * Every active superadmin, with its out-of-office reply while it is on (the internal message: a colleague who
     * mentions or assigns it sees it).
     */
    async supportTeam() {
        const team = (await this.oidc.listSuperadmins()).filter(user => user.status === 'active')
        const away = await this.oidc.listOutOfOffice(team.map(user => user.id))
        return team.map(user => {
            const ooo = away.get(user.id)
            return {
                id: user.id,
                name: user.name,
                email: user.email,
                outOfOffice: outOfOfficeActive(ooo) ? { until: ooo.until, message: ooo.internalMessage } : null
            }
        })
    }

    // ---------------------------------------------------------------- telling people

    /**
     * The customer wrote: the superadmin handling the ticket gets a notification; a ticket that nobody handles yet goes
     * to the superadmins that are online.
     */
    private async tellSupport(ticket: Ticket, customerId: string, text: string) {
        const author = await this.oidc.findUserById(customerId)
        const params = {
            ticketId: ticket.id,
            number: ticketNumber(ticket.number),
            tenant: ticket.tenantName,
            from: author?.name ?? null,
            text: preview(text, PREVIEW)
        }
        const nav = { screen: 'admin-ticket' as const, id: ticket.id }
        if (ticket.assignee)
            await this.notifications.toSupport(ticket.assignee.id, 'ticket.customer_reply', params, nav)
        else await this.notifications.toOnlineSupport('ticket.customer_reply', params, nav)
    }

    /**
     * Support wrote: the maker of the ticket gets a notification. A ticket that support made itself goes
     * to the admins of the organisation instead.
     */
    private async tellCustomer(ticket: Ticket, supportId: string, text: string) {
        const author = await this.oidc.findUserById(supportId)
        const recipients =
            ticket.createdBy && ticket.createdBy.id !== supportId
                ? [ticket.createdBy.id]
                : await this.notifications.tenantAdmins(ticket.tenantId).catch(() => [])
        for (const recipient of recipients.filter(id => id !== supportId)) {
            await this.notifications.toUser(
                recipient,
                ticket.tenantId,
                'ticket.reply',
                {
                    ticketId: ticket.id,
                    number: ticketNumber(ticket.number),
                    from: author?.name ?? null,
                    text: preview(text, PREVIEW)
                },
                { screen: 'ticket', id: ticket.id }
            )
        }
    }
}
