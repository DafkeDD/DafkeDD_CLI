import { AuditService } from '../audit/audit.service.js'
import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Inject,
    Param,
    ParseUUIDPipe,
    Patch,
    Post
} from '@nestjs/common'
import {
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiNoContentResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags
} from '@nestjs/swagger'
import { I18n, I18nContext } from 'nestjs-i18n'
import { Access, Auth, type AuthContext } from '../access/access.js'
import { AppException } from '../common/app.exception.js'
import { MfaService } from '../oidc/mfa.service.js'
import { OIDC_STORE, type OidcStore } from '../oidc/store/oidc.store.js'
import { assertChanged } from './change-result.js'
import { CreateTenantDto, SuperadminDto, UpdateTenantDto } from './platform.dto.js'
import { TenantsService } from './tenants.service.js'

const TENANT =
    '{ id, slug, name, status, provisioning, createdAt, members, apps, plan, city, contact: { name, email } | null, ' +
    'billing: { company, vat, billingAddress, billingEmail } }'

/** The whole platform, for superadmins only: every tenant, and who is superadmin. */
@ApiTags('platform (superadmin)')
@Controller('admin')
@Access('superadmin')
export class PlatformController {
    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly mfa: MfaService,
        private readonly audit: AuditService,
        private readonly tenantsService: TenantsService
    ) {}

    @Get('tenants')
    @ApiOperation({
        summary:
            'Every tenant: status, provisioning (nobody joined yet), members, apps (a valid subscription or grant), plan, city and contact'
    })
    @ApiOkResponse({ description: `[${TENANT}]` })
    tenants() {
        return this.tenantsService.list()
    }

    @Get('tenants/:id')
    @ApiOperation({ summary: 'One tenant (the same item as in the list)' })
    @ApiOkResponse({ description: TENANT })
    @ApiNotFoundResponse({ description: 'oidc.TENANT_NOT_FOUND' })
    tenant(@Param('id', new ParseUUIDPipe()) id: string) {
        return this.tenantsService.get(id)
    }

    @Post('tenants')
    @ApiOperation({
        summary:
            'Create a tenant; with adminEmail that person gets an invitation to become its admin (your own email: you are its admin at once)'
    })
    @ApiCreatedResponse({ description: `{ tenant: ${TENANT}, invited: email | null, joined }` })
    createTenant(@Auth() auth: AuthContext, @Body() body: CreateTenantDto, @I18n() i18n: I18nContext) {
        return this.tenantsService.create(auth, body, i18n.lang)
    }

    @Patch('tenants/:id')
    @ApiOperation({ summary: 'Suspend or reactivate a tenant, rename it, change its plan or city' })
    @ApiOkResponse({ description: TENANT })
    @ApiNotFoundResponse({ description: 'oidc.TENANT_NOT_FOUND' })
    updateTenant(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: UpdateTenantDto) {
        return this.tenantsService.update(id, body)
    }

    @Get('superadmins')
    @ApiOperation({ summary: 'The superadmins of the platform' })
    @ApiOkResponse({ description: '[{ userId, name, email }]' })
    async superadmins() {
        return (await this.store.listSuperadmins()).map(user => ({
            userId: user.id,
            name: user.name,
            email: user.email
        }))
    }

    @Post('superadmins')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Make an existing account superadmin' })
    @ApiOkResponse({ description: '{ userId, name, email }' })
    @ApiNotFoundResponse({ description: 'oidc.USER_NOT_FOUND' })
    async grant(@Body() body: SuperadminDto) {
        const user = await this.store.findUserByEmail(body.email.trim().toLowerCase())
        if (!user) throw new AppException('oidc.USER_NOT_FOUND', HttpStatus.NOT_FOUND)
        await this.store.setSuperadmin(user.id, true)
        await this.audit.record('platform.superadmin_granted', {
            tenantId: null,
            target: { type: 'user', id: user.id },
            details: { email: user.email }
        })
        return { userId: user.id, name: user.name, email: user.email }
    }

    @Delete('superadmins/:userId')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Take superadmin away. The platform always keeps at least one superadmin.' })
    @ApiNoContentResponse({ description: 'Revoked' })
    @ApiNotFoundResponse({ description: 'oidc.USER_NOT_FOUND' })
    @ApiConflictResponse({ description: 'oidc.LAST_SUPERADMIN' })
    async revoke(@Param('userId', new ParseUUIDPipe()) userId: string) {
        assertChanged(await this.store.setSuperadmin(userId, false), 'oidc.USER_NOT_FOUND', 'oidc.LAST_SUPERADMIN')
        await this.audit.record('platform.superadmin_revoked', { tenantId: null, target: { type: 'user', id: userId } })
    }

    @Delete('users/:userId/mfa')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary:
            'Reset two-step verification of an account (phone and recovery codes lost). Its sessions end; it sets it up again at the next login.'
    })
    @ApiNoContentResponse({ description: 'Reset' })
    @ApiNotFoundResponse({ description: 'oidc.USER_NOT_FOUND' })
    async resetMfa(@Param('userId', new ParseUUIDPipe()) userId: string) {
        if (!(await this.store.findUserById(userId)))
            throw new AppException('oidc.USER_NOT_FOUND', HttpStatus.NOT_FOUND)
        await this.mfa.reset(userId)
    }
}
