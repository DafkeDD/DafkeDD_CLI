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
import { AppException } from '../common/app.exception.js'
import { OAuthError } from '../oidc/oauth.error.js'
import { OidcService } from '../oidc/oidc.service.js'
import { OIDC_STORE, type OidcStore, type TenantRole } from '../oidc/store/oidc.store.js'

/** The three levels: user < admin (of the tenant in the token) < superadmin (of the whole platform). */
export type AccessLevel = 'user' | 'admin' | 'superadmin'

/** Who calls the API: from the verified access token, with the role as it is in the database right now. */
export interface AuthContext {
    userId: string
    tenantId: string
    tenantName: string
    role: TenantRole
    superadmin: boolean
}

const LEVEL = 'access-level'

/**
 * Checks the Bearer access token of this OIDC server and the level of the caller. The token says who the caller is
 * and in which tenant; the role and the superadmin flag are read from the database on every request, so taking a role
 * away works at once, not only when the token expires. A suspended tenant has no access at all.
 */
@Injectable()
export class AccessGuard implements CanActivate {
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
        if (user?.status !== 'active' || typeof tenant?.id !== 'string')
            throw new AppException('errors.UNAUTHORIZED', HttpStatus.UNAUTHORIZED)

        const forbidden = new AppException('errors.FORBIDDEN', HttpStatus.FORBIDDEN)
        const found = await this.store.findTenant(tenant.id)
        if (found?.status !== 'active') throw forbidden
        const role: TenantRole | null = user.isSuperadmin ? 'admin' : await this.store.findMemberRole(found.id, user.id)
        if (!role) throw forbidden

        const needed =
            this.reflector.getAllAndOverride<AccessLevel | undefined>(LEVEL, [
                context.getHandler(),
                context.getClass()
            ]) ?? 'user'
        if (needed === 'superadmin' && !user.isSuperadmin) throw forbidden
        if (needed === 'admin' && role !== 'admin') throw forbidden

        request.auth = {
            userId: user.id,
            tenantId: found.id,
            tenantName: found.name,
            role,
            superadmin: user.isSuperadmin
        }
        return true
    }
}

/**
 * Protects a controller or a route: `@Access()` any member, `@Access('admin')` admins of the tenant (and superadmins),
 * `@Access('superadmin')` superadmins only. Adds the Bearer authentication and the 401/403 answers to Swagger.
 */
export const Access = (level: AccessLevel = 'user') =>
    applyDecorators(
        SetMetadata(LEVEL, level),
        UseGuards(AccessGuard),
        ApiBearerAuth(),
        ApiUnauthorizedResponse({ description: 'errors.UNAUTHORIZED: no or an invalid/expired access token' }),
        ApiForbiddenResponse({ description: `errors.FORBIDDEN: not ${level === 'user' ? 'a member' : level}` })
    )

/** The caller of a route protected with @Access(). */
export const Auth = createParamDecorator(
    (_data: unknown, context: ExecutionContext): AuthContext =>
        context.switchToHttp().getRequest<Request & { auth: AuthContext }>().auth
)
