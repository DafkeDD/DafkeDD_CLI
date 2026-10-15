import { Controller, Delete, Get, HttpStatus, Inject, Param } from '@nestjs/common'
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Access, Auth, type AuthContext } from '../access/access.js'
import { AuditService } from '../audit/audit.service.js'
import { AppException } from '../common/app.exception.js'
import { OIDC_STORE, type OidcStore } from './store/oidc.store.js'

/**
 * The applications that are not our own which the account allowed on the consent screen: see them and take the
 * permission back (the application then loses its refresh tokens and asks again at the next login).
 */
@ApiTags('consents')
@Controller('me/consents')
@Access('account')
export class ConsentsController {
    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly audit: AuditService
    ) {}

    @Get()
    @ApiOperation({ summary: 'The applications the logged in account allowed, with the scopes, newest first' })
    @ApiOkResponse({ description: '[{ clientId, clientName, scopes, createdAt, updatedAt }]' })
    list(@Auth() auth: AuthContext) {
        return this.store.listConsents(auth.userId)
    }

    @Delete(':clientId')
    @ApiOperation({
        summary:
            'Takes the permission back: the refresh tokens of that application for this account stop at once (its access tokens run out within 10 minutes); the next login asks again'
    })
    @ApiOkResponse({ description: '{ revoked: true }' })
    @ApiNotFoundResponse({ description: 'oidc.CONSENT_NOT_FOUND: this account did not allow that application' })
    async revoke(@Auth() auth: AuthContext, @Param('clientId') clientId: string) {
        if (!/^[A-Za-z0-9._-]{1,100}$/.test(clientId) || !(await this.store.deleteConsent(auth.userId, clientId)))
            throw new AppException('oidc.CONSENT_NOT_FOUND', HttpStatus.NOT_FOUND)
        await this.audit.record('account.consent_revoked', {
            tenantId: null,
            actorId: auth.userId,
            target: { type: 'user', id: auth.userId },
            details: { client: clientId }
        })
        return { revoked: true }
    }
}
