import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service.js'
import { AppException } from '../common/app.exception.js'
import { effectiveRoles } from './app-roles.js'
import { OIDC_STORE, type OidcClient, type OidcStore } from './store/oidc.store.js'

/**
 * The roles per app inside an organisation: the developer of an app defines which roles it has, the admins
 * (beheerders) of an organisation give them to its members, and the tokens of the app carry them (`roles`).
 */
@Injectable()
export class AppRolesService {
    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly audit: AuditService
    ) {}

    /** The `roles` claim of a member in the tokens of an app (none for an app without roles or without a tenant). */
    async claim(client: OidcClient, tenantId: string | null, userId: string): Promise<string[]> {
        if (!client.roles?.length || tenantId === null) return []
        return effectiveRoles(client.roles, await this.store.findAppRoles(tenantId, client.clientId, userId))
    }

    /** The apps that have roles (enabled ones), with their roles: what an admin can give. */
    async apps() {
        return (await this.store.listClients())
            .filter(client => !client.disabled && (client.roles?.length ?? 0) > 0)
            .map(client => ({ clientId: client.clientId, name: client.name, roles: client.roles ?? [] }))
    }

    private async app(clientId: string) {
        const app = (await this.apps()).find(item => item.clientId === clientId)
        if (!app) throw new AppException('oidc.APP_NOT_FOUND', HttpStatus.NOT_FOUND)
        return app
    }

    /** Every member of the organisation with its roles in the app (`assigned` false: the default roles). */
    async members(tenantId: string, clientId: string) {
        const app = await this.app(clientId)
        const given = new Map(
            (await this.store.listAppRoles(tenantId, clientId)).map(item => [item.userId, item.roles] as const)
        )
        return (await this.store.listMembers(tenantId)).map(member => ({
            userId: member.userId,
            name: member.name,
            email: member.email,
            role: member.role,
            status: member.status,
            roles: effectiveRoles(app.roles, given.get(member.userId) ?? null),
            assigned: given.has(member.userId)
        }))
    }

    /** An admin gives a member roles in the app; `null` goes back to the default roles. */
    async set(actor: { tenantId: string; userId: string }, clientId: string, userId: string, roles: string[] | null) {
        const app = await this.app(clientId)
        if (!(await this.store.findMember(actor.tenantId, userId)))
            throw new AppException('oidc.MEMBER_NOT_FOUND', HttpStatus.NOT_FOUND)
        const keys = new Set(app.roles.map(role => role.key))
        const unknown = roles?.find(key => !keys.has(key))
        if (unknown) throw new AppException('oidc.ROLE_UNKNOWN', HttpStatus.BAD_REQUEST, { role: unknown })
        const unique = roles === null ? null : [...new Set(roles)]
        await this.store.setAppRoles(actor.tenantId, clientId, userId, unique, actor.userId)
        await this.audit.record('members.app_roles_changed', {
            tenantId: actor.tenantId,
            actorId: actor.userId,
            target: { type: 'user', id: userId },
            details: { app: clientId, roles: unique === null ? 'default' : unique.join(',') || 'none' }
        })
        return { userId, roles: effectiveRoles(app.roles, unique), assigned: unique !== null }
    }
}
