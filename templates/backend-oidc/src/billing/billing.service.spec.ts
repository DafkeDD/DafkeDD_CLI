import { addPeriods, discounted, isValid } from './billing.service.js'
import type { Subscription } from './store/billing.store.js'

const subscription = (change: Partial<Subscription>): Subscription => ({
    id: 's',
    tenantId: 't',
    productId: 'p',
    interval: 'month',
    seats: 1,
    status: 'active',
    providerSubscriptionId: 'sub_1',
    currentPeriodEnd: new Date(Date.now() + 60_000),
    cancelAtPeriodEnd: false,
    discountCodeId: null,
    discountPeriodsLeft: null,
    ...change
})

describe('billing', () => {
    it('adds months and years in UTC, like Mollie: never past the end of a month', () => {
        const start = new Date('2026-01-31T10:00:00Z')
        expect(addPeriods(start, 'year').toISOString()).toBe('2027-01-31T10:00:00.000Z')
        expect(addPeriods(start, 'month').toISOString()).toBe('2026-02-28T10:00:00.000Z')
        expect(addPeriods(start, 'month', 2).toISOString()).toBe('2026-03-31T10:00:00.000Z')
        expect(addPeriods(new Date('2026-03-31T10:00:00Z'), 'month', -1).toISOString()).toBe('2026-02-28T10:00:00.000Z')
        expect(addPeriods(new Date('2028-02-29T10:00:00Z'), 'year').toISOString()).toBe('2029-02-28T10:00:00.000Z')
        expect(addPeriods(new Date('2026-12-15T10:00:00Z'), 'month').toISOString()).toBe('2027-01-15T10:00:00.000Z')
    })

    it('applies a percentage or an amount, never below zero', () => {
        expect(discounted(2000, null)).toBe(2000)
        expect(discounted(2000, { percentOff: 25, amountOffCents: null })).toBe(1500)
        expect(discounted(999, { percentOff: 33, amountOffCents: null })).toBe(669)
        expect(discounted(2000, { percentOff: 100, amountOffCents: null })).toBe(0)
        expect(discounted(2000, { percentOff: null, amountOffCents: 500 })).toBe(1500)
        expect(discounted(400, { percentOff: null, amountOffCents: 500 })).toBe(0)
    })

    it('a subscription counts while its period runs (also canceled), never while pending', () => {
        expect(isValid(null)).toBe(false)
        expect(isValid(subscription({}))).toBe(true)
        expect(isValid(subscription({ status: 'canceled', cancelAtPeriodEnd: true }))).toBe(true)
        expect(isValid(subscription({ status: 'past_due' }))).toBe(true)
        // The period ended: a renewing subscription waits a week for its renewal (SEPA takes days), others stop
        const ended = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        expect(isValid(subscription({ currentPeriodEnd: ended(2) }))).toBe(true)
        expect(isValid(subscription({ currentPeriodEnd: ended(8) }))).toBe(false)
        expect(isValid(subscription({ currentPeriodEnd: ended(1), status: 'past_due' }))).toBe(false)
        expect(isValid(subscription({ currentPeriodEnd: ended(1), status: 'canceled', cancelAtPeriodEnd: true }))).toBe(
            false
        )
        expect(isValid(subscription({ currentPeriodEnd: ended(1), providerSubscriptionId: null }))).toBe(false)
        expect(isValid(subscription({ status: 'pending' }))).toBe(false)
        // Free forever (a 100% code)
        expect(isValid(subscription({ currentPeriodEnd: null, providerSubscriptionId: null }))).toBe(true)
        expect(isValid(subscription({ currentPeriodEnd: null, status: 'canceled' }))).toBe(false)
    })
})
