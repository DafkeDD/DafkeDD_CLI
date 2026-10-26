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
import { VaultCredentialsDto, VaultTokenDto } from './vault.dto.js'
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
            'For an app that calls eHealth for a doctor: the certificate (.p12, base64) and its password. Basic auth with the client id and secret of the app, the access token of the logged in account in the body; doctorId: the certificate of a doctor who chose that account (the secretariat).'
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
        return this.apps.credentials({
            ...app(request),
            accessToken: body.accessToken,
            doctorId: body.doctorId ?? null
        })
    }

    @Post('doctors')
    @HttpCode(HttpStatus.OK)
    @Header('Cache-Control', 'no-store')
    @ApiBasicAuth()
    @ApiOperation({
        summary:
            'For an app: the doctors whose certificate the logged in account may use (itself when it is a doctor, and the doctors who chose it on /vault). Basic auth with the client id and secret of the app, its access token in the body.'
    })
    @ApiOkResponse({ description: '[{ id, name, email, self, ready }]' })
    @ApiUnauthorizedResponse({ description: 'oidc.VAULT_APP_UNAUTHORIZED' })
    @ApiForbiddenResponse({ description: 'oidc.VAULT_APP_NOT_ALLOWED' })
    @ApiTooManyRequestsResponse({ description: 'oidc.TOO_MANY_ATTEMPTS' })
    doctors(@Req() request: Request, @Body() body: VaultTokenDto) {
        return this.apps.doctors({ ...app(request), accessToken: body.accessToken })
    }
}

/** The app that asks: client id and secret from the Basic auth header (401 oidc.VAULT_APP_UNAUTHORIZED without). */
function app(request: Request) {
    const basic = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(request.headers.authorization ?? '')?.[1]
    const decoded = basic ? Buffer.from(basic, 'base64').toString('utf8') : ''
    const separator = decoded.indexOf(':')
    if (separator < 1) throw new AppException('oidc.VAULT_APP_UNAUTHORIZED', HttpStatus.UNAUTHORIZED)
    return {
        clientId: decodeURIComponent(decoded.slice(0, separator)),
        clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
        ip: request.ip ?? 'unknown'
    }
}
