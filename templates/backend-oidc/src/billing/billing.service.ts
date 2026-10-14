import { randomInt } from 'node:crypto'
import { AuditService } from '../audit/audit.service.js'
import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common'
import { AppException } from '../common/app.exception.js'
import { AccountService } from '../oidc/account.service.js'
import { OIDC_STORE, type OidcStore } from '../oidc/store/oidc.store.js'
import { BillingConfig } from './billing.config.js'
import { PAYMENT_PROVIDER, type PaymentProvider, type ProviderPayment } from './payments/payment-provider.js'
import {
    BILLING_STORE,
    type BillingStore,
    type DiscountCode,
    type DiscountDuration,
    type Interval,
    type Payment,
    type Product,
    type Subscription
} from './store/billing.store.js'

const DAY = 24 * 60 * 60 * 1000
/** Renewals of the provider are fetched at most this often per subscription (when its period ended). */
const REFRESH_MS = 5 * 60 * 1000
/** Letters and digits that cannot be confused (no 0/O, 1/I/L) for generated discount codes. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** A paid subscription stays valid this long after its period while the renewal is on its way (SEPA takes days). */
const GRACE_MS = 7 * DAY

/**
 * The end of `periods` months or years after `from` (UTC), like Mollie counts: 31 January + 1 month is 28 (or 29)
 * February, never 3 March.
 */
export function addPeriods(from: Date, interval: Interval, periods = 1): Date {
    const months = interval === 'year' ? 12 * periods : periods
    const date = new Date(from)
    const day = date.getUTCDate()
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() + months)
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    date.setUTCDate(Math.min(day, last))
    return date
}

/** The price of a product for one seat and one period. */
export const unitPrice = (product: Product, interval: Interval) =>
    interval === 'year' ? product.priceYearCents : product.priceMonthCents

/** An amount after a discount (never below zero). */
export function discounted(
    cents: number,
    discount: Pick<DiscountCode, 'percentOff' | 'amountOffCents'> | null
): number {
    if (!discount) return cents
    if (discount.percentOff !== null) return cents - Math.round((cents * discount.percentOff) / 100)
    return Math.max(0, cents - (discount.amountOffCents ?? 0))
}

/**
 * Is a subscription paid (or free) right now? Canceled ones run until the end of the paid period. A renewing one
 * (active at the provider) stays valid a few days after it, while the renewal payment is on its way.
 */
export function isValid(subscription: Subscription | null, now = new Date()): subscription is Subscription {
    if (!subscription || subscription.status === 'pending') return false
    if (subscription.currentPeriodEnd === null) return subscription.status === 'active'
    const renewing =
        subscription.status === 'active' &&
        subscription.providerSubscriptionId !== null &&
        !subscription.cancelAtPeriodEnd
    return subscription.currentPeriodEnd.getTime() + (renewing ? GRACE_MS : 0) > now.getTime()
}

/** Does the subscription still get its discount (forever, or periods left)? */
const discountActive = (subscription: Subscription) =>
    subscription.discountCodeId !== null &&
    (subscription.discountPeriodsLeft === null || subscription.discountPeriodsLeft > 0)

/** A subscription without the ids of the provider and of the discount; `paid`: bought (not free with a code). */
function publicSubscription(subscription: Subscription) {
    const { providerSubscriptionId, discountCodeId: _discount, ...rest } = subscription
    return { ...rest, paid: providerSubscriptionId !== null }
}

/** Who does something: the organisation (tenant) and the account. */
export interface Actor {
    tenantId: string
    userId: string
}

/**
 * Licences per organisation, per product, per user. Every member first gets a trial (BILLING_TRIAL_DAYS, 14) for every
 * active product; after it, a seat of the organisation: paid (a subscription per month or per year through Mollie) or
 * free (a superadmin gives seats, or a 100% discount code). Admins give seats to members and take them back.
 */
@Injectable()
export class BillingService implements OnModuleInit {
    private readonly logger = new Logger(BillingService.name)
    private readonly refreshed = new Map<string, number>()

    constructor(
        @Inject(BILLING_STORE) private readonly store: BillingStore,
        @Inject(OIDC_STORE) private readonly oidc: OidcStore,
        private readonly config: BillingConfig,
        private readonly accounts: AccountService,
        private readonly audit: AuditService,
        @Optional() @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider | null
    ) {}

    onModuleInit() {
        // Every new member (registration, accepted invitation) starts with a trial of every active product
        this.accounts.onMemberJoined((tenantId, userId) => this.startTrials(tenantId, userId))
    }

    // ---------------------------------------------------------------- products

    private async product(code: string, activeOnly = true): Promise<Product> {
        const product = await this.store.findProductByCode(code)
        if (!product || (activeOnly && !product.active))
            throw new AppException('billing.PRODUCT_NOT_FOUND', HttpStatus.NOT_FOUND)
        return product
    }

    /** A year must be cheaper than twelve months. */
    private assertPrices(month: number, year: number) {
        if (year >= month * 12) throw new AppException('billing.YEAR_NOT_CHEAPER', HttpStatus.BAD_REQUEST)
    }

