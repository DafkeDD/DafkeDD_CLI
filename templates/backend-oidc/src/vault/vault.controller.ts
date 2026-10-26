import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Put } from '@nestjs/common'
import {
    ApiBadRequestResponse,
    ApiForbiddenResponse,
    ApiNoContentResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
    ApiUnprocessableEntityResponse
} from '@nestjs/swagger'
import { Access, Auth, type AuthContext } from '../access/access.js'
import { VaultColleaguesDto, VaultPasswordDto, VaultUploadDto } from './vault.dto.js'
import { VaultService } from './vault.service.js'

const STATUS =
    '{ allowed, cert: null | { filename, sizeBytes, uploadedAt, thumbprint, subject, issuer, serial, validUntil, passwordSaved }, ' +
    'apps: [{ code, name, icon, color, owned }] }'

/** The eHealth vault of the logged in account (doctors of the organisation of the token only). */
@ApiTags('eHealth vault')
@Controller('me/vault')
@Access('account')
export class VaultController {
    constructor(private readonly vault: VaultService) {}

    @Get()
    @ApiOperation({
        summary:
            'May I use the vault (a doctor here), my certificate (never the file or its password) and the apps that need it'
    })
    @ApiOkResponse({ description: STATUS })
    status(@Auth() auth: AuthContext) {
        return this.vault.status(auth)
    }

    @Put()
    @ApiOperation({
        summary:
            'Upload my eHealth certificate (.p12 or .pfx, at most 64 KiB, base64). It replaces the old one; set its password next when it has one.'
    })
    @ApiOkResponse({ description: STATUS })
    @ApiBadRequestResponse({ description: 'oidc.VAULT_INVALID_FILE' })
    @ApiForbiddenResponse({ description: 'oidc.VAULT_NOT_ALLOWED: not a doctor in this organisation' })
    upload(@Auth() auth: AuthContext, @Body() body: VaultUploadDto) {
        return this.vault.upload(auth, body)
    }

    @Put('password')
    @ApiOperation({ summary: 'The password of my certificate: checked by opening it, then stored (encrypted)' })
    @ApiOkResponse({ description: STATUS })
    @ApiForbiddenResponse({ description: 'oidc.VAULT_NOT_ALLOWED' })
    @ApiNotFoundResponse({ description: 'oidc.VAULT_EMPTY: upload the certificate first' })
    @ApiUnprocessableEntityResponse({ description: 'oidc.VAULT_WRONG_PASSWORD' })
    password(@Auth() auth: AuthContext, @Body() body: VaultPasswordDto) {
        return this.vault.setPassword(auth, body.password)
    }

    @Get('colleagues')
    @ApiOperation({
        summary:
            'The colleagues of my organisation, and who of them may use my certificate in the apps (the secretariat)'
    })
    @ApiOkResponse({ description: '[{ userId, name, email, profession, allowed }]' })
    @ApiForbiddenResponse({ description: 'oidc.VAULT_NOT_ALLOWED: not a doctor in this organisation' })
    colleagues(@Auth() auth: AuthContext) {
        return this.vault.colleagues(auth)
    }

    @Put('colleagues')
    @ApiOperation({
        summary:
            'Who of my organisation may use my certificate in the apps: replaces the list ([] nobody), for this organisation only'
    })
    @ApiOkResponse({ description: '[{ userId, name, email, profession, allowed }]' })
    @ApiForbiddenResponse({ description: 'oidc.VAULT_NOT_ALLOWED' })
    @ApiNotFoundResponse({ description: 'oidc.MEMBER_NOT_FOUND: not a member of this organisation' })
    setColleagues(@Auth() auth: AuthContext, @Body() body: VaultColleaguesDto) {
        return this.vault.setColleagues(auth, body.userIds)
    }

    @Delete()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Remove my certificate and its password' })
    @ApiNoContentResponse({ description: 'Removed' })
    remove(@Auth() auth: AuthContext) {
        return this.vault.remove(auth)
    }
}
