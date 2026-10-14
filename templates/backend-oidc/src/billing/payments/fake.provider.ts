import { randomBytes } from 'node:crypto'
import type {
    NewPayment,
    NewSubscription,
    PaymentProvider,
    ProviderPayment,
    ProviderPaymentStatus
} from './payment-provider.js'

/**
 * A payment provider for development (PAYMENTS=fake): no account, no money. Its checkout is a page of this API
 * (/billing/fake/<id>) with "Pay" and "Cancel". Renewals never happen by themselves: renew() pays the next period, like
 * Mollie would. Everything lives in memory: a restart forgets it. Refused in production.
 */
export class FakeProvider implements PaymentProvider {
    readonly name = 'fake'
    readonly payments = new Map<
        string,
        ProviderPayment & { redirectUrl: string; description: string; customerId: string }
    >()
    readonly subscriptions = new Map<string, NewSubscription & { canceled: boolean }>()

    constructor(private readonly checkoutBase: string) {}

    private id(prefix: string) {
        return prefix + randomBytes(8).toString('hex')
    }

    async createCustomer() {
        return this.id('cst_fake')
    }

    async createPayment(payment: NewPayment) {
        const id = this.id('tr_fake')
        this.payments.set(id, {
            id,
            status: 'open',
            amountCents: payment.amountCents,
            subscriptionId: null,
            metadata: payment.metadata,
            redirectUrl: payment.redirectUrl,
            description: payment.description,
            customerId: payment.customerId
        })
        return { id, checkoutUrl: `${this.checkoutBase}/${id}` }
    }

    async getPayment(id: string) {
        const payment = this.payments.get(id)
        return payment ? { ...payment } : null
    }

    /** The checkout page: the customer pays or cancels. Returns where the browser goes next. */
    complete(id: string, status: Extract<ProviderPaymentStatus, 'paid' | 'canceled'>): string | null {
        const payment = this.payments.get(id)
        if (!payment || payment.status !== 'open') return null
        payment.status = status
        return payment.redirectUrl
    }

    private readonly byKey = new Map<string, string>()

    async createSubscription(subscription: NewSubscription) {
        // Like Mollie: the same idempotency key gives the same subscription
        const existing = this.byKey.get(subscription.idempotencyKey)
        if (existing) return existing
        const id = this.id('sub_fake')
        this.byKey.set(subscription.idempotencyKey, id)
        this.subscriptions.set(id, { ...subscription, canceled: false })
        return id
    }

    async updateSubscriptionAmount(_customerId: string, subscriptionId: string, amountCents: number) {
        const subscription = this.subscriptions.get(subscriptionId)
        if (subscription) subscription.amountCents = amountCents
    }

    async cancelSubscription(_customerId: string, subscriptionId: string) {
        const subscription = this.subscriptions.get(subscriptionId)
        if (subscription) subscription.canceled = true
    }

    async listSubscriptionPayments(_customerId: string, subscriptionId: string) {
        return [...this.payments.values()].filter(payment => payment.subscriptionId === subscriptionId).reverse()
    }

    /** Simulates a renewal of a subscription (for tests and development): a paid (or failed) payment. */
    renew(subscriptionId: string, status: ProviderPaymentStatus = 'paid'): string | null {
        const subscription = this.subscriptions.get(subscriptionId)
        if (!subscription || subscription.canceled) return null
        const id = this.id('tr_fake')
        this.payments.set(id, {
            id,
            status,
            amountCents: subscription.amountCents,
            subscriptionId,
            metadata: subscription.metadata,
            redirectUrl: '',
            description: subscription.description,
            customerId: subscription.customerId
        })
        return id
    }
}