    async products(activeOnly = false) {
        const products = await this.store.listProducts()
        return activeOnly ? products.filter(product => product.active) : products
    }

    async createProduct(input: {
        code: string
        name: string
        description?: string
        priceMonthCents: number
        priceYearCents: number
    }) {
        this.assertPrices(input.priceMonthCents, input.priceYearCents)
        const created = await this.store.createProduct({
            code: input.code,
            name: input.name.trim(),
            description: input.description?.trim() ?? '',
            priceMonthCents: input.priceMonthCents,
            priceYearCents: input.priceYearCents,
            active: true
        })
        if (!created) throw new AppException('billing.PRODUCT_EXISTS', HttpStatus.CONFLICT)
        await this.audit.record('licences.product_created', {
            tenantId: null,
            target: { type: 'product', id: created.id },
            details: {
                product: created.code,
                priceMonthCents: created.priceMonthCents,
                priceYearCents: created.priceYearCents
            }
        })
        return created
    }

    async updateProduct(
        code: string,
        change: {
            name?: string
            description?: string
            priceMonthCents?: number
            priceYearCents?: number
            active?: boolean
        }
    ) {
        const product = await this.product(code, false)
        this.assertPrices(
            change.priceMonthCents ?? product.priceMonthCents,
            change.priceYearCents ?? product.priceYearCents
        )
        const updated = await this.store.updateProduct(product.id, {
            ...change,
            name: change.name?.trim(),
            description: change.description?.trim()
        })
        await this.audit.record('licences.product_changed', {
            tenantId: null,
            target: { type: 'product', id: product.id },
            details: {
                product: product.code,
                priceMonthCents: change.priceMonthCents,
                priceYearCents: change.priceYearCents,
                active: change.active
            }
        })
        return updated
    }

    // ---------------------------------------------------------------- trials

    /** Starts a trial of every active product for a new member (never twice for the same product). */
    async startTrials(tenantId: string, userId: string) {
        const endsAt = new Date(Date.now() + this.config.trialDays * DAY)
        for (const product of await this.products(true))
            await this.store.startTrial(tenantId, product.id, userId, endsAt)
    }

    private async assertMember(tenantId: string, userId: string) {
        if (!(await this.oidc.findMemberRole(tenantId, userId)))
            throw new AppException('billing.NOT_A_MEMBER', HttpStatus.NOT_FOUND)
    }

    /** An admin starts the trial of a member (for a member that joined before the product existed). Once per product. */
    async startTrial(tenantId: string, productCode: string, userId: string) {
        const product = await this.product(productCode)
        await this.assertMember(tenantId, userId)
        const endsAt = new Date(Date.now() + this.config.trialDays * DAY)
        if (!(await this.store.startTrial(tenantId, product.id, userId, endsAt)))
            throw new AppException('billing.TRIAL_USED', HttpStatus.CONFLICT)
        await this.audit.record('licences.trial_started', {
            tenantId,
            target: { type: 'user', id: userId },
            details: { product: product.code, endsAt: endsAt.toISOString() }
        })
        return { userId, endsAt }
    }

    /** A superadmin extends a trial by `days` (from its end, or from now when it ended); starts one when there is none. */
    async extendTrial(tenantId: string, productCode: string, userId: string, days: number) {
        const product = await this.product(productCode, false)
        await this.assertMember(tenantId, userId)
        const trial = await this.store.findTrial(tenantId, product.id, userId)
        const from = trial && trial.endsAt.getTime() > Date.now() ? trial.endsAt.getTime() : Date.now()
        const endsAt = new Date(from + days * DAY)
        if (trial) await this.store.setTrialEnd(tenantId, product.id, userId, endsAt)
        else await this.store.startTrial(tenantId, product.id, userId, endsAt)
        await this.audit.record('licences.trial_extended', {
            tenantId,
            target: { type: 'user', id: userId },
            details: { product: product.code, days, endsAt: endsAt.toISOString() }
        })
        return { userId, endsAt }
    }

    // ---------------------------------------------------------------- seats and access

    /** Paid seats (a valid subscription) and free seats (grants that did not end) of a product. */
    private async seats(tenantId: string, productId: string, now = new Date()) {
        const subscription = await this.store.findSubscription(tenantId, productId)
        if (subscription) await this.refresh(subscription)
        const current = subscription ? await this.store.findSubscription(tenantId, productId) : null
        const paid = isValid(current, now) ? current.seats : 0
        const free = (await this.store.listGrants(tenantId))
            .filter(grant => grant.productId === productId && (grant.endsAt === null || grant.endsAt > now))
            .reduce((sum, grant) => sum + grant.seats, 0)
        return { paid, free, total: paid + free, subscription: current }
    }

