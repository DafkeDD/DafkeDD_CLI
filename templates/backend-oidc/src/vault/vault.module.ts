import { Module } from '@nestjs/common'
import { BillingModule } from '../billing/billing.module.js'
import { OidcModule } from '../oidc/oidc.module.js'
import { PgVaultStore } from './pg-vault.store.js'
import { VaultController } from './vault.controller.js'
import { VaultAppController } from './vault-app.controller.js'
import { VaultAppService } from './vault-app.service.js'
import { VaultService } from './vault.service.js'
import { VAULT_STORE } from './vault.store.js'

/** The eHealth vault (/me/vault): the eHealth certificate of a doctor, stored encrypted. */
@Module({
    imports: [OidcModule, BillingModule],
    controllers: [VaultController, VaultAppController],
    providers: [VaultService, VaultAppService, { provide: VAULT_STORE, useClass: PgVaultStore }],
    exports: [VaultService]
})
export class VaultModule {}
