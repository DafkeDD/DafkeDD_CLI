import { Controller, Get, HttpStatus, Inject, Optional, Param, Post, Req, Res } from '@nestjs/common'
import { ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { I18n, I18nContext } from 'nestjs-i18n'
import { escapeHtml, messagePage, sendPage } from '../oidc/pages.js'
import { BillingConfig } from './billing.config.js'
import { BillingService } from './billing.service.js'
import { FakeProvider } from './payments/fake.provider.js'
import { formatAmount, PAYMENT_PROVIDER, type PaymentProvider } from './payments/payment-provider.js'

/** Calls of the payment provider (no login): the webhook, and the checkout of the fake provider for development. */
@ApiTags('licences')
@Controller('billing')
export class BillingController {
    constructor(
        private readonly billing: BillingService,
        private readonly config: BillingConfig,
        @Optional() @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider | null
    ) {}

    @Post('webhook')
    @ApiOperation({
        summary:
            'The webhook of Mollie: id=tr_... (form-encoded). The status is fetched from Mollie, never taken from the call; always 200.'
    })
    @ApiOkResponse({ description: 'Empty' })
    async webhook(@Req() request: Request, @Res() response: Response) {
        const id = (request.body as Record<string, unknown> | undefined)?.id
        // An error (database down) answers 500: Mollie tries again later
        if (typeof id === 'string' && id.length <= 64) await this.billing.handlePayment(id)
        response.status(HttpStatus.OK).send('')
    }

    /** The fake checkout (PAYMENTS=fake): only for development, so not in Swagger. */
    @Get('fake/:id')
    @ApiExcludeEndpoint()
    async fakeCheckout(@Param('id') id: string, @Res() response: Response, @I18n() i18n: I18nContext) {
        const t = (key: string, args?: Record<string, string>) => String(i18n.t(key, args ? { args } : undefined))
        const payment = this.provider instanceof FakeProvider ? await this.provider.getPayment(id) : null
        if (!payment || payment.status !== 'open')
            return sendPage(response, {
                lang: i18n.lang,
                status: 404,
                ...messagePage(t, 'billing.FAKE_TITLE', 'billing.PAYMENT_NOT_FOUND')
            })
        const amount = `€ ${formatAmount(payment.amountCents).replace('.', ',')}`
        const button = (action: string, label: string, style = '') =>
            `<button type="submit" name="action" value="${action}"${style}>${escapeHtml(label)}</button>`
        sendPage(response, {
            lang: i18n.lang,
            title: t('billing.FAKE_TITLE'),
            formTargets: [new URL(this.config.appUrl).origin],
            body:
                `<h1>${escapeHtml(t('billing.FAKE_TITLE'))}</h1>` +
                `<p class="muted">${escapeHtml(t('billing.FAKE_TEXT'))}</p>` +
                `<p><strong>${escapeHtml(this.provider instanceof FakeProvider ? (this.provider.payments.get(id)?.description ?? '') : '')}</strong><br>${escapeHtml(amount)}</p>` +
                `<form method="post" action="${escapeHtml(this.config.publicApiUrl + '/billing/fake/' + encodeURIComponent(id))}">` +
                button('pay', t('billing.FAKE_PAY')) +
                button('cancel', t('billing.FAKE_CANCEL'), ' class="choice"') +
                '</form>'
        })
    }

    @Post('fake/:id')
    @ApiExcludeEndpoint()
    async fakePay(@Param('id') id: string, @Req() request: Request, @Res() response: Response) {
        const action = (request.body as Record<string, unknown> | undefined)?.action
        const next =
            this.provider instanceof FakeProvider
                ? this.provider.complete(id, action === 'pay' ? 'paid' : 'canceled')
                : null
        if (!next) return response.status(HttpStatus.NOT_FOUND).send('')
        // Like the webhook of Mollie
        await this.billing.handlePayment(id)
        response.redirect(HttpStatus.SEE_OTHER, next)
    }
}
