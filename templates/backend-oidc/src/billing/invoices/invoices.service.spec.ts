import { ConfigService } from '@nestjs/config'
import type { I18nService } from 'nestjs-i18n'
import { AuditService } from '../../audit/audit.service.js'
import { MemoryAuditStore } from '../../audit/memory-audit.store.js'
import { MemoryNotificationsStore } from '../../notifications/memory-notifications.store.js'
import { NotificationsService } from '../../notifications/notifications.service.js'
import { MemoryOidcStore } from '../../oidc/store/memory-oidc.store.js'
import { BillingNotifications } from '../billing-notifications.js'
import type { BillingConfig } from '../billing.config.js'
import { MemoryBillingStore } from '../store/memory-billing.store.js'
import type { Payment, Product, Subscription } from '../store/billing.store.js'
import { InvoicesService, splitVat, withVat } from './invoices.service.js'
import { MemoryInvoicesStore } from './memory-invoices.store.js'

const DAY = 24 * 60 * 60 * 1000

function setup() {
    const oidc = new MemoryOidcStore()
    const acme = oidc.addTenant('acme', 'Acme')
    const admin = oidc.addUser({ email: 'admin@example.com', name: 'Ada', passwordHash: null })
    const root = oidc.addUser({ email: 'root@example.com', name: 'Root', passwordHash: null, isSuperadmin: true })
    oidc.addMembership(acme.id, admin.id, 'admin')
    const store = new MemoryInvoicesStore(async tenantId =>
        tenantId === acme.id
            ? {
                  tenantName: 'Acme',
                  company: 'Acme BV',
                  vat: 'BE0123456789',
                  billingAddress: 'Main street 1',
                  billingEmail: 'billing@acme.test'
              }
            : null
    )
    const auditStore = new MemoryAuditStore()
    const audit = new AuditService(auditStore, new ConfigService({}))
    const notificationsStore = new MemoryNotificationsStore()
    const notifications = new NotificationsService(notificationsStore, oidc, audit)
    const config = {
        vatPercent: 21,
        seller: { name: 'Pasport', address: [], vat: null, email: null, iban: null }
    } as unknown as BillingConfig
    const i18n = { t: (key: string) => key } as unknown as I18nService
    const service = new InvoicesService(store, oidc, config, notifications, audit, i18n)
    const product = { id: 'p', code: 'planner', name: 'Planner' } as Product
    const subscription = { id: 's', tenantId: acme.id, productId: 'p', interval: 'year', seats: 2 } as Subscription
    const payment = (id: string, change: Partial<Payment> = {}): Payment => ({
        id,
        tenantId: acme.id,
        subscriptionId: 's',
        kind: 'first',
        seats: 2,
        amountCents: 24200,
        status: 'paid',
        periodEnd: null,
        createdAt: new Date(),
        paidAt: new Date(),
        appliedAt: null,
        ...change
    })
    return { store, service, auditStore, notificationsStore, acme, admin, root, product, subscription, payment }
}

describe('VAT', () => {
    it('is added to a price without VAT, or taken out of a charged amount', () => {
        expect(withVat(20000, 21)).toEqual({ amountCents: 20000, vatCents: 4200, totalCents: 24200 })
        expect(withVat(999, 21)).toEqual({ amountCents: 999, vatCents: 210, totalCents: 1209 })
        expect(withVat(0, 21)).toEqual({ amountCents: 0, vatCents: 0, totalCents: 0 })
        expect(splitVat(24200, 21)).toEqual({ amountCents: 20000, vatCents: 4200, totalCents: 24200 })
        expect(splitVat(1209, 21)).toEqual({ amountCents: 999, vatCents: 210, totalCents: 1209 })
        expect(splitVat(500, 0)).toEqual({ amountCents: 500, vatCents: 0, totalCents: 500 })
    })
})

