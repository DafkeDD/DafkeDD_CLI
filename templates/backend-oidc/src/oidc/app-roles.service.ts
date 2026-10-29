import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service.js'
import { AppException } from '../common/app.exception.js'
import { AppLicenses } from './app-licenses.js'
import { effectiveRoles } from './app-roles.js'
import {
    type ClientSummary,
    type InvitationApp,
    OIDC_STORE,
    type OidcClient,
    type OidcStore
} from './store/oidc.store.js'

/** Where a member opens an app: its first address after logout (its home page), or else the site of its callback. */
export function appUrl(client: Pick<OidcClient, 'redirectUris' | 'postLogoutRedirectUris'>): string | null {
    const home = client.postLogoutRedirectUris[0]
    if (home) return home
    const callback = client.redirectUris[0]
    if (!callback) return null
    try {
        return new URL(callback).origin
    } catch {
        return null
    }
}

/**
 * The roles per app inside an organisation: the developer of an app defines which roles it has, the admins of an
 * organisation give them to its members, and the tokens of the app carry them (`roles`). Also the
 * apps of an invitation: the admin chooses them when inviting, the new member gets their roles (and a seat) on joining.
 */
@Injectable()
export class AppRolesService {
    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly audit: AuditService,
        private readonly licenses: AppLicenses
    ) {}

    /** The `roles` claim of a member in the tokens of an app (none for an app without roles or without a tenant). */
    async claim(client: OidcClient, tenantId: string | null, userId: string): Promise<string[]> {
        if (!client.roles?.length || tenantId === null) return []
        return effectiveRoles(client.roles, await this.store.findAppRoles(tenantId, client.clientId, userId))
    }

    /**
     * The apps an admin can give (enabled ones): every app made on /admin (linked apps), and every app with roles. With
     * the address to open it, the product it sells and its roles.
     */
    async apps() {
        return (await this.store.listClients())
            .filter(client => !client.disabled && (client.source === 'admin' || (client.roles?.length ?? 0) > 0))
            .map(client => this.summary(client))
    }

    private summary(client: ClientSummary) {
        return {
            clientId: client.clientId,
            name: client.name,
            url: appUrl(client),
            product: client.product ?? null,
            roles: client.roles ?? []
        }
    }

    /** An app that has roles (the roles of members are only given in those). */
    private async app(clientId: string) {
        const app = (await this.apps()).find(item => item.clientId === clientId && item.roles.length > 0)
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

    // ---------------------------------------------------------------- invitations

    /**
     * The apps an admin chose for an invitation, checked: an app it can give (400 oidc.INVITATION_APP_UNKNOWN), roles
     * the app has (400 oidc.ROLE_UNKNOWN). Every app once; a seat only for an app that sells a product.
     */
    async checkInvitationApps(
        input: { clientId: string; roles?: string[] | null; seat?: boolean }[] = []
    ): Promise<InvitationApp[]> {
        const apps = await this.apps()
        const chosen: InvitationApp[] = []
        for (const item of input) {
            if (chosen.some(app => app.clientId === item.clientId)) continue
            const app = apps.find(candidate => candidate.clientId === item.clientId)
            if (!app)
                throw new AppException('oidc.INVITATION_APP_UNKNOWN', HttpStatus.BAD_REQUEST, {
                    app: item.clientId.slice(0, 100)
                })
            const keys = new Set(app.roles.map(role => role.key))
            const roles = item.roles === undefined || item.roles === null ? null : [...new Set(item.roles)]
            const unknown = roles?.find(key => !keys.has(key))
            if (unknown) throw new AppException('oidc.ROLE_UNKNOWN', HttpStatus.BAD_REQUEST, { role: unknown })
            chosen.push({ clientId: app.clientId, roles, seat: item.seat === true && app.product !== null })
        }
        return chosen
    }

    /**
     * The apps of an invitation as the invited person sees them: name, address, the roles it will get (with their
     * names) and whether a seat comes with it. Apps that are gone (removed, disabled) are left out.
     */
    async describeInvitationApps(chosen: InvitationApp[]) {
        const apps = await this.apps()
        return chosen.flatMap(item => {
            const app = apps.find(candidate => candidate.clientId === item.clientId)
            if (!app) return []
            const roles = effectiveRoles(app.roles, item.roles)
            return [
                {
                    clientId: app.clientId,
                    name: app.name,
                    url: app.url,
                    roles: app.roles
                        .filter(role => roles.includes(role.key))
                        .map(role => ({ key: role.key, names: role.names })),
                    seat: item.seat
                }
            ]
        })
    }

    /**
     * A new member accepted an invitation: it gets the roles chosen for each app (recorded as given by the inviter) and,
     * when asked, one of the free seats. No free seat: the member still joins (without a
     * licence; the admin gives one later or the member asks a demo); `seat` says false.
     */
    async giveInvitationApps(
        tenantId: string,
        userId: string,
        invitedBy: string | null,
        chosen: InvitationApp[]
    ): Promise<{ clientId: string; name: string; url: string | null; seat: boolean }[]> {
        const apps = await this.apps()
        const given = []
        for (const item of chosen) {
            const app = apps.find(candidate => candidate.clientId === item.clientId)
            if (!app) continue
            if (item.roles !== null && app.roles.length > 0) {
                const keys = new Set(app.roles.map(role => role.key))
                const roles = item.roles.filter(key => keys.has(key))
                await this.store.setAppRoles(tenantId, app.clientId, userId, roles, invitedBy)
                await this.audit.record('members.app_roles_changed', {
                    tenantId,
                    actorId: invitedBy,
                    target: { type: 'user', id: userId },
                    details: { app: app.clientId, roles: roles.join(',') || 'none', reason: 'invitation' }
                })
            }
            const seat =
                item.seat && app.product !== null && invitedBy !== null
                    ? await this.licenses.assign({ tenantId, userId: invitedBy }, app.product, userId)
                    : false
            given.push({ clientId: app.clientId, name: app.name, url: app.url, seat })
        }
        return given
    }
}
