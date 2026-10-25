import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OidcConfig } from '../oidc/oidc.config.js'

/** Reads the BILLING / PAYMENTS / MOLLIE settings from .env. */
@Injectable()
export class BillingConfig {
    constructor(
        private readonly config: ConfigService,
        private readonly oidc: OidcConfig
    ) {}

    /**
     * PAYMENTS: `mollie` (MOLLIE_API_KEY), `fake` (a checkout page of this API, for development; refused in production)
     * or `off` (nothing can be bought; trials and free seats still work).
     */
    get payments(): 'mollie' | 'fake' | 'off' {
        const value = this.config.get<string>('PAYMENTS') ?? 'off'
        return value === 'mollie' || value === 'fake' ? value : 'off'
    }

    get mollieApiKey(): string {
        return this.config.get<string>('MOLLIE_API_KEY') ?? ''
    }

    /** A demo lasts this many days (14); a member has to ask it. A superadmin can extend a trial. */
    get trialDays(): number {
        const days = Number(this.config.get<string>('BILLING_TRIAL_DAYS') ?? 14)
        return Number.isInteger(days) && days > 0 ? days : 14
    }

    /** The public address of this API: Mollie calls /billing/webhook there. */
    get publicApiUrl(): string {
        return (this.config.get<string>('PUBLIC_API_URL') || new URL(this.oidc.issuer).origin).replace(/\/+$/, '')
    }

    /**
     * The webhook for Mollie, or null when this API is only reachable on this computer (Mollie cannot call localhost;
     * the return page then asks the status itself). Use a tunnel (for example ngrok) as PUBLIC_API_URL to test renewals.
     */
    get webhookUrl(): string | null {
        const host = new URL(this.publicApiUrl).hostname
        return ['localhost', '127.0.0.1', '[::1]'].includes(host) ? null : this.publicApiUrl + '/billing/webhook'
    }

    get appUrl(): string {
        return this.oidc.appUrl
    }

    get production(): boolean {
        return this.oidc.production
    }

    /** Prices are without VAT: BILLING_VAT_PERCENT (21) is added to every payment and shown on the invoices. */
    get vatPercent(): number {
        const percent = Number(this.config.get<string>('BILLING_VAT_PERCENT') ?? 21)
        return Number.isInteger(percent) && percent >= 0 && percent <= 100 ? percent : 21
    }

    /**
     * Who sends the invoices: INVOICE_SELLER_NAME (Pasport), INVOICE_SELLER_ADDRESS (lines separated by "|"),
     * INVOICE_SELLER_VAT, INVOICE_SELLER_EMAIL and INVOICE_SELLER_IBAN (for a bank transfer).
     */
    get seller() {
        const value = (name: string) => this.config.get<string>(name)?.trim() || null
        return {
            name: value('INVOICE_SELLER_NAME') ?? 'Pasport',
            address: (value('INVOICE_SELLER_ADDRESS') ?? '')
                .split('|')
                .map(line => line.trim())
                .filter(Boolean),
            vat: value('INVOICE_SELLER_VAT'),
            email: value('INVOICE_SELLER_EMAIL'),
            iban: value('INVOICE_SELLER_IBAN')
        }
    }
}
