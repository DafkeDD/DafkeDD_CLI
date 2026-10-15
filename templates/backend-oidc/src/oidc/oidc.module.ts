import { Module } from '@nestjs/common'
import { AccessGuard } from '../access/access.js'
import { ExternalService } from './external/external.service.js'
import { AuditModule } from '../audit/audit.module.js'
import { MailModule } from '../mail/mail.module.js'
import { AccountController } from './account.controller.js'
import { AccountService } from './account.service.js'
import { BackchannelService } from './backchannel.service.js'
import { ClientsController } from './clients/clients.controller.js'
import { ClientsService } from './clients/clients.service.js'
import { ConsentsController } from './consents.controller.js'
import { EidController } from './eid.controller.js'
import { EidService } from './eid.service.js'
import { KeysService } from './keys.service.js'
import { LoginLimiter } from './login-limiter.js'
import { MfaController } from './mfa.controller.js'
import { MfaService } from './mfa.service.js'
import { OidcConfig } from './oidc.config.js'
import { PasskeyService } from './passkeys/passkey.service.js'
import { PasskeysController } from './passkeys/passkeys.controller.js'
import { OidcController } from './oidc.controller.js'
import { OidcService } from './oidc.service.js'
import { OIDC_STORE } from './store/oidc.store.js'
import { PgOidcStore } from './store/pg-oidc.store.js'
import { SessionsController } from './sessions.controller.js'
import { SessionsService } from './sessions.service.js'
import { TokensService } from './tokens.service.js'
import { WellKnownController } from './well-known.controller.js'

/** The OpenID Connect server: /oidc/..., /oidc/account/... and /.well-known/oauth-authorization-server/oidc. */
@Module({
    imports: [MailModule, AuditModule],
    controllers: [
        OidcController,
        AccountController,
        MfaController,
        EidController,
        SessionsController,
        PasskeysController,
        ConsentsController,
        ClientsController,
        WellKnownController
    ],
    providers: [
        OidcConfig,
        OidcService,
        ExternalService,
        PasskeyService,
        BackchannelService,
        ClientsService,
        AccountService,
        MfaService,
        EidService,
        TokensService,
        SessionsService,
        KeysService,
        LoginLimiter,
        AccessGuard,
        { provide: OIDC_STORE, useClass: PgOidcStore }
    ],
    exports: [
        OidcService,
        ExternalService,
        PasskeyService,
        BackchannelService,
        TokensService,
        SessionsService,
        AccountService,
        MfaService,
        EidService,
        KeysService,
        OidcConfig,
        AccessGuard,
        OIDC_STORE
    ]
})
export class OidcModule {}