    /**
     * May this account use this product in this organisation right now? A superadmin always may. Otherwise: a running
     * trial, or one of the seats (the oldest assignments first, when there are fewer seats than assignments).
     */
    async access(tenantId: string, userId: string, productCode: string, superadmin = false) {
        const product = await this.store.findProductByCode(productCode)
        if (!product?.active) return { access: false as const }
        if (superadmin) return { access: true as const, via: 'superadmin' as const }
        const trial = await this.store.findTrial(tenantId, product.id, userId)
        if (trial && trial.endsAt > new Date())
            return { access: true as const, via: 'trial' as const, endsAt: trial.endsAt }
        const assignments = (await this.store.listAssignments(tenantId)).filter(item => item.productId === product.id)
        const index = assignments.findIndex(item => item.userId === userId)
        if (index < 0) return { access: false as const }
        const { total } = await this.seats(tenantId, product.id)
        return index < total ? { access: true as const, via: 'seat' as const } : { access: false as const }
    }

    /** The products of the account in its organisation (for the profile and the frontend). */
    async mine(tenantId: string, userId: string, superadmin: boolean) {
        const products = await this.products(true)
        return Promise.all(
            products.map(async product => ({
                code: product.code,
                name: product.name,
                ...(await this.access(tenantId, userId, product.code, superadmin))
            }))
        )
    }

    /** An admin gives a member a seat (paid or free). Answers 409 billing.NO_FREE_SEAT when all are in use. */
    async assign(actor: Actor, productCode: string, userId: string) {
        const product = await this.product(productCode)
        await this.assertMember(actor.tenantId, userId)
        const { total } = await this.seats(actor.tenantId, product.id)
        const result =
            total > 0 ? await this.store.assignSeat(actor.tenantId, product.id, userId, actor.userId, total) : 'full'
        if (result === 'full') throw new AppException('billing.NO_FREE_SEAT', HttpStatus.CONFLICT)
        if (result === 'ok')
            await this.audit.record('licences.seat_assigned', {
                tenantId: actor.tenantId,
                actorId: actor.userId,
                target: { type: 'user', id: userId },
                details: { product: product.code }
            })
        return { userId, assigned: true }
    }

    /** Takes a seat back: it is free for another member. */
    async unassign(tenantId: string, productCode: string, userId: string) {
        const product = await this.product(productCode, false)
        if (!(await this.store.unassignSeat(tenantId, product.id, userId)))
            throw new AppException('billing.SEAT_NOT_FOUND', HttpStatus.NOT_FOUND)
        await this.audit.record('licences.seat_unassigned', {
            tenantId,
            target: { type: 'user', id: userId },
            details: { product: product.code }
        })
        return { userId, assigned: false }
    }

    /** Everything about the licences of an organisation, per product (for its admins, and for superadmins). */
    async overview(tenantId: string) {
        const now = new Date()
        const [products, trials, assignments, grants, subscriptions] = await Promise.all([
            this.products(),
            this.store.listTrials(tenantId),
            this.store.listAssignments(tenantId),
            this.store.listGrants(tenantId),
            this.store.listSubscriptions(tenantId)
        ])
        const shown = products.filter(
            product =>
                product.active ||
                subscriptions.some(item => item.productId === product.id) ||
                grants.some(item => item.productId === product.id)
        )
        return Promise.all(
            shown.map(async product => {
                const seats = await this.seats(tenantId, product.id, now)
                const subscription = seats.subscription
                const discount = subscription?.discountCodeId
                    ? await this.store.findDiscount(subscription.discountCodeId)
                    : null
                const used = assignments.filter(item => item.productId === product.id)
                return {
                    product,
                    subscription: subscription
                        ? {
                              ...publicSubscription(subscription),
                              valid: isValid(subscription, now),
                              renewalCents:
                                  subscription.providerSubscriptionId && !subscription.cancelAtPeriodEnd
                                      ? this.recurringAmount(product, subscription, discount)
                                      : null,
                              discount: discount ? this.publicDiscount(discount) : null
                          }
                        : null,
                    grants: grants
                        .filter(item => item.productId === product.id)
                        .map(grant => ({ ...grant, valid: grant.endsAt === null || grant.endsAt > now })),
                    seats: { paid: seats.paid, free: seats.free, total: seats.total, used: used.length },
                    trials: trials
                        .filter(item => item.productId === product.id)
                        .map(trial => ({ userId: trial.userId, endsAt: trial.endsAt, active: trial.endsAt > now })),
                    assignments: used.map((item, index) => ({
                        userId: item.userId,
                        assignedAt: item.assignedAt,
                        active: index < seats.total
                    }))
                }
            })
        )
    }

    // ---------------------------------------------------------------- discount codes

    private publicDiscount(discount: DiscountCode) {
        const { code, percentOff, amountOffCents, duration, durationPeriods } = discount
        return { code, percentOff, amountOffCents, duration, durationPeriods }
    }

    /** A discount code that this organisation may use for this product, or billing.DISCOUNT_INVALID. */
    private async usableDiscount(code: string, product: Product, tenantId: string) {
        const discount = await this.store.findDiscountByCode(code.trim().toUpperCase())
        const usable =
            discount?.active &&
            (discount.productId === null || discount.productId === product.id) &&
            (discount.expiresAt === null || discount.expiresAt > new Date()) &&
            (discount.maxRedemptions === null || discount.redemptions < discount.maxRedemptions) &&
            !(await this.store.hasRedeemed(discount.id, tenantId))
        if (!usable || !discount) throw new AppException('billing.DISCOUNT_INVALID', HttpStatus.BAD_REQUEST)
        return discount
    }

