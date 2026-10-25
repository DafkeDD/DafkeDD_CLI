import type { Subscription } from '../billing/store/billing.store.js'
import { MemoryStatsStore } from './memory-stats.store.js'
import { deltaPct, lastMonths, StatsService } from './stats.service.js'

const NOW = new Date('2026-10-15T12:00:00Z')
const at = (date: string) => new Date(date + 'T10:00:00Z')

const subscription = (change: Partial<Subscription & { createdAt: Date }>): Subscription & { createdAt: Date } => ({
    id: 's',
    tenantId: 't1',
    productId: 'p1',
    interval: 'year',
    seats: 1,
    status: 'active',
    providerSubscriptionId: 'sub_1',
    currentPeriodEnd: at('2027-01-01'),
    cancelAtPeriodEnd: false,
    discountCodeId: null,
    discountPeriodsLeft: null,
    createdAt: at('2026-08-10'),
    ...change
})

function setup() {
    const store = new MemoryStatsStore()
    store.data = {
        tenants: [
            { id: 't1', createdAt: at('2025-12-20') },
            { id: 't2', createdAt: at('2026-09-03') },
            { id: 't3', createdAt: at('2026-10-01') }
        ],
        members: [
            { createdAt: at('2025-12-20'), lastSeenAt: at('2026-10-14') },
            { createdAt: at('2026-09-03'), lastSeenAt: at('2026-08-01') },
            { createdAt: at('2026-10-01'), lastSeenAt: null }
        ],
        subscriptions: [
            subscription({}),
            subscription({ id: 's2', tenantId: 't2', productId: 'p2', createdAt: at('2026-09-05') }),
            // Pending: not bought
            subscription({ id: 's3', tenantId: 't3', productId: 'p1', status: 'pending', currentPeriodEnd: null }),
            // Ended in September
            subscription({
                id: 's4',
                tenantId: 't3',
                productId: 'p3',
                status: 'canceled',
                cancelAtPeriodEnd: true,
                currentPeriodEnd: at('2026-09-20'),
                createdAt: at('2026-06-01')
            })
        ],
        grants: [
            { id: 'g', tenantId: 't3', productId: 'p2', seats: 2, endsAt: null, note: '', createdAt: at('2026-10-02') }
        ],
        payments: [
            { paidAt: at('2026-08-10'), amountCents: 10000 },
            { paidAt: at('2026-09-05'), amountCents: 5000 },
            { paidAt: at('2026-10-02'), amountCents: 2500 },
            { paidAt: at('2026-10-03'), amountCents: 2500 }
        ],
        products: [
            { id: 'p1', code: 'planner', name: 'Planner', color: '#ff0000' },
            { id: 'p2', code: 'agenda', name: 'Agenda', color: null },
            { id: 'p3', code: 'roster', name: 'Roster', color: null }
        ],
        discounts: [
            { code: 'WELCOME', redemptions: 2 },
            { code: 'PARTNER', redemptions: 5 }
        ]
    }
    return { store, service: new StatsService(store) }
}

describe('StatsService', () => {
    it('counts months in UTC and changes in percent', () => {
        expect(lastMonths(NOW, 3).map(month => month.key)).toEqual(['2026-08', '2026-09', '2026-10'])
        expect(lastMonths(new Date('2026-02-10T00:00:00Z'), 3).map(month => month.key)).toEqual([
            '2025-12',
            '2026-01',
            '2026-02'
        ])
        expect(deltaPct(150, 100)).toBe(50)
        expect(deltaPct(2, 3)).toBe(-33.3)
        expect(deltaPct(5, 0)).toBe(100)
        expect(deltaPct(0, 0)).toBe(0)
    })

    it('gives the months of the range: 6 months, this year, or since the first organisation', async () => {
        const { service } = setup()
        expect((await service.stats('6m', NOW)).months).toEqual([
            '2026-05',
            '2026-06',
            '2026-07',
            '2026-08',
            '2026-09',
            '2026-10'
        ])
        expect((await service.stats('year', NOW)).months).toHaveLength(10)
        const all = await service.stats('all', NOW)
        expect(all.months[0]).toBe('2025-12')
        expect(all.months).toHaveLength(11)
        expect(all.signups).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1])
    })

    it('computes the KPIs with their spark of the last 8 months', async () => {
        const { service } = setup()
        const stats = await service.stats('6m', NOW)
        expect(stats.revenueCents).toEqual([0, 0, 0, 10000, 5000, 5000])
        expect(stats.kpis.tenants).toEqual({ value: 3, deltaPct: 50, spark: [1, 1, 1, 1, 1, 1, 2, 3] })
        // Seen in the last 30 days: one member; the spark counts members
        expect(stats.kpis.activeUsers).toMatchObject({ value: 1, spark: [1, 1, 1, 1, 1, 1, 2, 3] })
        // End of August: s1 and s4; end of September: s1, s2 (s4 ended); now: s1, s2 and the grant of t3
        expect(stats.kpis.purchasedApps.spark.slice(-3)).toEqual([2, 2, 3])
        expect(stats.kpis.purchasedApps).toMatchObject({ value: 3, deltaPct: 50 })
        expect(stats.kpis.revenueMonthCents).toMatchObject({ value: 5000, deltaPct: 0 })
        expect(stats.kpis.revenueMonthCents.spark).toHaveLength(8)
    })

    it('ranks the apps by environments and sums the discount codes', async () => {
        const { service } = setup()
        const stats = await service.stats('6m', NOW)
        expect(stats.appBreakdown).toEqual([
            { code: 'agenda', name: 'Agenda', color: null, count: 2 },
            { code: 'planner', name: 'Planner', color: '#ff0000', count: 1 },
            { code: 'other', name: 'other', color: null, count: 0 }
        ])
        expect(stats.codes).toEqual([
            { code: 'PARTNER', redemptions: 5 },
            { code: 'WELCOME', redemptions: 2 }
        ])
        expect(stats).toMatchObject({ codesRedeemedTotal: 7, codesTotal: 2 })
    })
})
