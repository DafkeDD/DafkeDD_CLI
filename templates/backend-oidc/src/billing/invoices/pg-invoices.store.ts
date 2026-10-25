import { Injectable } from '@nestjs/common'
import type { QueryResultRow } from 'pg'
import { DatabaseService } from '../../database/database.service.js'
import type { Invoice, InvoicesStore, NewInvoice } from './invoices.store.js'

const COLUMNS =
    'id, number, tenant_id AS "tenantId", payment_id AS "paymentId", settled_by AS "settledBy", ' +
    'subscription_id AS "subscriptionId", product_code AS "productCode", product_name AS "productName", description, ' +
    'period, seats, vat_percent AS "vatPercent", amount_cents AS "amountCents", vat_cents AS "vatCents", ' +
    'total_cents AS "totalCents", status, checkout_url AS "checkoutUrl", issued_at AS "issuedAt", paid_at AS "paidAt", ' +
    'tenant_name AS "tenantName", company, vat, billing_address AS "billingAddress", billing_email AS "billingEmail"'

/** unique_violation */
const UNIQUE = '23505'

/**
 * Invoices in PostgreSQL. They are issued and paid by platform code (payments and webhooks come without a tenant);
 * the admins of an organisation read them with Row-Level Security (DatabaseService.withTenant).
 */
@Injectable()
export class PgInvoicesStore implements InvoicesStore {
    constructor(private readonly database: DatabaseService) {}

    private async query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<T[]> {
        await this.database.ready()
        return (await this.database.query<T>(text, params)).rows
    }

    async create(invoice: NewInvoice) {
        await this.database.ready()
        try {
            return await this.database.transaction(async db => {
                // The row of the year is locked until the invoice is stored: two invoices at once get 1 and 2, and a
                // failed one gives its number back (rollback)
                const { rows: numbers } = await db.query<{ year: number; last: number }>(
                    `INSERT INTO invoice_numbers (year, last) VALUES (extract(year FROM now())::int, 1)
           ON CONFLICT (year) DO UPDATE SET last = invoice_numbers.last + 1 RETURNING year, last`
                )
                const { year, last } = numbers[0] ?? { year: new Date().getUTCFullYear(), last: 1 }
                const { rows } = await db.query<Invoice>(
                    `INSERT INTO invoices (number, tenant_id, payment_id, subscription_id, product_code, product_name,
                                description, period, seats, vat_percent, amount_cents, vat_cents, total_cents,
                                status, checkout_url, paid_at, tenant_name, company, vat, billing_address,
                                billing_email)
           SELECT $1, t.id, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                  CASE WHEN $14 = 'paid' THEN now() END, t.name, t.company, t.vat, t.billing_address, t.billing_email
             FROM tenants t WHERE t.id = $2
           RETURNING ${COLUMNS}`,
                    [
                        `FAC-${year}-${String(last).padStart(4, '0')}`,
                        invoice.tenantId,
                        invoice.paymentId,
                        invoice.subscriptionId,
                        invoice.productCode,
                        invoice.productName,
                        invoice.description,
                        invoice.period,
                        invoice.seats,
                        invoice.vatPercent,
                        invoice.amountCents,
                        invoice.vatCents,
                        invoice.totalCents,
                        invoice.status,
                        invoice.checkoutUrl
                    ]
                )
                if (!rows[0]) throw new Error('The organisation of the invoice does not exist')
                return rows[0]
            })
        } catch (error) {
            // The payment has an invoice already: nothing was stored, and the number was given back
            if ((error as { code?: string }).code === UNIQUE) return null
            throw error
        }
    }

    async list(tenantId: string) {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            // Row-Level Security filters the organisation; the WHERE says it too (clearer, and uses the index)
            const { rows } = await db.query<Invoice>(
                `SELECT ${COLUMNS} FROM invoices WHERE tenant_id = $1 ORDER BY issued_at DESC, number DESC`,
                [tenantId]
            )
            return rows
        })
    }

    async find(tenantId: string, id: string) {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const { rows } = await db.query<Invoice>(`SELECT ${COLUMNS} FROM invoices WHERE id = $1`, [id])
            return rows[0] ?? null
        })
    }

    async findByPayment(paymentId: string) {
        return (
            (await this.query<Invoice>(`SELECT ${COLUMNS} FROM invoices WHERE payment_id = $1`, [paymentId]))[0] ?? null
        )
    }

    listSettledBy(paymentId: string) {
        return this.query<Invoice>(`SELECT ${COLUMNS} FROM invoices WHERE settled_by = $1 ORDER BY number`, [paymentId])
    }

    listOpen(tenantId: string) {
        return this.query<Invoice>(
            `SELECT ${COLUMNS} FROM invoices WHERE tenant_id = $1 AND status = 'open' ORDER BY issued_at, number`,
            [tenantId]
        )
    }

    async settle(ids: string[], paymentId: string, checkoutUrl: string) {
        await this.query(
            `UPDATE invoices SET settled_by = $2, checkout_url = $3 WHERE id = ANY($1::uuid[]) AND status = 'open'`,
            [ids, paymentId, checkoutUrl]
        )
    }

    async markPaid(id: string) {
        const rows = await this.query<Invoice>(
            `UPDATE invoices SET status = 'paid', paid_at = now(), checkout_url = NULL
        WHERE id = $1 AND status IN ('open', 'void') RETURNING ${COLUMNS}`,
            [id]
        )
        return rows[0] ?? null
    }

    markVoid(ids: string[]) {
        return this.query<Invoice>(
            `UPDATE invoices SET status = 'void', checkout_url = NULL WHERE id = ANY($1::uuid[]) AND status = 'open'
       RETURNING ${COLUMNS}`,
            [ids]
        )
    }

    listOpenPurchase(subscriptionId: string) {
        return this.query<Invoice>(
            `SELECT ${COLUMNS} FROM invoices WHERE subscription_id = $1 AND status = 'open' AND description = 'subscription'`,
            [subscriptionId]
        )
    }
}
