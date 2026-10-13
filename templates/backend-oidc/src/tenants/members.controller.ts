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
    ApiAcceptedResponse,
    ApiConflictResponse,
    ApiNoContentResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags
} from '@nestjs/swagger'
import { I18n, I18nContext } from 'nestjs-i18n'
import { Access, Auth, type AuthContext } from '../access/access.js'
import { InviteDto, RoleDto } from '../oidc/account.dto.js'
import { AccountService } from '../oidc/account.service.js'
import { OIDC_STORE, type OidcStore } from '../oidc/store/oidc.store.js'
import { assertChanged } from './change-result.js'

/** The tenant of the access token ("current"): its members, for its admins (and superadmins). */
@ApiTags('tenant members')
@Controller('tenants/current')
@Access('admin')
export class MembersController {
    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly accounts: AccountService
    ) {}

    @Get('members')
    @ApiOperation({ summary: 'The members of the current tenant with their role (admin of the tenant)' })
    @ApiOkResponse({ description: '[{ userId, name, email, emailVerified, role }]' })
    members(@Auth() auth: AuthContext) {
        return this.store.listMembers(auth.tenantId)
    }

    @Post('invitations')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({ summary: 'Invite someone by email as user or admin (the link is valid for 7 days)' })
    @ApiAcceptedResponse({ description: '{ status: "invited", email }' })
    @ApiConflictResponse({ description: 'oidc.ALREADY_MEMBER' })
    async invite(@Auth() auth: AuthContext, @Body() body: InviteDto, @I18n() i18n: I18nContext) {
        const inviter = await this.store.findUserById(auth.userId)
        return this.accounts.invite(
            { userId: auth.userId, name: inviter?.name ?? '' },
            { id: auth.tenantId, name: auth.tenantName },
            body,
            i18n.lang
        )
    }

    @Patch('members/:userId')
    @ApiOperation({ summary: 'Change the role of a member. The tenant always keeps at least one admin.' })
    @ApiOkResponse({ description: '{ userId, role }' })
    @ApiNotFoundResponse({ description: 'oidc.MEMBER_NOT_FOUND' })
    @ApiConflictResponse({ description: 'oidc.LAST_ADMIN' })
    async setRole(
        @Auth() auth: AuthContext,
        @Param('userId', new ParseUUIDPipe()) userId: string,
        @Body() body: RoleDto
    ) {
        assertChanged(
            await this.store.setMemberRole(auth.tenantId, userId, body.role),
            'oidc.MEMBER_NOT_FOUND',
            'oidc.LAST_ADMIN'
        )
        return { userId, role: body.role }
    }

    @Delete('members/:userId')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Remove a member from the tenant (the account stays). Not the last admin.' })
    @ApiNoContentResponse({ description: 'Removed' })
    @ApiNotFoundResponse({ description: 'oidc.MEMBER_NOT_FOUND' })
    @ApiConflictResponse({ description: 'oidc.LAST_ADMIN' })
    async remove(@Auth() auth: AuthContext, @Param('userId', new ParseUUIDPipe()) userId: string) {
        assertChanged(await this.store.removeMember(auth.tenantId, userId), 'oidc.MEMBER_NOT_FOUND', 'oidc.LAST_ADMIN')
    }
}