    async createDiscount(
        creator: string,
        input: {
            code?: string
            percentOff?: number
            amountOffCents?: number
            productCode?: string
            duration: DiscountDuration
            durationPeriods?: number
            maxRedemptions?: number
            expiresAt?: string
        }
    ) {
        if ((input.percentOff === undefined) === (input.amountOffCents === undefined))
            throw new AppException('billing.DISCOUNT_AMOUNT', HttpStatus.BAD_REQUEST)
        if ((input.duration === 'repeating') !== (input.durationPeriods !== undefined))
            throw new AppException('billing.DISCOUNT_PERIODS', HttpStatus.BAD_REQUEST)
        const product = input.productCode ? await this.product(input.productCode, false) : null
        const code =
            input.code?.trim().toUpperCase() ||
            Array.from(
                { length: 8 },
                (_, index) => (index === 4 ? '-' : '') + CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
            ).join('')
        const created = await this.store.createDiscount({
            code,
            percentOff: input.percentOff ?? null,
            amountOffCents: input.amountOffCents ?? null,
            productId: product?.id ?? null,
            duration: input.duration,
            durationPeriods: input.durationPeriods ?? null,
            maxRedemptions: input.maxRedemptions ?? null,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            createdBy: creator
        })
        if (!created) throw new AppException('billing.DISCOUNT_EXISTS', HttpStatus.CONFLICT)
        await this.audit.record('licences.discount_created', {
            tenantId: null,
            target: { type: 'discount', id: created.id },
            details: {
                code: created.code,
                percentOff: created.percentOff,
                amountOffCents: created.amountOffCents,
                product: product?.code ?? null,
                duration: created.duration,
                periods: created.durationPeriods
            }
        })
        return created
    }

    async discounts() {
        const [discounts, products] = await Promise.all([this.store.listDiscounts(), this.store.listProducts()])
        return discounts.map(discount => ({
            ...discount,
            productCode: products.find(product => product.id === discount.productId)?.code ?? null
        }))
    }

    async setDiscountActive(code: string, active: boolean) {
        const discount = await this.store.findDiscountByCode(code.trim().toUpperCase())
        if (!discount || !(await this.store.setDiscountActive(discount.id, active)))
            throw new AppException('billing.DISCOUNT_INVALID', HttpStatus.NOT_FOUND)
        await this.audit.record('licences.discount_switched', {
            tenantId: null,
            target: { type: 'discount', id: discount.id },
            details: { code: discount.code, active }
        })
        return { code: discount.code, active }
    }

    // ---------------------------------------------------------------- free seats

    async grant(
        creator: string,
        tenantId: string,
        input: { productCode: string; seats: number; endsAt?: string; note?: string }
    ) {
        const product = await this.product(input.productCode, false)
        if (!(await this.oidc.findTenant(tenantId))) throw new AppException('errors.NOT_FOUND', HttpStatus.NOT_FOUND)
        const grant = await this.store.addGrant({
            tenantId,
            productId: product.id,
            seats: input.seats,
            endsAt: input.endsAt ? new Date(input.endsAt) : null,
            note: input.note?.trim() ?? '',
            grantedBy: creator
        })
        await this.audit.record('licences.grant_added', {
            tenantId,
            actorId: creator,
            target: { type: 'grant', id: grant.id },
            details: { product: product.code, seats: grant.seats, endsAt: grant.endsAt?.toISOString() ?? null }
        })
        return grant
    }

    async revokeGrant(tenantId: string, id: string) {
        if (!(await this.store.deleteGrant(tenantId, id)))
            throw new AppException('errors.NOT_FOUND', HttpStatus.NOT_FOUND)
        await this.audit.record('licences.grant_revoked', { tenantId, target: { type: 'grant', id } })
        return { id, deleted: true }
    }

    // ---------------------------------------------------------------- buying

    private requireProvider(): PaymentProvider {
        if (!this.provider) throw new AppException('billing.PAYMENTS_DISABLED', HttpStatus.SERVICE_UNAVAILABLE)
        return this.provider
    }

    /** What a renewal costs: the seats, with the discount while it lasts. */
    private recurringAmount(
        product: Product,
        subscription: Subscription,
        discount: DiscountCode | null,
        seats = subscription.seats
    ) {
        const base = unitPrice(product, subscription.interval) * seats
        return discountActive(subscription) && discount ? discounted(base, discount) : base
    }

    private async loadDiscount(subscription: Subscription) {
        return subscription.discountCodeId ? this.store.findDiscount(subscription.discountCodeId) : null
    }