describe('InvoicesService', () => {
    it('issues numbered invoices with the billing details of that moment, once per payment', async () => {
        const { service, notificationsStore, admin, product, subscription } = setup()
        const first = await service.issue({
            subscription,
            product,
            line: 'subscription',
            seats: 2,
            amounts: withVat(20000, 21),
            payment: { id: 'tr_1', checkoutUrl: 'https://pay/tr_1' }
        })
        expect(first).toMatchObject({
            number: `FAC-${new Date().getUTCFullYear()}-0001`,
            status: 'open',
            totalCents: 24200,
            company: 'Acme BV',
            vatPercent: 21,
            checkoutUrl: 'https://pay/tr_1'
        })
        const again = await service.issue({
            subscription,
            product,
            line: 'subscription',
            seats: 2,
            amounts: withVat(20000, 21),
            payment: { id: 'tr_1', checkoutUrl: null }
        })
        expect(again).toBeNull()
        const free = await service.issue({
            subscription,
            product,
            line: 'free',
            seats: 2,
            amounts: withVat(0, 21),
            payment: null
        })
        expect(free).toMatchObject({ number: `FAC-${new Date().getUTCFullYear()}-0002`, status: 'free', totalCents: 0 })
        expect(notificationsStore.notifications).toMatchObject([
            {
                userId: admin.id,
                kind: 'invoice.created',
                params: { number: first?.number, app: 'Planner', totalCents: 24200, status: 'open' },
                nav: { screen: 'invoices' }
            },
            { kind: 'invoice.created', params: { status: 'free' } }
        ])
    })

    it('marks invoices paid once (also a payment of several), voids unpaid ones, and lists them', async () => {
        const { service, store, auditStore, notificationsStore, acme, root, product, subscription, payment } = setup()
        const issue = (id: string) =>
            service.issue({
                subscription,
                product,
                line: 'renewal',
                seats: 2,
                amounts: withVat(1000, 21),
                payment: { id, checkoutUrl: null }
            })
        const one = await issue('tr_1')
        const two = await issue('tr_2')
        const three = await issue('tr_3')
        expect(await service.paid(payment('tr_1'))).toHaveLength(1)
        expect(await service.paid(payment('tr_1'))).toHaveLength(0)
        await service.received(payment('tr_1'))
        expect(notificationsStore.notifications.at(-1)).toMatchObject({
            userId: root.id,
            tenantId: null,
            kind: 'payment.received',
            params: { tenant: 'Acme', totalCents: 24200, app: 'Planner' },
            nav: { screen: 'admin-tenant', id: acme.id }
        })
        await service.voidFor('tr_3')
        await service.settle([two!.id, three!.id], 'tr_all', 'https://pay/all')
        const paid = await service.paid(payment('tr_all', { kind: 'invoices', subscriptionId: null }))
        expect(paid.map(invoice => invoice.number)).toEqual([two?.number])
        expect(store.invoices.map(invoice => invoice.status)).toEqual(['paid', 'paid', 'void'])
        expect((await service.list(acme.id)).map(invoice => invoice.number)).toEqual([two?.number, one?.number])
        expect(auditStore.events.map(event => event.action)).toEqual([
            'invoices.issued',
            'invoices.issued',
            'invoices.issued',
            'invoices.paid',
            'invoices.voided',
            'invoices.paid'
        ])
    })

    it('makes the PDF of an invoice of the own organisation only', async () => {
        const { service, acme, product, subscription } = setup()
        const invoice = await service.issue({
            subscription,
            product,
            line: 'subscription',
            seats: 2,
            amounts: withVat(20000, 21),
            payment: { id: 'tr_1', checkoutUrl: null }
        })
        const pdf = await service.pdf(acme.id, invoice!.id, 'xx')
        expect(pdf.filename).toBe(`${invoice?.number}.pdf`)
        expect(pdf.content.subarray(0, 8).toString()).toBe('%PDF-1.4')
        await expect(service.pdf('other', invoice!.id, 'en')).rejects.toThrow('invoices.NOT_FOUND')
    })
})

describe('BillingNotifications', () => {
    it('contracts that renew or end within 30 days for admins; codes that expire within 7 days for superadmins', async () => {
        const billing = new MemoryBillingStore()
        const { service } = { service: { addSource: () => undefined } }
        const source = new BillingNotifications(billing, service as unknown as NotificationsService)
        const now = new Date('2026-10-15T12:00:00Z')
        billing.products.push({ id: 'p', code: 'planner', name: 'Planner' } as Product)
        const sub = (id: string, days: number, change: Partial<Subscription> = {}) =>
            billing.subscriptions.push({
                id,
                tenantId: 't',
                productId: 'p',
                interval: 'year',
                seats: 1,
                status: 'active',
                providerSubscriptionId: 'sub',
                currentPeriodEnd: new Date(now.getTime() + days * DAY),
                cancelAtPeriodEnd: false,
                discountCodeId: null,
                discountPeriodsLeft: null,
                ...change
            })
        sub('6f1d4c2e-1111-4111-8111-111111111111', 12)
        sub('6f1d4c2e-2222-4111-8111-111111111111', 45)
        sub('6f1d4c2e-3333-4111-8111-111111111111', 3, { status: 'canceled', cancelAtPeriodEnd: true })
        sub('6f1d4c2e-4444-4111-8111-111111111111', 3, { status: 'pending' })
        const admin = { userId: 'u', tenantId: 't', role: 'admin' as const, superadmin: false }
        const contracts = await source.contracts(admin, now)
        expect(contracts).toMatchObject([
            {
                id: 'contract:6f1d4c2e-1111-4111-8111-111111111111:2026-10-27',
                kind: 'contract.expiring',
                params: { app: 'Planner', daysLeft: 12, renews: true },
                nav: { screen: 'invoices' }
            },
            { params: { daysLeft: 3, renews: false } }
        ])
        expect(await source.contracts({ ...admin, role: 'user' }, now)).toEqual([])

        billing.discounts.push(
            ...([
                {
                    id: 'd1',
                    code: 'SOON',
                    active: true,
                    expiresAt: new Date(now.getTime() + 2 * DAY),
                    redemptions: 4,
                    createdAt: now
                },
                {
                    id: 'd2',
                    code: 'LATER',
                    active: true,
                    expiresAt: new Date(now.getTime() + 20 * DAY),
                    redemptions: 0,
                    createdAt: now
                },
                {
                    id: 'd3',
                    code: 'OFF',
                    active: false,
                    expiresAt: new Date(now.getTime() + 2 * DAY),
                    redemptions: 0,
                    createdAt: now
                }
            ] as never[])
        )
        expect(await source.discounts(admin, now)).toEqual([])
        expect(await source.discounts({ ...admin, superadmin: true }, now)).toMatchObject([
            { id: 'discount:d1:2026-10-17', params: { code: 'SOON', daysLeft: 2, redemptions: 4 } }
        ])
    })
})
