import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common'
import {
    ApiConflictResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiServiceUnavailableResponse,
    ApiTags
} from '@nestjs/swagger'
import { Access, Auth, type AuthContext } from '../access/access.js'
import { PurchaseDto, SeatsDto } from './billing.dto.js'
import { BillingService } from './billing.service.js'
import { ProductCodePipe } from './product-code.pipe.js'

/** The licences of the own organisation, for its admins: buy seats, give them to members, take them back. */
@ApiTags('licences (admin)')
@Controller('tenants/current/licenses')
@Access('admin')
export class LicensesController {
    constructor(private readonly billing: BillingService) {}

    @Get()
    @ApiOperation({
        summary:
            'Per product: the subscription (seats, month or year, paid until), free seats, the trials and who has a seat'
    })
    @ApiOkResponse({
        description: '[{ product, subscription, grants, seats: { paid, free, total, used }, trials, assignments }]'
    })
    overview(@Auth() auth: AuthContext) {
        return this.billing.overview(auth.tenantId)
    }

    @Post('quote')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'What a purchase costs (with a discount code): the first payment and every renewal' })
    @ApiOkResponse({ description: '{ currency, unitCents, baseCents, firstCents, renewalCents, discount }' })
    quote(@Auth() auth: AuthContext, @Body() body: PurchaseDto) {
        return this.billing.quote(auth.tenantId, body)
    }

    @Post('subscriptions')
    @ApiOperation({
        summary:
            'Buy seats of a product, per month or per year: answers the checkout of Mollie (or nothing when a discount code makes it free)'
    })
    @ApiOkResponse({ description: '{ status: "pending" | "active", checkoutUrl, subscriptionId }' })
    @ApiConflictResponse({ description: 'billing.SUBSCRIPTION_EXISTS: change the seats instead' })
    @ApiServiceUnavailableResponse({ description: 'billing.PAYMENTS_DISABLED (PAYMENTS=off)' })
    subscribe(@Auth() auth: AuthContext, @Body() body: PurchaseDto) {
        return this.billing.subscribe(auth, body)
    }

    @Patch('subscriptions/:productCode')
    @ApiOperation({ summary: 'More seats (a payment for the rest of the period) or fewer (at once, no refund)' })
    @ApiOkResponse({ description: '{ status: "pending" | "updated" | "unchanged", checkoutUrl }' })
    @ApiConflictResponse({ description: 'billing.NO_SUBSCRIPTION, billing.FREE_SUBSCRIPTION or billing.SEATS_IN_USE' })
    seats(@Auth() auth: AuthContext, @Param('productCode', ProductCodePipe) code: string, @Body() body: SeatsDto) {
        return this.billing.changeSeats(auth, code, body.seats)
    }

    @Delete('subscriptions/:productCode')
    @ApiOperation({ summary: 'Cancel: no more renewals; the seats stay until the end of the paid period' })
    @ApiOkResponse({ description: '{ status: "canceled", endsAt }' })
    @ApiConflictResponse({ description: 'billing.NO_SUBSCRIPTION' })
    cancel(@Auth() auth: AuthContext, @Param('productCode', ProductCodePipe) code: string) {
        return this.billing.cancel(auth, code)
    }

    @Post('subscriptions/:id/sync')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'After the checkout: fetch the status of the last payment from the provider (works without a webhook)'
    })
    @ApiOkResponse({ description: '{ payment: "paid" | "open" | "canceled" | ..., subscription, seats }' })
    @ApiNotFoundResponse({ description: 'billing.PAYMENT_NOT_FOUND' })
    sync(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
        return this.billing.sync(auth.tenantId, id)
    }

    @Post(':productCode/trials/:userId')
    @ApiOperation({ summary: 'Start the trial of a member (once per product; new members get it automatically)' })
    @ApiOkResponse({ description: '{ userId, endsAt }' })
    @ApiConflictResponse({ description: 'billing.TRIAL_USED' })
    trial(
        @Auth() auth: AuthContext,
        @Param('productCode', ProductCodePipe) code: string,
        @Param('userId', ParseUUIDPipe) userId: string
    ) {
        return this.billing.startTrial(auth.tenantId, code, userId)
    }

    @Post(':productCode/seats/:userId')
    @ApiOperation({ summary: 'Give a member a seat (paid or free)' })
    @ApiOkResponse({ description: '{ userId, assigned: true }' })
    @ApiConflictResponse({ description: 'billing.NO_FREE_SEAT: buy more seats, or take one back' })
    assign(
        @Auth() auth: AuthContext,
        @Param('productCode', ProductCodePipe) code: string,
        @Param('userId', ParseUUIDPipe) userId: string
    ) {
        return this.billing.assign(auth, code, userId)
    }

    @Delete(':productCode/seats/:userId')
    @ApiOperation({ summary: 'Take a seat back: it is free for another member' })
    @ApiOkResponse({ description: '{ userId, assigned: false }' })
    @ApiNotFoundResponse({ description: 'billing.SEAT_NOT_FOUND' })
    unassign(
        @Auth() auth: AuthContext,
        @Param('productCode', ProductCodePipe) code: string,
        @Param('userId', ParseUUIDPipe) userId: string
    ) {
        return this.billing.unassign(auth.tenantId, code, userId)
    }
}
