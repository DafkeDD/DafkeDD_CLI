import { Controller, Get, Query } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Access, Auth, type AuthContext } from '../access/access.js'
import { AuditQueryDto, PlatformAuditQueryDto } from '../audit/audit.dto.js'
import { AuditService } from '../audit/audit.service.js'

const PAGE = '{ events: [{ id, createdAt, tenant, actor, action, target, details, ip, userAgent }], next }'

/** Reading the audit log: an organisation (its admins), the whole platform (superadmins) and the own account. */
@ApiTags('audit log')
@Controller()
export class AuditController {
    constructor(private readonly audit: AuditService) {}

    @Get('tenants/current/audit')
    @Access('admin')
    @ApiOperation({ summary: 'The audit log of the current organisation, newest first (50 per page)' })
    @ApiOkResponse({ description: PAGE })
    tenant(@Auth() auth: AuthContext, @Query() query: AuditQueryDto) {
        return this.audit.list({
            tenantId: auth.tenantId,
            categories: query.category ? [query.category] : undefined,
            actorId: query.actor,
            before: query.before,
            limit: query.limit ?? 50
        })
    }

    @Get('admin/audit')
    @Access('superadmin')
    @ApiOperation({
        summary: 'The audit log of the whole platform: every organisation, the platform and the accounts (superadmins)'
    })
    @ApiOkResponse({ description: PAGE })
    platform(@Query() query: PlatformAuditQueryDto) {
        return this.audit.list({
            tenantId: query.tenant === 'platform' ? null : query.tenant?.toLowerCase(),
            categories: query.category ? [query.category] : undefined,
            actorId: query.actor,
            before: query.before,
            limit: query.limit ?? 50
        })
    }

    @Get('me/audit')
    @Access('account')
    @ApiOperation({
        summary: 'What happened with the own account: logins (also failed ones), two-step verification, eID, password'
    })
    @ApiOkResponse({ description: PAGE })
    mine(@Auth() auth: AuthContext, @Query() query: AuditQueryDto) {
        return this.audit.list({
            userId: auth.userId,
            categories: query.category ? [query.category] : undefined,
            before: query.before,
            limit: query.limit ?? 50
        })
    }
}
