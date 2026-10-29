import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common'
import {
    ApiBadRequestResponse,
    ApiConflictResponse,
    ApiForbiddenResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
    ApiTooManyRequestsResponse
} from '@nestjs/swagger'
import { Access, Auth, type AuthContext } from '../access/access.js'
import { MfaCodeDto } from './mfa.dto.js'
import { MfaService } from './mfa.service.js'

/** Two-factor authentication of the logged in account (also a superadmin without an organisation). */
@ApiTags('two-factor authentication')
@Controller('me/mfa')
@Access('account')
export class MfaController {
    constructor(private readonly mfa: MfaService) {}

    @Get()
    @ApiOperation({ summary: 'Is two-factor authentication on, and how many recovery codes are left?' })
    @ApiOkResponse({ description: '{ enabled, recoveryCodesLeft }' })
    status(@Auth() auth: AuthContext) {
        return this.mfa.status(auth.userId)
    }

    @Post('setup')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Start setting up: a new secret with its QR code (SVG) and otpauth URL for the authenticator app'
    })
    @ApiOkResponse({ description: '{ secret, otpauthUrl, qrSvg }' })
    @ApiConflictResponse({ description: 'oidc.MFA_ALREADY_ENABLED' })
    setup(@Auth() auth: AuthContext) {
        return this.mfa.setup(auth.userId)
    }

    @Post('enable')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary:
            'Confirm with a first code: two-factor authentication is on. Returns ten recovery codes (shown once); other sessions end.'
    })
    @ApiOkResponse({ description: '{ enabled: true, recoveryCodes }' })
    @ApiBadRequestResponse({ description: 'oidc.MFA_INVALID_CODE or oidc.MFA_SETUP_FIRST' })
    @ApiTooManyRequestsResponse({ description: 'oidc.TOO_MANY_ATTEMPTS' })
    enable(@Auth() auth: AuthContext, @Body() body: MfaCodeDto) {
        return this.mfa.enable(auth.userId, body.code, auth.sessionId || null)
    }

    @Post('disable')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Turn two-factor authentication off (needs a code or a recovery code)' })
    @ApiOkResponse({ description: '{ enabled: false }' })
    @ApiBadRequestResponse({ description: 'oidc.MFA_INVALID_CODE' })
    @ApiForbiddenResponse({
        description:
            'oidc.MFA_REQUIRED: OIDC_MFA=required, it cannot be turned off (or errors.FORBIDDEN: the account is blocked, or oidc.EID_REQUIRED: OIDC_EID_REQUIRED and no eID linked yet)'
    })
    @ApiTooManyRequestsResponse({ description: 'oidc.TOO_MANY_ATTEMPTS' })
    disable(@Auth() auth: AuthContext, @Body() body: MfaCodeDto) {
        return this.mfa.disable(auth.userId, body.code)
    }

    @Post('recovery-codes')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Ten new recovery codes (the old ones stop working; needs a code)' })
    @ApiOkResponse({ description: '{ recoveryCodes }' })
    @ApiBadRequestResponse({ description: 'oidc.MFA_INVALID_CODE' })
    @ApiTooManyRequestsResponse({ description: 'oidc.TOO_MANY_ATTEMPTS' })
    recoveryCodes(@Auth() auth: AuthContext, @Body() body: MfaCodeDto) {
        return this.mfa.regenerateRecoveryCodes(auth.userId, body.code)
    }
}
