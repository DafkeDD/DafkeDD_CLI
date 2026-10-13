import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common'
import {
    ApiAcceptedResponse,
    ApiBadRequestResponse,
    ApiConflictResponse,
    ApiForbiddenResponse,
    ApiOkResponse,
    ApiNotFoundResponse,
    ApiOperation,
    ApiQuery,
    ApiTags,
    ApiTooManyRequestsResponse,
    ApiUnauthorizedResponse
} from '@nestjs/swagger'
import type { Request } from 'express'
import { I18n, I18nContext } from 'nestjs-i18n'
import {
    AcceptInvitationDto,
    EmailDto,
    RegisterDto,
    RegisterEidDto,
    ResetPasswordDto,
    TokenDto
} from './account.dto.js'
import { AccountService } from './account.service.js'

const ip = (request: Request) => request.ip ?? 'unknown'

/**
 * Account pages of the frontend talk to these endpoints (JSON). Errors have the normal translated API shape
 * { statusCode, error, message }: error is for example oidc.INVALID_LINK or oidc.TOO_MANY_ATTEMPTS.
 */
@ApiTags('account')
@Controller('oidc/account')
export class AccountController {
    constructor(private readonly accounts: AccountService) {}

    @Post('register')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({
        summary:
            'Create an account and a new organisation (the account becomes its admin). Sends a verification email. Always answers the same, also when the email address has an account (its owner gets an email instead).'
    })
    @ApiAcceptedResponse({ description: '{ status: "check-email" }' })
    @ApiForbiddenResponse({ description: 'oidc.REGISTRATION_CLOSED (OIDC_REGISTRATION=closed or eid)' })
    @ApiTooManyRequestsResponse({ description: 'oidc.TOO_MANY_ATTEMPTS' })
    register(@Body() body: RegisterDto, @Req() request: Request, @I18n() i18n: I18nContext) {
        return this.accounts.register(body, i18n.lang, ip(request))
    }

    @Get('registration')
    @ApiOperation({ summary: 'Which ways of registering are open: with a password, with the Belgian eID' })
    @ApiOkResponse({ description: '{ password, eid }' })
    registration() {
        return this.accounts.registrationOptions()
    }

    @Post('eid/challenge')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary:
            'Start registering with the Belgian eID: a nonce for the eID bridge and an encrypted challenge to send back (valid 5 minutes)'
    })
    @ApiOkResponse({ description: '{ challenge, nonce, expiresAt }' })
    @ApiNotFoundResponse({ description: 'oidc.EID_DISABLED (OIDC_EID=off)' })
    @ApiTooManyRequestsResponse({ description: 'oidc.TOO_MANY_ATTEMPTS' })
    eidChallenge(@Req() request: Request) {
        return this.accounts.eidChallenge(ip(request))
    }

    @Post('register-eid')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({
        summary:
            'Create an account with the Belgian eID and a new organisation. The name comes from the card; no password. Sends a verification email.'
    })
    @ApiAcceptedResponse({ description: '{ status: "check-email", name }' })
    @ApiBadRequestResponse({ description: 'oidc.EID_EXPIRED: the challenge expired or is invalid' })
    @ApiUnauthorizedResponse({ description: 'oidc.EID_INVALID: the token of the bridge is not valid' })
    @ApiForbiddenResponse({ description: 'oidc.REGISTRATION_CLOSED' })
    @ApiConflictResponse({ description: 'oidc.EID_ALREADY_LINKED: this eID belongs to an account already' })
    @ApiTooManyRequestsResponse({ description: 'oidc.TOO_MANY_ATTEMPTS' })
    registerWithEid(@Body() body: RegisterEidDto, @Req() request: Request, @I18n() i18n: I18nContext) {
        return this.accounts.registerWithEid(body, i18n.lang, ip(request))
    }

    @Post('verify-email')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Confirm an email address with the token of the link in the verification email' })
    @ApiOkResponse({ description: '{ status: "verified", email }' })
    @ApiBadRequestResponse({ description: 'oidc.INVALID_LINK: invalid, expired or for another address' })
    verifyEmail(@Body() body: TokenDto) {
        return this.accounts.verifyEmail(body)
    }

    @Post('resend-verification')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({ summary: 'Send the verification email again (always answers the same)' })
    @ApiAcceptedResponse({ description: '{ status: "check-email" }' })
    @ApiTooManyRequestsResponse({ description: 'oidc.TOO_MANY_ATTEMPTS' })
    resendVerification(@Body() body: EmailDto, @Req() request: Request, @I18n() i18n: I18nContext) {
        return this.accounts.resendVerification(body, i18n.lang, ip(request))
    }

    @Post('forgot-password')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({ summary: 'Send a link to choose a new password (valid 1 hour; always answers the same)' })
    @ApiAcceptedResponse({ description: '{ status: "check-email" }' })
    @ApiTooManyRequestsResponse({ description: 'oidc.TOO_MANY_ATTEMPTS' })
    forgotPassword(@Body() body: EmailDto, @Req() request: Request, @I18n() i18n: I18nContext) {
        return this.accounts.forgotPassword(body, i18n.lang, ip(request))
    }

    @Post('reset-password')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary:
            'Choose a new password with the token of the link. The link works once; every session of the account ends.'
    })
    @ApiOkResponse({ description: '{ status: "password-changed" }' })
    @ApiBadRequestResponse({ description: 'oidc.INVALID_LINK' })
    resetPassword(@Body() body: ResetPasswordDto) {
        return this.accounts.resetPassword(body)
    }

    @Get('invitation')
    @ApiOperation({ summary: 'The details of an invitation, for the page that accepts it' })
    @ApiQuery({ name: 'token', description: 'The token from the link in the invitation email' })
    @ApiOkResponse({ description: '{ email, tenantName, role, inviterName, accountExists }' })
    @ApiBadRequestResponse({ description: 'oidc.INVALID_LINK' })
    invitation(@Query('token') token: string) {
        return this.accounts.invitation(token)
    }

    @Post('invitation/accept')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary:
            'Accept an invitation. With an account it joins the organisation; without one, name and password create it (verified).'
    })
    @ApiOkResponse({ description: '{ status: "accepted", tenantName, accountExists }' })
    @ApiBadRequestResponse({ description: 'oidc.INVALID_LINK or oidc.ACCOUNT_DETAILS_NEEDED' })
    @ApiConflictResponse({ description: 'errors.CONFLICT' })
    acceptInvitation(@Body() body: AcceptInvitationDto, @I18n() i18n: I18nContext) {
        return this.accounts.acceptInvitation(body, i18n.lang)
    }
}
