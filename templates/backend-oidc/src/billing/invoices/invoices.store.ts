import type { Interval } from '../store/billing.store.js'

/** Storage of the invoices. PgInvoicesStore keeps them in PostgreSQL, MemoryInvoicesStore in memory (tests). */
export const INVOICES_STORE = Symbol('INVOICES_STORE')

/** open: to be paid; paid; free: nothing to pay (a 100% discount); void: the purchase was replaced or not paid. */
export type InvoiceStatus = 'open' | 'paid' | 'free' | 'void'

/**
 * What an invoice is for (stored in its description, translated on the PDF): subscription (the first payment),
 * seats (more seats for the rest of a period), renewal (the next period), free (a purchase without payment).
 */
export type InvoiceLine = 'subscription' | 'seats' | 'renewal' | 'free'

/** The billing details of an organisation, copied onto an invoice when it is issued. */
export interface BillingDetails {
    tenantName: string
    company: string | null
    vat: string | null
    billingAddress: string | null
    billingEmail: string | null
}

export interface Invoice extends BillingDetails {
    id: string
    /** FAC-YYYY-NNNN, numbered per year without gaps. */
    number: string
    tenantId: string
    /** The payment it was made for (null: free). */
    paymentId: string | null
    /** A later payment of all open invoices at once that pays it. */
    settledBy: string | null
    subscriptionId: string | null
    productCode: string
    productName: string
    description: InvoiceLine
    period: Interval
    seats: number
    vatPercent: number
    /** Without VAT. */
    amountCents: number
    vatCents: number
    /** amountCents + vatCents: what is (or was) charged. */
    totalCents: number
    status: InvoiceStatus
    checkoutUrl: string | null
    issuedAt: Date
    paidAt: Date | null
}

export type NewInvoice = Omit<Invoice, keyof BillingDetails | 'id' | 'number' | 'settledBy' | 'issuedAt' | 'paidAt'>

export interface InvoicesStore {
    /**
     * Issues an invoice with the next number of this year and the billing details the organisation has now (in one
     * transaction: a number is never skipped). Null when the payment has an invoice already (a webhook that came twice).
     */
    create(invoice: NewInvoice): Promise<Invoice | null>
    /** The invoices of an organisation, newest first (read with Row-Level Security). */
    list(tenantId: string): Promise<Invoice[]>
    /** One invoice of an organisation (Row-Level Security). */
    find(tenantId: string, id: string): Promise<Invoice | null>
    findByPayment(paymentId: string): Promise<Invoice | null>
    /** The invoices a payment of several open invoices pays. */
    listSettledBy(paymentId: string): Promise<Invoice[]>
    /** The open invoices of an organisation (to pay them at once). */
    listOpen(tenantId: string): Promise<Invoice[]>
    /** Marks these open invoices as paid by one payment (the newest payment wins). */
    settle(ids: string[], paymentId: string, checkoutUrl: string): Promise<void>
    /** Paid now (also an invoice that was void: the money came in). Returns it, or null when it was paid already. */
    markPaid(id: string): Promise<Invoice | null>
    /** Void: open invoices only; returns those that changed. */
    markVoid(ids: string[]): Promise<Invoice[]>
    /** The open invoices of the first payment of a purchase (replaced by a new purchase). */
    listOpenPurchase(subscriptionId: string): Promise<Invoice[]>
}
