import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

/** The login server (Pasport) whose access tokens this API accepts. Everything comes from .env. */
@Injectable()
export class PasportConfig {
    constructor(private readonly config: ConfigService) {}

    /** The issuer of the login server, for example http://localhost:4000/oidc. */
    get issuer(): string {
        return (this.config.get<string>('OIDC_ISSUER') ?? '__ISSUER__').replace(/\/+$/, '')
    }

    /** The audience (aud) of its access tokens: the API of the login server. */
    get audience(): string {
        return (this.config.get<string>('OIDC_AUDIENCE') ?? '__AUDIENCE__').replace(/\/+$/, '')
    }

    /**
     * The product (licence code on the login server) this app sells: members need a licence of it (OIDC_PRODUCT).
     * Empty: the app is free, no licence is checked.
     */
    get product(): string | null {
        return (this.config.get<string>('OIDC_PRODUCT') ?? '__PRODUCT__').trim() || null
    }

    /** The apps (client_id) whose tokens this API accepts: this app's frontend, and others you trust. */
    get clientIds(): string[] {
        return (this.config.get<string>('OIDC_CLIENT_IDS') ?? '__CLIENT_ID__')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean)
    }
}