    /** The price of a purchase, with a discount code (for the page before paying). */
    async quote(
        tenantId: string,
        input: { productCode: string; interval: Interval; seats: number; discountCode?: string }
    ) {
        const product = await this.product(input.productCode)
        const discount = input.discountCode ? await this.usableDiscount(input.discountCode, product, tenantId) : null
        const base = unitPrice(product, input.interval) * input.seats
        const first = discounted(base, discount)
        const after = discount && discount.duration !== 'once' ? first : base
        return {
            currency: product.currency,
            unitCents: unitPrice(product, input.interval),
            baseCents: base,
            firstCents: first,
            renewalCents: after,
            discount: discount ? this.publicDiscount(discount) : null
        }
    }

    /**
     * Buys seats of a product for the organisation, per month or per year. Answers the checkout of the payment provider;
     * when a discount code makes it free, the seats are there at once (no payment).
     */
    async subscribe(
        actor: Actor,
        input: { productCode: string; interval: Interval; seats: number; discountCode?: string }
    ): Promise<{ status: 'active' | 'pending'; checkoutUrl: string | null; subscriptionId: string }> {
        const product = await this.product(input.productCode)
        const found = await this.store.findSubscription(actor.tenantId, product.id)
        if (found) await this.refresh(found)
        const existing = found ? await this.store.findSubscriptionById(found.id) : null
        if (isValid(existing)) throw new AppException('billing.SUBSCRIPTION_EXISTS', HttpStatus.CONFLICT)
        if (existing) await this.replace(existing)
        const discount = input.discountCode
            ? await this.usableDiscount(input.discountCode, product, actor.tenantId)
            : null
        // The code is reserved now (also for a payment that is still open), and given back when it is not paid
        if (discount && !(await this.store.redeemDiscount(discount.id, actor.tenantId)))
            throw new AppException('billing.DISCOUNT_INVALID', HttpStatus.BAD_REQUEST)
        const first = discounted(unitPrice(product, input.interval) * input.seats, discount)

        if (first === 0 && discount) {
            // Free thanks to the code: no payment, for the periods of the code
            const periods =
                discount.duration === 'forever'
                    ? null
                    : discount.duration === 'repeating'
                      ? discount.durationPeriods
                      : 1
            const saved = await this.store.saveSubscription({
                tenantId: actor.tenantId,
                productId: product.id,
                interval: input.interval,
                seats: input.seats,
                status: 'active',
                providerSubscriptionId: null,
                currentPeriodEnd: periods === null ? null : addPeriods(new Date(), input.interval, periods ?? 1),
                cancelAtPeriodEnd: periods !== null,
                discountCodeId: discount.id,
                discountPeriodsLeft: null
            })
            await this.audit.record('licences.subscription_started', {
                tenantId: actor.tenantId,
                actorId: actor.userId,
                target: { type: 'subscription', id: saved.id },
                details: {
                    product: product.code,
                    interval: input.interval,
                    seats: input.seats,
                    code: discount.code,
                    free: true
                }
            })
            return { status: 'active', checkoutUrl: null, subscriptionId: saved.id }
        }

        try {
            const provider = this.requireProvider()
            const customerId = await this.customer(actor)
            const saved = await this.store.saveSubscription({
                tenantId: actor.tenantId,
                productId: product.id,
                interval: input.interval,
                seats: input.seats,
                status: 'pending',
                providerSubscriptionId: null,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                discountCodeId: discount?.id ?? null,
                discountPeriodsLeft: !discount
                    ? null
                    : discount.duration === 'once'
                      ? 1
                      : discount.duration === 'repeating'
                        ? discount.durationPeriods
                        : null
            })
            const payment = await provider.createPayment({
                customerId,
                amountCents: first,
                currency: product.currency,
                description: `${product.name}: ${input.seats} × ${input.interval === 'year' ? '1 year' : '1 month'}`,
                sequenceType: 'first',
                redirectUrl: `${this.config.appUrl}/licenses/return?subscription=${saved.id}`,
                webhookUrl: this.config.webhookUrl,
                metadata: { subscriptionId: saved.id, kind: 'first' }
            })
            // The newest payment of a pending subscription is the only one that can activate it
            await this.store.createPayment({
                id: payment.id,
                tenantId: actor.tenantId,
                subscriptionId: saved.id,
                kind: 'first',
                seats: input.seats,
                amountCents: first,
                status: 'open',
                periodEnd: null
            })
            await this.audit.record('licences.subscription_started', {
                tenantId: actor.tenantId,
                actorId: actor.userId,
                target: { type: 'subscription', id: saved.id },
                details: {
                    product: product.code,
                    interval: input.interval,
                    seats: input.seats,
                    code: discount?.code ?? null,
                    amountCents: first
                }
            })
            return { status: 'pending', checkoutUrl: payment.checkoutUrl, subscriptionId: saved.id }
        } catch (error) {
            if (discount) await this.store.releaseDiscount(discount.id, actor.tenantId)
            throw error
        }
    }

