/** Everything the licences and payments store. PgBillingStore keeps it in PostgreSQL, MemoryBillingStore in memory (tests). */
export const BILLING_STORE = Symbol('BILLING_STORE')

export type Interval = 'month' | 'year'
export const INTERVALS: readonly Interval[] = ['month', 'year']

/** How a product looks in the app catalogue. */
export interface ProductCatalog {
    /** An icon key: checklist, calendar, invoice, users, idcard, euro, roster, box, ... */
    icon: string
    category: string
    /** The line on its card (description is the long text). */
    short: string
    features: string[]
    /** Hex colour (#0d9488), or null. */
    color: string | null
    /** Needs the eHealth vault (an eHealth certificate of a doctor). */
    requiresVault: boolean
    /** Customers can try it for free (a trial; a member has to ask it). A superadmin can always give one. */
    demoEnabled: boolean
    /** Where the app opens; may contain {slug} (the slug of the organisation). */
    launchUrl: string | null
    /** Lower first in the catalogue (then by name). */
    sort: number
}

export const CATALOG_DEFAULTS: ProductCatalog = {
    icon: 'box',
    category: '',
    short: '',
    features: [],
    color: null,
    requiresVault: false,
    demoEnabled: true,
    launchUrl: null,
    sort: 0
}

/** A product that is sold per user (seat), per organisation. Prices in cents, as charged. */
export interface Product extends ProductCatalog {
    id: string
    code: string
    name: string
    description: string
    priceMonthCents: number
    priceYearCents: number
    currency: string
    active: boolean
    createdAt: Date
}

/** A new product; the catalogue fields left out get CATALOG_DEFAULTS. */
export type NewProduct = Omit<Product, 'id' | 'createdAt' | 'currency' | keyof ProductCatalog> & Partial<ProductCatalog>

export type SubscriptionStatus = 'pending' | 'active' | 'past_due' | 'canceled'

/** The paid seats of an organisation for one product. */
export interface Subscription {
    id: string
    tenantId: string
    productId: string
    interval: Interval
    seats: number
    status: SubscriptionStatus
    /** The subscription at the payment provider (null: free, or the first payment is not paid yet). */
    providerSubscriptionId: string | null
    /** Paid (or free) until then; null while pending, or forever (a 100% discount forever). */
    currentPeriodEnd: Date | null
    cancelAtPeriodEnd: boolean
    discountCodeId: string | null
    /** Periods that still get the discount: null means forever (or no discount). */
    discountPeriodsLeft: number | null
    /** The practice name chosen at the purchase (where the app runs). */
    environmentName?: string | null
    /** The region it runs in: eu-west-1, eu-west-3 or eu-central-1. */
    region?: string | null
}

export type DiscountDuration = 'once' | 'repeating' | 'forever'

export interface DiscountCode {
    id: string
    code: string
    /** 1 to 100; or amountOffCents. */
    percentOff: number | null
    amountOffCents: number | null
    /** null: every product. */
    productId: string | null
    duration: DiscountDuration
    /** Only for `repeating`: how many periods. */
    durationPeriods: number | null
    maxRedemptions: number | null
    redemptions: number
    expiresAt: Date | null
    active: boolean
    createdAt: Date
}

export type NewDiscountCode = Omit<DiscountCode, 'id' | 'redemptions' | 'createdAt' | 'active'> & { createdBy: string }

/** Free seats a superadmin gives an organisation. */
export interface Grant {
    id: string
    tenantId: string
    productId: string
    seats: number
    /** null: for good. */
    endsAt: Date | null
    note: string
    createdAt: Date
}

export interface Trial {
    tenantId: string
    productId: string
    userId: string
    startedAt: Date
    endsAt: Date
}

/** A seat in use. */
export interface Assignment {
    tenantId: string
    productId: string
    userId: string
    assignedAt: Date
}

/** invoices: one payment of all open invoices of an organisation (no subscription). */
export type PaymentKind = 'first' | 'seats' | 'recurring' | 'invoices'

export interface Payment {
    /** The id of the payment provider (tr_...). */
    id: string
    tenantId: string
    /** null for a payment of open invoices (kind invoices). */
    subscriptionId: string | null
    kind: PaymentKind
    /** first: the seats bought; seats: the seats added; recurring: the seats paid for. */
    seats: number
    amountCents: number
    status: string
    /** seats: the end of the period the price was for (null for the other kinds). */
    periodEnd: Date | null
    createdAt: Date
    paidAt: Date | null
    /** When what it paid for was applied (once). */
    appliedAt: Date | null
}

/** A new payment: what the provider created, before anything comes back. */
export type NewPayment = Omit<Payment, 'createdAt' | 'paidAt' | 'appliedAt'>

/** Result of giving someone a seat. */
export type AssignResult = 'ok' | 'exists' | 'full'

