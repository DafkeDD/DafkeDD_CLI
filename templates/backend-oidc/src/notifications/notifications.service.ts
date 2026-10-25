import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import type { RecordedEvent } from '../audit/audit.service.js'
import { AuditService } from '../audit/audit.service.js'
import { presence } from '../access/presence.js'
import { AppException } from '../common/app.exception.js'
import { OIDC_STORE, type OidcStore, type TenantRole } from '../oidc/store/oidc.store.js'
import {
    type Nav,
    type NewNotification,
    type NotificationKind,
    type NotificationParams,
    NOTIFICATIONS_STORE,
    type NotificationsStore
} from './notifications.store.js'

/** At most this many notifications are shown (newest first). */
export const NOTIFICATIONS_LIMIT = 40

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The id of a computed notification: `contract:<subscription id>:<YYYY-MM-DD>` or `discount:<code id>:<YYYY-MM-DD>`. */
export const VIRTUAL_ID =
    /^(contract|discount):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d{4}-\d{2}-\d{2}$/i

/** Who asks: the account, the organisation of its token ('' for a platform login), its role there and superadmin. */
export interface Viewer {
    userId: string
    tenantId: string
    role: TenantRole
    superadmin: boolean
}

/** A notification that is not stored but computed when asked (a contract that ends soon); its id stays the same. */
export interface VirtualNotification {
    id: string
    kind: NotificationKind
    params: NotificationParams
    nav: Nav
    createdAt: Date
}

export type NotificationSource = (viewer: Viewer) => Promise<VirtualNotification[]>

/** Leaves out notifications that are not (or no longer) for the viewer, e.g. a ticket another superadmin handles. */
export type NotificationFilter = (viewer: Viewer, items: NotificationView[]) => Promise<NotificationView[]>

/** A notification as the frontend gets it. */
export interface NotificationView {
    id: string
    kind: NotificationKind
    params: NotificationParams
    nav: Nav
    createdAt: Date
    read: boolean
}

/** The longest text in the params of a notification. */
const MAX_TEXT = 200

function clean(params: NotificationParams): NotificationParams {
    return Object.fromEntries(
        Object.entries(params).map(([key, value]) => [
            key,
            typeof value === 'string' ? value.slice(0, MAX_TEXT) : value
        ])
    )
}

