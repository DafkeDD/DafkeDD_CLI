import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common'
import {
    ApiBadRequestResponse,
    ApiConflictResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags
} from '@nestjs/swagger'
import { Access, Auth, type AuthContext } from '../../access/access.js'
import { AddPasskeyDto, RenamePasskeyDto } from './passkeys.dto.js'
import { PasskeyService } from './passkey.service.js'

/** The passkeys of the own account: log in with a fingerprint, face or PIN of the device instead of a password. */
@ApiTags('passkeys')
@Controller('me/passkeys')
@Access('account')
export class PasskeysController {
    constructor(private readonly passkeys: PasskeyService) {}

    @Get()
    @ApiOperation({ summary: 'The passkeys of the logged in account, and whether passkeys are on (OIDC_PASSKEYS)' })
    @ApiOkResponse({
        description: '{ enabled, passkeys: [{ id, name, synced, createdAt, lastUsedAt }] }'
    })
    list(@Auth() auth: AuthContext) {
        return this.passkeys.list(auth.userId)
    }

    @Post('options')
    @HttpCode(200)
    @ApiOperation({
        summary:
            'Adding a passkey, step 1: the options for navigator.credentials.create() and a token with the challenge (5 minutes)'
    })
    @ApiOkResponse({
        description: '{ token, options: { challenge, rp, user, pubKeyCredParams, excludeCredentials, … } }'
    })
    @ApiNotFoundResponse({ description: 'oidc.PASSKEYS_DISABLED' })
    options(@Auth() auth: AuthContext) {
        return this.passkeys.registrationOptions(auth.userId)
    }

    @Post()
    @ApiOperation({
        summary: 'Adding a passkey, step 2: the answer of navigator.credentials.create() (max 20 per account)'
    })
    @ApiOkResponse({ description: '{ id, name, synced, createdAt, lastUsedAt }' })
    @ApiBadRequestResponse({ description: 'oidc.PASSKEY_EXPIRED (token) or oidc.PASSKEY_INVALID (checks failed)' })
    @ApiConflictResponse({ description: 'oidc.PASSKEY_EXISTS: already added, or 20 passkeys' })
    add(@Auth() auth: AuthContext, @Body() body: AddPasskeyDto) {
        return this.passkeys.register(auth.userId, body)
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Renames a passkey of the account' })
    @ApiOkResponse({ description: '{ id, name }' })
    @ApiNotFoundResponse({ description: 'oidc.PASSKEY_NOT_FOUND' })
    rename(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: RenamePasskeyDto) {
        return this.passkeys.rename(auth.userId, id, body.name)
    }

    @Delete(':id')
    @ApiOperation({
        summary: 'Removes a passkey (it no longer logs in; the device may still show it until removed there too)'
    })
    @ApiOkResponse({ description: '{ removed: true }' })
    @ApiNotFoundResponse({ description: 'oidc.PASSKEY_NOT_FOUND' })
    @ApiConflictResponse({ description: 'oidc.PASSKEY_LAST_LOGIN: the only way left to log in' })
    async remove(@Auth() auth: AuthContext, @Param('id') id: string) {
        await this.passkeys.remove(auth.userId, id)
        return { removed: true }
    }
}
