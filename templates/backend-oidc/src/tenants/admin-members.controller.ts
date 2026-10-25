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

const uuid = () => new ParseUUIDPipe()

/**
 * The members and invitations of any tenant, for superadmins: the same as /tenants/current for its admins, with the
 * tenant from the URL. oidc.TENANT_NOT_FOUND when it does not exist.
 */
@ApiTags('platform (superadmin)')
@Controller('admin/tenants/:id')
@Access('superadmin')
export class AdminMembersController {
    constructor(private readonly members: MembersService) {}

    @Get('members')
    @ApiOperation({ summary: 'The members of a tenant (see GET /tenants/current/members)' })
    @ApiOkResponse({
        description:
            '[{ userId, name, email, emailVerified, role, status, profession, online, presence, lastSeenAt, eidLinked }]'
    })
    @ApiNotFoundResponse({ description: 'oidc.TENANT_NOT_FOUND' })
    async list(@Param('id', uuid()) id: string) {
        const tenant = await this.members.tenant(id)
        return this.members.membersWithEid(tenant.id)
    }

    @Get('invitations')
    @ApiOperation({ summary: 'The open invitations of a tenant, newest first' })
    @ApiOkResponse({ description: '[{ id, email, role, invitedBy, invitedByName, createdAt, expiresAt }]' })
    @ApiNotFoundResponse({ description: 'oidc.TENANT_NOT_FOUND' })
    async invitations(@Param('id', uuid()) id: string) {
        const tenant = await this.members.tenant(id)
        return this.members.invitations(tenant.id)
    }

    @Post('invitations')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({ summary: 'Invite someone to a tenant by email as user or admin (the link is valid for 7 days)' })
    @ApiAcceptedResponse({ description: '{ status: "invited", email, id }' })
    @ApiNotFoundResponse({ description: 'oidc.TENANT_NOT_FOUND' })
    @ApiConflictResponse({ description: 'oidc.ALREADY_MEMBER' })
    async invite(
        @Auth() auth: AuthContext,
        @Param('id', uuid()) id: string,
        @Body() body: InviteDto,
        @I18n() i18n: I18nContext
    ) {
        return this.members.invite(auth.userId, await this.members.tenant(id), body, i18n.lang)
    }

    @Post('invitations/:invId/resend')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({ summary: 'Send an open invitation again (valid for 7 more days from now)' })
    @ApiAcceptedResponse({ description: '{ status: "invited", email, id }' })
    @ApiNotFoundResponse({ description: 'oidc.TENANT_NOT_FOUND or oidc.INVITATION_NOT_FOUND' })
    async resend(
        @Auth() auth: AuthContext,
        @Param('id', uuid()) id: string,
        @Param('invId', uuid()) invId: string,
        @I18n() i18n: I18nContext
    ) {
        return this.members.resend(auth.userId, await this.members.tenant(id), invId, i18n.lang)
    }

    @Delete('invitations/:invId')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Withdraw an open invitation' })
    @ApiNoContentResponse({ description: 'Withdrawn' })
    @ApiNotFoundResponse({ description: 'oidc.TENANT_NOT_FOUND or oidc.INVITATION_NOT_FOUND' })
    async withdraw(@Param('id', uuid()) id: string, @Param('invId', uuid()) invId: string) {
        const tenant = await this.members.tenant(id)
        await this.members.withdraw(tenant.id, invId)
    }

    @Patch('members/:userId')
    @ApiOperation({ summary: 'Change the role of a member. The tenant always keeps at least one admin.' })
    @ApiOkResponse({ description: '{ userId, role }' })
    @ApiNotFoundResponse({ description: 'oidc.TENANT_NOT_FOUND or oidc.MEMBER_NOT_FOUND' })
    @ApiConflictResponse({ description: 'oidc.LAST_ADMIN' })
    async setRole(@Param('id', uuid()) id: string, @Param('userId', uuid()) userId: string, @Body() body: RoleDto) {
        const tenant = await this.members.tenant(id)
        return this.members.setRole(tenant.id, userId, body.role)
    }

    @Patch('members/:userId/status')
    @ApiOperation({ summary: 'Disable a member (its sessions in this tenant end) or enable it again' })
    @ApiOkResponse({ description: '{ userId, status }' })
    @ApiNotFoundResponse({ description: 'oidc.TENANT_NOT_FOUND or oidc.MEMBER_NOT_FOUND' })
    @ApiConflictResponse({ description: 'oidc.LAST_ADMIN' })
    async setStatus(
        @Param('id', uuid()) id: string,
        @Param('userId', uuid()) userId: string,
        @Body() body: MemberStatusDto
    ) {
        const tenant = await this.members.tenant(id)
        return this.members.setStatus(tenant.id, userId, body.status)
    }

    @Patch('members/:userId/profession')
    @ApiOperation({ summary: 'Doctor (may use the eHealth vault) or staff' })
    @ApiOkResponse({ description: '{ userId, profession }' })
    @ApiNotFoundResponse({ description: 'oidc.TENANT_NOT_FOUND or oidc.MEMBER_NOT_FOUND' })
    async setProfession(
        @Param('id', uuid()) id: string,
        @Param('userId', uuid()) userId: string,
        @Body() body: ProfessionDto
    ) {
        const tenant = await this.members.tenant(id)
        return this.members.setProfession(tenant.id, userId, body.profession)
    }

    @Delete('members/:userId')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Remove a member from a tenant (the account stays). Not the last admin.' })
    @ApiNoContentResponse({ description: 'Removed' })
    @ApiNotFoundResponse({ description: 'oidc.TENANT_NOT_FOUND or oidc.MEMBER_NOT_FOUND' })
    @ApiConflictResponse({ description: 'oidc.LAST_ADMIN' })
    async remove(@Param('id', uuid()) id: string, @Param('userId', uuid()) userId: string) {
        const tenant = await this.members.tenant(id)
        await this.members.remove(tenant.id, userId)
    }
}
