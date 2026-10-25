import { ConfigService } from '@nestjs/config'
import { AuditService } from '../audit/audit.service.js'
import { MemoryAuditStore } from '../audit/memory-audit.store.js'
import type { BillingService } from '../billing/billing.service.js'
import { CatalogService } from '../billing/catalog.service.js'
import { MemoryBillingStore } from '../billing/store/memory-billing.store.js'
import { AppException } from '../common/app.exception.js'
import type { AccountService } from '../oidc/account.service.js'
import { MemoryOidcStore } from '../oidc/store/memory-oidc.store.js'
import { MembersService } from './members.service.js'
import { TenantsService } from './tenants.service.js'

function setup() {
    const oidc = new MemoryOidcStore()
    const billing = new MemoryBillingStore()
    const auditStore = new MemoryAuditStore()
    const audit = new AuditService(auditStore, new ConfigService({}))
    // Inviting: an invitation row, like AccountService.invite (the email is tested with the accounts)
    const invite = vi.fn(
        async (
            inviter: { userId: string },
            tenant: { id: string },
            input: { email: string; role: 'user' | 'admin' }
        ) => {
            const row = await oidc.saveInvitation({
                tenantId: tenant.id,
                email: input.email,
                role: input.role,
                invitedBy: inviter.userId,
                apps: [],
                expiresAt: new Date(Date.now() + 60_000)
            })
            return { status: 'invited' as const, email: input.email, id: row.id }
        }
    )
    const accounts = { invite } as unknown as AccountService
    const catalog = new CatalogService(billing, oidc, { access: vi.fn() } as unknown as BillingService)
    const tenants = new TenantsService(oidc, accounts, catalog, audit)
    const members = new MembersService(oidc, accounts, audit)
    const root = oidc.addUser({ email: 'root@example.com', name: 'Root', passwordHash: 'x', isSuperadmin: true })
    return { oidc, billing, auditStore, tenants, members, invite, root }
}

const errorKey = async (promise: Promise<unknown>) => {
    try {
        await promise
    } catch (error) {
        if (error instanceof AppException) return error.key
        throw error
    }
    return null
}

describe('TenantsService', () => {
    it('creates a tenant with plan, city and contact; it is provisioning until someone joins', async () => {
        const { tenants, oidc, root, invite } = setup()
        const created = await tenants.create(
            { userId: root.id },
            {
                name: 'Praktijk Peeters',
                adminEmail: 'jan@peeters.be',
                contactName: 'Jan Peeters',
                city: 'Gent',
                plan: 'Pro'
            },
            'nl'
        )
        expect(invite).toHaveBeenCalledOnce()
        expect(created.invited).toBe('jan@peeters.be')
        expect(created.tenant).toMatchObject({
            slug: 'praktijk-peeters',
            name: 'Praktijk Peeters',
            status: 'active',
            provisioning: true,
            members: 0,
            apps: 0,
            plan: 'Pro',
            city: 'Gent',
            contact: { name: 'Jan Peeters', email: 'jan@peeters.be' },
            billing: { company: null, vat: null, billingAddress: null, billingEmail: null }
        })
        // The first admin joined: the contact is that admin
        const jan = oidc.addUser({ email: 'jan@peeters.be', name: 'Jan P.', passwordHash: 'x' })
        oidc.addMembership(created.tenant.id, jan.id, 'admin')
        expect(await tenants.get(created.tenant.id)).toMatchObject({
            provisioning: false,
            members: 1,
            contact: { name: 'Jan P.', email: 'jan@peeters.be' }
        })
        expect((await tenants.list()).map(item => item.name)).toEqual(['Praktijk Peeters'])
        // Without anything extra: plan Starter, no contact
        const bare = await tenants.create({ userId: root.id }, { name: 'Bare' }, 'en')
        expect(bare.tenant).toMatchObject({ plan: 'Starter', city: null, contact: null, provisioning: true })
    })

    it('changes status, name, plan and city with an audit event, and counts the apps', async () => {
        const { tenants, billing, oidc, auditStore } = setup()
        const tenant = oidc.addTenant('acme', 'Acme')
        const product = await billing.createProduct({
            code: 'agenda',
            name: 'Agenda',
            description: '',
            priceMonthCents: 100,
            priceYearCents: 1000,
            active: true
        })
        await billing.addGrant({
            tenantId: tenant.id,
            productId: product!.id,
            seats: 1,
            endsAt: null,
            note: '',
            grantedBy: 'root'
        })
        const changed = await tenants.update(tenant.id, { status: 'suspended', plan: 'Enterprise', city: ' Brugge ' })
        expect(changed).toMatchObject({ status: 'suspended', plan: 'Enterprise', city: 'Brugge', apps: 1 })
        expect((await tenants.list())[0]?.apps).toBe(1)
        expect(auditStore.events.map(event => event.action)).toEqual([
            'platform.tenant_suspended',
            'platform.tenant_changed'
        ])
        expect(auditStore.events[1]?.details).toMatchObject({ fields: 'plan,city' })
        // Nothing new: no event
        await tenants.update(tenant.id, { plan: 'Enterprise', status: 'suspended' })
        expect(auditStore.events).toHaveLength(2)
        expect((await tenants.update(tenant.id, { city: '' })).city).toBeNull()
        expect(await errorKey(tenants.get('00000000-0000-4000-8000-000000000000'))).toBe('oidc.TENANT_NOT_FOUND')
    })

    it('keeps the billing details of a tenant', async () => {
        const { tenants, oidc, auditStore } = setup()
        const tenant = oidc.addTenant('acme', 'Acme')
        expect(await tenants.billing(tenant.id)).toEqual({
            company: null,
            vat: null,
            billingAddress: null,
            billingEmail: null
        })
        expect(
            await tenants.updateBilling(tenant.id, {
                company: ' Acme BV ',
                vat: 'BE0123456789',
                billingAddress: 'Kerkstraat 1\n9000 Gent',
                billingEmail: 'Boekhouding@Acme.be'
            })
        ).toEqual({
            company: 'Acme BV',
            vat: 'BE0123456789',
            billingAddress: 'Kerkstraat 1\n9000 Gent',
            billingEmail: 'boekhouding@acme.be'
        })
        expect((await tenants.updateBilling(tenant.id, { vat: '', company: null })).vat).toBeNull()
        expect(auditStore.events.map(event => event.action)).toEqual([
            'licences.billing_details_changed',
            'licences.billing_details_changed'
        ])
        expect(auditStore.events[1]?.details).toEqual({ fields: 'company,vat' })
    })
})

