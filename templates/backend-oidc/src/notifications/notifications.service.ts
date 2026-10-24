import {
    HttpStatus,
    Inject,
    Injectable,
    Logger,
    type OnApplicationBootstrap,
    type OnModuleDestroy,
    type OnModuleInit
} from '@nestjs/common'
import { AuditService, type RecordedEvent } from '../audit/audit.service.js'
import { AppException } from '../common/app.exception.js'
import { OIDC_STORE, type OidcStore } from '../oidc/store/oidc.store.js'
import {
    type NewNotification,
    type NotificationKind,
    type NotificationParams,
    NOTIFICATIONS_STORE,
    type NotificationsStore
} from './notifications.store.js'

/** At most this many notifications are shown (newest first). */
export const NOTIFICATIONS_LIMIT = 40
/** Notifications are kept this many days. */
export const NOTIFICATIONS_DAYS = 90

const DAY = 24 * 60 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The longest text in the params of a notification. */
const MAX_TEXT = 200

/** Who asks: the account, the organisation of its token ('' for a platform login) and superadmin. */
export interface Viewer {
    userId: string
    tenantId: string
    superadmin: boolean
}

/** A notification as the frontend gets it. */
export interface NotificationView {
    id: string
    kind: NotificationKind
    params: NotificationParams
    link: string | null
    createdAt: Date
    read: boolean
}

function clean(params: NotificationParams): NotificationParams {
    return Object.fromEntries(
        Object.entries(params).map(([key, value]) => [
            key,
            typeof value === 'string' ? value.slice(0, MAX_TEXT) : value
        ])
    )
}

/** Only a path of this frontend ("/members"), never another site. */
function safeLink(link: string | null) {
    return link && link.startsWith('/') && !link.startsWith('//') ? link : null
}

/**
 * Notifications of accounts (the bell in the topbar of the frontend). They go to one account, to the active admins of
 * an organisation or to every superadmin (the platform). Sending one never fails the request: an error is logged. New
 * organisations, invitations and members are followed through the audit log; other modules inject this service and
 * call toUser, toTenantAdmins or toPlatform. Notifications older than 90 days are removed once a day.
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
    private readonly logger = new Logger(NotificationsService.name)
    private timer: NodeJS.Timeout | null = null

    constructor(
        @Inject(NOTIFICATIONS_STORE) private readonly store: NotificationsStore,
        @Inject(OIDC_STORE) private readonly oidc: OidcStore,
        private readonly audit: AuditService
    ) {}

    onModuleInit() {
        this.audit.onRecorded(event => this.fromAudit(event))
    }

    onApplicationBootstrap() {
        const run = () =>
            void this.store
                .purge(new Date(Date.now() - NOTIFICATIONS_DAYS * DAY))
                .catch((error: unknown) =>
                    this.logger.warn(
                        'Could not purge the notifications: ' + (error instanceof Error ? error.message : String(error))
                    )
                )
        run()
        this.timer = setInterval(run, DAY)
        this.timer.unref()
    }

    onModuleDestroy() {
        if (this.timer) clearInterval(this.timer)
    }

    // ---------------------------------------------------------------- sending

    private async add(
        recipients: string[],
        tenantId: string | null,
        kind: NotificationKind,
        params: NotificationParams,
        link: string | null
    ) {
        const items: NewNotification[] = [...new Set(recipients)].map(userId => ({
            userId,
            tenantId,
            kind,
            params: clean(params),
            link: safeLink(link)
        }))
        try {
            await this.store.add(items)
        } catch (error) {
            this.logger.error(`Could not notify ${kind}: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    /** One account, in an organisation. */
    toUser(userId: string, tenantId: string, kind: NotificationKind, params: NotificationParams, link: string | null) {
        return this.add([userId], tenantId, kind, params, link)
    }

    /** The active admins of an organisation; `except` is the account that did it (nobody hears of what they did). */
    async toTenantAdmins(
        tenantId: string,
        kind: NotificationKind,
        params: NotificationParams,
        link: string | null,
        except: string | null = null
    ) {
        const members = await this.oidc.listMembers(tenantId).catch(() => [])
        const admins = members
            .filter(member => member.role === 'admin' && member.status === 'active' && member.userId !== except)
            .map(member => member.userId)
        await this.add(admins, tenantId, kind, params, link)
    }

    /** Every active superadmin (a notification of the platform, without an organisation), except the one that did it. */
    async toPlatform(
        kind: NotificationKind,
        params: NotificationParams,
        link: string | null,
        except: string | null = null
    ) {
        const superadmins = await this.oidc.listSuperadmins().catch(() => [])
        await this.add(
            superadmins.filter(user => user.status === 'active' && user.id !== except).map(user => user.id),
            null,
            kind,
            params,
            link
        )
    }

    /** New organisations (for the superadmins), invitations and new members (for the admins), from the audit log. */
    private async fromAudit(event: RecordedEvent) {
        const tenantId = event.tenantId
        if (!tenantId) return
        const text = (value: unknown) => (typeof value === 'string' ? value : null)
        switch (event.action) {
            case 'platform.tenant_created':
            case 'account.registered':
                await this.toPlatform(
                    'tenant.created',
                    { name: text(event.details.name) ?? text(event.details.organisation) },
                    '/admin',
                    event.actorId
                )
                break
            case 'members.invited':
                await this.toTenantAdmins(
                    tenantId,
                    'member.invited',
                    { email: text(event.details.email) },
                    '/members',
                    event.actorId
                )
                break
            case 'members.joined': {
                const user = event.actorId ? await this.oidc.findUserById(event.actorId) : null
                await this.toTenantAdmins(
                    tenantId,
                    'member.joined',
                    { name: user?.name ?? null, email: user?.email ?? null },
                    '/members',
                    event.actorId
                )
                break
            }
        }
    }

    // ---------------------------------------------------------------- reading

    /** The organisation of the token and, for superadmins, the platform. */
    private scopes(viewer: Viewer): (string | null)[] {
        const scopes: (string | null)[] = viewer.tenantId ? [viewer.tenantId] : []
        if (viewer.superadmin) scopes.push(null)
        return scopes
    }

    /** The newest notifications (at most 40). */
    async list(viewer: Viewer): Promise<NotificationView[]> {
        const scopes = this.scopes(viewer)
        if (!scopes.length) return []
        const stored = await this.store.list(viewer.userId, scopes, NOTIFICATIONS_LIMIT)
        return stored.map(item => ({
            id: item.id,
            kind: item.kind,
            params: item.params,
            link: item.link,
            createdAt: item.createdAt,
            read: item.readAt !== null
        }))
    }

    async markRead(viewer: Viewer, id: string) {
        if (!UUID.test(id) || !(await this.store.markRead(viewer.userId, id)))
            throw new AppException('errors.NOT_FOUND', HttpStatus.NOT_FOUND)
    }

    async markAllRead(viewer: Viewer) {
        const scopes = this.scopes(viewer)
        if (scopes.length) await this.store.markAllRead(viewer.userId, scopes)
    }
}