/**
 * Notifications of accounts (the bell of the frontend). Stored ones go to the admins of an organisation, to one
 * account (the maker of a ticket) or to every superadmin (the platform); computed ones (a contract or a discount code
 * that ends soon) come from sources that other modules register. Sending one never fails the request: an error is
 * logged. New organisations, invitations and new members are followed through the audit log.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
    private readonly logger = new Logger(NotificationsService.name)
    private readonly sources: NotificationSource[] = []
    private readonly filters: NotificationFilter[] = []

    constructor(
        @Inject(NOTIFICATIONS_STORE) private readonly store: NotificationsStore,
        @Inject(OIDC_STORE) private readonly oidc: OidcStore,
        private readonly audit: AuditService
    ) {}

    onModuleInit() {
        this.audit.onRecorded(event => this.fromAudit(event))
    }

    /** Computed notifications (for example the contracts that end within 30 days). */
    addSource(source: NotificationSource) {
        this.sources.push(source)
    }

    /** A filter on what an account sees (see NotificationFilter). */
    addFilter(filter: NotificationFilter) {
        this.filters.push(filter)
    }

    // ---------------------------------------------------------------- sending

    private async add(
        recipients: string[],
        tenantId: string | null,
        kind: NotificationKind,
        params: NotificationParams,
        nav: Nav
    ) {
        const unique = [...new Set(recipients)]
        const items: NewNotification[] = unique.map(userId => ({
            userId,
            tenantId,
            kind,
            params: clean(params),
            nav
        }))
        try {
            await this.store.add(items)
        } catch (error) {
            this.logger.error(`Could not notify ${kind}: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    /** One account, in an organisation. */
    toUser(userId: string, tenantId: string, kind: NotificationKind, params: NotificationParams, nav: Nav) {
        return this.add([userId], tenantId, kind, params, nav)
    }

    /** The active admins of an organisation; `except` is the admin that did it (nobody hears of what they did). */
    async toTenantAdmins(
        tenantId: string,
        kind: NotificationKind,
        params: NotificationParams,
        nav: Nav,
        except: string | null = null
    ) {
        const admins = await this.tenantAdmins(tenantId).catch(() => [])
        await this.add(
            admins.filter(id => id !== except),
            tenantId,
            kind,
            params,
            nav
        )
    }

    /**
     * Every superadmin (a notification of the platform, without an organisation); `except` is the superadmin that did
     * it (nobody gets a notification of what they did themselves).
     */
    async toPlatform(kind: NotificationKind, params: NotificationParams, nav: Nav, except: string | null = null) {
        const superadmins = await this.oidc.listSuperadmins().catch(() => [])
        await this.add(
            superadmins.filter(user => user.status === 'active' && user.id !== except).map(user => user.id),
            null,
            kind,
            params,
            nav
        )
    }

    /** One superadmin (the one handling a ticket): a notification of the platform, without an organisation. */
    toSupport(userId: string, kind: NotificationKind, params: NotificationParams, nav: Nav) {
        return this.add([userId], null, kind, params, nav)
    }

    /** The superadmins that are online right now (made a request in the last two minutes). */
    async toOnlineSupport(kind: NotificationKind, params: NotificationParams, nav: Nav) {
        const superadmins = await this.oidc.listSuperadmins().catch(() => [])
        await this.add(
            superadmins.filter(user => user.status === 'active' && presence.isOnline(user.id)).map(user => user.id),
            null,
            kind,
            params,
            nav
        )
    }

    async tenantAdmins(tenantId: string) {
        return (await this.oidc.listMembers(tenantId))
            .filter(member => member.role === 'admin' && member.status === 'active')
            .map(member => member.userId)
    }

    /** New organisations and invitations, from the audit log (whatever made them: /admin, a registration). */
    private async fromAudit(event: RecordedEvent) {
        const tenantId = event.tenantId
        if (!tenantId) return
        if (event.action === 'platform.tenant_created' || event.action === 'account.registered') {
            const name = event.details.name ?? event.details.organisation ?? null
            await this.toPlatform(
                'tenant.created',
                { tenantId, name: typeof name === 'string' ? name : null },
                { screen: 'admin-tenant', id: tenantId },
                event.actorId ?? null
            )
        } else if (event.action === 'members.joined') {
            // The other admins of the organisation: who joined it
            const user = event.actorId ? await this.oidc.findUserById(event.actorId) : null
            await this.toTenantAdmins(
                tenantId,
                'member.joined',
                { name: user?.name ?? null, email: user?.email ?? null },
                { screen: 'users' },
                event.actorId ?? null
            )
        } else if (event.action === 'members.invited') {
            const tenant = await this.oidc.findTenant(tenantId)
            await this.toPlatform(
                'member.invited',
                {
                    tenant: tenant?.name ?? null,
                    email: typeof event.details.email === 'string' ? event.details.email : null
                },
                { screen: 'admin-tenant', id: tenantId },
                event.actorId ?? null
            )
        }
    }

    // ---------------------------------------------------------------- reading

    /** The organisation of the token and, for superadmins, the platform. */
    private scopes(viewer: Viewer): (string | null)[] {
        const scopes: (string | null)[] = viewer.tenantId ? [viewer.tenantId] : []
        if (viewer.superadmin) scopes.push(null)
        return scopes
    }

    private async computed(viewer: Viewer) {
        const lists = await Promise.all(
            this.sources.map(source =>
                source(viewer).catch((error: unknown) => {
                    this.logger.warn(
                        'A notification source failed: ' + (error instanceof Error ? error.message : String(error))
                    )
                    return []
                })
            )
        )
        return lists.flat()
    }

    /** The newest notifications (at most 40), stored and computed together. */
    async list(viewer: Viewer): Promise<NotificationView[]> {
        const scopes = this.scopes(viewer)
        const [stored, computed] = await Promise.all([
            scopes.length ? this.store.list(viewer.userId, scopes, NOTIFICATIONS_LIMIT) : Promise.resolve([]),
            this.computed(viewer)
        ])
        const read = await this.store.readKeys(
            viewer.userId,
            computed.map(item => item.id)
        )
        const all: NotificationView[] = [
            ...stored.map(item => ({
                id: item.id,
                kind: item.kind,
                params: item.params,
                nav: item.nav,
                createdAt: item.createdAt,
                read: item.readAt !== null
            })),
            ...computed.map(item => ({ ...item, read: read.has(item.id) }))
        ]
        let shown = all
        for (const filter of this.filters)
            shown = await filter(viewer, shown).catch((error: unknown) => {
                this.logger.warn(
                    'A notification filter failed: ' + (error instanceof Error ? error.message : String(error))
                )
                return shown
            })
        return shown.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, NOTIFICATIONS_LIMIT)
    }

    async markRead(viewer: Viewer, id: string) {
        if (VIRTUAL_ID.test(id)) {
            // Only an id that the account sees right now
            if (!(await this.computed(viewer)).some(item => item.id === id))
                throw new AppException('errors.NOT_FOUND', HttpStatus.NOT_FOUND)
            return this.store.addReads(viewer.userId, [id])
        }
        if (!UUID.test(id) || !(await this.store.markRead(viewer.userId, id)))
            throw new AppException('errors.NOT_FOUND', HttpStatus.NOT_FOUND)
    }

    async markAllRead(viewer: Viewer) {
        const scopes = this.scopes(viewer)
        if (scopes.length) await this.store.markAllRead(viewer.userId, scopes)
        await this.store.addReads(
            viewer.userId,
            (await this.computed(viewer)).map(item => item.id)
        )
    }
}
