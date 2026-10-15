import { randomBytes } from 'node:crypto'
import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { AuditService } from '../../audit/audit.service.js'
import { AppException } from '../../common/app.exception.js'
import { sha256 } from '../crypto.js'
import { OIDC } from '../oidc.config.js'
import { assertRedirectUri } from '../oidc.service.js'
import { type ClientSummary, OIDC_STORE, type OidcClient, type OidcStore } from '../store/oidc.store.js'
import type { ClientFieldsDto, CreateClientDto } from './clients.dto.js'

/** A client as /admin shows it: never the hash of the secret. */
export function publicClient(client: ClientSummary) {
    const { secretHash, ...rest } = client
    return { ...rest, hasSecret: secretHash !== null }
}

const newSecret = () => randomBytes(32).toString('base64url')

/**
 * The apps (OpenID Connect clients) superadmins make on /admin, next to the ones of config/oidc-clients.json (those
 * stay read-only here). A confidential app gets a secret that is shown once; only its sha256 is stored.
 */
@Injectable()
export class ClientsService {
    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly audit: AuditService
    ) {}

    async list() {
        return (await this.store.listClients()).map(publicClient)
    }

    /** The checked fields; throws oidc.CLIENT_INVALID_URI (with the address) for a wrong address. */
    private fields(body: ClientFieldsDto) {
        const uri = (value: string) => {
            try {
                assertRedirectUri(value)
            } catch {
                throw new AppException('oidc.CLIENT_INVALID_URI', HttpStatus.BAD_REQUEST, { uri: value.slice(0, 200) })
            }
            return value
        }
        const unique = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))]
        const redirectUris = unique(body.redirectUris).map(uri)
        if (redirectUris.length === 0) throw new AppException('oidc.CLIENT_NO_REDIRECT', HttpStatus.BAD_REQUEST)
        const allowed: readonly string[] = OIDC.SCOPES
        return {
            name: body.name.trim(),
            redirectUris,
            postLogoutRedirectUris: unique(body.postLogoutRedirectUris ?? []).map(uri),
            backchannelLogoutUri: body.backchannelLogoutUri?.trim() ? uri(body.backchannelLogoutUri.trim()) : null,
            // openid always: it is an OpenID Connect client
            scopes: ['openid', ...allowed.filter(scope => scope !== 'openid' && body.scopes.includes(scope))],
            grantTypes: body.refreshTokens ? ['authorization_code', 'refresh_token'] : ['authorization_code'],
            firstParty: body.firstParty
        }
    }

    private async clientId(body: CreateClientDto) {
        if (body.clientId) return body.clientId
        const base =
            body.name
                .normalize('NFKD')
                .replace(/[̀-ͯ]/g, '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 40) || 'app'
        return `${base}-${randomBytes(3).toString('hex')}`
    }

    /** Makes the app; a confidential one gets its secret here, the only time it is shown. */
    async create(createdBy: string, body: CreateClientDto) {
        const fields = this.fields(body)
        const clientId = await this.clientId(body)
        const secret = body.type === 'confidential' ? newSecret() : null
        const client: OidcClient = {
            clientId,
            type: body.type,
            secretHash: secret ? sha256(secret) : null,
            backchannelLogoutSessionRequired: false,
            ...fields
        }
        if (!(await this.store.createClient(client, createdBy)))
            throw new AppException('oidc.CLIENT_EXISTS', HttpStatus.CONFLICT)
        await this.audit.record('platform.client_created', {
            tenantId: null,
            target: { type: 'client', id: clientId },
            details: { client: clientId, name: fields.name, type: body.type, firstParty: fields.firstParty }
        })
        return { client: await this.get(clientId), secret }
    }

    async get(clientId: string) {
        const client = await this.store.findClientSummary(clientId)
        if (!client) throw new AppException('oidc.CLIENT_NOT_FOUND', HttpStatus.NOT_FOUND)
        return publicClient(client)
    }

    /** Only apps made on /admin: the ones of the clients file are changed in that file. */
    private async editable(clientId: string) {
        const client = await this.store.findClientSummary(clientId)
        if (!client) throw new AppException('oidc.CLIENT_NOT_FOUND', HttpStatus.NOT_FOUND)
        if (client.source !== 'admin') throw new AppException('oidc.CLIENT_FROM_FILE', HttpStatus.CONFLICT)
        return client
    }

    async update(clientId: string, body: ClientFieldsDto) {
        const before = await this.editable(clientId)
        const fields = this.fields(body)
        await this.store.updateClient(clientId, fields)
        await this.audit.record('platform.client_updated', {
            tenantId: null,
            target: { type: 'client', id: clientId },
            details: {
                client: clientId,
                name: fields.name,
                firstParty: fields.firstParty,
                ...(before.firstParty !== fields.firstParty
                    ? { from: String(before.firstParty), to: String(fields.firstParty) }
                    : {})
            }
        })
        return this.get(clientId)
    }

    /** A new secret for a confidential app: the old one stops at once. Shown once. */
    async rotateSecret(clientId: string) {
        const client = await this.editable(clientId)
        if (client.type !== 'confidential') throw new AppException('oidc.CLIENT_PUBLIC', HttpStatus.CONFLICT)
        const secret = newSecret()
        await this.store.setClientSecret(clientId, sha256(secret))
        await this.audit.record('platform.client_secret_rotated', {
            tenantId: null,
            target: { type: 'client', id: clientId },
            details: { client: clientId, name: client.name }
        })
        return { client: await this.get(clientId), secret }
    }

    async setEnabled(clientId: string, enabled: boolean) {
        const client = await this.editable(clientId)
        await this.store.setClientDisabled(clientId, !enabled)
        if (client.disabled === !enabled) return this.get(clientId)
        await this.audit.record(enabled ? 'platform.client_enabled' : 'platform.client_disabled', {
            tenantId: null,
            target: { type: 'client', id: clientId },
            details: { client: clientId, name: client.name }
        })
        return this.get(clientId)
    }

    /** Removes the app with its codes, refresh tokens and consents. Only a disabled one (two steps on purpose). */
    async remove(clientId: string) {
        const client = await this.editable(clientId)
        if (!client.disabled) throw new AppException('oidc.CLIENT_DISABLE_FIRST', HttpStatus.CONFLICT)
        await this.store.deleteClient(clientId)
        await this.audit.record('platform.client_deleted', {
            tenantId: null,
            target: { type: 'client', id: clientId },
            details: { client: clientId, name: client.name }
        })
    }
}
