import {
    applyDecorators,
    type CanActivate,
    type ExecutionContext,
    HttpStatus,
    Injectable,
    SetMetadata,
    UseGuards
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ApiForbiddenResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { Access, type AuthContext } from '../access/access.js'
import { AppException } from '../common/app.exception.js'
import { BillingService } from './billing.service.js'

const PRODUCT = 'license-product'

/** Lets a request through when the caller has a licence (a running trial, or a seat) for the product. */
@Injectable()
export class LicenseGuard implements CanActivate {
    constructor(
        private readonly billing: BillingService,
        private readonly reflector: Reflector
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const product = this.reflector.getAllAndOverride<string>(PRODUCT, [context.getHandler(), context.getClass()])
        const { auth } = context.switchToHttp().getRequest<Request & { auth: AuthContext }>()
        const result = await this.billing.access(auth.tenantId, auth.userId, product, auth.superadmin)
        if (!result.access) throw new AppException('billing.LICENSE_REQUIRED', HttpStatus.FORBIDDEN, { product })
        return true
    }
}

/**
 * Protects a route of your application with a licence: `@License('planner')`. The caller must be a member of the
 * organisation of the token (like `@Access()`) AND have a licence for that product there: a running trial, or one of
 * the seats of the organisation. Superadmins always pass. Answers 403 billing.LICENSE_REQUIRED otherwise.
 */
export const License = (productCode: string) =>
    applyDecorators(
        Access('user'),
        SetMetadata(PRODUCT, productCode),
        UseGuards(LicenseGuard),
        ApiForbiddenResponse({ description: `billing.LICENSE_REQUIRED: no licence for ${productCode}` })
    )
