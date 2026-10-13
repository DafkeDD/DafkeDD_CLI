import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common'
import {
    ApiBadRequestResponse,
    ApiConflictResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse
} from '@nestjs/swagger'
import { Access, Auth, type AuthContext } from '../access/access.js'
import { EidTokenDto } from './account.dto.js'
import { AccountService } from './account.service.js'

/** The Belgian eID of the logged in account: link it to log in with it, or unlink it. */
@ApiTags('eID')
@Controller('me/eid')
@Access('account')
export class EidController {
    constructor(private readonly accounts: AccountService) {}

    @Get()
    @ApiOperation({ summary: 'Is an eID linked to this account (and is eID login available at all)?' })
    @ApiOkResponse({ description: '{ enabled, linked, linkedAt, lastUsedAt, hasPassword }' })
    status(@Auth() auth: AuthContext) {
        return this.accounts.eidStatus(auth.userId)
    }

    @Post('challenge')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Start linking: a nonce for the eID bridge and an encrypted challenge (5 minutes, this account only)'
    })
    @ApiOkResponse({ description: '{ challenge, nonce, expiresAt }' })
    challenge(@Auth() auth: AuthContext) {
        return this.accounts.linkChallenge(auth.userId)
    }

    @Post()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Link the eID: send the challenge and the token of the bridge (after the PIN)' })
    @ApiOkResponse({ description: 'The new status: { enabled, linked: true, ... }' })
    @ApiBadRequestResponse({ description: 'oidc.EID_EXPIRED' })
    @ApiUnauthorizedResponse({ description: 'oidc.EID_INVALID' })
    @ApiConflictResponse({
        description:
            'oidc.EID_ALREADY_LINKED (another account has this eID) or oidc.EID_OTHER_LINKED (unlink the old eID first)'
    })
    link(@Auth() auth: AuthContext, @Body() body: EidTokenDto) {
        return this.accounts.linkEid(auth.userId, body)
    }

    @Delete()
    @ApiOperation({ summary: 'Unlink the eID (not when the account has no password: the eID is then its only login)' })
    @ApiOkResponse({ description: 'The new status: { enabled, linked: false, ... }' })
    @ApiConflictResponse({ description: 'oidc.EID_ONLY_LOGIN: choose a password first (forgot password)' })
    unlink(@Auth() auth: AuthContext) {
        return this.accounts.unlinkEid(auth.userId)
    }
}
