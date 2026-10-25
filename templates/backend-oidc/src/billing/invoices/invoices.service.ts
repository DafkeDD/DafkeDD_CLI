import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common'
import { I18nService } from 'nestjs-i18n'
import { AuditService } from '../../audit/audit.service.js'
import { AppException } from '../../common/app.exception.js'
import { NotificationsService } from '../../notifications/notifications.service.js'
import { OIDC_STORE, type OidcStore } from '../../oidc/store/oidc.store.js'
import { BillingConfig } from '../billing.config.js'
import type { Payment, Product, Subscription } from '../store/billing.store.js'
import { invoicePdf } from './invoice-pdf.js'
import { type Invoice, type InvoiceLine, INVOICES_STORE, type InvoicesStore } from './invoices.store.js'

/** An amount without VAT, with the VAT on top. */
export function withVat(netCents: number, percent: number) {
    const vatCents = Math.round((netCents * percent) / 100)
    return { amountCents: netCents, vatCents, totalCents: netCents + vatCents }
}

/** A charged amount (VAT included) split into the amount without VAT and the VAT. */
export function splitVat(totalCents: number, percent: number) {
    const amountCents = Math.round((totalCents * 100) / (100 + percent))
    return { amountCents, vatCents: totalCents - amountCents, totalCents }
}

export type Amounts = ReturnType<typeof withVat>

/**
 * Invoices of the organisations: one for every payment of a subscription (open, paid when the payment comes in) and a
 * free one for a purchase without payment. Numbered FAC-YYYY-NNNN per year, with the billing details of the
 * organisation as they were when it was issued. The admins of the organisation get a notification for each one.
 */
@Injectable()
export class InvoicesService {
    private readonly logger = new Logger(InvoicesService.name)

    constructor(
        @Inject(INVOICES_STORE) private readonly store: InvoicesStore,
        @Inject(OIDC_STORE) private readonly oidc: OidcStore,
        private readonly config: BillingConfig,
        private readonly notifications: NotificationsService,
        private readonly audit: AuditService,
        private readonly i18n: I18nService
    ) {}

    get vatPercent() {
        return this.config.vatPercent
    }

    /**
     * Issues an invoice (once per payment): open while its payment is not paid, paid (a renewal that came in paid),
     * or free (no payment). Null when the payment had one already.
     */
    async issue(input: {
        subscription: Subscription
        product: Product
        line: InvoiceLine
        seats: number
        amounts: Amounts
        payment: { id: string; checkoutUrl: string | null; paid?: boolean } | null
    }) {
        const invoice = await this.store.create({
            tenantId: input.subscription.tenantId,
            paymentId: input.payment?.id ?? null,
            subscriptionId: input.subscription.id,
            productCode: input.product.code,
            productName: input.product.name,
            description: input.line,
            period: input.subscription.interval,
            seats: input.seats,
            vatPercent: this.vatPercent,
            ...input.amounts,
            status: !input.payment ? 'free' : input.payment.paid ? 'paid' : 'open',
            checkoutUrl: input.payment && !input.payment.paid ? input.payment.checkoutUrl : null
        })
        if (!invoice) return null
        await this.audit.record('invoices.issued', {
            tenantId: invoice.tenantId,
            actorId: null,
            target: { type: 'invoice', id: invoice.id },
            details: {
                number: invoice.number,
                product: invoice.productCode,
                totalCents: invoice.totalCents,
                status: invoice.status
            }
        })
        await this.notifications.toTenantAdmins(
            invoice.tenantId,
            'invoice.created',
            {
                number: invoice.number,
                app: invoice.productName,
                totalCents: invoice.totalCents,
                status: invoice.status
            },
            { screen: 'invoices' }
        )
        return invoice
    }

    /** The invoices a payment pays: its own, or (a payment of open invoices) all of them. */
    private async ofPayment(payment: Payment) {
        if (payment.kind === 'invoices') return this.store.listSettledBy(payment.id)
        const invoice = await this.store.findByPayment(payment.id)
        return invoice ? [invoice] : []
    }

