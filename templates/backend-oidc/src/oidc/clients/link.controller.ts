import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common'
import {
    ApiBadRequestResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
    ApiTooManyRequestsResponse
} from '@nestjs/swagger'
import type { Request } from 'express'
import { AppException } from '../../common/app.exception.js'
import { LoginLimiter } from '../login-limiter.js'
import { LinkDto, LinkRolesDto } from './clients.dto.js'
import { ClientsService } from './clients.service.js'

/** The CLI links a new project to an app with a link code of /admin: no login, the code is the permission. */
@ApiTags('apps (superadmin)')
@Controller('oidc/link')
export class LinkController {
    constructor(
        private readonly clients: ClientsService,
        private readonly limiter: LoginLimiter
    ) {}

    @Post()
    @HttpCode(200)
    @ApiOperation({
        summary:
            'Uses a link code once: the settings of the app (issuer, client id, scopes) with the addresses of the new project added; a confidential app gets a new secret (in this answer only). Rate limited.'
    })
    @ApiOkResponse({
        description:
            '{ issuer, apiUrl, accountUrl, client: { clientId, name, type, scopes, firstParty, refreshTokens, product, roles }, clientSecret }'
    })
    @ApiBadRequestResponse({
        description: 'oidc.LINK_CODE_INVALID (unknown, used or expired), oidc.CLIENT_INVALID_URI or oidc.ROLES_INVALID'
    })
    @ApiTooManyRequestsResponse({ description: 'oidc.TOO_MANY_ATTEMPTS (per IP address)' })
    link(@Req() request: Request, @Body() body: LinkDto) {
        if (!this.limiter.allow(['link:' + (request.ip ?? 'unknown')]))
            throw new AppException('oidc.TOO_MANY_ATTEMPTS', HttpStatus.TOO_MANY_REQUESTS)
        return this.clients.link(body)
    }

    @Post('roles')
    @HttpCode(200)
    @ApiOperation({
        summary:
            'The developer of an app sends its roles (npm run roles:push in the backend of the app) with a link code of the app: they replace its roles. Nothing else changes. Rate limited.'
    })
    @ApiOkResponse({ description: '{ clientId, roles: ["editor", "viewer"] }' })
    @ApiBadRequestResponse({ description: 'oidc.LINK_CODE_INVALID or oidc.ROLES_INVALID (with the reason)' })
    @ApiTooManyRequestsResponse({ description: 'oidc.TOO_MANY_ATTEMPTS (per IP address)' })
    roles(@Req() request: Request, @Body() body: LinkRolesDto) {
        if (!this.limiter.allow(['link:' + (request.ip ?? 'unknown')]))
            throw new AppException('oidc.TOO_MANY_ATTEMPTS', HttpStatus.TOO_MANY_REQUESTS)
        return this.clients.pushRoles(body)
    }
}
