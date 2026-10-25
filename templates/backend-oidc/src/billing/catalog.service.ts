import { Inject, Injectable } from '@nestjs/common'
import { OIDC_STORE, type OidcStore } from '../oidc/store/oidc.store.js'
import { BillingService, isValid } from './billing.service.js'
import { launchUrlFor } from './catalog.js'
import { BILLING_STORE, type BillingStore, type Grant, type Product, type Subscription } from './store/billing.store.js'

/** Who looks at the catalogue: the organisation of the token and the account. */
export interface CatalogViewer {
    tenantId: string
    userId: string
    superadmin: boolean
}

const validGrant = (grant: Grant, now: Date) => grant.endsAt === null || grant.endsAt > now

/** Products in the order of the catalogue: sort, then name. */
export const catalogOrder = (a: Product, b: Product) => a.sort - b.sort || a.name.localeCompare(b.name)

/**
 * The app catalogue: every product that is sold, as an organisation sees it (does it have the app, may this account use
 * it, how many seats, where it opens), and which apps organisations have (for superadmins and the eHealth vault).
 */
@Injectable()
export class CatalogService {
    constructor(
        @Inject(BILLING_STORE) private readonly store: BillingStore,
        @Inject(OIDC_STORE) private readonly oidc: OidcStore,
        private readonly billing: BillingService
    ) {}

    /** Does the organisation have the product: a valid (paid, free or canceled but running) subscription or a grant? */
    private owns(productId: string, subscriptions: Subscription[], grants: Grant[], now: Date) {
        return (
            isValid(subscriptions.find(item => item.productId === productId) ?? null, now) ||
            grants.some(grant => grant.productId === productId && validGrant(grant, now))
        )
    }

    /** The ids of the products an organisation has. */
    async ownedProductIds(tenantId: string, now = new Date()): Promise<Set<string>> {
        const [products, subscriptions, grants] = await Promise.all([
            this.store.listProducts(),
            this.store.listSubscriptions(tenantId),
            this.store.listGrants(tenantId)
        ])
        return new Set(
            products.filter(product => this.owns(product.id, subscriptions, grants, now)).map(product => product.id)
        )
    }

    /** Per organisation: how many products it has (a valid subscription or grant). */
    async ownedCounts(now = new Date()): Promise<Map<string, number>> {
        const { subscriptions, grants } = await this.store.listAllOwnership()
        const owned = new Map<string, Set<string>>()
        const add = (tenantId: string, productId: string) => {
            const set = owned.get(tenantId) ?? new Set<string>()
            set.add(productId)
            owned.set(tenantId, set)
        }
        for (const subscription of subscriptions)
            if (isValid(subscription, now)) add(subscription.tenantId, subscription.productId)
        for (const grant of grants) if (validGrant(grant, now)) add(grant.tenantId, grant.productId)
        return new Map([...owned].map(([tenantId, products]) => [tenantId, products.size]))
    }

    /** The active products that need the eHealth vault, and whether the organisation (if any) has them. */
    async vaultApps(tenantId: string | null) {
        const [products, owned] = await Promise.all([
            this.store.listProducts(),
            tenantId ? this.ownedProductIds(tenantId) : Promise.resolve(new Set<string>())
        ])
        return products
            .filter(product => product.active && product.requiresVault)
            .sort(catalogOrder)
            .map(product => ({
                code: product.code,
                name: product.name,
                icon: product.icon,
                color: product.color,
                owned: owned.has(product.id)
            }))
    }

    /** The catalogue of the organisation of the viewer: the active products, sorted by sort and name. */
    async catalog(viewer: CatalogViewer) {
        const now = new Date()
        const [products, tenant, subscriptions, grants, assignments, environments] = await Promise.all([
            this.store.listProducts(),
            this.oidc.findTenant(viewer.tenantId),
            this.store.listSubscriptions(viewer.tenantId),
            this.store.listGrants(viewer.tenantId),
            this.store.listAssignments(viewer.tenantId),
            this.store.listEnvironments(viewer.tenantId)
        ])
        const active = products.filter(product => product.active).sort(catalogOrder)
        return Promise.all(
            active.map(async product => {
                const subscription = subscriptions.find(item => item.productId === product.id) ?? null
                const paid = isValid(subscription, now) ? subscription.seats : 0
                const productGrants = grants.filter(grant => grant.productId === product.id && validGrant(grant, now))
                const free = productGrants.reduce((sum, grant) => sum + grant.seats, 0)
                const owned = paid > 0 || productGrants.length > 0
                const environment = environments.find(item => item.productId === product.id)
                const firstGrant = [...productGrants].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]
                const [rights, trial] = await Promise.all([
                    this.billing.access(viewer.tenantId, viewer.userId, product.code, viewer.superadmin),
                    this.store.findTrial(viewer.tenantId, product.id, viewer.userId)
                ])
                const access = rights.access
                return {
                    code: product.code,
                    name: product.name,
                    description: product.description,
                    short: product.short,
                    icon: product.icon,
                    category: product.category,
                    features: product.features,
                    color: product.color,
                    requiresVault: product.requiresVault,
                    demoEnabled: product.demoEnabled,
                    priceMonthCents: product.priceMonthCents,
                    priceYearCents: product.priceYearCents,
                    currency: product.currency,
                    owned,
                    access,
                    // The own demo: until when it runs (null: none, or ended), and whether one can still be asked
                    // (not when the demo of the app is turned off)
                    trialEndsAt: trial && trial.endsAt > now ? trial.endsAt : null,
                    trialAvailable: product.demoEnabled && !trial,
                    seatsUsed: assignments.filter(item => item.productId === product.id).length,
                    seatsTotal: paid + free,
                    launchUrl: launchUrlFor(product.launchUrl, tenant?.slug ?? ''),
                    environment:
                        paid > 0
                            ? {
                                  name: environment?.name ?? null,
                                  region: environment?.region ?? null,
                                  since: environment?.since ?? null
                              }
                            : firstGrant
                              ? { name: null, region: null, since: firstGrant.createdAt }
                              : null
                }
            })
        )
    }
}
