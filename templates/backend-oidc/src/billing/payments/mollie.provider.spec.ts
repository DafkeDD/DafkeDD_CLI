import { Logger } from '@nestjs/common'
import { MollieProvider } from './mollie.provider.js'
import { formatAmount, parseAmount } from './payment-provider.js'

/** A fetch that remembers the requests and answers with the next prepared response. */
function fakeFetch(...answers: { status?: number; body?: unknown }[]) {
    const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = []
    const fetcher = (async (url: string, init: RequestInit) => {
        calls.push({
            url,
            method: init.method ?? 'GET',
            headers: init.headers as Record<string, string>,
            body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined
        })
        const answer = answers.shift() ?? { status: 200, body: {} }
        return new Response(answer.status === 204 ? null : JSON.stringify(answer.body ?? {}), {
            status: answer.status ?? 200
        })
    }) as unknown as typeof fetch
    return { calls, fetcher }
}

describe('MollieProvider', () => {
    it('formats amounts as Mollie wants them', () => {
        expect(formatAmount(1234)).toBe('12.34')
        expect(formatAmount(5)).toBe('0.05')
        expect(parseAmount('12.34')).toBe(1234)
    })

    it('creates a first payment with the key, the amount and the checkout', async () => {
        const { calls, fetcher } = fakeFetch({
            status: 201,
            body: {
                id: 'tr_abc',
                status: 'open',
                amount: { value: '20.00', currency: 'EUR' },
                _links: { checkout: { href: 'https://www.mollie.com/checkout/x' } }
            }
        })
        const mollie = new MollieProvider('test_key', fetcher)
        const result = await mollie.createPayment({
            customerId: 'cst_1',
            amountCents: 2000,
            currency: 'EUR',
            description: 'Planner: 2 × 1 year',
            sequenceType: 'first',
            redirectUrl: 'http://localhost:3000/licenses/return?subscription=s',
            webhookUrl: null,
            metadata: { subscriptionId: 's', kind: 'first' }
        })
        expect(result).toEqual({ id: 'tr_abc', checkoutUrl: 'https://www.mollie.com/checkout/x' })
        expect(calls[0]).toMatchObject({
            url: 'https://api.mollie.com/v2/payments',
            method: 'POST',
            headers: { Authorization: 'Bearer test_key' },
            body: { amount: { currency: 'EUR', value: '20.00' }, sequenceType: 'first', customerId: 'cst_1' }
        })
        // No webhook on localhost: Mollie would refuse it
        expect(calls[0]?.body).not.toHaveProperty('webhookUrl')
    })

    it('creates a subscription per month or per year, and lists its payments', async () => {
        const { calls, fetcher } = fakeFetch(
            { status: 201, body: { id: 'sub_1' } },
            {
                body: {
                    _embedded: {
                        payments: [
                            {
                                id: 'tr_r1',
                                status: 'paid',
                                amount: { value: '9.00', currency: 'EUR' },
                                subscriptionId: 'sub_1'
                            }
                        ]
                    }
                }
            }
        )
        const mollie = new MollieProvider('test_key', fetcher)
        const id = await mollie.createSubscription({
            customerId: 'cst_1',
            amountCents: 900,
            currency: 'EUR',
            interval: 'year',
            startDate: '2027-10-14',
            description: 'Planner (s)',
            webhookUrl: 'https://api.example.com/billing/webhook',
            metadata: { subscriptionId: 's' },
            idempotencyKey: 'subscription-tr_1'
        })
        expect(id).toBe('sub_1')
        // A retry gets the same subscription at Mollie
        expect(calls[0]?.headers?.['Idempotency-Key']).toBe('subscription-tr_1')
        expect(calls[0]?.body).toMatchObject({
            interval: '12 months',
            startDate: '2027-10-14',
            webhookUrl: 'https://api.example.com/billing/webhook'
        })
        const payments = await mollie.listSubscriptionPayments('cst_1', 'sub_1')
        expect(payments).toEqual([
            { id: 'tr_r1', status: 'paid', amountCents: 900, subscriptionId: 'sub_1', metadata: {} }
        ])
    })

    it('never asks Mollie for an id that is not a payment id, and logs errors without throwing details at users', async () => {
        const { calls, fetcher } = fakeFetch({ status: 422, body: { detail: 'The amount is lower than the minimum' } })
        const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
        const mollie = new MollieProvider('test_key', fetcher)
        expect(await mollie.getPayment('../customers')).toBeNull()
        expect(calls).toHaveLength(0)
        await expect(mollie.createCustomer('Acme', 'a@example.com')).rejects.toThrow('Mollie request failed: 422')
        expect(error).toHaveBeenCalled()
        error.mockRestore()
    })
})
