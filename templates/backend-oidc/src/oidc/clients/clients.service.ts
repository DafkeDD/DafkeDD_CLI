import { randomBytes } from 'node:crypto'
import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { AuditService } from '../../audit/audit.service.js'
import { AppException } from '../../common/app.exception.js'
import { AppLicenses } from '../app-licenses.js'
import { parseRoles } from '../app-roles.js'
import { sha256 } from '../crypto.js'
import { OIDC, OidcConfig } from '../oidc.config.js'
import { assertRedirectUri } from '../oidc.service.js'
import { type ClientSummary, OIDC_STORE, type OidcClient, type OidcStore } from '../store/oidc.store.js'
import type { ClientFieldsDto, CreateClientDto, LinkDto, LinkRolesDto } from './clients.dto.js'

/** A client as /admin shows it: never the hash of the secret. */
export function publicClient(client: ClientSummary) {
    const { secretHash, ...rest } = client
    return { ...rest, hasSecret: secretHash !== null }
}

const newSecret = () => randomBytes(32).toString('base64url')

/** Letters and digits that cannot be mistaken for each other (no I, O, 0, 1). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** A link code: 24 characters (120 bits) as XXXX-XXXX-XXXX-XXXX-XXXX-XXXX. */
export function newLinkCode(): string {
    const bytes = randomBytes(24)
    const chars = [...bytes].map(byte => CODE_ALPHABET[byte % 32]!)
    return [0, 4, 8, 12, 16, 20].map(start => chars.slice(start, start + 4).join('')).join('-')
}

/** As typed: case and dashes or spaces do not matter. */
export const normalizeLinkCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * The apps (OpenID Connect clients) superadmins make on /admin, next to the ones of config/oidc-clients.json (those
 * stay read-only here). A confidential app gets a secret that is shown once; only its sha256 is stored.
 */
