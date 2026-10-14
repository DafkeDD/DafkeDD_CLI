import { Global, type MiddlewareConsumer, Module, type NestModule, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { HttpAdapterHost } from '@nestjs/core'
import { requestContextMiddleware } from './audit.context.js'
import { AuditService } from './audit.service.js'
import { AUDIT_STORE } from './audit.store.js'
import { PgAuditStore } from './pg-audit.store.js'

/**
 * Which proxies may tell the IP address of the user (X-Forwarded-For): TRUST_PROXY as Express reads it. Default
 * `loopback`: this computer (the Next.js frontend calls the API for the browser, and a proxy like nginx on the same
 * server). Others: `false`, a number of proxies, or addresses and ranges like `loopback, 10.0.0.0/8`.
 */
export function trustProxy(value: string | undefined): boolean | number | string {
    const setting = value?.trim() ?? ''
    if (!setting) return 'loopback'
    if (setting === 'true' || setting === 'false') return setting === 'true'
    return /^\d+$/.test(setting) ? Number(setting) : setting
}

/**
 * The audit log (src/audit). Global: every service can inject AuditService and record what it does. The routes to read
 * it are in src/tenants/audit.controller.ts (they need the login).
 */
@Global()
@Module({
    providers: [AuditService, { provide: AUDIT_STORE, useClass: PgAuditStore }],
    exports: [AuditService, AUDIT_STORE]
})
export class AuditModule implements NestModule, OnModuleInit {
    constructor(
        private readonly adapter: HttpAdapterHost,
        private readonly config: ConfigService
    ) {}

    onModuleInit() {
        const express = this.adapter.httpAdapter?.getInstance() as { set?: (name: string, value: unknown) => void }
        express?.set?.('trust proxy', trustProxy(this.config.get<string>('TRUST_PROXY')))
    }

    configure(consumer: MiddlewareConsumer) {
        // Every request: its IP address and browser for the events it records
        consumer.apply(requestContextMiddleware).forRoutes('{*path}')
    }
}