    /**
     * A new purchase replaces a subscription that is no longer valid: an unpaid attempt gives its discount code back
     * (its payment can no longer activate anything), and a subscription that still renews at the provider (its
     * renewal failed) is stopped there, so it never charges next to the new one.
     */
    private async replace(old: Subscription) {
        if (old.status === 'pending' && old.discountCodeId)
            await this.store.releaseDiscount(old.discountCodeId, old.tenantId)
        if (old.providerSubscriptionId && !old.cancelAtPeriodEnd && this.provider) {
            const customerId = await this.store.getCustomerId(old.tenantId)
            if (customerId) await this.provider.cancelSubscription(customerId, old.providerSubscriptionId)
            await this.store.updateSubscription(old.id, { status: 'canceled', cancelAtPeriodEnd: true })
        }
    }

    /** The customer of the organisation at the provider, created at its first purchase. */
    private async customer(actor: Actor) {
        const existing = await this.store.getCustomerId(actor.tenantId)
        if (existing) return existing
        const [tenant, user] = await Promise.all([
            this.oidc.findTenant(actor.tenantId),
            this.oidc.findUserById(actor.userId)
        ])
        const id = await this.requireProvider().createCustomer(tenant?.name ?? actor.tenantId, user?.email ?? '')
        await this.store.setCustomerId(actor.tenantId, id)
        return id
    }

    /** More or fewer paid seats. More: a payment for the rest of the period. Fewer: at once (no refund). */
    async changeSeats(actor: Actor, productCode: string, seats: number) {
        const product = await this.product(productCode)
        const subscription = await this.store.findSubscription(actor.tenantId, product.id)
        if (!isValid(subscription) || subscription.cancelAtPeriodEnd)
            throw new AppException('billing.NO_SUBSCRIPTION', HttpStatus.CONFLICT)
        if (!subscription.providerSubscriptionId || subscription.currentPeriodEnd === null)
            throw new AppException('billing.FREE_SUBSCRIPTION', HttpStatus.CONFLICT)
        // The period ended and its renewal is on its way: change the seats once it is paid
        if (subscription.currentPeriodEnd <= new Date())
            throw new AppException('billing.RENEWAL_PENDING', HttpStatus.CONFLICT)
        const discount = await this.loadDiscount(subscription)
        if (seats === subscription.seats) return { status: 'unchanged' as const, checkoutUrl: null }

        if (seats < subscription.seats) {
            const { free } = await this.seats(actor.tenantId, product.id)
            const used = (await this.store.listAssignments(actor.tenantId)).filter(
                item => item.productId === product.id
            ).length
            if (used > seats + free) throw new AppException('billing.SEATS_IN_USE', HttpStatus.CONFLICT)
            // First the provider: when it fails, nothing changed (and the customer is not charged too much)
            await this.requireProvider().updateSubscriptionAmount(
                await this.customer(actor),
                subscription.providerSubscriptionId,
                this.recurringAmount(product, subscription, discount, seats),
                product.currency
            )
            await this.store.updateSubscription(subscription.id, { seats })
            await this.audit.record('licences.subscription_seats_changed', {
                tenantId: actor.tenantId,
                actorId: actor.userId,
                target: { type: 'subscription', id: subscription.id },
                details: { product: product.code, from: subscription.seats, to: seats }
            })
            return { status: 'updated' as const, checkoutUrl: null }
        }

        // The added seats for the rest of the paid period
        const added = seats - subscription.seats
        const end = subscription.currentPeriodEnd.getTime()
        const start = addPeriods(subscription.currentPeriodEnd, subscription.interval, -1).getTime()
        const fraction = Math.min(1, Math.max(0, (end - Date.now()) / (end - start)))
        const full = unitPrice(product, subscription.interval) * added
        const percent = discountActive(subscription) && discount?.percentOff ? discount : null
        const amount = Math.max(1, Math.ceil(discounted(full, percent) * fraction))
        const payment = await this.requireProvider().createPayment({
            customerId: await this.customer(actor),
            amountCents: amount,
            currency: product.currency,
            description: `${product.name}: +${added}`,
            sequenceType: 'oneoff',
            redirectUrl: `${this.config.appUrl}/licenses/return?subscription=${subscription.id}`,
            webhookUrl: this.config.webhookUrl,
            metadata: { subscriptionId: subscription.id, kind: 'seats' }
        })
        await this.store.createPayment({
            id: payment.id,
            tenantId: actor.tenantId,
            subscriptionId: subscription.id,
            kind: 'seats',
            seats: added,
            amountCents: amount,
            status: 'open',
            // Only for this period: paid after the renewal, it adds nothing
            periodEnd: subscription.currentPeriodEnd
        })
        return { status: 'pending' as const, checkoutUrl: payment.checkoutUrl }
    }

    /** Stops the renewals: the seats stay until the end of the paid period. */
    async cancel(actor: Actor, productCode: string) {
        const product = await this.product(productCode, false)
        const subscription = await this.store.findSubscription(actor.tenantId, product.id)
        if (!isValid(subscription) || subscription.cancelAtPeriodEnd)
            throw new AppException('billing.NO_SUBSCRIPTION', HttpStatus.CONFLICT)
        if (subscription.providerSubscriptionId)
            await this.requireProvider().cancelSubscription(
                await this.customer(actor),
                subscription.providerSubscriptionId
            )
        await this.store.updateSubscription(subscription.id, {
            status: 'canceled',
            cancelAtPeriodEnd: true,
            // A free subscription without an end stops now
            currentPeriodEnd: subscription.currentPeriodEnd ?? new Date()
        })
        await this.audit.record('licences.subscription_canceled', {
            tenantId: actor.tenantId,
            actorId: actor.userId,
            target: { type: 'subscription', id: subscription.id },
            details: { product: product.code, endsAt: subscription.currentPeriodEnd?.toISOString() ?? null }
        })
        return { status: 'canceled' as const, endsAt: subscription.currentPeriodEnd }
    }