@Injectable()
export class ClientsService {
    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly audit: AuditService,
        private readonly config: OidcConfig,
        private readonly licenses: AppLicenses
    ) {}

    /**
     * The product an app sells (empty: none). It must exist on /licenses (oidc.CLIENT_UNKNOWN_PRODUCT) and can belong to
     * only one app (oidc.CLIENT_PRODUCT_TAKEN): one licence per user per app.
     */
    private async product(code: string | null | undefined, clientId: string | null): Promise<string | null> {
        const product = code?.trim() || null
        if (!product) return null
        if (!(await this.licenses.productExists(product)))
            throw new AppException('oidc.CLIENT_UNKNOWN_PRODUCT', HttpStatus.BAD_REQUEST, { product })
        const owner = (await this.store.listClients()).find(
            client => client.product === product && client.clientId !== clientId
        )
        if (owner)
            throw new AppException('oidc.CLIENT_PRODUCT_TAKEN', HttpStatus.CONFLICT, { product, app: owner.name })
        return product
    }

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
        const product = await this.product(body.product, null)
        const secret = body.type === 'confidential' ? newSecret() : null
        const client: OidcClient = {
            clientId,
            type: body.type,
            secretHash: secret ? sha256(secret) : null,
            backchannelLogoutSessionRequired: false,
            ...fields,
            product
        }
        if (!(await this.store.createClient(client, createdBy)))
            throw new AppException('oidc.CLIENT_EXISTS', HttpStatus.CONFLICT)
        await this.audit.record('platform.client_created', {
            tenantId: null,
            target: { type: 'client', id: clientId },
            details: {
                client: clientId,
                name: fields.name,
                type: body.type,
                firstParty: fields.firstParty,
                product: product ?? undefined
            }
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
        // Without `product` in the body the app keeps the one it sells: only "" or null makes it free
        const product =
            body.product === undefined ? (before.product ?? null) : await this.product(body.product, clientId)
        await this.store.updateClient(clientId, { ...fields, product })
        await this.revokeLinkCodes(clientId)
        await this.audit.record('platform.client_updated', {
            tenantId: null,
            target: { type: 'client', id: clientId },
            details: {
                client: clientId,
                name: fields.name,
                firstParty: fields.firstParty,
                product: product ?? undefined,
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
        await this.revokeLinkCodes(clientId)
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
        await this.revokeLinkCodes(clientId)
        if (client.disabled === !enabled) return this.get(clientId)
        await this.audit.record(enabled ? 'platform.client_enabled' : 'platform.client_disabled', {
            tenantId: null,
            target: { type: 'client', id: clientId },
            details: { client: clientId, name: client.name }
        })
        return this.get(clientId)
    }

    /** Every link code of the app stops (used or not): called whenever the app is changed. A no-op without codes. */
    async revokeLinkCodes(clientId: string) {
        await this.store.deleteLinkCodes(clientId)
    }

    /**
     * A one-time link code for an app made on /admin (15 minutes): the CLI links a new project to this app with it
     * (POST /oidc/link). An earlier unused code of the app stops.
     */
    async linkCode(clientId: string, createdBy: string) {
        const client = await this.editable(clientId)
        if (client.disabled) throw new AppException('oidc.CLIENT_NOT_FOUND', HttpStatus.NOT_FOUND)
        const code = newLinkCode()
        const expiresAt = new Date(Date.now() + OIDC.LINK_CODE_SECONDS * 1000)
        await this.store.createLinkCode(sha256(normalizeLinkCode(code)), clientId, createdBy, expiresAt)
        await this.audit.record('platform.client_link_code', {
            tenantId: null,
            target: { type: 'client', id: clientId },
            details: { client: clientId, name: client.name }
        })
        return { code, expiresAt, issuer: this.config.issuer }
    }

    /**
     * Used by the CLI (no login, the code is the permission): the settings of the app, with the addresses of the new
     * project added to it. A confidential app gets a new secret here (the old one stops), shown only in this answer.
     */
    async link(body: LinkDto) {
        const roles = body.roles === undefined ? null : this.roles(body.roles)
        const clientId = await this.store.useLinkCode(sha256(normalizeLinkCode(body.code)))
        if (!clientId) throw new AppException('oidc.LINK_CODE_INVALID', HttpStatus.BAD_REQUEST)
        if (roles) await this.setRoles(clientId, roles)
        const uri = (value: string) => {
            try {
                assertRedirectUri(value)
            } catch {
                throw new AppException('oidc.CLIENT_INVALID_URI', HttpStatus.BAD_REQUEST, { uri: value.slice(0, 200) })
            }
            return value
        }
        await this.store.addClientUris(clientId, {
            redirectUris: (body.redirectUris ?? []).map(uri),
            postLogoutRedirectUris: (body.postLogoutRedirectUris ?? []).map(uri),
            backchannelLogoutUri: body.backchannelLogoutUri ? uri(body.backchannelLogoutUri) : null
        })
        const client = (await this.store.findClientSummary(clientId))!
        let secret: string | null = null
        if (client.type === 'confidential') {
            secret = newSecret()
            await this.store.setClientSecret(clientId, sha256(secret))
        }
        await this.audit.record('platform.client_linked', {
            tenantId: null,
            target: { type: 'client', id: clientId },
            details: { client: clientId, name: client.name, redirectUri: body.redirectUris?.[0] ?? undefined }
        })
        const issuer = this.config.issuer
        return {
            issuer,
            // The API of this server (the issuer is <API>/oidc) and its own frontend (account, management)
            apiUrl: issuer.replace(/\/oidc$/, ''),
            accountUrl: this.config.appUrl,
            client: {
                clientId,
                name: client.name,
                type: client.type,
                scopes: client.scopes,
                firstParty: client.firstParty,
                refreshTokens: client.grantTypes.includes('refresh_token'),
                // The product the app sells: its API refuses users without a licence (OIDC_PRODUCT)
                product: client.product ?? null,
                roles: (roles ?? client.roles ?? []).map(role => role.key)
            },
            clientSecret: secret
        }
    }

    /** The roles of an app as sent by its developer, checked (400 oidc.ROLES_INVALID with the reason). */
    private roles(value: unknown[]) {
        try {
            return parseRoles(value)
        } catch (error) {
            throw new AppException('oidc.ROLES_INVALID', HttpStatus.BAD_REQUEST, {
                reason: error instanceof Error ? error.message : String(error)
            })
        }
    }

    private async setRoles(clientId: string, roles: ReturnType<typeof parseRoles>) {
        await this.store.setClientRoles(clientId, roles)
        await this.audit.record('platform.client_roles_pushed', {
            tenantId: null,
            target: { type: 'client', id: clientId },
            details: { client: clientId, roles: roles.map(role => role.key).join(',') || 'none' }
        })
    }

    /**
     * The developer of an app sends its roles (npm run roles:push in its backend) with a link code of the app: they
     * replace the roles of the app. Nothing else changes (no new secret, no addresses).
     */
    async pushRoles(body: LinkRolesDto) {
        const roles = this.roles(body.roles)
        const clientId = await this.store.useLinkCode(sha256(normalizeLinkCode(body.code)))
        if (!clientId) throw new AppException('oidc.LINK_CODE_INVALID', HttpStatus.BAD_REQUEST)
        await this.setRoles(clientId, roles)
        return { clientId, roles: roles.map(role => role.key) }
    }

    /**
     * For a catalogue app (client id = app code): switches the OIDC app of it on or off together with the app.
     * Nothing happens without an OIDC app, or for one of the clients file.
     */
    async followProduct(clientId: string, enabled: boolean) {
        const client = await this.store.findClientSummary(clientId)
        if (client?.source !== 'admin') return
        if (client.disabled === !enabled) return this.revokeLinkCodes(clientId)
        await this.setEnabled(clientId, enabled)
    }

    /** For a catalogue app that is deleted: its OIDC app goes along, enabled or not. Nothing without one. */
    async removeWithProduct(clientId: string) {
        const client = await this.store.findClientSummary(clientId)
        if (client?.source !== 'admin') return
        await this.store.deleteClient(clientId)
        await this.audit.record('platform.client_deleted', {
            tenantId: null,
            target: { type: 'client', id: clientId },
            details: { client: clientId, name: client.name }
        })
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
