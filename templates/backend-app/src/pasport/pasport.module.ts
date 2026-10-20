import { Global, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { MeController } from '../me/me.controller.js'
import { PasportConfig } from './pasport.config.js'
import { PasportGuard } from './pasport.guard.js'
import { PasportKeys } from './pasport-keys.service.js'

/** Login through the login server (Pasport): its access tokens are checked on every route (PasportGuard). */
@Global()
@Module({
    controllers: [MeController],
    providers: [PasportConfig, PasportKeys, { provide: APP_GUARD, useClass: PasportGuard }],
    exports: [PasportConfig, PasportKeys]
})
export class PasportModule {}
