import { Injectable } from '@nestjs/common'
import type { QueryResultRow } from 'pg'
import { DatabaseService } from '../../database/database.service.js'
import {
    CATALOG_DEFAULTS,
    type Assignment,
    type AssignResult,
    type BillingStore,
    type DiscountCode,
    type Environment,
    type Grant,
    type NewDiscountCode,
    type NewProduct,
    type NewPayment,
    type Payment,
    type Product,
    type Subscription,
    type Trial
} from './billing.store.js'

const PRODUCT_COLUMNS =
    'id, code, name, description, price_month_cents AS "priceMonthCents", price_year_cents AS "priceYearCents", ' +
    'currency, active, created_at AS "createdAt", icon, category, short_description AS "short", features, color, ' +
    'requires_vault AS "requiresVault", demo_enabled AS "demoEnabled", launch_url AS "launchUrl", sort'
const DISCOUNT_COLUMNS =
    'id, code, percent_off AS "percentOff", amount_off_cents AS "amountOffCents", product_id AS "productId", duration, ' +
    'duration_periods AS "durationPeriods", max_redemptions AS "maxRedemptions", redemptions, expires_at AS "expiresAt", ' +
    'active, created_at AS "createdAt"'
const SUBSCRIPTION_COLUMNS =
    'id, tenant_id AS "tenantId", product_id AS "productId", interval, seats, status, ' +
    'provider_subscription_id AS "providerSubscriptionId", current_period_end AS "currentPeriodEnd", ' +
    'cancel_at_period_end AS "cancelAtPeriodEnd", discount_code_id AS "discountCodeId", ' +
    'discount_periods_left AS "discountPeriodsLeft", environment_name AS "environmentName", region'
const GRANT_COLUMNS =
    'id, tenant_id AS "tenantId", product_id AS "productId", seats, ends_at AS "endsAt", note, created_at AS "createdAt"'
const TRIAL_COLUMNS =
    'tenant_id AS "tenantId", product_id AS "productId", user_id AS "userId", started_at AS "startedAt", ends_at AS "endsAt"'
const PAYMENT_COLUMNS =
    'id, tenant_id AS "tenantId", subscription_id AS "subscriptionId", kind, seats, amount_cents AS "amountCents", status, ' +
    'period_end AS "periodEnd", created_at AS "createdAt", paid_at AS "paidAt", applied_at AS "appliedAt"'

/** Column names of the subscription fields that can change. */
const SUBSCRIPTION_FIELDS: Record<string, string> = {
    interval: 'interval',
    seats: 'seats',
    status: 'status',
    providerSubscriptionId: 'provider_subscription_id',
    currentPeriodEnd: 'current_period_end',
    cancelAtPeriodEnd: 'cancel_at_period_end',
    discountCodeId: 'discount_code_id',
    discountPeriodsLeft: 'discount_periods_left',
    environmentName: 'environment_name',
    region: 'region'
}
const PRODUCT_FIELDS: Record<string, string> = {
    name: 'name',
    description: 'description',
    priceMonthCents: 'price_month_cents',
    priceYearCents: 'price_year_cents',
    active: 'active',
    icon: 'icon',
    category: 'category',
    short: 'short_description',
    features: 'features',
    color: 'color',
    requiresVault: 'requires_vault',
    demoEnabled: 'demo_enabled',
    launchUrl: 'launch_url',
    sort: 'sort'
}

/** "SET a = $2, b = $3" from the fields that are given (undefined fields stay as they are). */
function setClause(change: Record<string, unknown>, columns: Record<string, string>) {
    const entries = Object.entries(change).filter(([key, value]) => value !== undefined && columns[key])
    return {
        sql: entries.map(([key], index) => `${columns[key]} = $${index + 2}`).join(', '),
        values: entries.map(([, value]) => value)
    }
}

/**
 * Licences and payments in PostgreSQL. Runs as the owner of the tables (platform code: webhooks of the payment
 * provider come without a tenant); every query that belongs to an organisation has its tenant_id in the WHERE.
 */