describe('MembersService', () => {
    it('sets the profession of a member, and lists it', async () => {
        const { members, oidc, auditStore } = setup()
        const tenant = oidc.addTenant('acme', 'Acme')
        const ada = oidc.addUser({ email: 'ada@example.com', name: 'Ada', passwordHash: 'x' })
        oidc.addMembership(tenant.id, ada.id, 'admin')
        expect((await members.members(tenant.id))[0]).toMatchObject({ userId: ada.id, profession: 'staff' })
        expect(await members.setProfession(tenant.id, ada.id, 'doctor')).toEqual({
            userId: ada.id,
            profession: 'doctor'
        })
        expect((await members.members(tenant.id))[0]).toMatchObject({ profession: 'doctor', online: false })
        expect(auditStore.events[0]).toMatchObject({
            action: 'members.profession_changed',
            tenantId: tenant.id,
            details: { from: 'staff', to: 'doctor' }
        })
        expect(await errorKey(members.setProfession(tenant.id, '00000000-0000-4000-8000-000000000000', 'doctor'))).toBe(
            'oidc.MEMBER_NOT_FOUND'
        )
    })

    it('manages the members of a tenant of the URL (superadmins) like the own tenant', async () => {
        const { members, oidc, root } = setup()
        const tenant = oidc.addTenant('acme', 'Acme')
        const ada = oidc.addUser({ email: 'ada@example.com', name: 'Ada', passwordHash: 'x' })
        const bob = oidc.addUser({ email: 'bob@example.com', name: 'Bob', passwordHash: 'x' })
        oidc.addMembership(tenant.id, ada.id, 'admin')
        oidc.addMembership(tenant.id, bob.id, 'user')
        expect(await members.tenant(tenant.id)).toEqual({ id: tenant.id, name: 'Acme' })
        expect(await errorKey(members.tenant('00000000-0000-4000-8000-000000000000'))).toBe('oidc.TENANT_NOT_FOUND')
        const invited = await members.invite(
            root.id,
            { id: tenant.id, name: 'Acme' },
            { email: 'c@x.be', role: 'user' },
            'en'
        )
        expect((await members.invitations(tenant.id)).map(item => item.id)).toEqual([invited.id])
        await members.withdraw(tenant.id, invited.id)
        expect(await errorKey(members.withdraw(tenant.id, invited.id))).toBe('oidc.INVITATION_NOT_FOUND')
        expect(await members.setRole(tenant.id, bob.id, 'admin')).toEqual({ userId: bob.id, role: 'admin' })
        expect(await members.setStatus(tenant.id, bob.id, 'disabled')).toEqual({ userId: bob.id, status: 'disabled' })
        expect(await errorKey(members.remove(tenant.id, ada.id))).toBe('oidc.LAST_ADMIN')
        await members.remove(tenant.id, bob.id)
        expect((await members.members(tenant.id)).map(item => item.name)).toEqual(['Ada'])
    })
})
