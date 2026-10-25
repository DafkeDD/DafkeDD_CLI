import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import {
    ApiBadRequestResponse,
    ApiForbiddenResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
    ApiTooManyRequestsResponse
} from '@nestjs/swagger'
import { Access, Auth, type AuthContext } from '../access/access.js'
import { ChangePasswordDto } from './account.dto.js'
import { AccountService } from './account.service.js'

/** The password of the logged in account (also a superadmin without an organisation). */
@ApiTags('account')
@Controller('me/password')
@Access('account')
export class PasswordController {
    constructor(private readonly accounts: AccountService) {}

    @Post()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary:
            'Choose a new password. Needs the current one, except when the account has none yet (eID only: GET /me/eid says hasPassword). Every other session of the account ends; this one stays.'
    })
    @ApiOkResponse({ description: '{ status: "password-changed", endedSessions }' })
    @ApiBadRequestResponse({ description: 'oidc.SAME_PASSWORD: the new password is the current one' })
    @ApiForbiddenResponse({ description: 'oidc.WRONG_PASSWORD: the current password is missing or not correct' })
    @ApiTooManyRequestsResponse({ description: 'oidc.TOO_MANY_ATTEMPTS' })
    change(@Auth() auth: AuthContext, @Body() body: ChangePasswordDto) {
        return this.accounts.changePassword(auth.userId, body, auth.sessionId || null)
    }
}
