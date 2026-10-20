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
}
