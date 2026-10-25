import { Controller, Delete, Get, Param } from '@nestjs/common'
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Access, Auth, type AuthContext, EidOptional } from '../access/access.js'
import { SessionsService } from './sessions.service.js'

/** The sessions (logged in browsers) of the own account: see them and end them. */
@ApiTags('sessions')
@Controller('me/sessions')
@Access('account')
// Also without a linked eID (OIDC_EID_REQUIRED): logging out keeps working
@EidOptional()
export class SessionsController {
    constructor(private readonly sessions: SessionsService) {}

    @Get()
    @ApiOperation({
        summary:
            'The active sessions of the logged in account: browser, organisation, how it logged in, when; `current` is this one'
    })
    @ApiOkResponse({ description: '[{ id, current, tenant, userAgent, acr, amr, createdAt, lastUsedAt, expiresAt }]' })
    list(@Auth() auth: AuthContext) {
        return this.sessions.list(auth.userId, auth.sessionId)
    }

    @Delete()
    @ApiOperation({ summary: 'Log out everywhere else: ends every session of the account except this one' })
    @ApiOkResponse({ description: '{ ended }: how many sessions ended' })
    endOthers(@Auth() auth: AuthContext) {
        return this.sessions.endOthers(auth.userId, auth.sessionId)
    }

    @Delete(':id')
    @ApiOperation({
        summary: 'End one session of the account (its refresh and access tokens stop at once); this one too logs out'
    })
    @ApiOkResponse({ description: '{ ended: 1 }' })
    @ApiNotFoundResponse({ description: 'oidc.SESSION_NOT_FOUND: not an active session of this account' })
    end(@Auth() auth: AuthContext, @Param('id') id: string) {
        return this.sessions.end(auth.userId, id)
    }
}
