/** Storage of the notifications. PgNotificationsStore keeps them in PostgreSQL, MemoryNotificationsStore in memory (tests). */
export const NOTIFICATIONS_STORE = Symbol('NOTIFICATIONS_STORE')

/**
 * Every kind of notification. The frontend makes the text from the kind and its params, in every language (checked by
 * the tests of the CLI). Add one here when you send something new, with its texts in the Notifications messages.
 */
export const NOTIFICATION_KINDS = [
    // the superadmins (the platform)
    'tenant.created',
    // the admins of an organisation
    'member.invited',
    'member.joined'
] as const

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/** Short plain values only. */
export type NotificationParams = Record<string, string | number | boolean | null>

export interface StoredNotification {
    id: string
    userId: string
    /** null: a notification of the platform (superadmins). */
    tenantId: string | null
    kind: NotificationKind
    params: NotificationParams
    /** The page of the frontend it opens (a path like /members), or null. */
    link: string | null
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
    /** Removes the notifications older than this date. Returns how many. */
    purge(before: Date): Promise<number>
}
