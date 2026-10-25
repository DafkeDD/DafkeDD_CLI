import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, StreamableFile } from '@nestjs/common'
import {
    ApiConflictResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiProduces,
    ApiServiceUnavailableResponse,
    ApiTags
} from '@nestjs/swagger'
import { I18n, I18nContext } from 'nestjs-i18n'
import { Access, Auth, type AuthContext } from '../../access/access.js'
import { PayInvoicesDto } from '../billing.dto.js'
import { BillingService } from '../billing.service.js'
import { InvoicesService } from './invoices.service.js'

/** The invoices of the own organisation, for its admins: the list, the PDF and paying the open ones at once. */
@ApiTags('invoices (admin)')
@Controller('tenants/current/invoices')
@Access('admin')
export class InvoicesController {
    constructor(
        private readonly invoices: InvoicesService,
        private readonly billing: BillingService
    ) {}

    @Get()
    @ApiOperation({
        summary: 'The invoices of the current organisation, newest first (asks the provider about open payments first)'
    })
    @ApiOkResponse({
        description:
            '[{ id, number, issuedAt, paidAt, app, productCode, period, seats, amountCents, vatCents, totalCents, status: "open" | "paid" | "free", checkoutUrl }]'
    })
    async list(@Auth() auth: AuthContext) {
        await this.billing.refreshInvoicePayments(auth.tenantId)
        return this.invoices.list(auth.tenantId)
    }

    @Post('pay')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'One checkout for every open invoice; when it is paid, they all are' })
    @ApiOkResponse({ description: '{ checkoutUrl }' })
    @ApiConflictResponse({ description: 'invoices.NOTHING_TO_PAY' })
    @ApiServiceUnavailableResponse({ description: 'billing.PAYMENTS_DISABLED (PAYMENTS=off)' })
    pay(@Auth() auth: AuthContext, @Body() body: PayInvoicesDto) {
        return this.billing.payInvoices(auth, body.returnPath)
    }

    @Get(':id/pdf')
    @ApiOperation({ summary: 'The invoice as PDF (A4), in the language of the request' })
    @ApiProduces('application/pdf')
    @ApiOkResponse({ description: 'application/pdf, as an attachment FAC-YYYY-NNNN.pdf' })
    @ApiNotFoundResponse({ description: 'invoices.NOT_FOUND' })
    async pdf(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @I18n() i18n: I18nContext) {
        const { filename, content } = await this.invoices.pdf(auth.tenantId, id, i18n.lang)
        return new StreamableFile(content, {
            type: 'application/pdf',
            disposition: `attachment; filename="${filename}"`,
            length: content.length
        })
    }
}
