import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AuditAction, AuditDetails, AuditTargetType } from './audit.actions.js'
import { requestContext } from './audit.context.js'
import { AUDIT_STORE, type AuditQuery, type AuditStore } from './audit.store.js'

const DAY = 24 * 60 * 60 * 1000
/** The longest text kept in the details of an event. */
const MAX_TEXT = 200

/** What an event is about, besides its action. Left out: the organisation and the account of the request. */
export interface AuditInput {
    tenantId?: string | null
    actorId?: string | null
    target?: { type: AuditTargetType; id: string } | null
    details?: AuditDetails
}

/** An event as it was written: what a listener (onRecorded) gets. */
export interface RecordedEvent {
    tenantId: string | null
    actorId: string | null
    action: AuditAction
    details: AuditDetails
}

export type AuditListener = (event: RecordedEvent) => Promise<void> | void

/** Short values only: long texts are cut, and nothing that is not a plain value is stored. */
function clean(details: AuditDetails = {}): AuditDetails {
    const result: AuditDetails = {}
    for (const [key, value] of Object.entries(details).slice(0, 20)) {
        if (value === undefined) continue
        result[key.slice(0, 40)] =
            typeof value === 'string'
                ? value.slice(0, MAX_TEXT)
                : ['number', 'boolean'].includes(typeof value)
                  ? value
                  : null
    }
    return result
}

/**
 * The audit log: who did what, when, in which organisation, from which IP address and browser. Every important change
 * calls record(); it never fails the request (a log that cannot be written is logged as an error). The IP address and
 * the account come from the request (src/audit/audit.context.ts). Events older than AUDIT_RETENTION_DAYS (365) are
 * removed once a day.
 */
@Injectable()
export class AuditService implements OnApplicationBootstrap, OnModuleDestroy {
    private readonly logger = new Logger('AuditLog')
    private timer: NodeJS.Timeout | null = null
    private readonly listeners: AuditListener[] = []

    constructor(
        @Inject(AUDIT_STORE) private readonly store: AuditStore,
        private readonly config: ConfigService
    ) {}

    /** Days an event is kept (AUDIT_RETENTION_DAYS, default 365; 0 keeps everything). */
    get retentionDays(): number {
        const days = Number(this.config.get<string>('AUDIT_RETENTION_DAYS') ?? 365)
        return Number.isInteger(days) && days >= 0 ? days : 365
    }

    /**
     * Called after every event that was written (the notifications follow new organisations and members this way). A
     * listener that fails is logged; it never fails the request.
     */
    onRecorded(listener: AuditListener) {
        this.listeners.push(listener)
    }

    async record(action: AuditAction, input: AuditInput = {}) {
        const context = requestContext.getStore()
        const event: RecordedEvent = {
            tenantId: input.tenantId !== undefined ? input.tenantId : (context?.tenantId ?? null),
            actorId: input.actorId !== undefined ? input.actorId : (context?.actorId ?? null),
            action,
            details: clean(input.details)
        }
        try {
            await this.store.add({
                ...event,
                targetType: input.target?.type ?? null,
                targetId: input.target?.id ?? null,
                ip: context?.ip ?? null,
                userAgent: context?.userAgent ?? null
            })
        } catch (error) {
            this.logger.error(`Could not record ${action}: ${error instanceof Error ? error.message : String(error)}`)
            return
        }
        for (const listener of this.listeners)
            try {
                await listener(event)
            } catch (error) {
                this.logger.warn(
                    `A listener of ${action} failed: ${error instanceof Error ? error.message : String(error)}`
                )
            }
    }

    /** One page, newest first, and the `next` to ask the page after it (null: no more). */
    async list(query: AuditQuery) {
        const events = await this.store.list({ ...query, limit: query.limit + 1 })
        const page = events.slice(0, query.limit)
        return { events: page, next: events.length > query.limit ? (page.at(-1)?.id ?? null) : null }
    }

    /** Removes the events older than the retention. */
    async purge() {
        if (this.retentionDays === 0) return 0
        const removed = await this.store.purge(new Date(Date.now() - this.retentionDays * DAY))
        if (removed > 0) this.logger.log(`Removed ${removed} audit events older than ${this.retentionDays} days`)
        return removed
    }

    onApplicationBootstrap() {
        const run = () =>
            void this.purge().catch(error =>
                this.logger.warn('Could not purge the audit log: ' + (error instanceof Error ? error.message : error))
            )
        run()
        this.timer = setInterval(run, DAY)
        this.timer.unref()
    }

    onModuleDestroy() {
        if (this.timer) clearInterval(this.timer)
    }
}
