import type { Interval } from '../store/billing.store.js'

/** The payment provider (Mollie, or the fake one for development), behind one small interface. */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER')

/** Statuses as Mollie names them. Only `paid` gives seats; canceled, expired and failed end a payment. */
export type ProviderPaymentStatus = 'open' | 'pending' | 'authorized' | 'paid' | 'canceled' | 'expired' | 'failed'

export interface ProviderPayment {
    id: string
    status: ProviderPaymentStatus
    amountCents: number
    /** Set for the payments of a subscription (the renewals). */
    subscriptionId: string | null
    metadata: Record<string, unknown>
}

export interface NewPayment {
    customerId: string
    amountCents: number
    currency: string
    description: string
    /** first: also creates the mandate for the renewals; oneoff: a single payment (more seats). */
    sequenceType: 'first' | 'oneoff'
    redirectUrl: string
    webhookUrl: string | null
    metadata: Record<string, string>
}

export interface NewSubscription {
    customerId: string
    amountCents: number
    currency: string
    interval: Interval
    /** The first renewal (YYYY-MM-DD): the end of the period that was just paid. */
    startDate: string
    /** Unique per customer at Mollie. */
    description: string
    webhookUrl: string | null
    metadata: Record<string, string>
    /** The same key twice creates one subscription (a retry after an error). */
    idempotencyKey: string
}

export interface PaymentProvider {
    /** 'mollie' or 'fake'. */
    readonly name: string
    createCustomer(name: string, email: string): Promise<string>
    createPayment(payment: NewPayment): Promise<{ id: string; checkoutUrl: string }>
    getPayment(id: string): Promise<ProviderPayment | null>
    createSubscription(subscription: NewSubscription): Promise<string>
    updateSubscriptionAmount(
        customerId: string,
        subscriptionId: string,
        amountCents: number,
        currency: string
    ): Promise<void>
    cancelSubscription(customerId: string, subscriptionId: string): Promise<void>
    /** The payments of a subscription (the renewals), newest first. */
    listSubscriptionPayments(customerId: string, subscriptionId: string): Promise<ProviderPayment[]>
}

/** "12.34" from 1234 cents, as Mollie wants amounts. */
export const formatAmount = (cents: number): string => (cents / 100).toFixed(2)

/** 1234 from "12.34". */
export const parseAmount = (value: string): number => Math.round(Number(value) * 100)
