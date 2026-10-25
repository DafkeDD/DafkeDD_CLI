import type { Grant, Subscription } from '../billing/store/billing.store.js'

/** The data behind the statistics of the platform. PgStatsStore reads it from PostgreSQL, MemoryStatsStore holds it (tests). */
export const STATS_STORE = Symbol('STATS_STORE')

export interface StatsData {
    tenants: { id: string; createdAt: Date }[]
    /** Every membership: when it started and the last request of the member. */
    members: { createdAt: Date; lastSeenAt: Date | null }[]
    subscriptions: (Subscription & { createdAt: Date })[]
    grants: Grant[]
    /** Paid invoices: when, and the amount without VAT. */
    payments: { paidAt: Date; amountCents: number }[]
    products: { id: string; code: string; name: string; color: string | null }[]
    discounts: { code: string; redemptions: number }[]
}

export interface StatsStore {
    /** Everything at once (the platform is small enough; superadmins only). */
    load(): Promise<StatsData>
}
