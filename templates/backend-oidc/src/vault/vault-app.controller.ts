import { Body, Controller, Header, HttpCode, HttpStatus, Post, Req } from '@nestjs/common'
import {
    ApiBasicAuth,
    ApiConflictResponse,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
    ApiTooManyRequestsResponse,
    ApiUnauthorizedResponse
} from '@nestjs/swagger'
import type { Request } from 'express'
import { AppException } from '../common/app.exception.js'
import { VaultCredentialsDto } from './vault.dto.js'
import { VaultAppService } from './vault-app.service.js'

/** The eHealth certificate for the apps (server to server). Not for browsers: it needs the secret of the app. */
@ApiTags('eHealth vault')
@Controller('vault')
export class VaultAppController {
    constructor(private readonly apps: VaultAppService) {}

    @Post('credentials')
    @HttpCode(HttpStatus.OK)
    @Header('Cache-Control', 'no-store')
    @ApiBasicAuth()
    @ApiOperation({
        summary:
            'For an app that calls eHealth for a doctor: the certificate (.p12, base64) and its password. Basic auth with the client id and secret of the app, the access token of the doctor in the body.'
    })
    @ApiOkResponse({
        description:
            '{ filename, p12Base64, password, thumbprint, subject, issuer, serial, validUntil }. Never cache or log it.'
    })
    @ApiUnauthorizedResponse({
        description: 'oidc.VAULT_APP_UNAUTHORIZED: wrong secret, or the token is not for this app'
    })
    @ApiForbiddenResponse({
        description:
            'oidc.VAULT_APP_NOT_ALLOWED (the app has no product that needs the vault, or the organisation has no licence) or oidc.VAULT_NOT_ALLOWED (not a doctor)'
    })
    @ApiNotFoundResponse({ description: 'oidc.VAULT_EMPTY: the doctor has not uploaded a certificate' })
    @ApiConflictResponse({ description: 'oidc.VAULT_NO_PASSWORD or oidc.VAULT_EXPIRED' })
    @ApiTooManyRequestsResponse({ description: 'oidc.TOO_MANY_ATTEMPTS' })
    credentials(@Req() request: Request, @Body() body: VaultCredentialsDto) {
        const basic = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(request.headers.authorization ?? '')?.[1]
        const decoded = basic ? Buffer.from(basic, 'base64').toString('utf8') : ''
        const separator = decoded.indexOf(':')
        if (separator < 1) throw new AppException('oidc.VAULT_APP_UNAUTHORIZED', HttpStatus.UNAUTHORIZED)
        return this.apps.credentials({
            clientId: decodeURIComponent(decoded.slice(0, separator)),
            clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
            accessToken: body.accessToken,
            ip: request.ip ?? 'unknown'
        })
    }
}
