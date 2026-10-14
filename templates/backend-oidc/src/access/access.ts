import {
    applyDecorators,
    type CanActivate,
    createParamDecorator,
    type ExecutionContext,
    HttpStatus,
    Inject,
    Injectable,
    SetMetadata,
    UseGuards
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ApiBearerAuth, ApiForbiddenResponse, ApiUnauthorizedResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { setActor } from '../audit/audit.context.js'
import { AppException } from '../common/app.exception.js'
import { OAuthError } from '../oidc/oauth.error.js'
import { OidcService } from '../oidc/oidc.service.js'
import { OIDC_STORE, type OidcStore, type TenantRole } from '../oidc/store/oidc.store.js'

/**
 * The levels: user < admin (of the tenant in the token) < superadmin (of the whole platform). `account` is any
 * logged in account, also a superadmin who logged in without an organisation (for the own two-step verification).
 */
export type AccessLevel = 'account' | 'user' | 'admin' | 'superadmin'

/** Who calls the API: from the verified access token, with the role as it is in the database right now. */
export interface AuthContext {
    userId: string
    /**
     * The tenant of the token. Empty for a platform login of a superadmin (no organisation): such a token only reaches
     * routes with @Access('account') or @Access('superadmin').
     */
    tenantId: string
    tenantName: string
    role: TenantRole
    superadmin: boolean
    /** The session (sid) of the token: the browser login behind it (see /me/sessions). */
    sessionId: string
}

const LEVEL = 'access-level'

/** "Last seen" of a member is written at most once a minute (who is online). */
const TOUCH_MS = 60_000

/**
 * Checks the Bearer access token of this OIDC server and the level of the caller. The token says who the caller is
 * and in which tenant; the role and the superadmin flag are read from the database on every request, so taking a role
 * away works at once, not only when the token expires. A suspended tenant has no access at all.
 */
@Injectable()
export class AccessGuard implements CanActivate {
    private readonly touched = new Map<string, number>()

    constructor(
        private readonly oidc: OidcService,
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly reflector: Reflector
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>()
        const header = request.headers.authorization ?? ''
        const token = /^Bearer ([A-Za-z0-9._~+/=-]+)$/i.exec(header)?.[1]
        let claims: Record<string, unknown>
        try {
            claims = await this.oidc.verifyAccessToken(token)
        } catch (error) {
            if (error instanceof OAuthError) throw new AppException('errors.UNAUTHORIZED', HttpStatus.UNAUTHORIZED)
            throw error
        }
        const tenant = claims.tenant as { id?: unknown; name?: unknown } | undefined
        const user = typeof claims.sub === 'string' ? await this.store.findUserById(claims.sub) : null
        if (user?.status !== 'active') throw new AppException('errors.UNAUTHORIZED', HttpStatus.UNAUTHORIZED)
        // verifyAccessToken checked that this session is still active (not logged out)
        const sessionId = typeof claims.sid === 'string' ? claims.sid : ''
        await this.touch('session:' + sessionId, () => this.store.touchSession(sessionId))

        const forbidden = new AppException('errors.FORBIDDEN', HttpStatus.FORBIDDEN)
        const needed =
            this.reflector.getAllAndOverride<AccessLevel | undefined>(LEVEL, [
                context.getHandler(),
                context.getClass()
            ]) ?? 'user'
        if (needed === 'superadmin' && !user.isSuperadmin) throw forbidden

        // A platform login (superadmin without an organisation): only the account and the platform
        if (typeof tenant?.id !== 'string') {
            if (!user.isSuperadmin || (needed !== 'account' && needed !== 'superadmin')) throw forbidden
            request.auth = { userId: user.id, tenantId: '', tenantName: '', role: 'admin', superadmin: true, sessionId }
            setActor(user.id, null)
            return true
        }

        const found = await this.store.findTenant(tenant.id)
        if (found?.status !== 'active') throw forbidden
        const role: TenantRole | null = user.isSuperadmin ? 'admin' : await this.store.findMemberRole(found.id, user.id)
        if (!role) throw forbidden
        if (needed === 'admin' && role !== 'admin') throw forbidden

        await this.touch(found.id + ':' + user.id, () => this.store.touchMember(found.id, user.id))
        request.auth = {
            userId: user.id,
            tenantId: found.id,
            tenantName: found.name,
            role,
            superadmin: user.isSuperadmin,
            sessionId
        }
        // The audit log knows who does what in this request
        setActor(user.id, found.id)
        return true
    }

    /**
     * Records activity (of a member in a tenant: who is online; of a session: last used), at most once a minute per key.
     * It never fails the request.
     */
    private async touch(key: string, write: () => Promise<void>) {
        const now = Date.now()
        if (now - (this.touched.get(key) ?? 0) < TOUCH_MS) return
        if (this.touched.size > 10_000) this.touched.clear()
        this.touched.set(key, now)
        await write().catch(() => undefined)
    }
}

/**
 * Protects a controller or a route: `@Access()` any member of the tenant in the token, `@Access('admin')` admins of the
 * tenant (and superadmins), `@Access('superadmin')` superadmins only, `@Access('account')` any logged in account (also
 * without an organisation). Adds the Bearer authentication and the 401/403 answers to Swagger.
 */
export const Access = (level: AccessLevel = 'user') =>
    applyDecorators(
        SetMetadata(LEVEL, level),
        UseGuards(AccessGuard),
        ApiBearerAuth(),
        ApiUnauthorizedResponse({ description: 'errors.UNAUTHORIZED: no or an invalid/expired access token' }),
        ApiForbiddenResponse({
            description: `errors.FORBIDDEN: ${level === 'account' ? 'the account is blocked' : 'not ' + (level === 'user' ? 'a member' : level)}`
        })
    )

/** The caller of a route protected with @Access(). */
export const Auth = createParamDecorator(
    (_data: unknown, context: ExecutionContext): AuthContext =>
        context.switchToHttp().getRequest<Request & { auth: AuthContext }>().auth
)
