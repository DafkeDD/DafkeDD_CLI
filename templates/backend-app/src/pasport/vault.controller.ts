import { Controller, Get, ParseUUIDPipe, Query, Req } from '@nestjs/common'
import {
    ApiBadGatewayResponse,
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiConflictResponse,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiQuery,
    ApiServiceUnavailableResponse,
    ApiTags,
    ApiUnauthorizedResponse
} from '@nestjs/swagger'
import type { Request } from 'express'
import { Access } from './access.js'
import { PasportVault } from './pasport-vault.service.js'

/**
 * The eHealth certificate of the logged in doctor, from the vault of the login server: what it is, never the file or
 * its password (those stay on this server, for the calls to eHealth: PasportVault.credentials()).
 */
@ApiTags('eHealth vault')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'errors.UNAUTHORIZED: no or no valid access token of the login server' })
@ApiForbiddenResponse({
    description:
        'errors.NO_ORGANISATION (no organisation), errors.NO_LICENSE (no licence of the product of this app) or errors.VAULT_NOT_ALLOWED (not a doctor, and not chosen by one)'
})
@ApiBadGatewayResponse({ description: 'errors.VAULT_UNAVAILABLE: the vault of the login server cannot be reached' })
@ApiServiceUnavailableResponse({ description: 'errors.VAULT_NOT_SET_UP: no OIDC_CLIENT_SECRET' })
@Controller('vault')
export class VaultController {
    constructor(private readonly vault: PasportVault) {}

    @Get('doctors')
    @Access('member')
    @ApiOperation({
        summary:
            'The doctors whose certificate the logged in account may use: itself when it is a doctor, and the doctors of the organisation who chose it on /vault of the login server'
    })
    @ApiOkResponse({
        schema: {
            example: [{ id: '6f1c…', name: 'Dr. An Peeters', email: 'an@example.com', self: false, ready: true }]
        }
    })
    doctors(@Req() request: Request) {
        return this.vault.doctors(bearer(request))
    }

    @Get()
    @Access('member')
    @ApiQuery({
        name: 'doctor',
        required: false,
        description: 'The id of a doctor who chose this account (GET /vault/doctors); without: its own certificate'
    })
    @ApiOperation({
        summary:
            'The eHealth certificate of the doctor in the vault of the login server: subject, issuer, serial, valid until (never the file)'
    })
    @ApiOkResponse({
        schema: {
            example: {
                subject: 'CN=Dr. An Peeters',
                issuer: 'CN=eHealth CA',
                serial: '0A1B2C',
                validUntil: '2027-10-01T00:00:00.000Z',
                thumbprint: 'ab12…'
            }
        }
    })
    @ApiBadRequestResponse({ description: 'errors.BAD_REQUEST: doctor is not a uuid' })
    @ApiNotFoundResponse({ description: 'errors.VAULT_EMPTY: no certificate in the vault yet' })
    @ApiConflictResponse({ description: 'errors.VAULT_NOT_READY: its password is missing or it has expired' })
    async certificate(
        @Req() request: Request,
        @Query('doctor', new ParseUUIDPipe({ optional: true })) doctor?: string
    ) {
        const { subject, issuer, serial, validUntil, thumbprint } = await this.vault.credentials(
            bearer(request),
            doctor
        )
        return { subject, issuer, serial, validUntil, thumbprint }
    }
}

/** The access token of the logged in account (the guard checked it already). */
function bearer(request: Request) {
    return /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? ''
}
