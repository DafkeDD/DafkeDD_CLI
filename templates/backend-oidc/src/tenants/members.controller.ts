import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common'
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
import { InviteDto, MemberStatusDto, ProfessionDto, RoleDto } from '../oidc/account.dto.js'
import { MembersService } from './members.service.js'

export { ONLINE_SECONDS } from './members.service.js'

/** The tenant of the access token ("current"): its members, for its admins (and superadmins). */
@ApiTags('tenant members')
@Controller('tenants/current')
@Access('admin')
export class MembersController {
    constructor(private readonly members: MembersService) {}

    private tenant(auth: AuthContext) {
        return { id: auth.tenantId, name: auth.tenantName }
    }

    @Get('members')
    @ApiOperation({
        summary:
            'The members of the current tenant: role, status (active or disabled), profession, online (a request in the last 2 minutes) and last seen'
    })
    @ApiOkResponse({
        description: '[{ userId, name, email, emailVerified, role, status, profession, online, presence, lastSeenAt }]'
    })
    list(@Auth() auth: AuthContext) {
        return this.members.members(auth.tenantId)
    }

    @Post('invitations')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({ summary: 'Invite someone by email as user or admin (the link is valid for 7 days)' })
    @ApiAcceptedResponse({ description: '{ status: "invited", email, id }' })
    @ApiConflictResponse({ description: 'oidc.ALREADY_MEMBER' })
    invite(@Auth() auth: AuthContext, @Body() body: InviteDto, @I18n() i18n: I18nContext) {
        return this.members.invite(auth.userId, this.tenant(auth), body, i18n.lang)
    }

    @Patch('members/:userId')
    @ApiOperation({ summary: 'Change the role of a member. The tenant always keeps at least one admin.' })
    @ApiOkResponse({ description: '{ userId, role }' })
    @ApiNotFoundResponse({ description: 'oidc.MEMBER_NOT_FOUND' })
    @ApiConflictResponse({ description: 'oidc.LAST_ADMIN' })
    setRole(@Auth() auth: AuthContext, @Param('userId', new ParseUUIDPipe()) userId: string, @Body() body: RoleDto) {
        return this.members.setRole(auth.tenantId, userId, body.role)
    }

    @Delete('members/:userId')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Remove a member from the tenant (the account stays). Not the last admin.' })
    @ApiNoContentResponse({ description: 'Removed' })
    @ApiNotFoundResponse({ description: 'oidc.MEMBER_NOT_FOUND' })
    @ApiConflictResponse({ description: 'oidc.LAST_ADMIN' })
    remove(@Auth() auth: AuthContext, @Param('userId', new ParseUUIDPipe()) userId: string) {
        return this.members.remove(auth.tenantId, userId)
    }

    @Patch('members/:userId/status')
    @ApiOperation({
        summary:
            'Disable a member (cannot log in to this tenant or use its API; sessions end at once) or enable it again. Not the last active admin.'
    })
    @ApiOkResponse({ description: '{ userId, status }' })
    @ApiNotFoundResponse({ description: 'oidc.MEMBER_NOT_FOUND' })
    @ApiConflictResponse({ description: 'oidc.LAST_ADMIN' })
    setStatus(
        @Auth() auth: AuthContext,
        @Param('userId', new ParseUUIDPipe()) userId: string,
        @Body() body: MemberStatusDto
    ) {
        return this.members.setStatus(auth.tenantId, userId, body.status)
    }

    @Patch('members/:userId/profession')
    @ApiOperation({ summary: 'Doctor (may use the eHealth vault and the apps that need it) or staff' })
    @ApiOkResponse({ description: '{ userId, profession }' })
    @ApiNotFoundResponse({ description: 'oidc.MEMBER_NOT_FOUND' })
    setProfession(
        @Auth() auth: AuthContext,
        @Param('userId', new ParseUUIDPipe()) userId: string,
        @Body() body: ProfessionDto
    ) {
        return this.members.setProfession(auth.tenantId, userId, body.profession)
    }

    @Get('invitations')
    @ApiOperation({ summary: 'The open invitations of the current tenant (not accepted, not expired), newest first' })
    @ApiOkResponse({ description: '[{ id, email, role, invitedBy, invitedByName, createdAt, expiresAt }]' })
    invitations(@Auth() auth: AuthContext) {
        return this.members.invitations(auth.tenantId)
    }

    @Post('invitations/:id/resend')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({ summary: 'Send an open invitation again (valid for 7 more days from now)' })
    @ApiAcceptedResponse({ description: '{ status: "invited", email, id }' })
    @ApiNotFoundResponse({ description: 'oidc.INVITATION_NOT_FOUND' })
    resend(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @I18n() i18n: I18nContext) {
        return this.members.resend(auth.userId, this.tenant(auth), id, i18n.lang)
    }

    @Delete('invitations/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Withdraw an open invitation: the link in the email stops working' })
    @ApiNoContentResponse({ description: 'Withdrawn' })
    @ApiNotFoundResponse({ description: 'oidc.INVITATION_NOT_FOUND' })
    withdraw(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
        return this.members.withdraw(auth.tenantId, id)
    }
}
