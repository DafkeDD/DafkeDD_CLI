/** Storage of the notifications. PgNotificationsStore keeps them in PostgreSQL, MemoryNotificationsStore in memory (tests). */
export const NOTIFICATIONS_STORE = Symbol('NOTIFICATIONS_STORE')

/** What happened: the frontend makes the (translated) text from the kind and its params. */
export type NotificationKind =
    // the admins of an organisation
    | 'invoice.created'
    | 'contract.expiring'
    // the account that made a ticket
    | 'ticket.reply'
    | 'ticket.customer_reply'
    // the superadmin handling a ticket
    | 'ticket.closed'
    // every superadmin (the platform)
    | 'tenant.created'
    | 'ticket.created'
    | 'payment.received'
    | 'discount.expiring'
    | 'member.invited'
    // the other admins of an organisation: someone joined it
    | 'member.joined'

/** The screen of the frontend a notification opens (with the id of what it is about). */
export type NavScreen =
    | 'invoices'
    | 'ticket'
    | 'dashboard'
    | 'admin-tenants'
    | 'admin-tenant'
    | 'admin-ticket'
    | 'admin-codes'
    | 'admin-users'
    | 'users'

export interface Nav {
    screen: NavScreen
    id?: string
}

/** Short plain values only. */
export type NotificationParams = Record<string, string | number | boolean | null>

export interface StoredNotification {
    id: string
    userId: string
    /** null: a notification of the platform (superadmins). */
    tenantId: string | null
    kind: NotificationKind
    params: NotificationParams
    nav: Nav
    createdAt: Date
    readAt: Date | null
}

export type NewNotification = Omit<StoredNotification, 'id' | 'createdAt' | 'readAt'>

export interface NotificationsStore {
    add(notifications: NewNotification[]): Promise<void>
    /**
     * The newest notifications of an account in these scopes: organisations (their id) and/or the platform (null).
     * At most `limit`.
     */
    list(userId: string, scopes: (string | null)[], limit: number): Promise<StoredNotification[]>
    /** False when the account has no notification with this id. */
    markRead(userId: string, id: string): Promise<boolean>
    markAllRead(userId: string, scopes: (string | null)[]): Promise<void>
    /** Which of these keys (computed notifications) the account has read. */
    readKeys(userId: string, keys: string[]): Promise<Set<string>>
    addReads(userId: string, keys: string[]): Promise<void>
}
