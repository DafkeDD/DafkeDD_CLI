import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common'
import {
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiNoContentResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags
} from '@nestjs/swagger'
import { Access, Auth, type AuthContext } from '../access/access.js'
import { ClientsService } from '../oidc/clients/clients.service.js'
import {
    DiscountActiveDto,
    DiscountDto,
    ExtendTrialDto,
    GrantDto,
    ProductDto,
    UpdateProductDto
} from './billing.dto.js'
import { BillingService } from './billing.service.js'
import { ProductCodePipe } from './product-code.pipe.js'

/** Products, discount codes, free seats and trials of the whole platform, for superadmins only. */
@ApiTags('licences (superadmin)')
@Controller('admin')
@Access('superadmin')
export class BillingAdminController {
    constructor(
        private readonly billing: BillingService,
        private readonly clients: ClientsService
    ) {}

    @Get('products')
    @ApiOperation({ summary: 'Every product, also the ones that are no longer sold' })
    @ApiOkResponse({
        description:
            '[{ id, code, name, description, priceMonthCents, priceYearCents, currency, active, icon, category, short, features, color, requiresVault, demoEnabled, launchUrl, sort }]'
    })
    products() {
        return this.billing.products()
    }

    @Post('products')
    @ApiOperation({ summary: 'A new product, sold per user (seat): a price per month and a (cheaper) price per year' })
    @ApiCreatedResponse({ description: 'The product' })
    @ApiConflictResponse({ description: 'billing.PRODUCT_EXISTS' })
    createProduct(@Body() body: ProductDto) {
        return this.billing.createProduct(body)
    }

    @Patch('products/:code')
    @ApiOperation({ summary: 'Change a product: name, description, prices (new purchases), or stop selling it' })
    @ApiOkResponse({ description: 'The product' })
    async updateProduct(@Param('code', ProductCodePipe) code: string, @Body() body: UpdateProductDto) {
        const updated = await this.billing.updateProduct(code, body)
        // The OIDC app of this product (client id = code) follows: off with the product, and its link codes stop
        if (body.active === undefined) await this.clients.revokeLinkCodes(code)
        else await this.clients.followProduct(code, body.active)
        return updated
    }

    @Delete('products/:code')
    @HttpCode(204)
    @ApiOperation({
        summary:
            'Remove a product from the catalogue, with its free seats and trials, and the OIDC app with the same code'
    })
    @ApiNoContentResponse({ description: 'Removed' })
    @ApiConflictResponse({ description: 'billing.PRODUCT_IN_USE: an organisation still has a running subscription' })
    async deleteProduct(@Param('code', ProductCodePipe) code: string) {
        await this.billing.deleteProduct(code)
        // Its OIDC app (client id = code) goes along, so no app is left behind that can still log in
        await this.clients.removeWithProduct(code)
    }

    @Get('discounts')
    @ApiOperation({ summary: 'Every discount code, with how often it was used' })
    @ApiOkResponse({ description: '[{ code, percentOff, amountOffCents, productCode, duration, redemptions, ... }]' })
    discounts() {
        return this.billing.discounts()
    }

    @Post('discounts')
    @ApiOperation({
        summary:
            'Make a discount code: a percentage (100 = free) or an amount, for one product or all, once, for N periods or forever'
    })
    @ApiCreatedResponse({ description: 'The code (a random one when none was given)' })
    @ApiConflictResponse({ description: 'billing.DISCOUNT_EXISTS' })
    createDiscount(@Auth() auth: AuthContext, @Body() body: DiscountDto) {
        return this.billing.createDiscount(auth.userId, body)
    }

    @Patch('discounts/:code')
    @ApiOperation({ summary: 'Switch a discount code off (or on again); purchases that used it keep their discount' })
    @ApiOkResponse({ description: '{ code, active }' })
    setDiscount(@Param('code') code: string, @Body() body: DiscountActiveDto) {
        return this.billing.setDiscountActive(code, body.active)
    }

    @Get('tenants/:id/licenses')
    @ApiOperation({ summary: 'The licences of any organisation (the same overview its admins see)' })
    @ApiOkResponse({ description: 'See GET /tenants/current/licenses' })
    licenses(@Param('id', ParseUUIDPipe) id: string) {
        return this.billing.overview(id)
    }

    @Post('tenants/:id/grants')
    @ApiOperation({ summary: 'Give an organisation free seats of a product, until a date or for good' })
    @ApiCreatedResponse({ description: 'The grant' })
    grant(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: GrantDto) {
        return this.billing.grant(auth.userId, id, body)
    }

    @Delete('tenants/:id/grants/:grantId')
    @ApiOperation({ summary: 'Take free seats back' })
    @ApiOkResponse({ description: '{ id, deleted: true }' })
    revokeGrant(@Param('id', ParseUUIDPipe) id: string, @Param('grantId', ParseUUIDPipe) grantId: string) {
        return this.billing.revokeGrant(id, grantId)
    }

    @Post('tenants/:id/trials')
    @ApiOperation({
        summary:
            'Extend the trial of a member by a number of days (or start one, also after an ended one); also when the demo of the product is off'
    })
    @ApiCreatedResponse({ description: '{ userId, endsAt }' })
    extendTrial(@Param('id', ParseUUIDPipe) id: string, @Body() body: ExtendTrialDto) {
        return this.billing.extendTrial(id, body.productCode, body.userId, body.days)
    }

    @Delete('tenants/:id/trials/:productCode/:userId')
    @ApiOperation({ summary: 'End the running trial of a member now (it stays: it counts as used)' })
    @ApiOkResponse({ description: '{ userId, endsAt }' })
    @ApiNotFoundResponse({ description: 'billing.TRIAL_NOT_FOUND: no running trial' })
    endTrial(
        @Param('id', ParseUUIDPipe) id: string,
        @Param('productCode', ProductCodePipe) code: string,
        @Param('userId', ParseUUIDPipe) userId: string
    ) {
        return this.billing.endTrial(id, code, userId)
    }
}
