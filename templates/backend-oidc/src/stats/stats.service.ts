import { Inject, Injectable } from '@nestjs/common'
import { isValid } from '../billing/billing.service.js'
import { STATS_STORE, type StatsData, type StatsStore } from './stats.store.js'

const DAY = 24 * 60 * 60 * 1000
/** Members count as active with a request in the last 30 days. */
const ACTIVE_DAYS = 30
/** The KPI tiles show the last 8 months. */
const SPARK = 8
/** `all` shows at most 24 months. */
const MAX_MONTHS = 24
/** The products with the most environments; the rest is one slice "other". */
const TOP_APPS = 4

export type StatsRange = '6m' | 'year' | 'all'
export const STATS_RANGES: readonly StatsRange[] = ['6m', 'year', 'all']

/** A month in UTC: 'YYYY-MM', its start and its end (the start of the next month). */
interface Month {
    key: string
    start: Date
    end: Date
}

function month(year: number, index: number): Month {
    const start = new Date(Date.UTC(year, index, 1))
    const end = new Date(Date.UTC(year, index + 1, 1))
    return { key: start.toISOString().slice(0, 7), start, end }
}

/** `count` months up to and including the month of `now`, oldest first. */
export function lastMonths(now: Date, count: number): Month[] {
    return Array.from({ length: count }, (_, index) =>
        month(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - index))
    )
}

/** The change from `previous` to `current` in percent (one decimal); 100 when it starts from zero. */
export function deltaPct(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0
    return Math.round(((current - previous) / previous) * 1000) / 10
}

/**
 * The statistics of the platform for superadmins: organisations, active users, apps bought, revenue (paid invoices,
 * without VAT) per month, the apps with the most environments and how often the discount codes were used.
 */
@Injectable()
export class StatsService {
    constructor(@Inject(STATS_STORE) private readonly store: StatsStore) {}

    /** The months of a range, oldest first. */
    months(range: StatsRange, data: StatsData, now: Date): Month[] {
        if (range === 'year') return lastMonths(now, now.getUTCMonth() + 1)
        if (range === '6m') return lastMonths(now, 6)
        const first = data.tenants.reduce<Date | null>(
            (oldest, tenant) => (!oldest || tenant.createdAt < oldest ? tenant.createdAt : oldest),
            null
        )
        const span = first
            ? (now.getUTCFullYear() - first.getUTCFullYear()) * 12 + now.getUTCMonth() - first.getUTCMonth() + 1
            : 1
        return lastMonths(now, Math.min(MAX_MONTHS, Math.max(1, span)))
    }

    async stats(range: StatsRange = '6m', now = new Date()) {
        const data = await this.store.load()
        const months = this.months(range, data, now)
        const spark = lastMonths(now, SPARK)
        const inMonth = (date: Date | null, item: Month) => date !== null && date >= item.start && date < item.end
        const revenue = (item: Month) =>
            data.payments.filter(payment => inMonth(payment.paidAt, item)).reduce((sum, p) => sum + p.amountCents, 0)

        // Who owns which app (a valid subscription or a free grant), at the end of a month or now
        const owned = (at: Date, current: boolean) => {
            const pairs = new Set<string>()
            for (const subscription of data.subscriptions) {
                const counts = current
                    ? isValid(subscription, now)
                    : subscription.status !== 'pending' &&
                      subscription.createdAt < at &&
                      (subscription.currentPeriodEnd === null || subscription.currentPeriodEnd >= at)
                if (counts) pairs.add(subscription.tenantId + ':' + subscription.productId)
            }
            for (const grant of data.grants)
                if (grant.createdAt < at && (grant.endsAt === null || grant.endsAt >= (current ? now : at)))
                    pairs.add(grant.tenantId + ':' + grant.productId)
            return pairs
        }
        const sparkOf = (value: (item: Month, last: boolean) => number) =>
            spark.map((item, index) => value(item, index === spark.length - 1))
        const kpi = (values: number[], value = values.at(-1) ?? 0) => ({
            value,
            deltaPct: deltaPct(values.at(-1) ?? 0, values.at(-2) ?? 0),
            spark: values
        })

        const tenants = sparkOf(item => data.tenants.filter(tenant => tenant.createdAt < item.end).length)
        const members = sparkOf(item => data.members.filter(member => member.createdAt < item.end).length)
        const activeSince = new Date(now.getTime() - ACTIVE_DAYS * DAY)
        const active = data.members.filter(
            member => member.lastSeenAt !== null && member.lastSeenAt > activeSince
        ).length
        const apps = sparkOf((item, last) => owned(last ? now : item.end, last).size)
        const revenues = sparkOf(item => revenue(item))

        // Environments per product now: the organisations that own it
        const counts = new Map<string, number>()
        for (const pair of owned(now, true)) {
            const productId = pair.split(':')[1] ?? ''
            counts.set(productId, (counts.get(productId) ?? 0) + 1)
        }
        const ranked = data.products
            .map(product => ({
                code: product.code,
                name: product.name,
                color: product.color,
                count: counts.get(product.id) ?? 0
            }))
            .filter(item => item.count > 0)
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        const appBreakdown = [
            ...ranked.slice(0, TOP_APPS),
            {
                code: 'other',
                name: 'other',
                color: null,
                count: ranked.slice(TOP_APPS).reduce((sum, item) => sum + item.count, 0)
            }
        ]

        const codes = [...data.discounts]
            .sort((a, b) => b.redemptions - a.redemptions || a.code.localeCompare(b.code))
            .map(discount => ({ code: discount.code, redemptions: discount.redemptions }))

        return {
            months: months.map(item => item.key),
            kpis: {
                tenants: kpi(tenants),
                // The value: members seen in the last 30 days; the spark: members at the end of each month
                activeUsers: kpi(members, active),
                purchasedApps: kpi(apps),
                revenueMonthCents: kpi(revenues)
            },
            revenueCents: months.map(item => revenue(item)),
            signups: months.map(item => data.tenants.filter(tenant => inMonth(tenant.createdAt, item)).length),
            appBreakdown,
            codes,
            codesRedeemedTotal: codes.reduce((sum, code) => sum + code.redemptions, 0),
            codesTotal: codes.length
        }
    }
}
