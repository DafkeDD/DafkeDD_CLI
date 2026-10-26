import { Global, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { MeController } from '../me/me.controller.js'
import { PasportConfig } from './pasport.config.js'
import { PasportVault } from './pasport-vault.service.js'
import { VaultController } from './vault.controller.js'
import { PasportGuard } from './pasport.guard.js'
import { PasportKeys } from './pasport-keys.service.js'

/**
 * Login through the login server (Pasport): its access tokens are checked on every route (PasportGuard). PasportVault:
 * the eHealth certificate of a doctor from the vault of the login server (the vault is only there).
 */
@Global()
@Module({
    controllers: [MeController, VaultController],
    providers: [PasportConfig, PasportKeys, PasportVault, { provide: APP_GUARD, useClass: PasportGuard }],
    exports: [PasportConfig, PasportKeys, PasportVault]
})
export class PasportModule {}
