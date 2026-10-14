import { Module } from '@nestjs/common'
import { OidcModule } from '../oidc/oidc.module.js'
import { BillingAdminController } from './billing-admin.controller.js'
import { BillingConfig } from './billing.config.js'
import { BillingController } from './billing.controller.js'
import { BillingService } from './billing.service.js'
import { LicenseGuard } from './license.guard.js'
import { LicensesController } from './licenses.controller.js'
import { MyLicensesController } from './my-licenses.controller.js'
import { FakeProvider } from './payments/fake.provider.js'
import { MollieProvider } from './payments/mollie.provider.js'
import { PAYMENT_PROVIDER } from './payments/payment-provider.js'
import { BILLING_STORE } from './store/billing.store.js'
import { PgBillingStore } from './store/pg-billing.store.js'

/**
 * Licences: products, trials, seats, subscriptions (Mollie), discount codes and free seats. Protect your own routes
 * with @License('product-code') (src/billing/license.guard.ts).
 */
@Module({
    imports: [OidcModule],
    controllers: [LicensesController, MyLicensesController, BillingAdminController, BillingController],
    providers: [
        BillingConfig,
        BillingService,
        LicenseGuard,
        { provide: BILLING_STORE, useClass: PgBillingStore },
        {
            provide: PAYMENT_PROVIDER,
            inject: [BillingConfig],
            useFactory: (config: BillingConfig) => {
                if (config.payments === 'mollie') {
                    if (!/^(test|live)_\w+$/.test(config.mollieApiKey))
                        throw new Error('PAYMENTS=mollie needs MOLLIE_API_KEY (test_... or live_...). See the README.')
                    return new MollieProvider(config.mollieApiKey)
                }
                if (config.payments === 'fake') {
                    if (config.production)
                        throw new Error('PAYMENTS=fake is only for development: use PAYMENTS=mollie.')
                    return new FakeProvider(config.publicApiUrl + '/billing/fake')
                }
                return null
            }
        }
    ],
    exports: [BillingService, LicenseGuard]
})
export class BillingModule {}