@Injectable()
export class PgBillingStore implements BillingStore {
    constructor(private readonly database: DatabaseService) {}

    private async query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<T[]> {
        await this.database.ready()
        return (await this.database.query<T>(text, params)).rows
    }

    // ---------------------------------------------------------------- products

    listProducts() {
        return this.query<Product>(`SELECT ${PRODUCT_COLUMNS} FROM license_products ORDER BY lower(name)`)
    }

    async findProduct(id: string) {
        return (
            (await this.query<Product>(`SELECT ${PRODUCT_COLUMNS} FROM license_products WHERE id = $1`, [id]))[0] ??
            null
        )
    }

    async findProductByCode(code: string) {
        const rows = await this.query<Product>(`SELECT ${PRODUCT_COLUMNS} FROM license_products WHERE code = $1`, [
            code
        ])
        return rows[0] ?? null
    }

    async createProduct(product: NewProduct) {
        const rows = await this.query<Product>(
            `INSERT INTO license_products (code, name, description, price_month_cents, price_year_cents, active, icon,
                               category, short_description, features, color, requires_vault, demo_enabled, launch_url,
                               sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (code) DO NOTHING RETURNING ${PRODUCT_COLUMNS}`,
            [
                product.code,
                product.name,
                product.description,
                product.priceMonthCents,
                product.priceYearCents,
                product.active,
                product.icon ?? CATALOG_DEFAULTS.icon,
                product.category ?? CATALOG_DEFAULTS.category,
                product.short ?? CATALOG_DEFAULTS.short,
                JSON.stringify(product.features ?? CATALOG_DEFAULTS.features),
                product.color ?? CATALOG_DEFAULTS.color,
                product.requiresVault ?? CATALOG_DEFAULTS.requiresVault,
                product.demoEnabled ?? CATALOG_DEFAULTS.demoEnabled,
                product.launchUrl ?? CATALOG_DEFAULTS.launchUrl,
                product.sort ?? CATALOG_DEFAULTS.sort
            ]
        )
        return rows[0] ?? null
    }

    async updateProduct(id: string, change: Partial<Omit<NewProduct, 'code'>>) {
        // jsonb: pg would send a JavaScript array as a PostgreSQL array
        const { sql, values } = setClause(
            { ...change, features: change.features && JSON.stringify(change.features) },
            PRODUCT_FIELDS
        )
        if (!sql) return this.findProduct(id)
        const rows = await this.query<Product>(
            `UPDATE license_products SET ${sql} WHERE id = $1 RETURNING ${PRODUCT_COLUMNS}`,
            [id, ...values]
        )
        return rows[0] ?? null
    }

    async deleteProduct(id: string) {
        const rows = await this.query<{ deleted: boolean; found: boolean }>(
            `WITH removed AS (
                 DELETE FROM license_products
                 WHERE id = $1
                   AND NOT EXISTS (SELECT 1 FROM tenant_subscriptions WHERE product_id = $1 AND status <> 'canceled')
                 RETURNING id
             )
             SELECT EXISTS (SELECT 1 FROM removed) AS deleted,
                    EXISTS (SELECT 1 FROM license_products WHERE id = $1) OR EXISTS (SELECT 1 FROM removed) AS found`,
            [id]
        )
        if (rows[0]?.deleted) return 'deleted'
        return rows[0]?.found ? 'in_use' : 'missing'
    }

    // ---------------------------------------------------------------- discount codes

    listDiscounts() {
        return this.query<DiscountCode>(`SELECT ${DISCOUNT_COLUMNS} FROM discount_codes ORDER BY created_at DESC`)
    }

    async findDiscountByCode(code: string) {
        const rows = await this.query<DiscountCode>(`SELECT ${DISCOUNT_COLUMNS} FROM discount_codes WHERE code = $1`, [
            code
        ])
        return rows[0] ?? null
    }

    async findDiscount(id: string) {
        const rows = await this.query<DiscountCode>(`SELECT ${DISCOUNT_COLUMNS} FROM discount_codes WHERE id = $1`, [
            id
        ])
        return rows[0] ?? null
    }

