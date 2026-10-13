import { Controller, Get, Res } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { OidcService } from './oidc.service.js'

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414). For an issuer with a path (http://host/oidc) the document lives
 * at /.well-known/oauth-authorization-server/oidc. It is the same document as the OpenID Connect discovery.
 */
@ApiTags('oidc')
@Controller('.well-known')
export class WellKnownController {
    constructor(private readonly oidc: OidcService) {}

    @Get('oauth-authorization-server/oidc')
    @ApiOperation({ summary: 'OAuth 2.0 authorization server metadata (RFC 8414), same content as the discovery' })
    @ApiOkResponse({ description: 'The metadata document' })
    metadata(@Res() response: Response) {
        response.set('Cache-Control', 'public, max-age=300').json(this.oidc.discovery())
    }
}
