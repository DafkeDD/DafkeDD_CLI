import { Injectable } from '@nestjs/common'
import type { QueryResultRow } from 'pg'
import { DatabaseService } from '../database/database.service.js'
import type { StatsData, StatsStore } from './stats.store.js'

/** The statistics of the platform from PostgreSQL, as the owner of the tables (superadmins: every organisation). */
@Injectable()
export class PgStatsStore implements StatsStore {
    constructor(private readonly database: DatabaseService) {}

    private async query<T extends QueryResultRow>(text: string): Promise<T[]> {
        return (await this.database.query<T>(text)).rows
    }

    async load(): Promise<StatsData> {
        await this.database.ready()
        const [tenants, members, subscriptions, grants, payments, products, discounts] = await Promise.all([
            this.query<StatsData['tenants'][number]>('SELECT id, created_at AS "createdAt" FROM tenants'),
            this.query<StatsData['members'][number]>(
                'SELECT created_at AS "createdAt", last_seen_at AS "lastSeenAt" FROM tenant_members'
            ),
            this.query<StatsData['subscriptions'][number]>(
                `SELECT id, tenant_id AS "tenantId", product_id AS "productId", interval, seats, status,
                provider_subscription_id AS "providerSubscriptionId", current_period_end AS "currentPeriodEnd",
                cancel_at_period_end AS "cancelAtPeriodEnd", discount_code_id AS "discountCodeId",
                discount_periods_left AS "discountPeriodsLeft", created_at AS "createdAt"
           FROM tenant_subscriptions`
            ),
            this.query<StatsData['grants'][number]>(
                `SELECT id, tenant_id AS "tenantId", product_id AS "productId", seats, ends_at AS "endsAt", note,
                created_at AS "createdAt" FROM license_grants`
            ),
            this.query<StatsData['payments'][number]>(
                `SELECT paid_at AS "paidAt", amount_cents AS "amountCents" FROM invoices
          WHERE status = 'paid' AND paid_at IS NOT NULL`
            ),
            this.query<StatsData['products'][number]>('SELECT id, code, name, color FROM license_products'),
            this.query<StatsData['discounts'][number]>('SELECT code, redemptions FROM discount_codes')
        ])
        return { tenants, members, subscriptions, grants, payments, products, discounts }
    }
}
