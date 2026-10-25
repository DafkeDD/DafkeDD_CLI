import { randomUUID } from 'node:crypto'
import {
    CATALOG_DEFAULTS,
    type Assignment,
    AssignResult,
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

/** In-memory store with the same behaviour as PgBillingStore. Used by the tests; never in production. */
export class MemoryBillingStore implements BillingStore {
    products: Product[] = []
    discounts: DiscountCode[] = []
    redemptions: { discountId: string; tenantId: string }[] = []
    customers = new Map<string, string>()
    subscriptions: Subscription[] = []
    grants: Grant[] = []
    trials: Trial[] = []
    assignments: Assignment[] = []
    payments: Payment[] = []

    // ---------------------------------------------------------------- products

    async listProducts() {
        return [...this.products].sort((a, b) => a.name.localeCompare(b.name))
    }

    async findProduct(id: string) {
        return this.products.find(product => product.id === id) ?? null
    }

    async findProductByCode(code: string) {
        return this.products.find(product => product.code === code) ?? null
    }

    async createProduct(product: NewProduct) {
        if (this.products.some(existing => existing.code === product.code)) return null
        const created: Product = {
            ...CATALOG_DEFAULTS,
            ...product,
            features: [...(product.features ?? [])],
            id: randomUUID(),
            currency: 'EUR',
            createdAt: new Date()
        }
        this.products.push(created)
        return { ...created }
    }

    async updateProduct(id: string, change: Partial<Omit<NewProduct, 'code'>>) {
        const product = this.products.find(item => item.id === id)
        if (!product) return null
        Object.assign(product, Object.fromEntries(Object.entries(change).filter(([, value]) => value !== undefined)))
        return { ...product }
    }

    async deleteProduct(id: string) {
        if (!this.products.some(product => product.id === id)) return 'missing'
        if (this.subscriptions.some(sub => sub.productId === id && sub.status !== 'canceled')) return 'in_use'
        this.products = this.products.filter(product => product.id !== id)
        this.subscriptions = this.subscriptions.filter(sub => sub.productId !== id)
        this.grants = this.grants.filter(grant => grant.productId !== id)
        this.trials = this.trials.filter(trial => trial.productId !== id)
        this.assignments = this.assignments.filter(assignment => assignment.productId !== id)
        return 'deleted'
    }

    // ---------------------------------------------------------------- discount codes

    async listDiscounts() {
        return [...this.discounts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    }

    async findDiscountByCode(code: string) {
        return this.discounts.find(discount => discount.code === code) ?? null
    }

    async findDiscount(id: string) {
        return this.discounts.find(discount => discount.id === id) ?? null
    }

    async createDiscount(discount: NewDiscountCode) {
        if (this.discounts.some(existing => existing.code === discount.code)) return null
        const { createdBy: _createdBy, ...rest } = discount
        const created: DiscountCode = { ...rest, id: randomUUID(), redemptions: 0, active: true, createdAt: new Date() }
        this.discounts.push(created)
        return { ...created }
    }

    async setDiscountActive(id: string, active: boolean) {
        const discount = this.discounts.find(item => item.id === id)
        if (!discount) return false
        discount.active = active
        return true
    }

    async redeemDiscount(discountId: string, tenantId: string) {
        const discount = this.discounts.find(item => item.id === discountId)
        if (!discount || (await this.hasRedeemed(discountId, tenantId))) return false
        if (discount.maxRedemptions !== null && discount.redemptions >= discount.maxRedemptions) return false
        discount.redemptions++
        this.redemptions.push({ discountId, tenantId })
        return true
    }

    async releaseDiscount(discountId: string, tenantId: string) {
        const index = this.redemptions.findIndex(item => item.discountId === discountId && item.tenantId === tenantId)
        if (index < 0) return false
        this.redemptions.splice(index, 1)
        const discount = this.discounts.find(item => item.id === discountId)
        if (discount) discount.redemptions--
        return true
    }

    async hasRedeemed(discountId: string, tenantId: string) {
        return this.redemptions.some(item => item.discountId === discountId && item.tenantId === tenantId)
    }

    // ---------------------------------------------------------------- customers and subscriptions

    async getCustomerId(tenantId: string) {
        return this.customers.get(tenantId) ?? null
    }

    async setCustomerId(tenantId: string, customerId: string) {
        this.customers.set(tenantId, customerId)
    }

    async listEnvironments(tenantId: string): Promise<Environment[]> {
        return this.subscriptions
            .filter(item => item.tenantId === tenantId)
            .map(item => {
                // The purchase may store the environment on the subscription (name and region)
                const extra = item as Subscription & { environmentName?: string | null; region?: string | null }
                return {
                    productId: item.productId,
                    name: extra.environmentName ?? null,
                    region: extra.region ?? null,
                    since: null
                }
            })
    }

    async listAllOwnership() {
        return {
            subscriptions: this.subscriptions.map(item => ({ ...item })),
            grants: this.grants.map(item => ({ ...item }))
        }
    }

    async listSubscriptions(tenantId: string) {
        return this.subscriptions.filter(item => item.tenantId === tenantId).map(item => ({ ...item }))
    }

    async findSubscription(tenantId: string, productId: string) {
        const found = this.subscriptions.find(item => item.tenantId === tenantId && item.productId === productId)
        return found ? { ...found } : null
    }

    async findSubscriptionById(id: string) {
        const found = this.subscriptions.find(item => item.id === id)
        return found ? { ...found } : null
    }

    async findSubscriptionByProviderId(providerSubscriptionId: string) {
        const found = this.subscriptions.find(item => item.providerSubscriptionId === providerSubscriptionId)
        return found ? { ...found } : null
    }

    async saveSubscription(subscription: Omit<Subscription, 'id'>) {
        const existing = this.subscriptions.find(
            item => item.tenantId === subscription.tenantId && item.productId === subscription.productId
        )
        if (existing) {
            Object.assign(existing, subscription)
            return { ...existing }
        }
        const created: Subscription = { ...subscription, id: randomUUID() }
        this.subscriptions.push(created)
        return { ...created }
    }

    async updateSubscription(id: string, change: Partial<Omit<Subscription, 'id' | 'tenantId' | 'productId'>>) {
        const subscription = this.subscriptions.find(item => item.id === id)
        if (subscription) Object.assign(subscription, change)
    }

    // ---------------------------------------------------------------- free seats

    async listGrants(tenantId: string) {
        return this.grants.filter(item => item.tenantId === tenantId).map(item => ({ ...item }))
    }

    async addGrant(grant: Omit<Grant, 'id' | 'createdAt'> & { grantedBy: string }) {
        const { grantedBy: _grantedBy, ...rest } = grant
        const created: Grant = { ...rest, id: randomUUID(), createdAt: new Date() }
        this.grants.push(created)
        return { ...created }
    }

    async deleteGrant(tenantId: string, id: string) {
        const before = this.grants.length
        this.grants = this.grants.filter(item => !(item.tenantId === tenantId && item.id === id))
        return this.grants.length < before
    }

    // ---------------------------------------------------------------- trials and seats

    async listTrials(tenantId: string) {
        return this.trials.filter(item => item.tenantId === tenantId).map(item => ({ ...item }))
    }

    async findTrial(tenantId: string, productId: string, userId: string) {
        const found = this.trials.find(
            item => item.tenantId === tenantId && item.productId === productId && item.userId === userId
        )
        return found ? { ...found } : null
    }

    async startTrial(tenantId: string, productId: string, userId: string, endsAt: Date) {
        if (await this.findTrial(tenantId, productId, userId)) return false
        this.trials.push({ tenantId, productId, userId, startedAt: new Date(), endsAt })
        return true
    }

    async setTrialEnd(tenantId: string, productId: string, userId: string, endsAt: Date) {
        const trial = this.trials.find(
            item => item.tenantId === tenantId && item.productId === productId && item.userId === userId
        )
        if (!trial) return false
        trial.endsAt = endsAt
        return true
    }

    async listAssignments(tenantId: string) {
        return this.assignments
            .filter(item => item.tenantId === tenantId)
            .sort((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime())
            .map(item => ({ ...item }))
    }

    async assignSeat(
        tenantId: string,
        productId: string,
        userId: string,
        _assignedBy: string,
        seats: number
    ): Promise<AssignResult> {
        const used = this.assignments.filter(item => item.tenantId === tenantId && item.productId === productId)
        if (used.some(item => item.userId === userId)) return 'exists'
        if (used.length >= seats) return 'full'
        this.assignments.push({ tenantId, productId, userId, assignedAt: new Date() })
        return 'ok'
    }

    async unassignSeat(tenantId: string, productId: string, userId: string) {
        const before = this.assignments.length
        this.assignments = this.assignments.filter(
            item => !(item.tenantId === tenantId && item.productId === productId && item.userId === userId)
        )
        return this.assignments.length < before
    }

    // ---------------------------------------------------------------- payments

    private claims = new Map<string, number>()

    async createPayment(payment: NewPayment) {
        if (this.payments.some(item => item.id === payment.id)) return
        this.payments.push({ ...payment, createdAt: new Date(), paidAt: null, appliedAt: null })
    }

    async findPayment(id: string) {
        const found = this.payments.find(item => item.id === id)
        return found ? { ...found } : null
    }

    async lastPayment(subscriptionId: string) {
        // In the order they were made
        const found = this.payments.filter(item => item.subscriptionId === subscriptionId).at(-1)
        return found ? { ...found } : null
    }

    async setPaymentStatus(id: string, status: string) {
        const payment = this.payments.find(item => item.id === id)
        if (!payment) return
        payment.status = status
        if (status === 'paid' && !payment.paidAt) payment.paidAt = new Date()
    }

    async claimPayment(id: string) {
        const payment = this.payments.find(item => item.id === id)
        if (!payment || payment.status !== 'paid' || payment.appliedAt) return false
        if ((this.claims.get(id) ?? 0) > Date.now()) return false
        this.claims.set(id, Date.now() + 2 * 60 * 1000)
        return true
    }

    async finishPayment(id: string) {
        const payment = this.payments.find(item => item.id === id)
        if (payment) payment.appliedAt = new Date()
        this.claims.delete(id)
    }

    async releasePayment(id: string) {
        this.claims.delete(id)
    }
}
