import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Access, Auth, type AuthContext } from '../access/access.js'
import { BillingService } from './billing.service.js'

/** The licences of the logged in account, in the organisation of its token. */
@ApiTags('licences')
@Controller('me/licenses')
@Access('user')
export class MyLicensesController {
    constructor(private readonly billing: BillingService) {}

    @Get()
    @ApiOperation({ summary: 'Which products may I use here: through a trial (until when) or a seat' })
    @ApiOkResponse({ description: '[{ code, name, access, via: "trial" | "seat" | "superadmin", endsAt }]' })
    mine(@Auth() auth: AuthContext) {
        return this.billing.mine(auth.tenantId, auth.userId, auth.superadmin)
    }
}
