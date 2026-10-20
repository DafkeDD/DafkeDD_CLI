import { Controller, Get, Param, Post } from '@nestjs/common'
import { ApiConflictResponse, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Access, Auth, type AuthContext } from '../access/access.js'
import { BillingService } from './billing.service.js'
import { ProductCodePipe } from './product-code.pipe.js'

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

    @Post(':productCode/trial')
    @ApiOperation({
        summary: 'Ask a demo: a trial of the product for myself (BILLING_TRIAL_DAYS, 14), once per product'
    })
    @ApiCreatedResponse({ description: '{ userId, endsAt }' })
    @ApiConflictResponse({ description: 'billing.DEMO_USED: the demo of this product was used already' })
    trial(@Auth() auth: AuthContext, @Param('productCode', ProductCodePipe) code: string) {
        return this.billing.requestDemo(auth.tenantId, code, auth.userId)
    }
}
