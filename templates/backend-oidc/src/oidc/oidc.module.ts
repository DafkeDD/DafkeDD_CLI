import { Module } from '@nestjs/common'
import { AccessGuard } from '../access/access.js'
import { MailModule } from '../mail/mail.module.js'
import { AccountController } from './account.controller.js'
import { AccountService } from './account.service.js'
import { KeysService } from './keys.service.js'
import { LoginLimiter } from './login-limiter.js'
import { MfaController } from './mfa.controller.js'
import { MfaService } from './mfa.service.js'
import { OidcConfig } from './oidc.config.js'
import { OidcController } from './oidc.controller.js'
import { OidcService } from './oidc.service.js'
import { OIDC_STORE } from './store/oidc.store.js'
import { PgOidcStore } from './store/pg-oidc.store.js'
import { WellKnownController } from './well-known.controller.js'

/** The OpenID Connect server: /oidc/..., /oidc/account/... and /.well-known/oauth-authorization-server/oidc. */
@Module({
    imports: [MailModule],
    controllers: [OidcController, AccountController, MfaController, WellKnownController],
    providers: [
        OidcConfig,
        OidcService,
        AccountService,
        MfaService,
        KeysService,
        LoginLimiter,
        AccessGuard,
        { provide: OIDC_STORE, useClass: PgOidcStore }
    ],
    exports: [OidcService, AccountService, MfaService, KeysService, OidcConfig, AccessGuard, OIDC_STORE]
})
export class OidcModule {}