    async createDiscount(discount: NewDiscountCode) {
        const rows = await this.query<DiscountCode>(
            `INSERT INTO discount_codes (code, percent_off, amount_off_cents, product_id, duration, duration_periods,
                                   max_redemptions, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (code) DO NOTHING RETURNING ${DISCOUNT_COLUMNS}`,
            [
                discount.code,
                discount.percentOff,
                discount.amountOffCents,
                discount.productId,
                discount.duration,
                discount.durationPeriods,
                discount.maxRedemptions,
                discount.expiresAt,
                discount.createdBy
            ]
        )
        return rows[0] ?? null
    }

    async setDiscountActive(id: string, active: boolean) {
        return (
            (await this.query('UPDATE discount_codes SET active = $2 WHERE id = $1 RETURNING 1', [id, active])).length >
            0
        )
    }

    async redeemDiscount(discountId: string, tenantId: string) {
        await this.database.ready()
        return this.database.transaction(async db => {
            // The row lock makes two redemptions at once count one after the other
            const { rows } = await db.query<{ ok: boolean }>(
                `SELECT max_redemptions IS NULL OR redemptions < max_redemptions AS ok FROM discount_codes WHERE id = $1 FOR UPDATE`,
                [discountId]
            )
            if (!rows[0]?.ok) return false
            const inserted = await db.query(
                `INSERT INTO discount_redemptions (discount_code_id, tenant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1`,
                [discountId, tenantId]
            )
            if (inserted.rows.length === 0) return false
            await db.query('UPDATE discount_codes SET redemptions = redemptions + 1 WHERE id = $1', [discountId])
            return true
        })
    }

    async releaseDiscount(discountId: string, tenantId: string) {
        await this.database.ready()
        return this.database.transaction(async db => {
            const deleted = await db.query(
                'DELETE FROM discount_redemptions WHERE discount_code_id = $1 AND tenant_id = $2 RETURNING 1',
                [discountId, tenantId]
            )
            if (deleted.rows.length === 0) return false
            await db.query('UPDATE discount_codes SET redemptions = redemptions - 1 WHERE id = $1', [discountId])
            return true
        })
    }

    async hasRedeemed(discountId: string, tenantId: string) {
        const rows = await this.query(
            'SELECT 1 FROM discount_redemptions WHERE discount_code_id = $1 AND tenant_id = $2',
            [discountId, tenantId]
        )
        return rows.length > 0
    }

    // ---------------------------------------------------------------- customers and subscriptions

    async getCustomerId(tenantId: string) {
        const rows = await this.query<{ id: string | null }>(
            'SELECT payment_customer_id AS id FROM tenants WHERE id = $1',
            [tenantId]
        )
        return rows[0]?.id ?? null
    }

    async setCustomerId(tenantId: string, customerId: string) {
        await this.query('UPDATE tenants SET payment_customer_id = $2 WHERE id = $1', [tenantId, customerId])
    }

    listEnvironments(tenantId: string) {
        return this.query<Environment>(
            `SELECT product_id AS "productId", environment_name AS name, region, created_at AS since
         FROM tenant_subscriptions WHERE tenant_id = $1`,
            [tenantId]
        )
    }

    async listAllOwnership() {
        const [subscriptions, grants] = await Promise.all([
            this.query<Subscription>(`SELECT ${SUBSCRIPTION_COLUMNS} FROM tenant_subscriptions`),
            this.query<Grant>(`SELECT ${GRANT_COLUMNS} FROM license_grants`)
        ])
        return { subscriptions, grants }
    }

    listSubscriptions(tenantId: string) {
        return this.query<Subscription>(
            `SELECT ${SUBSCRIPTION_COLUMNS} FROM tenant_subscriptions WHERE tenant_id = $1`,
            [tenantId]
        )
    }

    async findSubscription(tenantId: string, productId: string) {
        const rows = await this.query<Subscription>(
            `SELECT ${SUBSCRIPTION_COLUMNS} FROM tenant_subscriptions WHERE tenant_id = $1 AND product_id = $2`,
            [tenantId, productId]
        )
        return rows[0] ?? null
    }

