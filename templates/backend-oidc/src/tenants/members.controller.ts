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
import { InviteDto, MemberStatusDto, RoleDto } from '../oidc/account.dto.js'
import { AccountService } from '../oidc/account.service.js'
import { OIDC_STORE, type OidcStore } from '../oidc/store/oidc.store.js'
import { AppException } from '../common/app.exception.js'
import { assertChanged } from './change-result.js'

/** A member counts as online after a request in the last 2 minutes (the frontend sends a heartbeat every minute). */
export const ONLINE_SECONDS = 120

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
    @ApiOperation({
        summary:
            'The members of the current tenant: role, status (active or disabled), online (a request in the last 2 minutes) and last seen'
    })
    @ApiOkResponse({ description: '[{ userId, name, email, emailVerified, role, status, online, lastSeenAt }]' })
    async members(@Auth() auth: AuthContext) {
        const since = Date.now() - ONLINE_SECONDS * 1000
        return (await this.store.listMembers(auth.tenantId)).map(member => ({
            ...member,
            online: member.status === 'active' && member.lastSeenAt !== null && member.lastSeenAt.getTime() > since
        }))
    }

    @Post('invitations')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({ summary: 'Invite someone by email as user or admin (the link is valid for 7 days)' })
    @ApiAcceptedResponse({ description: '{ status: "invited", email, id }' })
    @ApiConflictResponse({ description: 'oidc.ALREADY_MEMBER' })
    async invite(@Auth() auth: AuthContext, @Body() body: InviteDto, @I18n() i18n: I18nContext) {
        // The answer also holds the id of the invitation: { status, email, id }
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
        await this.store.endTenantSessions(auth.tenantId, userId)
    }

    @Patch('members/:userId/status')
    @ApiOperation({
        summary:
            'Disable a member (cannot log in to this tenant or use its API; sessions end at once) or enable it again. Not the last active admin.'
    })
    @ApiOkResponse({ description: '{ userId, status }' })
    @ApiNotFoundResponse({ description: 'oidc.MEMBER_NOT_FOUND' })
    @ApiConflictResponse({ description: 'oidc.LAST_ADMIN' })
    async setStatus(
        @Auth() auth: AuthContext,
        @Param('userId', new ParseUUIDPipe()) userId: string,
        @Body() body: MemberStatusDto
    ) {
        assertChanged(
            await this.store.setMemberStatus(auth.tenantId, userId, body.status),
            'oidc.MEMBER_NOT_FOUND',
            'oidc.LAST_ADMIN'
        )
        if (body.status === 'disabled') await this.store.endTenantSessions(auth.tenantId, userId)
        return { userId, status: body.status }
    }

    @Get('invitations')
    @ApiOperation({ summary: 'The open invitations of the current tenant (not accepted, not expired), newest first' })
    @ApiOkResponse({ description: '[{ id, email, role, invitedBy, invitedByName, createdAt, expiresAt }]' })
    invitations(@Auth() auth: AuthContext) {
        return this.store.listInvitations(auth.tenantId)
    }

    @Post('invitations/:id/resend')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({ summary: 'Send an open invitation again (valid for 7 more days from now)' })
    @ApiAcceptedResponse({ description: '{ status: "invited", email, id }' })
    @ApiNotFoundResponse({ description: 'oidc.INVITATION_NOT_FOUND' })
    async resend(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @I18n() i18n: I18nContext) {
        const inviter = await this.store.findUserById(auth.userId)
        return this.accounts.resendInvitation(
            inviter?.name ?? '',
            { id: auth.tenantId, name: auth.tenantName },
            id,
            i18n.lang
        )
    }

    @Delete('invitations/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Withdraw an open invitation: the link in the email stops working' })
    @ApiNoContentResponse({ description: 'Withdrawn' })
    @ApiNotFoundResponse({ description: 'oidc.INVITATION_NOT_FOUND' })
    async withdraw(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
        if (!(await this.store.deleteInvitation(auth.tenantId, id)))
            throw new AppException('oidc.INVITATION_NOT_FOUND', HttpStatus.NOT_FOUND)
    }
}
