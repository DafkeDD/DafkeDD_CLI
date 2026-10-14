import { AsyncLocalStorage } from 'node:async_hooks'
import type { NextFunction, Request, Response } from 'express'

/** Where a request comes from and who makes it: filled in by the middleware and by AccessGuard (after the token). */
export interface RequestContext {
    ip: string | null
    userAgent: string | null
    actorId: string | null
    tenantId: string | null
}

export const requestContext = new AsyncLocalStorage<RequestContext>()

/** Express middleware: every request gets its own context (the audit log reads the IP and the browser from it). */
export function requestContextMiddleware(request: Request, _response: Response, next: NextFunction) {
    const userAgent = request.headers['user-agent']
    requestContext.run(
        {
            ip: request.ip ?? null,
            userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
            actorId: null,
            tenantId: null
        },
        next
    )
}

/** Who is logged in for this request (AccessGuard calls it after checking the access token). */
export function setActor(userId: string, tenantId: string | null) {
    const context = requestContext.getStore()
    if (!context) return
    context.actorId = userId
    context.tenantId = tenantId || null
}