    // ---------------------------------------------------------------- payments coming back

    /**
     * The return page of the frontend asks how the payment of a subscription went (Mollie cannot call a webhook on
     * localhost): the status is fetched from the provider, never taken from the browser.
     */
    async sync(tenantId: string, subscriptionId: string) {
        const subscription = await this.store.findSubscriptionById(subscriptionId)
        if (subscription?.tenantId !== tenantId)
            throw new AppException('billing.PAYMENT_NOT_FOUND', HttpStatus.NOT_FOUND)
        const last = await this.store.lastPayment(subscriptionId)
        if (last) await this.handlePayment(last.id)
        const after = await this.store.lastPayment(subscriptionId)
        const current = await this.store.findSubscriptionById(subscriptionId)
        return { payment: after?.status ?? null, subscription: current?.status ?? null, seats: current?.seats ?? 0 }
    }

    /**
     * A payment changed (the webhook of the provider, or sync): its status is fetched from the provider. What a paid
     * payment pays for is applied once, also when the webhook comes twice.
     */
    async handlePayment(id: string) {
        const provider = this.provider
        if (!provider) return
        const remote = await provider.getPayment(id)
        if (!remote) return
        let payment = await this.store.findPayment(id)
        if (!payment && remote.subscriptionId) payment = await this.recordRenewal(remote)
        if (!payment) return
        const subscription = await this.store.findSubscriptionById(payment.subscriptionId)
        if (!subscription) return
        await this.store.setPaymentStatus(id, remote.status)
        if (remote.status === 'paid') {
            // Applied once: only one caller claims it (webhook and return page at once); a failure can be tried again
            if (!(await this.store.claimPayment(id))) return
            try {
                await this.applyPaid(subscription, payment)
                await this.store.finishPayment(id)
            } catch (error) {
                await this.store.releasePayment(id)
                throw error
            }
        } else if (['failed', 'expired', 'canceled'].includes(remote.status)) {
            if (payment.kind === 'recurring') {
                await this.store.updateSubscription(subscription.id, { status: 'past_due' })
                await this.paymentEvent('licences.subscription_past_due', subscription, payment)
            } else if (payment.kind === 'first' && (await this.isCurrentFirst(subscription, payment)))
                // Not bought: the discount code can be used again
                if (subscription.discountCodeId)
                    await this.store.releaseDiscount(subscription.discountCodeId, subscription.tenantId)
        }
    }

    /** Is this the payment that can activate the subscription (it is pending, and this is its newest payment)? */
    private async isCurrentFirst(subscription: Subscription, payment: Payment) {
        return subscription.status === 'pending' && (await this.store.lastPayment(subscription.id))?.id === payment.id
    }

    private async applyPaid(subscription: Subscription, payment: Payment) {
        if (payment.kind === 'first') {
            // An older checkout of a purchase that was replaced: it buys nothing (refund it in the Mollie dashboard)
            if (!(await this.isCurrentFirst(subscription, payment))) {
                this.logger.warn(`Payment ${payment.id} was paid for a replaced purchase: refund it`)
                return this.paymentEvent('licences.payment_refund_needed', subscription, payment)
            }
            await this.firstPaid(subscription, payment)
            return this.paymentEvent('licences.subscription_activated', subscription, payment)
        }
        if (payment.kind === 'seats') {
            const samePeriod = payment.periodEnd?.getTime() === subscription.currentPeriodEnd?.getTime()
            if (!samePeriod || subscription.cancelAtPeriodEnd || subscription.status !== 'active') {
                this.logger.warn(`Payment ${payment.id} for more seats came after its period: refund it`)
                return this.paymentEvent('licences.payment_refund_needed', subscription, payment)
            }
            await this.seatsPaid(subscription, payment)
            return this.paymentEvent('licences.subscription_seats_changed', subscription, payment, {
                from: subscription.seats,
                to: subscription.seats + payment.seats
            })
        }
        await this.renewalPaid(subscription)
        return this.paymentEvent('licences.subscription_renewed', subscription, payment)
    }

    /** A payment that came in (the provider, not a person: no actor). */
    private paymentEvent(
        action:
            | 'licences.subscription_activated'
            | 'licences.subscription_seats_changed'
            | 'licences.subscription_renewed'
            | 'licences.subscription_past_due'
            | 'licences.payment_refund_needed',
        subscription: Subscription,
        payment: Payment,
        extra: Record<string, number> = {}
    ) {
        return this.audit.record(action, {
            tenantId: subscription.tenantId,
            actorId: null,
            target: { type: 'subscription', id: subscription.id },
            details: { payment: payment.id, amountCents: payment.amountCents, seats: payment.seats, ...extra }
        })
    }

