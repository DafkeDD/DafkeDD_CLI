import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common'
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { AppException } from '../../common/app.exception.js'
import { LoginLimiter } from '../login-limiter.js'
import { LinkDto } from './clients.dto.js'
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
            '{ issuer, apiUrl, accountUrl, client: { clientId, name, type, scopes, firstParty, refreshTokens, product }, clientSecret }'
    })
    @ApiBadRequestResponse({
        description: 'oidc.LINK_CODE_INVALID (unknown, used or expired) or oidc.CLIENT_INVALID_URI'
    })
    link(@Req() request: Request, @Body() body: LinkDto) {
        if (!this.limiter.allow(['link:' + (request.ip ?? 'unknown')]))
            throw new AppException('oidc.TOO_MANY_ATTEMPTS', HttpStatus.TOO_MANY_REQUESTS)
        return this.clients.link(body)
    }
}
