import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import type { AuthContext } from '../access/access.js'
import { AuditService } from '../audit/audit.service.js'
import { AppException } from '../common/app.exception.js'
import { AccountService } from './account.service.js'
import { EidService } from './eid.service.js'
import { OIDC_STORE, type OidcStore, type ProfileChanges } from './store/oidc.store.js'

/** What the account sends to change its profile (see UpdateProfileDto). */
export interface ProfileInput {
    firstName?: string
    lastName?: string
    phone?: string
    locale?: string
    email?: string
}

/** Who asks: the account and (when the token has one) its organisation. */
export type ProfileViewer = Pick<AuthContext, 'userId' | 'tenantId' | 'role'>

/**
 * The own profile of the logged in account: name, phone, language, email address (a new one only after it was
 * confirmed), what the eID told (national register number, address: read-only) and its role and profession in the
 * organisation of the token. The national register number is only ever shown to the account itself.
 */
@Injectable()
export class ProfileService {
    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly accounts: AccountService,
        private readonly eid: EidService,
        private readonly audit: AuditService
    ) {}

    async profile(viewer: ProfileViewer) {
        const [user, profile, identifier, tenant, member] = await Promise.all([
            this.store.findUserById(viewer.userId),
            this.store.findProfile(viewer.userId),
            this.store.findIdentifier(viewer.userId, 'eid'),
            viewer.tenantId ? this.store.findTenant(viewer.tenantId) : Promise.resolve(null),
            viewer.tenantId ? this.store.findMember(viewer.tenantId, viewer.userId) : Promise.resolve(null)
        ])
        if (!user || !profile) throw new AppException('errors.NOT_FOUND', HttpStatus.NOT_FOUND)
        return {
            id: user.id,
            name: user.name,
            firstName: profile.firstName,
            lastName: profile.lastName,
            email: user.email,
            emailVerified: user.emailVerified,
            pendingEmail: profile.pendingEmail,
            phone: profile.phone,
            locale: user.locale,
            superadmin: user.isSuperadmin,
            eid: {
                linked: Boolean(identifier),
                rrn: identifier ? this.eid.openNationalNumber(profile.rrnEncrypted) : null,
                address: identifier ? profile.address : null
            },
            tenant: tenant
                ? {
                      id: tenant.id,
                      name: tenant.name,
                      slug: tenant.slug,
                      role: viewer.role,
                      // A superadmin without a membership counts as staff
                      profession: member?.profession ?? 'staff'
                  }
                : null
        }
    }

    /**
     * Changes the profile. The display name follows first and last name when both are known. A new email address is
     * only requested here (a link goes to it; 409 oidc.EMAIL_TAKEN when another account has it).
     */
    async update(viewer: ProfileViewer, input: ProfileInput, lang: string) {
        const profile = await this.store.findProfile(viewer.userId)
        if (!profile) throw new AppException('errors.NOT_FOUND', HttpStatus.NOT_FOUND)
        // First the email address: when it is refused, nothing else changed
        if (input.email !== undefined) await this.accounts.requestEmailChange(viewer.userId, input.email, lang)

        const changes: ProfileChanges = {}
        if (input.firstName !== undefined) changes.firstName = input.firstName.trim() || null
        if (input.lastName !== undefined) changes.lastName = input.lastName.trim() || null
        if (input.phone !== undefined) changes.phone = input.phone.trim() || null
        if (input.locale !== undefined) changes.locale = input.locale
        const first = changes.firstName !== undefined ? changes.firstName : profile.firstName
        const last = changes.lastName !== undefined ? changes.lastName : profile.lastName
        if ((changes.firstName !== undefined || changes.lastName !== undefined) && first && last)
            changes.name = `${first} ${last}`
        const fields = Object.keys(changes).filter(key => key !== 'name')
        if (fields.length > 0) {
            await this.store.updateProfile(viewer.userId, changes)
            await this.audit.record('account.profile_changed', {
                tenantId: null,
                actorId: viewer.userId,
                target: { type: 'user', id: viewer.userId },
                details: { fields: fields.join(',') }
            })
        }
        return this.profile(viewer)
    }
}