    /** A renewal the provider made by itself: stored as a payment of the subscription. */
    private async recordRenewal(remote: ProviderPayment): Promise<Payment | null> {
        const subscription = await this.store.findSubscriptionByProviderId(remote.subscriptionId ?? '')
        if (!subscription) return null
        await this.store.createPayment({
            id: remote.id,
            tenantId: subscription.tenantId,
            subscriptionId: subscription.id,
            kind: 'recurring',
            seats: subscription.seats,
            amountCents: remote.amountCents,
            status: 'open',
            periodEnd: null
        })
        return this.store.findPayment(remote.id)
    }

    private async firstPaid(subscription: Subscription, payment: Payment) {
        const product = await this.store.findProduct(subscription.productId)
        if (!product) return
        const discount = await this.loadDiscount(subscription)
        const periodEnd = addPeriods(new Date(), subscription.interval)
        const left = subscription.discountPeriodsLeft === null ? null : subscription.discountPeriodsLeft - 1
        const next = { ...subscription, discountPeriodsLeft: left }
        const customerId = await this.store.getCustomerId(subscription.tenantId)
        const providerSubscriptionId = await this.requireProvider().createSubscription({
            customerId: customerId ?? '',
            amountCents: Math.max(1, this.recurringAmount(product, next, discount)),
            currency: product.currency,
            interval: subscription.interval,
            startDate: periodEnd.toISOString().slice(0, 10),
            // Unique per customer at Mollie: a new purchase after a cancel gets its own
            description: `${product.name} (${payment.id})`,
            webhookUrl: this.config.webhookUrl,
            metadata: { subscriptionId: subscription.id },
            // A retry (the database failed after Mollie answered) gets the same subscription
            idempotencyKey: `subscription-${payment.id}`
        })
        await this.store.updateSubscription(subscription.id, {
            status: 'active',
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
            providerSubscriptionId,
            discountPeriodsLeft: left
        })
        this.logger.log(
            `Subscription ${subscription.id} paid: ${subscription.seats} seats until ${periodEnd.toISOString()}`
        )
    }

    // The provider is changed first and the database after it: a failure in between is tried again (the payment is
    // released), and setting the same amount twice at the provider changes nothing.

    private async seatsPaid(subscription: Subscription, payment: Payment) {
        const product = await this.store.findProduct(subscription.productId)
        if (!product) return
        const seats = subscription.seats + payment.seats
        const customerId = await this.store.getCustomerId(subscription.tenantId)
        if (subscription.providerSubscriptionId && customerId)
            await this.requireProvider().updateSubscriptionAmount(
                customerId,
                subscription.providerSubscriptionId,
                this.recurringAmount(product, subscription, await this.loadDiscount(subscription), seats),
                product.currency
            )
        await this.store.updateSubscription(subscription.id, { seats })
    }

    private async renewalPaid(subscription: Subscription) {
        const product = await this.store.findProduct(subscription.productId)
        if (!product) return
        const from = subscription.currentPeriodEnd ?? new Date()
        const left =
            subscription.discountPeriodsLeft === null ? null : Math.max(0, subscription.discountPeriodsLeft - 1)
        // The last discounted period is paid: from now on the full price
        const customerId = await this.store.getCustomerId(subscription.tenantId)
        if (left === 0 && subscription.discountPeriodsLeft !== 0 && subscription.providerSubscriptionId && customerId)
            await this.requireProvider().updateSubscriptionAmount(
                customerId,
                subscription.providerSubscriptionId,
                unitPrice(product, subscription.interval) * subscription.seats,
                product.currency
            )
        await this.store.updateSubscription(subscription.id, {
            status: subscription.cancelAtPeriodEnd ? 'canceled' : 'active',
            currentPeriodEnd: addPeriods(from, subscription.interval),
            discountPeriodsLeft: left
        })
    }

    /**
     * When the paid period of a subscription ended, asks the provider for its renewals (also without a webhook): a
     * renewal that was paid extends the period. At most once every 5 minutes per subscription.
     */
    private async refresh(subscription: Subscription) {
        if (!this.provider || !subscription.providerSubscriptionId || subscription.currentPeriodEnd === null) return
        if (subscription.currentPeriodEnd > new Date()) return
        const last = this.refreshed.get(subscription.id) ?? 0
        if (Date.now() - last < REFRESH_MS) return
        this.refreshed.set(subscription.id, Date.now())
        const customerId = await this.store.getCustomerId(subscription.tenantId)
        if (!customerId) return
        try {
            const payments = await this.provider.listSubscriptionPayments(
                customerId,
                subscription.providerSubscriptionId
            )
            for (const payment of [...payments].reverse()) await this.handlePayment(payment.id)
        } catch (error) {
            this.logger.warn(
                'Could not fetch the renewals: ' + (error instanceof Error ? error.message : String(error))
            )
        }
    }
}
