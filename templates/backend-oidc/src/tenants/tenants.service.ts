import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service.js'
import { CatalogService } from '../billing/catalog.service.js'
import { AppException } from '../common/app.exception.js'
import { AccountService } from '../oidc/account.service.js'
import { slugify } from '../oidc/oidc.config.js'
import {
    OIDC_STORE,
    type OidcStore,
    type Tenant,
    type TenantChanges,
    type TenantDetails,
    type TenantSummary
} from '../oidc/store/oidc.store.js'

/** The billing details of a tenant as the API shows them. */
export type BillingDetails = Pick<TenantDetails, 'company' | 'vat' | 'billingAddress' | 'billingEmail'>

/** A text field of a form: trimmed, and empty is null. undefined stays undefined (not changed). */
const text = (value: string | null | undefined) => (value === undefined ? undefined : value?.trim() || null)

const billingOf = (details: TenantDetails): BillingDetails => ({
    company: details.company,
    vat: details.vat,
    billingAddress: details.billingAddress,
    billingEmail: details.billingEmail
})

/** Tenants as superadmins manage them (/admin/tenants) and the billing details of the own tenant. */
@Injectable()
export class TenantsService {
    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly accounts: AccountService,
        private readonly catalog: CatalogService,
        private readonly audit: AuditService
    ) {}

    private item(summary: TenantSummary, apps: number) {
        return {
            id: summary.id,
            slug: summary.slug,
            name: summary.name,
            status: summary.status,
            // Created by a superadmin, nobody joined yet (at most an open invitation)
            provisioning: summary.members === 0,
            createdAt: summary.createdAt,
            members: summary.members,
            apps,
            plan: summary.plan,
            city: summary.city,
            contact: summary.contact,
            billing: billingOf(summary)
        }
    }

    /** Every tenant: status, members, apps (a valid subscription or grant), plan, city and contact. */
    async list() {
        const [summaries, apps] = await Promise.all([this.store.listTenantSummaries(), this.catalog.ownedCounts()])
        return summaries.map(summary => this.item(summary, apps.get(summary.id) ?? 0))
    }

    async get(id: string) {
        const summary = await this.store.findTenantSummary(id)
        if (!summary) throw new AppException('oidc.TENANT_NOT_FOUND', HttpStatus.NOT_FOUND)
        return this.item(summary, (await this.catalog.ownedProductIds(id)).size)
    }

    /**
     * A new tenant; with adminEmail that person gets an invitation to become its admin (your own email: you are its
     * admin at once, `joined`).
     */
    async create(
        actor: { userId: string },
        input: { name: string; adminEmail?: string; contactName?: string; city?: string; plan?: string },
        lang: string
    ) {
        const tenant: Tenant = await this.store.createTenant(input.name.trim(), slugify(input.name))
        await this.store.updateTenant(tenant.id, {
            contactName: text(input.contactName),
            city: text(input.city),
            plan: input.plan?.trim() || undefined
        })
        await this.audit.record('platform.tenant_created', {
            tenantId: tenant.id,
            target: { type: 'tenant', id: tenant.id },
            details: { name: tenant.name }
        })
        let invited: string | null = null
        let joined = false
        const inviter = input.adminEmail ? await this.store.findUserById(actor.userId) : null
        if (inviter && input.adminEmail?.trim().toLowerCase() === inviter.email.toLowerCase()) {
            // Your own email: you are its admin at once (no invitation to yourself)
            await this.accounts.addSelfAsAdmin(inviter.id, tenant.id)
            joined = true
        } else if (input.adminEmail) {
            invited = (
                await this.accounts.invite(
                    { userId: actor.userId, name: inviter?.name ?? '' },
                    tenant,
                    { email: input.adminEmail, role: 'admin' },
                    lang
                )
            ).email
        }
        return { tenant: await this.get(tenant.id), invited, joined }
    }

    /** Status (suspend, reactivate), name, plan and city. */
    async update(
        id: string,
        input: { status?: 'active' | 'suspended'; name?: string; plan?: string; city?: string | null }
    ) {
        const before = await this.store.findTenantSummary(id)
        if (!before) throw new AppException('oidc.TENANT_NOT_FOUND', HttpStatus.NOT_FOUND)
        if (input.status !== undefined && input.status !== before.status) {
            await this.store.setTenantStatus(id, input.status)
            await this.audit.record(
                input.status === 'suspended' ? 'platform.tenant_suspended' : 'platform.tenant_activated',
                { tenantId: id, target: { type: 'tenant', id } }
            )
        }
        const changes: TenantChanges = {
            name: input.name?.trim() || undefined,
            plan: input.plan?.trim() || undefined,
            city: text(input.city)
        }
        const changed = (Object.keys(changes) as (keyof TenantChanges)[]).filter(
            key => changes[key] !== undefined && changes[key] !== before[key]
        )
        if (changed.length > 0) {
            await this.store.updateTenant(id, changes)
            await this.audit.record('platform.tenant_changed', {
                tenantId: id,
                target: { type: 'tenant', id },
                details: { fields: changed.join(','), name: changes.name, plan: changes.plan, city: changes.city }
            })
        }
        return this.get(id)
    }

    async billing(tenantId: string): Promise<BillingDetails> {
        const details = await this.store.findTenantDetails(tenantId)
        if (!details) throw new AppException('oidc.TENANT_NOT_FOUND', HttpStatus.NOT_FOUND)
        return billingOf(details)
    }

    async updateBilling(
        tenantId: string,
        input: { [K in keyof BillingDetails]?: string | null }
    ): Promise<BillingDetails> {
        const before = await this.billing(tenantId)
        const changes: TenantChanges = {
            company: text(input.company),
            vat: text(input.vat),
            billingAddress: text(input.billingAddress),
            billingEmail: text(input.billingEmail?.toLowerCase())
        }
        const changed = (Object.keys(changes) as (keyof BillingDetails)[]).filter(
            key => changes[key] !== undefined && changes[key] !== before[key]
        )
        if (changed.length > 0) {
            await this.store.updateTenant(tenantId, changes)
            await this.audit.record('licences.billing_details_changed', {
                tenantId,
                target: { type: 'tenant', id: tenantId },
                details: { fields: changed.join(',') }
            })
        }
        return this.billing(tenantId)
    }
}