    async findSubscriptionById(id: string) {
        const rows = await this.query<Subscription>(
            `SELECT ${SUBSCRIPTION_COLUMNS} FROM tenant_subscriptions WHERE id = $1`,
            [id]
        )
        return rows[0] ?? null
    }

    async findSubscriptionByProviderId(providerSubscriptionId: string) {
        const rows = await this.query<Subscription>(
            `SELECT ${SUBSCRIPTION_COLUMNS} FROM tenant_subscriptions WHERE provider_subscription_id = $1`,
            [providerSubscriptionId]
        )
        return rows[0] ?? null
    }

    async saveSubscription(subscription: Omit<Subscription, 'id'>) {
        const rows = await this.query<Subscription>(
            `INSERT INTO tenant_subscriptions (tenant_id, product_id, interval, seats, status, provider_subscription_id,
                                         current_period_end, cancel_at_period_end, discount_code_id, discount_periods_left,
                                         environment_name, region)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (tenant_id, product_id) DO UPDATE SET interval = EXCLUDED.interval, seats = EXCLUDED.seats,
         status = EXCLUDED.status, provider_subscription_id = EXCLUDED.provider_subscription_id,
         current_period_end = EXCLUDED.current_period_end, cancel_at_period_end = EXCLUDED.cancel_at_period_end,
         discount_code_id = EXCLUDED.discount_code_id, discount_periods_left = EXCLUDED.discount_periods_left,
         environment_name = EXCLUDED.environment_name, region = EXCLUDED.region, updated_at = now()
       RETURNING ${SUBSCRIPTION_COLUMNS}`,
            [
                subscription.tenantId,
                subscription.productId,
                subscription.interval,
                subscription.seats,
                subscription.status,
                subscription.providerSubscriptionId,
                subscription.currentPeriodEnd,
                subscription.cancelAtPeriodEnd,
                subscription.discountCodeId,
                subscription.discountPeriodsLeft,
                subscription.environmentName ?? null,
                subscription.region ?? null
            ]
        )
        return rows[0] as Subscription
    }

    async updateSubscription(id: string, change: Partial<Omit<Subscription, 'id' | 'tenantId' | 'productId'>>) {
        const { sql, values } = setClause(change, SUBSCRIPTION_FIELDS)
        if (!sql) return
        await this.query(`UPDATE tenant_subscriptions SET ${sql}, updated_at = now() WHERE id = $1`, [id, ...values])
    }

    // ---------------------------------------------------------------- free seats

    listGrants(tenantId: string) {
        return this.query<Grant>(
            `SELECT ${GRANT_COLUMNS} FROM license_grants WHERE tenant_id = $1 ORDER BY created_at`,
            [tenantId]
        )
    }

    async addGrant(grant: Omit<Grant, 'id' | 'createdAt'> & { grantedBy: string }) {
        const rows = await this.query<Grant>(
            `INSERT INTO license_grants (tenant_id, product_id, seats, ends_at, note, granted_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${GRANT_COLUMNS}`,
            [grant.tenantId, grant.productId, grant.seats, grant.endsAt, grant.note, grant.grantedBy]
        )
        return rows[0] as Grant
    }

    async deleteGrant(tenantId: string, id: string) {
        const rows = await this.query('DELETE FROM license_grants WHERE tenant_id = $1 AND id = $2 RETURNING 1', [
            tenantId,
            id
        ])
        return rows.length > 0
    }

    // ---------------------------------------------------------------- trials and seats

    listTrials(tenantId: string) {
        return this.query<Trial>(`SELECT ${TRIAL_COLUMNS} FROM license_trials WHERE tenant_id = $1`, [tenantId])
    }

    async findTrial(tenantId: string, productId: string, userId: string) {
        const rows = await this.query<Trial>(
            `SELECT ${TRIAL_COLUMNS} FROM license_trials WHERE tenant_id = $1 AND product_id = $2 AND user_id = $3`,
            [tenantId, productId, userId]
        )
        return rows[0] ?? null
    }