/** Where the app of a subscription runs: the practice name and region chosen at the purchase, and since when. */
export interface Environment {
    productId: string
    name: string | null
    region: string | null
    since: Date | null
}

export interface BillingStore {
    // ---------------------------------------------------------------- products
    listProducts(): Promise<Product[]>
    findProduct(id: string): Promise<Product | null>
    findProductByCode(code: string): Promise<Product | null>
    /** null when the code exists already. */
    createProduct(product: NewProduct): Promise<Product | null>
    updateProduct(id: string, change: Partial<Omit<NewProduct, 'code'>>): Promise<Product | null>
    /** 'in_use' while an organisation still has a running subscription; free seats, trials and assignments go along. */
    deleteProduct(id: string): Promise<'deleted' | 'in_use' | 'missing'>

    // ---------------------------------------------------------------- discount codes
    listDiscounts(): Promise<DiscountCode[]>
    findDiscountByCode(code: string): Promise<DiscountCode | null>
    findDiscount(id: string): Promise<DiscountCode | null>
    /** null when the code exists already. */
    createDiscount(discount: NewDiscountCode): Promise<DiscountCode | null>
    setDiscountActive(id: string, active: boolean): Promise<boolean>
    /** Uses a code for an organisation: false when it did already, or the code has no redemptions left (under a lock). */
    redeemDiscount(discountId: string, tenantId: string): Promise<boolean>
    hasRedeemed(discountId: string, tenantId: string): Promise<boolean>
    /** Gives a reserved redemption back (the purchase was not paid). False when there was none. */
    releaseDiscount(discountId: string, tenantId: string): Promise<boolean>

    // ---------------------------------------------------------------- customers and subscriptions
    getCustomerId(tenantId: string): Promise<string | null>
    setCustomerId(tenantId: string, customerId: string): Promise<void>
    listSubscriptions(tenantId: string): Promise<Subscription[]>
    /** The environment of every subscription of an organisation (the app catalogue). */
    listEnvironments(tenantId: string): Promise<Environment[]>
    /** Every subscription and grant of every organisation (superadmins: which apps each one has). */
    listAllOwnership(): Promise<{ subscriptions: Subscription[]; grants: Grant[] }>
    findSubscription(tenantId: string, productId: string): Promise<Subscription | null>
    findSubscriptionById(id: string): Promise<Subscription | null>
    findSubscriptionByProviderId(providerSubscriptionId: string): Promise<Subscription | null>
    /** Creates the subscription of an organisation for a product, or starts the existing one over (a new purchase). */
    saveSubscription(subscription: Omit<Subscription, 'id'>): Promise<Subscription>
    updateSubscription(id: string, change: Partial<Omit<Subscription, 'id' | 'tenantId' | 'productId'>>): Promise<void>

    // ---------------------------------------------------------------- free seats
    listGrants(tenantId: string): Promise<Grant[]>
    addGrant(grant: Omit<Grant, 'id' | 'createdAt'> & { grantedBy: string }): Promise<Grant>
    deleteGrant(tenantId: string, id: string): Promise<boolean>

    // ---------------------------------------------------------------- trials and seats
    listTrials(tenantId: string): Promise<Trial[]>
    findTrial(tenantId: string, productId: string, userId: string): Promise<Trial | null>
    /** Starts a trial; false when this user had one for this product in this organisation already. */
    startTrial(tenantId: string, productId: string, userId: string, endsAt: Date): Promise<boolean>
    setTrialEnd(tenantId: string, productId: string, userId: string, endsAt: Date): Promise<boolean>
    /** Seats in use, oldest first. */
    listAssignments(tenantId: string): Promise<Assignment[]>
    /** Gives a seat, when fewer than `seats` are in use (under a lock: two at once can never go over). */
    assignSeat(
        tenantId: string,
        productId: string,
        userId: string,
        assignedBy: string,
        seats: number
    ): Promise<AssignResult>
    unassignSeat(tenantId: string, productId: string, userId: string): Promise<boolean>

    // ---------------------------------------------------------------- payments
    createPayment(payment: NewPayment): Promise<void>
    findPayment(id: string): Promise<Payment | null>
    /** The newest payment of a subscription. */
    lastPayment(subscriptionId: string): Promise<Payment | null>
    /** Stores the status the provider gave (paid_at is set the first time it is paid). */
    setPaymentStatus(id: string, status: string): Promise<void>
    /**
     * Claims a paid payment that was not applied yet, for 2 minutes: only one caller gets true, also when the webhook
     * and the return page come at the same time. Then finishPayment (applied) or releasePayment (failed: try again).
     */
    claimPayment(id: string): Promise<boolean>
    finishPayment(id: string): Promise<void>
    releasePayment(id: string): Promise<void>
}
