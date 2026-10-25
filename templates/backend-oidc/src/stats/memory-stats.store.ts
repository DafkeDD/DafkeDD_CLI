import type { StatsData, StatsStore } from './stats.store.js'

/** The statistics data in memory, filled in by the test. Used by the tests; never in production. */
export class MemoryStatsStore implements StatsStore {
    data: StatsData = {
        tenants: [],
        members: [],
        subscriptions: [],
        grants: [],
        payments: [],
        products: [],
        discounts: []
    }

    async load() {
        return this.data
    }
}
