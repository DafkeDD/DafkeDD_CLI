import { Logger } from '@nestjs/common'
import {
    formatAmount,
    type NewPayment,
    type NewSubscription,
    parseAmount,
    type PaymentProvider,
    type ProviderPayment,
    type ProviderPaymentStatus
} from './payment-provider.js'

const API = 'https://api.mollie.com/v2'

type MolliePayment = {
    id: string
    status: ProviderPaymentStatus
    amount: { value: string; currency: string }
    subscriptionId?: string
    metadata?: Record<string, unknown> | null
    _links?: { checkout?: { href: string } }
}

/**
 * Mollie (https://docs.mollie.com), with fetch: customers, payments (a first payment creates the mandate), and
 * subscriptions that renew per month or per year. MOLLIE_API_KEY: test_... while testing, live_... in production.
 */
export class MollieProvider implements PaymentProvider {
    readonly name = 'mollie'
    private readonly logger = new Logger(MollieProvider.name)

    constructor(
        private readonly apiKey: string,
        private readonly fetcher: typeof fetch = fetch
    ) {}

    private async call<T>(method: string, path: string, body?: object, idempotencyKey?: string): Promise<T | null> {
        const response = await this.fetcher(API + path, {
            method,
            headers: {
                Authorization: 'Bearer ' + this.apiKey,
                Accept: 'application/json',
                ...(body ? { 'Content-Type': 'application/json' } : {}),
                ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
            },
            body: body ? JSON.stringify(body) : undefined
        })
        if (response.status === 404) return null
        if (response.status === 204) return null
        if (!response.ok) {
            // The detail of Mollie goes to the log, never to the customer
            const detail = await response.text().catch(() => '')
            this.logger.error(`Mollie ${method} ${path} failed: ${response.status} ${detail.slice(0, 300)}`)
            throw new Error('Mollie request failed: ' + response.status)
        }
        return (await response.json()) as T
    }

    private payment(raw: MolliePayment): ProviderPayment {
        return {
            id: raw.id,
            status: raw.status,
            amountCents: parseAmount(raw.amount.value),
            subscriptionId: raw.subscriptionId ?? null,
            metadata: raw.metadata ?? {}
        }
    }

    async createCustomer(name: string, email: string) {
        const customer = await this.call<{ id: string }>('POST', '/customers', { name, email })
        if (!customer) throw new Error('Mollie did not create the customer')
        return customer.id
    }

    async createPayment(payment: NewPayment) {
        const created = await this.call<MolliePayment>('POST', '/payments', {
            amount: { currency: payment.currency, value: formatAmount(payment.amountCents) },
            description: payment.description,
            customerId: payment.customerId,
            sequenceType: payment.sequenceType,
            redirectUrl: payment.redirectUrl,
            ...(payment.webhookUrl ? { webhookUrl: payment.webhookUrl } : {}),
            ...(payment.method ? { method: payment.method } : {}),
            metadata: payment.metadata
        })
        const checkoutUrl = created?._links?.checkout?.href
        if (!created || !checkoutUrl) throw new Error('Mollie did not return a checkout')
        return { id: created.id, checkoutUrl }
    }

    async getPayment(id: string) {
        if (!/^tr_[A-Za-z0-9]+$/.test(id)) return null
        const payment = await this.call<MolliePayment>('GET', '/payments/' + id)
        return payment ? this.payment(payment) : null
    }

    async createSubscription(subscription: NewSubscription) {
        const created = await this.call<{ id: string }>(
            'POST',
            `/customers/${subscription.customerId}/subscriptions`,
            {
                amount: { currency: subscription.currency, value: formatAmount(subscription.amountCents) },
                interval: subscription.interval === 'year' ? '12 months' : '1 month',
                startDate: subscription.startDate,
                description: subscription.description,
                ...(subscription.webhookUrl ? { webhookUrl: subscription.webhookUrl } : {}),
                metadata: subscription.metadata
            },
            subscription.idempotencyKey
        )
        if (!created) throw new Error('Mollie did not create the subscription')
        return created.id
    }

    async updateSubscriptionAmount(customerId: string, subscriptionId: string, amountCents: number, currency: string) {
        await this.call('PATCH', `/customers/${customerId}/subscriptions/${subscriptionId}`, {
            amount: { currency, value: formatAmount(amountCents) }
        })
    }

    async cancelSubscription(customerId: string, subscriptionId: string) {
        await this.call('DELETE', `/customers/${customerId}/subscriptions/${subscriptionId}`)
    }

    async listSubscriptionPayments(customerId: string, subscriptionId: string) {
        const list = await this.call<{ _embedded?: { payments?: MolliePayment[] } }>(
            'GET',
            `/customers/${customerId}/subscriptions/${subscriptionId}/payments?limit=25`
        )
        return (list?._embedded?.payments ?? []).map(payment => this.payment(payment))
    }
}
