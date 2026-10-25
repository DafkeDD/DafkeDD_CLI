import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Access, Auth, type AuthContext } from '../access/access.js'
import { CatalogService } from './catalog.service.js'

/** The app catalogue of the own organisation, for every member. */
@ApiTags('licences')
@Controller('tenants/current/catalog')
@Access('user')
export class CatalogController {
    constructor(private readonly catalog: CatalogService) {}

    @Get()
    @ApiOperation({
        summary:
            'Every product that is sold, sorted by sort and name: does the organisation have it (owned), may I use it (access), seats, where it opens'
    })
    @ApiOkResponse({
        description:
            '[{ code, name, description, short, icon, category, features, color, requiresVault, demoEnabled, priceMonthCents, priceYearCents, currency, owned, access, trialEndsAt, trialAvailable, seatsUsed, seatsTotal, launchUrl, environment: { name, region, since } | null }]'
    })
    list(@Auth() auth: AuthContext) {
        return this.catalog.catalog(auth)
    }
}
