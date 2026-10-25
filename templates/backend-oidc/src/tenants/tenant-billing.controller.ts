import { Body, Controller, Get, Patch } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Access, Auth, type AuthContext } from '../access/access.js'
import { BillingDetailsDto } from './platform.dto.js'
import { TenantsService } from './tenants.service.js'

const DETAILS = '{ company, vat, billingAddress, billingEmail } (null when not filled in)'

/** The billing details of the own organisation: on its invoices. Every member reads them, its admins change them. */
@ApiTags('tenant members')
@Controller('tenants/current/billing')
export class TenantBillingController {
    constructor(private readonly tenants: TenantsService) {}

    @Get()
    @Access('user')
    @ApiOperation({ summary: 'The billing details of the current organisation' })
    @ApiOkResponse({ description: DETAILS })
    details(@Auth() auth: AuthContext) {
        return this.tenants.billing(auth.tenantId)
    }

    @Patch()
    @Access('admin')
    @ApiOperation({ summary: 'Change the billing details (empty or null clears a field). New invoices use them.' })
    @ApiOkResponse({ description: DETAILS })
    update(@Auth() auth: AuthContext, @Body() body: BillingDetailsDto) {
        return this.tenants.updateBilling(auth.tenantId, body)
    }
}
