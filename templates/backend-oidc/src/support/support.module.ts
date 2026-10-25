import { Module } from '@nestjs/common'
import { BillingModule } from '../billing/billing.module.js'
import { MailModule } from '../mail/mail.module.js'
import { OidcModule } from '../oidc/oidc.module.js'
import { PgTicketsStore } from './pg-tickets.store.js'
import { SupportAdminController, TicketsController } from './tickets.controller.js'
import { TicketsService } from './tickets.service.js'
import { TICKETS_STORE } from './tickets.store.js'

/** Support tickets (src/support): members ask, the support team (superadmins) answers. */
@Module({
    imports: [OidcModule, BillingModule, MailModule],
    controllers: [TicketsController, SupportAdminController],
    providers: [TicketsService, { provide: TICKETS_STORE, useClass: PgTicketsStore }],
    exports: [TicketsService]
})
export class SupportModule {}
