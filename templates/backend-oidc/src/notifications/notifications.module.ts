import { Global, Module } from '@nestjs/common'
import { OidcModule } from '../oidc/oidc.module.js'
import { NotificationsController } from './notifications.controller.js'
import { NotificationsService } from './notifications.service.js'
import { NOTIFICATIONS_STORE } from './notifications.store.js'
import { PgNotificationsStore } from './pg-notifications.store.js'

/**
 * Notifications of accounts (src/notifications). Global: every service can inject NotificationsService to notify the
 * admins of an organisation, one account or the superadmins, or register a source of computed notifications.
 */
@Global()
@Module({
    imports: [OidcModule],
    controllers: [NotificationsController],
    providers: [NotificationsService, { provide: NOTIFICATIONS_STORE, useClass: PgNotificationsStore }],
    exports: [NotificationsService, NOTIFICATIONS_STORE]
})
export class NotificationsModule {}
