import { randomUUID } from 'node:crypto'
import type { BillingDetails, Invoice, InvoicesStore, NewInvoice } from './invoices.store.js'

/** The billing details of an organisation: in the tests a function of the test. */
export type BillingDetailsLookup = (tenantId: string) => Promise<BillingDetails | null>

/** In-memory invoices with the same behaviour as PgInvoicesStore. Used by the tests; never in production. */
export class MemoryInvoicesStore implements InvoicesStore {
    invoices: Invoice[] = []
    private readonly numbers = new Map<number, number>()
    private tick = 0

    constructor(private readonly details: BillingDetailsLookup) {}

    async create(invoice: NewInvoice) {
        if (invoice.paymentId && this.invoices.some(item => item.paymentId === invoice.paymentId)) return null
        const billing = await this.details(invoice.tenantId)
        if (!billing) throw new Error('The organisation of the invoice does not exist')
        const now = new Date(Date.now() + this.tick++)
        const year = now.getUTCFullYear()
        const last = (this.numbers.get(year) ?? 0) + 1
        this.numbers.set(year, last)
        const created: Invoice = {
            ...invoice,
            ...billing,
            id: randomUUID(),
            number: `FAC-${year}-${String(last).padStart(4, '0')}`,
            settledBy: null,
            issuedAt: now,
            paidAt: invoice.status === 'paid' ? now : null
        }
        this.invoices.push(created)
        return { ...created }
    }

    async list(tenantId: string) {
        return this.invoices
            .filter(item => item.tenantId === tenantId)
            .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime() || b.number.localeCompare(a.number))
            .map(item => ({ ...item }))
    }

    async find(tenantId: string, id: string) {
        const found = this.invoices.find(item => item.tenantId === tenantId && item.id === id)
        return found ? { ...found } : null
    }

    async findByPayment(paymentId: string) {
        const found = this.invoices.find(item => item.paymentId === paymentId)
        return found ? { ...found } : null
    }

    async listSettledBy(paymentId: string) {
        return this.invoices
            .filter(item => item.settledBy === paymentId)
            .sort((a, b) => a.number.localeCompare(b.number))
            .map(item => ({ ...item }))
    }

    async listOpen(tenantId: string) {
        return this.invoices
            .filter(item => item.tenantId === tenantId && item.status === 'open')
            .sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime())
            .map(item => ({ ...item }))
    }

    async settle(ids: string[], paymentId: string, checkoutUrl: string) {
        for (const item of this.invoices)
            if (ids.includes(item.id) && item.status === 'open')
                Object.assign(item, { settledBy: paymentId, checkoutUrl })
    }

    async markPaid(id: string) {
        const found = this.invoices.find(item => item.id === id && (item.status === 'open' || item.status === 'void'))
        if (!found) return null
        Object.assign(found, { status: 'paid', paidAt: new Date(), checkoutUrl: null })
        return { ...found }
    }

    async markVoid(ids: string[]) {
        const changed = this.invoices.filter(item => ids.includes(item.id) && item.status === 'open')
        for (const item of changed) Object.assign(item, { status: 'void', checkoutUrl: null })
        return changed.map(item => ({ ...item }))
    }

    async listOpenPurchase(subscriptionId: string) {
        return this.invoices
            .filter(
                item =>
                    item.subscriptionId === subscriptionId &&
                    item.status === 'open' &&
                    item.description === 'subscription'
            )
            .map(item => ({ ...item }))
    }
}
