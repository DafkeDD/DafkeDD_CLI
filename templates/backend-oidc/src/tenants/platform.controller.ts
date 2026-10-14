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
import { AccountService } from '../oidc/account.service.js'
import { MfaService } from '../oidc/mfa.service.js'
import { slugify } from '../oidc/oidc.config.js'
import { OIDC_STORE, type OidcStore } from '../oidc/store/oidc.store.js'
import { assertChanged } from './change-result.js'
import { CreateTenantDto, SuperadminDto, TenantStatusDto } from './platform.dto.js'

/** The whole platform, for superadmins only: every tenant, and who is superadmin. */
@ApiTags('platform (superadmin)')
@Controller('admin')
@Access('superadmin')
export class PlatformController {
    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly accounts: AccountService,
        private readonly mfa: MfaService,
        private readonly audit: AuditService
    ) {}

    @Get('tenants')
    @ApiOperation({ summary: 'Every tenant with its status and number of members' })
    @ApiOkResponse({ description: '[{ id, slug, name, status, createdAt, members }]' })
    tenants() {
        return this.store.listTenants()
    }

    @Post('tenants')
    @ApiOperation({ summary: 'Create a tenant; with adminEmail that person gets an invitation to become its admin' })
    @ApiCreatedResponse({ description: '{ tenant, invited }' })
    async createTenant(@Auth() auth: AuthContext, @Body() body: CreateTenantDto, @I18n() i18n: I18nContext) {
        const tenant = await this.store.createTenant(body.name.trim(), slugify(body.name))
        await this.audit.record('platform.tenant_created', {
            tenantId: tenant.id,
            target: { type: 'tenant', id: tenant.id },
            details: { name: tenant.name }
        })
        let invited: string | null = null
        if (body.adminEmail) {
            const inviter = await this.store.findUserById(auth.userId)
            invited = (
                await this.accounts.invite(
                    { userId: auth.userId, name: inviter?.name ?? '' },
                    tenant,
                    { email: body.adminEmail, role: 'admin' },
                    i18n.lang
                )
            ).email
        }
        return { tenant, invited }
    }

    @Patch('tenants/:id')
    @ApiOperation({ summary: 'Suspend or reactivate a tenant' })
    @ApiOkResponse({ description: '{ id, status }' })
    @ApiNotFoundResponse({ description: 'oidc.TENANT_NOT_FOUND' })
    async setStatus(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: TenantStatusDto) {
        if (!(await this.store.setTenantStatus(id, body.status)))
            throw new AppException('oidc.TENANT_NOT_FOUND', HttpStatus.NOT_FOUND)
        await this.audit.record(
            body.status === 'suspended' ? 'platform.tenant_suspended' : 'platform.tenant_activated',
            { tenantId: id, target: { type: 'tenant', id } }
        )
        return { id, status: body.status }
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
