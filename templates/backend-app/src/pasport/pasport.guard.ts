import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { AppException } from '../common/app.exception.js'
import { ACCESS_KEY, type AccessLevel, type Caller } from './access.js'
import { ALGORITHMS, JoseError, type VerifyKey, verifyJwt } from './jose.js'
import { PasportConfig } from './pasport.config.js'
import { PasportKeys } from './pasport-keys.service.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Every route needs an access token of the login server (Authorization: Bearer ...), unless it is @Public().
 * The token is checked here, without a call to the login server: its signature (the keys of the login server),
 * the issuer, the audience, that it is an access token (typ at+jwt), that it is not expired, and that it was issued
 * to an app this API trusts (OIDC_CLIENT_IDS). Access tokens live 10 minutes; the frontend renews them.
 */
@Injectable()
export class PasportGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly config: PasportConfig,
        private readonly keys: PasportKeys
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const level =
            this.reflector.getAllAndOverride<AccessLevel>(ACCESS_KEY, [context.getHandler(), context.getClass()]) ??
            'member'
        if (level === 'public') return true
        const request = context.switchToHttp().getRequest<Request & { caller?: Caller }>()
        const caller = await this.caller(request.headers.authorization)
        request.caller = caller
        if (level === 'account') return true
        if (!caller.tenant) throw new AppException('errors.NO_ORGANISATION', HttpStatus.FORBIDDEN)
        if (level === 'admin' && caller.tenant.role !== 'admin' && !caller.superadmin)
            throw new AppException('errors.FORBIDDEN', HttpStatus.FORBIDDEN)
        return true
    }

    private async caller(header: string | undefined): Promise<Caller> {
        const token = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header ?? '')?.[1]
        if (!token) throw new AppException('errors.UNAUTHORIZED', HttpStatus.UNAUTHORIZED)
        // The key is looked up before verifying: an unknown key id may mean the login server has a new key
        let key: VerifyKey | undefined
        try {
            const kid = JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8')).kid
            key = typeof kid === 'string' ? await this.keys.find(kid) : undefined
        } catch {
            key = undefined
        }
        try {
            const { payload } = verifyJwt(token, {
                keys: () => key,
                algorithms: ALGORITHMS,
                issuer: this.config.issuer,
                audience: this.config.audience,
                typ: 'at+jwt'
            })
            const clientId = typeof payload.client_id === 'string' ? payload.client_id : ''
            if (!this.config.clientIds.includes(clientId)) throw new JoseError('Token of another app')
            if (typeof payload.sub !== 'string') throw new JoseError('No subject')
            const tenant = payload.tenant as { id?: unknown; name?: unknown; role?: unknown } | undefined
            const validTenant =
                tenant &&
                typeof tenant.id === 'string' &&
                UUID.test(tenant.id) &&
                typeof tenant.name === 'string' &&
                (tenant.role === 'user' || tenant.role === 'admin')
            return {
                sub: payload.sub,
                tenant: validTenant
                    ? { id: tenant.id as string, name: tenant.name as string, role: tenant.role as 'user' | 'admin' }
                    : null,
                superadmin: payload.superadmin === true,
                sid: typeof payload.sid === 'string' ? payload.sid : null,
                clientId
            }
        } catch (error) {
            if (error instanceof JoseError) throw new AppException('errors.UNAUTHORIZED', HttpStatus.UNAUTHORIZED)
            throw error
        }
    }
}