    async startTrial(tenantId: string, productId: string, userId: string, endsAt: Date) {
        const rows = await this.query(
            `INSERT INTO license_trials (tenant_id, product_id, user_id, ends_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING 1`,
            [tenantId, productId, userId, endsAt]
        )
        return rows.length > 0
    }

    async setTrialEnd(tenantId: string, productId: string, userId: string, endsAt: Date) {
        const rows = await this.query(
            'UPDATE license_trials SET ends_at = $4 WHERE tenant_id = $1 AND product_id = $2 AND user_id = $3 RETURNING 1',
            [tenantId, productId, userId, endsAt]
        )
        return rows.length > 0
    }

    listAssignments(tenantId: string) {
        return this.query<Assignment>(
            `SELECT tenant_id AS "tenantId", product_id AS "productId", user_id AS "userId", assigned_at AS "assignedAt"
         FROM license_assignments WHERE tenant_id = $1 ORDER BY assigned_at`,
            [tenantId]
        )
    }

    async assignSeat(tenantId: string, productId: string, userId: string, assignedBy: string, seats: number) {
        await this.database.ready()
        return this.database.transaction<AssignResult>(async db => {
            // One lock per organisation and product: two seats given at the same moment are counted one after the other
            await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`seats:${tenantId}:${productId}`])
            const { rows } = await db.query<{ userId: string }>(
                'SELECT user_id AS "userId" FROM license_assignments WHERE tenant_id = $1 AND product_id = $2',
                [tenantId, productId]
            )
            if (rows.some(row => row.userId === userId)) return 'exists'
            if (rows.length >= seats) return 'full'
            await db.query(
                'INSERT INTO license_assignments (tenant_id, product_id, user_id, assigned_by) VALUES ($1, $2, $3, $4)',
                [tenantId, productId, userId, assignedBy]
            )
            return 'ok'
        })
    }

    async unassignSeat(tenantId: string, productId: string, userId: string) {
        const rows = await this.query(
            'DELETE FROM license_assignments WHERE tenant_id = $1 AND product_id = $2 AND user_id = $3 RETURNING 1',
            [tenantId, productId, userId]
        )
        return rows.length > 0
    }

    // ---------------------------------------------------------------- payments

    async createPayment(payment: NewPayment) {
        await this.query(
            `INSERT INTO billing_payments (id, tenant_id, subscription_id, kind, seats, amount_cents, status, period_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
            [
                payment.id,
                payment.tenantId,
                payment.subscriptionId,
                payment.kind,
                payment.seats,
                payment.amountCents,
                payment.status,
                payment.periodEnd
            ]
        )
    }

    async findPayment(id: string) {
        return (
            (await this.query<Payment>(`SELECT ${PAYMENT_COLUMNS} FROM billing_payments WHERE id = $1`, [id]))[0] ??
            null
        )
    }

    async lastPayment(subscriptionId: string) {
        const rows = await this.query<Payment>(
            `SELECT ${PAYMENT_COLUMNS} FROM billing_payments WHERE subscription_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [subscriptionId]
        )
        return rows[0] ?? null
    }

    async setPaymentStatus(id: string, status: string) {
        await this.query(
            `UPDATE billing_payments SET status = $2,
              paid_at = CASE WHEN $2 = 'paid' AND paid_at IS NULL THEN now() ELSE paid_at END
        WHERE id = $1`,
            [id, status]
        )
    }

    async claimPayment(id: string) {
        // One UPDATE: two callers at the same time never both get the row
        const rows = await this.query(
            `UPDATE billing_payments SET applying_until = now() + interval '2 minutes'
        WHERE id = $1 AND status = 'paid' AND applied_at IS NULL AND (applying_until IS NULL OR applying_until < now())
        RETURNING 1`,
            [id]
        )
        return rows.length === 1
    }

    async finishPayment(id: string) {
        await this.query('UPDATE billing_payments SET applied_at = now(), applying_until = NULL WHERE id = $1', [id])
    }

    async releasePayment(id: string) {
        await this.query('UPDATE billing_payments SET applying_until = NULL WHERE id = $1', [id])
    }
}
