import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service.js'
import { AppException } from '../common/app.exception.js'
import { AccountService } from '../oidc/account.service.js'
import { presence as activity, shownPresence } from '../access/presence.js'
import {
    type MemberStatus,
    OIDC_STORE,
    type OidcStore,
    outOfOfficeActive,
    type Profession,
    type TenantRole
} from '../oidc/store/oidc.store.js'
import { assertChanged } from './change-result.js'

/** A member counts as online after a request in the last 2 minutes (the frontend sends a heartbeat every minute). */
export const ONLINE_SECONDS = 120

/** The tenant that is managed: the one of the token (its admins) or one of the URL (superadmins). */
export interface ManagedTenant {
    id: string
    name: string
}

/**
 * Managing the members and invitations of one tenant. Used for the own tenant (/tenants/current, its admins) and for
 * any tenant (/admin/tenants/:id, superadmins): the caller checked who may do it.
 */
@Injectable()
export class MembersService {
    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly accounts: AccountService,
        private readonly audit: AuditService
    ) {}

    /** The tenant of the URL (superadmins), or oidc.TENANT_NOT_FOUND. */
    async tenant(id: string): Promise<ManagedTenant> {
        const tenant = await this.store.findTenant(id)
        if (!tenant) throw new AppException('oidc.TENANT_NOT_FOUND', HttpStatus.NOT_FOUND)
        return { id: tenant.id, name: tenant.name }
    }

    async members(tenantId: string) {
        const since = Date.now() - ONLINE_SECONDS * 1000
        const members = await this.store.listMembers(tenantId)
        const away = await this.store.listOutOfOffice(members.map(member => member.userId))
        return members.map(member => {
            const online =
                member.status === 'active' && member.lastSeenAt !== null && member.lastSeenAt.getTime() > since
            // The chosen status only while online; "offline" (appear offline) hides that the member is there
            const presence = shownPresence({
                online,
                chosen: member.presence,
                idle: activity.isIdle(member.userId),
                outOfOffice: outOfOfficeActive(away.get(member.userId))
            })
            return { ...member, online: online && member.presence !== 'offline', presence }
        })
    }

    /** The members with eidLinked: whether each one has its Belgian eID linked (for superadmins, OIDC_EID_REQUIRED). */
    async membersWithEid(tenantId: string) {
        const members = await this.members(tenantId)
        const ids = members.map(member => member.userId)
        const linked = new Set(await this.store.listLinkedUsers('eid', ids))
        return members.map(member => ({ ...member, eidLinked: linked.has(member.userId) }))
    }

    /** Invites someone (optionally with apps: their roles and a seat, see AccountService.invite). */
    async invite(actorId: string, tenant: ManagedTenant, input: Parameters<AccountService['invite']>[2], lang: string) {
        const inviter = await this.store.findUserById(actorId)
        return this.accounts.invite({ userId: actorId, name: inviter?.name ?? '' }, tenant, input, lang)
    }

    async setRole(tenantId: string, userId: string, role: TenantRole) {
        const before = await this.store.findMemberRole(tenantId, userId)
        assertChanged(
            await this.store.setMemberRole(tenantId, userId, role),
            'oidc.MEMBER_NOT_FOUND',
            'oidc.LAST_ADMIN'
        )
        if (before !== role)
            await this.audit.record('members.role_changed', {
                tenantId,
                target: { type: 'user', id: userId },
                details: { from: before, to: role }
            })
        return { userId, role }
    }

    async remove(tenantId: string, userId: string) {
        assertChanged(await this.store.removeMember(tenantId, userId), 'oidc.MEMBER_NOT_FOUND', 'oidc.LAST_ADMIN')
        await this.store.endTenantSessions(tenantId, userId)
        await this.audit.record('members.removed', { tenantId, target: { type: 'user', id: userId } })
    }

    async setStatus(tenantId: string, userId: string, status: MemberStatus) {
        assertChanged(
            await this.store.setMemberStatus(tenantId, userId, status),
            'oidc.MEMBER_NOT_FOUND',
            'oidc.LAST_ADMIN'
        )
        if (status === 'disabled') await this.store.endTenantSessions(tenantId, userId)
        await this.audit.record(status === 'disabled' ? 'members.disabled' : 'members.enabled', {
            tenantId,
            target: { type: 'user', id: userId }
        })
        return { userId, status }
    }

    /** Doctor (may use the eHealth vault) or staff. */
    async setProfession(tenantId: string, userId: string, profession: Profession) {
        const before = await this.store.findMember(tenantId, userId)
        if (!before || !(await this.store.setMemberProfession(tenantId, userId, profession)))
            throw new AppException('oidc.MEMBER_NOT_FOUND', HttpStatus.NOT_FOUND)
        if (before.profession !== profession)
            await this.audit.record('members.profession_changed', {
                tenantId,
                target: { type: 'user', id: userId },
                details: { from: before.profession, to: profession }
            })
        return { userId, profession }
    }

    invitations(tenantId: string) {
        return this.store.listInvitations(tenantId)
    }

    async resend(actorId: string, tenant: ManagedTenant, id: string, lang: string) {
        const inviter = await this.store.findUserById(actorId)
        return this.accounts.resendInvitation(inviter?.name ?? '', tenant, id, lang)
    }

    async withdraw(tenantId: string, id: string) {
        if (!(await this.store.deleteInvitation(tenantId, id)))
            throw new AppException('oidc.INVITATION_NOT_FOUND', HttpStatus.NOT_FOUND)
        await this.audit.record('members.invitation_withdrawn', { tenantId, target: { type: 'invitation', id } })
    }
}