    /** A payment came in: its invoices are paid (nothing changes when they were paid already). */
    async paid(payment: Payment) {
        const paid: Invoice[] = []
        for (const invoice of await this.ofPayment(payment)) {
            const changed = await this.store.markPaid(invoice.id)
            if (!changed) continue
            paid.push(changed)
            await this.audit.record('invoices.paid', {
                tenantId: changed.tenantId,
                actorId: null,
                target: { type: 'invoice', id: changed.id },
                details: { number: changed.number, totalCents: changed.totalCents, payment: payment.id }
            })
        }
        return paid
    }

    /** The superadmins hear about money that came in (once per payment: the caller applied it just now). */
    async received(payment: Payment) {
        const invoices = await this.ofPayment(payment)
        const tenant = invoices[0]?.tenantName ?? (await this.oidc.findTenant(payment.tenantId))?.name ?? null
        await this.notifications.toPlatform(
            'payment.received',
            {
                tenant,
                totalCents: payment.amountCents,
                app: [...new Set(invoices.map(invoice => invoice.productName))].join(', ') || null
            },
            { screen: 'admin-tenant', id: payment.tenantId }
        )
    }

    findByPayment(paymentId: string) {
        return this.store.findByPayment(paymentId)
    }

    listSettledBy(paymentId: string) {
        return this.store.listSettledBy(paymentId)
    }

    /** A payment failed, expired or was canceled (or its purchase was replaced): its open invoice is void. */
    async voidFor(paymentId: string) {
        const invoice = await this.store.findByPayment(paymentId)
        if (invoice) await this.void([invoice.id])
    }

    /** A pending purchase is replaced by a new one: the open invoice of its first payment is void. */
    async voidPurchase(subscriptionId: string) {
        await this.void((await this.store.listOpenPurchase(subscriptionId)).map(invoice => invoice.id))
    }

    private async void(ids: string[]) {
        if (ids.length === 0) return
        for (const invoice of await this.store.markVoid(ids))
            await this.audit.record('invoices.voided', {
                tenantId: invoice.tenantId,
                actorId: null,
                target: { type: 'invoice', id: invoice.id },
                details: { number: invoice.number }
            })
    }

    // ---------------------------------------------------------------- the organisation

    /** The invoices of an organisation, newest first (not the void ones). */
    async list(tenantId: string) {
        return (await this.store.list(tenantId))
            .filter(invoice => invoice.status !== 'void')
            .map(invoice => ({
                id: invoice.id,
                number: invoice.number,
                issuedAt: invoice.issuedAt,
                paidAt: invoice.paidAt,
                app: invoice.productName,
                productCode: invoice.productCode,
                period: invoice.period,
                seats: invoice.seats,
                amountCents: invoice.amountCents,
                vatCents: invoice.vatCents,
                totalCents: invoice.totalCents,
                status: invoice.status,
                checkoutUrl: invoice.status === 'open' ? invoice.checkoutUrl : null
            }))
    }

    listOpen(tenantId: string) {
        return this.store.listOpen(tenantId)
    }

    /** These open invoices are paid by one payment (of all open invoices at once). */
    settle(ids: string[], paymentId: string, checkoutUrl: string) {
        return this.store.settle(ids, paymentId, checkoutUrl)
    }

    /** The PDF of an invoice, in the language of the request. */
    async pdf(tenantId: string, id: string, lang: string) {
        const invoice = await this.store.find(tenantId, id)
        if (!invoice) throw new AppException('invoices.NOT_FOUND', HttpStatus.NOT_FOUND)
        const language = ['nl', 'fr', 'de', 'en'].includes(lang) ? lang : 'en'
        const t = (key: string, args?: Record<string, string>) => String(this.i18n.t(key, { lang: language, args }))
        return { filename: `${invoice.number}.pdf`, content: invoicePdf(invoice, this.config.seller, t, language) }
    }

    /** Never fails what it is part of (a purchase or a payment coming in): an invoice that cannot be made is logged. */
    async safely<T>(what: string, work: () => Promise<T>): Promise<T | null> {
        try {
            return await work()
        } catch (error) {
            this.logger.error(`Could not ${what}: ${error instanceof Error ? error.message : String(error)}`)
            return null
        }
    }
}
