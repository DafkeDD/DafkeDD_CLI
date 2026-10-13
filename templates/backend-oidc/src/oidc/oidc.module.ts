import { Module } from '@nestjs/common'
import { KeysService } from './keys.service.js'
import { LoginLimiter } from './login-limiter.js'
import { OidcConfig } from './oidc.config.js'
import { OidcController } from './oidc.controller.js'
import { OidcService } from './oidc.service.js'
import { OIDC_STORE } from './store/oidc.store.js'
import { PgOidcStore } from './store/pg-oidc.store.js'
import { WellKnownController } from './well-known.controller.js'

/** The OpenID Connect server: /oidc/... and /.well-known/oauth-authorization-server/oidc. */
@Module({
    controllers: [OidcController, WellKnownController],
    providers: [OidcConfig, OidcService, KeysService, LoginLimiter, { provide: OIDC_STORE, useClass: PgOidcStore }],
    exports: [OidcService, KeysService, OidcConfig]
})
export class OidcModule {}
