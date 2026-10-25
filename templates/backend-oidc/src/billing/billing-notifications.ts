import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import { NotificationsService, type Viewer, type VirtualNotification } from '../notifications/notifications.service.js'
import { isValid } from './billing.service.js'
import { BILLING_STORE, type BillingStore } from './store/billing.store.js'

const DAY = 24 * 60 * 60 * 1000
/** The admins of an organisation hear about a contract this many days before it renews or ends. */
export const CONTRACT_NOTICE_DAYS = 30
/** Superadmins hear about a discount code this many days before it expires. */
export const DISCOUNT_NOTICE_DAYS = 7

const day = (date: Date) => date.toISOString().slice(0, 10)

/**
 * The notifications that the licences compute when asked (nothing is stored but whether they were read): contracts of
 * the organisation that renew or end within 30 days (its admins) and discount codes that expire within 7 days
 * (superadmins). Their id stays the same for the same period, so read stays read.
 */
@Injectable()
export class BillingNotifications implements OnModuleInit {
    constructor(
        @Inject(BILLING_STORE) private readonly store: BillingStore,
        private readonly notifications: NotificationsService
    ) {}

    onModuleInit() {
        this.notifications.addSource(viewer => this.contracts(viewer))
        this.notifications.addSource(viewer => this.discounts(viewer))
    }

    async contracts(viewer: Viewer, now = new Date()): Promise<VirtualNotification[]> {
        if (!viewer.tenantId || viewer.role !== 'admin') return []
        const [subscriptions, products] = await Promise.all([
            this.store.listSubscriptions(viewer.tenantId),
            this.store.listProducts()
        ])
        return subscriptions.flatMap(subscription => {
            const end = subscription.currentPeriodEnd
            if (
                !isValid(subscription, now) ||
                !end ||
                end <= now ||
                end.getTime() - now.getTime() > CONTRACT_NOTICE_DAYS * DAY
            )
                return []
            const product = products.find(item => item.id === subscription.productId)
            return [
                {
                    id: `contract:${subscription.id}:${day(end)}`,
                    kind: 'contract.expiring' as const,
                    params: {
                        app: product?.name ?? null,
                        renewsAt: end.toISOString(),
                        daysLeft: Math.ceil((end.getTime() - now.getTime()) / DAY),
                        // false: canceled (or free for a while): it ends then instead of renewing
                        renews: subscription.providerSubscriptionId !== null && !subscription.cancelAtPeriodEnd
                    },
                    nav: { screen: 'invoices' as const },
                    createdAt: new Date(end.getTime() - CONTRACT_NOTICE_DAYS * DAY)
                }
            ]
        })
    }

    async discounts(viewer: Viewer, now = new Date()): Promise<VirtualNotification[]> {
        if (!viewer.superadmin) return []
        return (await this.store.listDiscounts()).flatMap(discount => {
            const end = discount.expiresAt
            if (!discount.active || !end || end <= now || end.getTime() - now.getTime() > DISCOUNT_NOTICE_DAYS * DAY)
                return []
            return [
                {
                    id: `discount:${discount.id}:${day(end)}`,
                    kind: 'discount.expiring' as const,
                    params: {
                        code: discount.code,
                        daysLeft: Math.ceil((end.getTime() - now.getTime()) / DAY),
                        redemptions: discount.redemptions
                    },
                    nav: { screen: 'admin-codes' as const },
                    createdAt: new Date(end.getTime() - DISCOUNT_NOTICE_DAYS * DAY)
                }
            ]
        })
    }
}
