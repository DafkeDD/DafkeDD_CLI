/** Storage of the support tickets. PgTicketsStore keeps them in PostgreSQL, MemoryTicketsStore in memory (tests). */
export const TICKETS_STORE = Symbol('TICKETS_STORE')

export type TicketStatus = 'open' | 'in_progress' | 'answered' | 'closed'
export const TICKET_STATUSES: readonly TicketStatus[] = ['open', 'in_progress', 'answered', 'closed']
export type TicketPriority = 'normal' | 'high'
export const TICKET_PRIORITIES: readonly TicketPriority[] = ['normal', 'high']
/** The images that can be put in a message (the type is detected from the content, never taken from the upload). */
export type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
/** customer: a member of the organisation; support: a superadmin. */
export type MessageRole = 'customer' | 'support'

/** Someone, by id and name (null when the account was removed). */
export interface Person {
    id: string
    name: string
}

/** How satisfied the customer was with a closed ticket. */
export interface TicketRating {
    /** 1 (bad) to 5 (very good). */
    score: number
    comment: string | null
    ratedAt: Date
}

/** A ticket with the names of what it refers to and its last message. */
export interface Ticket {
    id: string
    number: number
    tenantId: string
    tenantName: string
    createdBy: Person | null
    subject: string
    appCode: string | null
    /** The name of the product (null: a general question, or the product is gone). */
    appName: string | null
    status: TicketStatus
    priority: TicketPriority
    assignee: Person | null
    createdAt: Date
    updatedAt: Date
    lastMessage: { role: MessageRole; text: string } | null
    /** The rating of the customer (null: not rated). Rating again overwrites it; reopening keeps it. */
    rating: TicketRating | null
}

export interface TicketMessage {
    id: string
    ticketId: string
    author: Person | null
    role: MessageRole
    body: string
    createdAt: Date
}

export interface TicketNote {
    id: string
    ticketId: string
    author: Person | null
    body: string
    mentions: Person[]
    createdAt: Date
}

export interface NewTicket {
    tenantId: string
    createdBy: string
    subject: string
    appCode: string | null
    status: TicketStatus
    priority: TicketPriority
    assigneeId: string | null
}

export interface NewMessage {
    authorId: string
    role: MessageRole
    body: string
}

/** An image of an organisation, referred to in messages as ![name](att:<id>). */
export interface NewAttachment {
    tenantId: string
    uploadedBy: string
    filename: string
    contentType: ImageType
    data: Buffer
}

export interface TicketAttachment {
    id: string
    tenantId: string
    filename: string
    contentType: ImageType
    /** In bytes. */
    size: number
    data: Buffer
}

/** What changes with a message or an action; undefined stays as it is. */
export interface TicketChange {
    status?: TicketStatus
    assigneeId?: string | null
}

export interface TicketFilter {
    status?: TicketStatus
    /** Only the tickets of this superadmin. */
    assigneeId?: string
    /** Only the tickets nobody handles yet. */
    unassigned?: boolean
    /** Searches the number (TIC-1042 or 1042), the subject, the organisation and the customer. */
    q?: string
}

/**
 * `scope`: the organisation of the caller (read and written with Row-Level Security: only its own tickets), or null
 * for the support team (superadmins: every organisation).
 */
export interface TicketsStore {
    /** Newest activity first. */
    list(scope: string | null, filter?: TicketFilter): Promise<Ticket[]>
    find(scope: string | null, id: string): Promise<Ticket | null>
    /** Oldest first. */
    messages(scope: string | null, ticketId: string): Promise<TicketMessage[]>
    /** A ticket with its first message, in one transaction (with Row-Level Security of its organisation). */
    create(ticket: NewTicket, message: NewMessage): Promise<string>
    /** Adds a message and changes the ticket with it; false when the ticket does not exist (in this scope). */
    addMessage(scope: string | null, ticketId: string, message: NewMessage, change: TicketChange): Promise<boolean>
    /** False when the ticket does not exist (in this scope). Organisations can only change the status. */
    update(scope: string | null, id: string, change: TicketChange): Promise<boolean>
    /** Sets (or overwrites) the rating, rated now; false when the ticket does not exist (in this scope). */
    rate(scope: string | null, id: string, rating: { score: number; comment: string | null }): Promise<boolean>
    /** The internal notes (support team only), oldest first. */
    notes(ticketId: string): Promise<TicketNote[]>
    addNote(ticketId: string, authorId: string, body: string, mentions: string[]): Promise<void>
    /** Stores an image of the organisation (attachment.tenantId); its id. */
    addAttachment(scope: string | null, attachment: NewAttachment): Promise<string>
    findAttachment(scope: string | null, id: string): Promise<TicketAttachment | null>
    /** Which of `ids` (valid uuids) are images of the organisation `tenantId`. */
    attachmentsExist(scope: string | null, tenantId: string, ids: string[]): Promise<string[]>
}
