import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common'
import {
    ApiBadRequestResponse,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiNoContentResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags
} from '@nestjs/swagger'
import { Access, Auth, type AuthContext } from '../../access/access.js'
import { ClientFieldsDto, ClientStatusDto, CreateClientDto } from './clients.dto.js'
import { ClientsService } from './clients.service.js'

const CLIENT =
    '{ clientId, name, type, source, disabled, redirectUris, postLogoutRedirectUris, backchannelLogoutUri, scopes, grantTypes, firstParty, hasSecret, consents, createdAt, updatedAt }'

/**
 * The apps that may log in with this server (OpenID Connect clients), for superadmins on /admin. Apps of
 * config/oidc-clients.json are listed read-only (source "file"); apps made here can be changed, get a new secret,
 * be disabled and removed.
 */
@ApiTags('apps (superadmin)')
@Controller('admin/clients')
@Access('superadmin')
export class ClientsController {
    constructor(private readonly clients: ClientsService) {}

    @Get()
    @ApiOperation({ summary: 'Every app: the ones of the clients file and the ones made here (never a secret)' })
    @ApiOkResponse({ description: `[${CLIENT}]` })
    list() {
        return this.clients.list()
    }

    @Post()
    @ApiOperation({
        summary: 'Makes an app. A confidential one gets a secret: it is in this answer only, store it in that app.'
    })
    @ApiCreatedResponse({ description: `{ client: ${CLIENT}, secret: "…" | null }` })
    @ApiBadRequestResponse({ description: 'oidc.CLIENT_INVALID_URI, oidc.CLIENT_NO_REDIRECT or validation' })
    @ApiConflictResponse({ description: 'oidc.CLIENT_EXISTS: that client id is taken' })
    create(@Auth() auth: AuthContext, @Body() body: CreateClientDto) {
        return this.clients.create(auth.userId, body)
    }

    @Put(':clientId')
    @ApiOperation({ summary: 'Changes an app made here (not its id or type)' })
    @ApiOkResponse({ description: CLIENT })
    @ApiNotFoundResponse({ description: 'oidc.CLIENT_NOT_FOUND' })
    @ApiConflictResponse({ description: 'oidc.CLIENT_FROM_FILE: change it in config/oidc-clients.json' })
    update(@Param('clientId') clientId: string, @Body() body: ClientFieldsDto) {
        return this.clients.update(clientId, body)
    }

    @Post(':clientId/secret')
    @HttpCode(200)
    @ApiOperation({ summary: 'A new secret for a confidential app: the old one stops at once. In this answer only.' })
    @ApiOkResponse({ description: `{ client: ${CLIENT}, secret }` })
    @ApiConflictResponse({ description: 'oidc.CLIENT_PUBLIC (no secret) or oidc.CLIENT_FROM_FILE' })
    rotate(@Param('clientId') clientId: string) {
        return this.clients.rotateSecret(clientId)
    }

    @Patch(':clientId')
    @ApiOperation({
        summary:
            'Disables or enables an app made here. Disabled: nobody can log in with it, its refresh tokens and codes stop at once.'
    })
    @ApiOkResponse({ description: CLIENT })
    @ApiConflictResponse({ description: 'oidc.CLIENT_FROM_FILE' })
    status(@Param('clientId') clientId: string, @Body() body: ClientStatusDto) {
        return this.clients.setEnabled(clientId, body.enabled)
    }

    @Post(':clientId/link-code')
    @HttpCode(200)
    @ApiOperation({
        summary:
            'A one-time link code (15 minutes) for an app made here: the CLI links a new project to this app with it. An earlier unused code stops.'
    })
    @ApiOkResponse({ description: '{ code: "K7QM-2XPD-9HRT", expiresAt, issuer }' })
    @ApiConflictResponse({ description: 'oidc.CLIENT_FROM_FILE' })
    linkCode(@Auth() auth: AuthContext, @Param('clientId') clientId: string) {
        return this.clients.linkCode(clientId, auth.userId)
    }

    @Delete(':clientId')
    @HttpCode(204)
    @ApiOperation({ summary: 'Removes a disabled app made here, with its codes, refresh tokens and consents' })
    @ApiNoContentResponse({ description: 'Removed' })
    @ApiConflictResponse({ description: 'oidc.CLIENT_DISABLE_FIRST or oidc.CLIENT_FROM_FILE' })
    async remove(@Param('clientId') clientId: string) {
        await this.clients.remove(clientId)
    }
}
