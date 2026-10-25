import type { BillingService } from './billing.service.js'
import { cleanCatalog, launchUrlFor } from './catalog.js'
import { CatalogService } from './catalog.service.js'
import { MemoryBillingStore } from './store/memory-billing.store.js'
import { MemoryOidcStore } from '../oidc/store/memory-oidc.store.js'

const DAY = 24 * 60 * 60 * 1000

async function setup() {
    const billing = new MemoryBillingStore()
    const oidc = new MemoryOidcStore()
    const access = vi.fn(async (_tenantId: string, _userId: string, code: string) => ({ access: code === 'agenda' }))
    const catalog = new CatalogService(billing, oidc, { access } as unknown as BillingService)
    const tenant = oidc.addTenant('praktijk-peeters', 'Praktijk Peeters')
    const other = oidc.addTenant('other', 'Other')
    const product = (code: string, name: string, extra = {}) =>
        billing.createProduct({
            code,
            name,
            description: name + ' long',
            priceMonthCents: 1800,
            priceYearCents: 18000,
            active: true,
            ...extra
        })
    const agenda = await product('agenda', 'Online Agenda', {
        icon: 'calendar',
        category: 'Planning',
        short: 'Afspraken online',
        features: ['Online boeken'],
        color: '#2563eb',
        launchUrl: 'https://{slug}.agenda.example.com',
        sort: 20
    })
    const todo = await product('todo', 'Takenlijst', { sort: 10 })
    await product('crm', 'Klantenbeheer', { sort: 20 })
    await product('old', 'Old', { active: false })
    return { billing, oidc, catalog, tenant, other, agenda: agenda!, todo: todo! }
}

describe('the app catalogue', () => {
    it('cleans the catalogue fields and fills in the slug of the launch URL', () => {
        expect(cleanCatalog({ icon: ' box ', features: [' a ', '', 'b'], color: '', launchUrl: ' ', sort: 3 })).toEqual(
            { icon: 'box', features: ['a', 'b'], color: null, launchUrl: null, sort: 3 }
        )
        expect(cleanCatalog({})).toEqual({})
        expect(cleanCatalog({ color: '#ABCDEF' })).toEqual({ color: '#abcdef' })
        expect(cleanCatalog({ demoEnabled: false, requiresVault: true })).toEqual({
            demoEnabled: false,
            requiresVault: true
        })
        expect(launchUrlFor('https://{slug}.example.com/?t={slug}', 'acme')).toBe('https://acme.example.com/?t=acme')
        expect(launchUrlFor(null, 'acme')).toBeNull()
    })

    it('lists the products that are sold, sorted, with owned, access, seats and environment', async () => {
        const { billing, catalog, tenant, agenda } = await setup()
        await billing.saveSubscription({
            tenantId: tenant.id,
            productId: agenda.id,
            interval: 'month',
            seats: 3,
            status: 'active',
            providerSubscriptionId: 'sub_1',
            currentPeriodEnd: new Date(Date.now() + 10 * DAY),
            cancelAtPeriodEnd: false,
            discountCodeId: null,
            discountPeriodsLeft: null
        })
        await billing.addGrant({
            tenantId: tenant.id,
            productId: agenda.id,
            seats: 2,
            endsAt: null,
            note: '',
            grantedBy: 'root'
        })
        await billing.assignSeat(tenant.id, agenda.id, 'u1', 'admin', 5)
        const list = await catalog.catalog({ tenantId: tenant.id, userId: 'u1', superadmin: false })
        expect(list.map(item => item.code)).toEqual(['todo', 'crm', 'agenda'])
        expect(list[2]).toEqual({
            code: 'agenda',
            name: 'Online Agenda',
            description: 'Online Agenda long',
            short: 'Afspraken online',
            icon: 'calendar',
            category: 'Planning',
            features: ['Online boeken'],
            color: '#2563eb',
            requiresVault: false,
            demoEnabled: true,
            priceMonthCents: 1800,
            priceYearCents: 18000,
            currency: 'EUR',
            owned: true,
            access: true,
            trialEndsAt: null,
            trialAvailable: true,
            seatsUsed: 1,
            seatsTotal: 5,
            launchUrl: 'https://praktijk-peeters.agenda.example.com',
            environment: { name: null, region: null, since: null }
        })
        expect(list[0]).toMatchObject({
            code: 'todo',
            icon: 'box',
            owned: false,
            access: false,
            seatsTotal: 0,
            launchUrl: null,
            environment: null
        })
    })

    it('offers a demo only when the app has one and the account had none', async () => {
        const { billing, catalog, tenant, agenda, todo } = await setup()
        await billing.updateProduct(todo.id, { demoEnabled: false })
        await billing.startTrial(tenant.id, agenda.id, 'u2', new Date(Date.now() - DAY))
        const list = await catalog.catalog({ tenantId: tenant.id, userId: 'u2', superadmin: false })
        const item = (code: string) => list.find(app => app.code === code)
        expect(item('todo')).toMatchObject({ demoEnabled: false, trialAvailable: false, trialEndsAt: null })
        // An ended demo was used
        expect(item('agenda')).toMatchObject({ demoEnabled: true, trialAvailable: false, trialEndsAt: null })
        expect(item('crm')).toMatchObject({ demoEnabled: true, trialAvailable: true })
        // A running demo stays when the demo of the app is turned off
        const endsAt = new Date(Date.now() + DAY)
        await billing.startTrial(tenant.id, todo.id, 'u3', endsAt)
        const other = await catalog.catalog({ tenantId: tenant.id, userId: 'u3', superadmin: false })
        expect(other.find(app => app.code === 'todo')).toMatchObject({ trialAvailable: false, trialEndsAt: endsAt })
    })

    it('counts which products each organisation has: a valid subscription or grant', async () => {
        const { billing, catalog, tenant, other, agenda, todo } = await setup()
        await billing.addGrant({
            tenantId: tenant.id,
            productId: todo.id,
            seats: 1,
            endsAt: new Date(Date.now() + DAY),
            note: '',
            grantedBy: 'root'
        })
        // An ended grant and a pending subscription do not count
        await billing.addGrant({
            tenantId: other.id,
            productId: todo.id,
            seats: 1,
            endsAt: new Date(Date.now() - DAY),
            note: '',
            grantedBy: 'root'
        })
        await billing.saveSubscription({
            tenantId: other.id,
            productId: agenda.id,
            interval: 'year',
            seats: 1,
            status: 'pending',
            providerSubscriptionId: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            discountCodeId: null,
            discountPeriodsLeft: null
        })
        expect(await catalog.ownedCounts()).toEqual(new Map([[tenant.id, 1]]))
        expect(await catalog.ownedProductIds(tenant.id)).toEqual(new Set([todo.id]))
        expect(await catalog.ownedProductIds(other.id)).toEqual(new Set())
        const list = await catalog.catalog({ tenantId: tenant.id, userId: 'u1', superadmin: false })
        expect(list.find(item => item.code === 'todo')?.environment).toMatchObject({ name: null, region: null })
    })
})
