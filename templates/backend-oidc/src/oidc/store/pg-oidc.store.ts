import { Injectable } from '@nestjs/common'
import type { QueryResultRow } from 'pg'
import { USERS_TABLE } from '../../database/database.constants.js'
import { DatabaseService } from '../../database/database.service.js'
import type { JwsAlgorithm } from '../jose.js'
import type {
    AuthorizationCode,
    AuthorizationParams,
    BootstrapAdmin,
    Interaction,
    Membership,
    OidcClient,
    OidcStore,
    Session,
    StoredKey,
    StoredUser
} from './oidc.store.js'

const USERS = '"' + USERS_TABLE + '"'
const USER_COLUMNS =
    'id, email, email_verified AS "emailVerified", name, locale, password_hash AS "passwordHash", status'
const CLIENT_COLUMNS =
    'client_id AS "clientId", name, type, secret_hash AS "secretHash", redirect_uris AS "redirectUris", ' +
    'post_logout_redirect_uris AS "postLogoutRedirectUris", grant_types AS "grantTypes", scopes, first_party AS "firstParty"'
const CODE_COLUMNS =
    'code_hash AS "codeHash", client_id AS "clientId", user_id AS "userId", tenant_id AS "tenantId", ' +
    'session_hash AS "sessionHash", redirect_uri AS "redirectUri", scope, nonce, code_challenge AS "codeChallenge", ' +
    'auth_time AS "authTime", acr, amr, expires_at AS "expiresAt"'

/**
 * The OpenID Connect data in PostgreSQL. Plain SQL with parameters ($1, $2, ...), never with values in the text.
 * Runs as the owner of the tables (platform code): the login has to find users and tenants across all tenants.
 */
@Injectable()
export class PgOidcStore implements OidcStore {
    constructor(private readonly database: DatabaseService) {}

    private async query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<T[]> {
        await this.database.ready()
        const result = await this.database.query<T>(text, params)
        return result.rows
    }

    async findUserByEmail(email: string) {
        const rows = await this.query<StoredUser>(
            `SELECT ${USER_COLUMNS} FROM ${USERS} WHERE lower(email) = lower($1)`,
            [email]
        )
        return rows[0] ?? null
    }

    async findUserById(id: string) {
        const rows = await this.query<StoredUser>(`SELECT ${USER_COLUMNS} FROM ${USERS} WHERE id = $1`, [id])
        return rows[0] ?? null
    }

    async listMemberships(userId: string) {
        return this.query<Membership>(
            `SELECT t.id AS "tenantId", t.slug, t.name, m.roles
         FROM tenant_members m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = $1 AND t.status = 'active'
        ORDER BY t.name`,
            [userId]
        )
    }

    async findClient(clientId: string) {
        const rows = await this.query<OidcClient>(`SELECT ${CLIENT_COLUMNS} FROM oidc_clients WHERE client_id = $1`, [
            clientId
        ])
        return rows[0] ?? null
    }

    async upsertClient(client: OidcClient) {
        await this.query(
            `INSERT INTO oidc_clients (client_id, name, type, secret_hash, redirect_uris, post_logout_redirect_uris, grant_types, scopes, first_party)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (client_id) DO UPDATE SET
         name = EXCLUDED.name, type = EXCLUDED.type, secret_hash = EXCLUDED.secret_hash,
         redirect_uris = EXCLUDED.redirect_uris, post_logout_redirect_uris = EXCLUDED.post_logout_redirect_uris,
         grant_types = EXCLUDED.grant_types, scopes = EXCLUDED.scopes, first_party = EXCLUDED.first_party, updated_at = now()`,
            [
                client.clientId,
                client.name,
                client.type,
                client.secretHash,
                client.redirectUris,
                client.postLogoutRedirectUris,
                client.grantTypes,
                client.scopes,
                client.firstParty
            ]
        )
    }

    async listKeys() {
        return this.query<StoredKey>(
            `SELECT kid, alg, public_jwk AS "publicJwk", private_key AS "privateKey", status,
              created_at AS "createdAt", retired_at AS "retiredAt"
         FROM oidc_signing_keys ORDER BY created_at`
        )
    }

    async activateKey(key: StoredKey, replaceBefore: Date) {
        await this.database.ready()
        return this.database.transaction(async db => {
            // One instance at a time per algorithm, so two instances never both add a key.
            await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['oidc-keys:' + key.alg])
            const { rows } = await db.query<{ createdAt: Date }>(
                `SELECT created_at AS "createdAt" FROM oidc_signing_keys WHERE alg = $1 AND status = 'active'`,
                [key.alg satisfies JwsAlgorithm]
            )
            const active = rows[0]
            if (active && active.createdAt >= replaceBefore) return false
            await db.query(
                `UPDATE oidc_signing_keys SET status = 'retiring', retired_at = $2 WHERE alg = $1 AND status = 'active'`,
                [key.alg, key.createdAt]
            )
            await db.query(
                `INSERT INTO oidc_signing_keys (kid, alg, public_jwk, private_key, status, created_at)
         VALUES ($1, $2, $3, $4, 'active', $5)`,
                [key.kid, key.alg, JSON.stringify(key.publicJwk), key.privateKey, key.createdAt]
            )
            return true
        })
    }

    async createInteraction(interaction: Interaction) {
        await this.query(
            `INSERT INTO oidc_interactions (id_hash, client_id, params, csrf, user_id, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                interaction.idHash,
                interaction.clientId,
                JSON.stringify(interaction.params),
                interaction.csrf,
                interaction.userId,
                interaction.expiresAt
            ]
        )
    }

    async findInteraction(idHash: string) {
        const rows = await this.query<Interaction & { params: AuthorizationParams }>(
            `SELECT id_hash AS "idHash", client_id AS "clientId", params, csrf, user_id AS "userId", expires_at AS "expiresAt"
         FROM oidc_interactions WHERE id_hash = $1 AND expires_at > now()`,
            [idHash]
        )
        return rows[0] ?? null
    }

    async setInteractionUser(idHash: string, userId: string) {
        await this.query('UPDATE oidc_interactions SET user_id = $2 WHERE id_hash = $1', [idHash, userId])
    }

    async deleteInteraction(idHash: string) {
        await this.query('DELETE FROM oidc_interactions WHERE id_hash = $1', [idHash])
    }

    async createSession(session: Session) {
        await this.query(
            `INSERT INTO oidc_sessions (id_hash, user_id, tenant_id, auth_time, acr, amr, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                session.idHash,
                session.userId,
                session.tenantId,
                session.authTime,
                session.acr,
                session.amr,
                session.expiresAt
            ]
        )
    }

    async findSession(idHash: string) {
        const rows = await this.query<Session>(
            `SELECT id_hash AS "idHash", user_id AS "userId", tenant_id AS "tenantId", auth_time AS "authTime", acr, amr,
              expires_at AS "expiresAt"
         FROM oidc_sessions WHERE id_hash = $1 AND expires_at > now()`,
            [idHash]
        )
        return rows[0] ?? null
    }

    async deleteSession(idHash: string) {
        await this.query('DELETE FROM oidc_sessions WHERE id_hash = $1', [idHash])
    }

    async createCode(code: AuthorizationCode) {
        await this.query(
            `INSERT INTO oidc_codes (code_hash, client_id, user_id, tenant_id, session_hash, redirect_uri, scope, nonce,
                               code_challenge, auth_time, acr, amr, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
                code.codeHash,
                code.clientId,
                code.userId,
                code.tenantId,
                code.sessionHash,
                code.redirectUri,
                code.scope,
                code.nonce,
                code.codeChallenge,
                code.authTime,
                code.acr,
                code.amr,
                code.expiresAt
            ]
        )
    }

    async consumeCode(codeHash: string) {
        // One UPDATE: two requests with the same code can never both get it.
        const rows = await this.query<AuthorizationCode>(
            `UPDATE oidc_codes SET used_at = now()
        WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING ${CODE_COLUMNS}`,
            [codeHash]
        )
        return rows[0] ?? null
    }

    async bootstrapAdmin(admin: BootstrapAdmin) {
        await this.database.ready()
        return this.database.transaction(async db => {
            await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['oidc-bootstrap'])
            const existing = await db.query(`SELECT 1 FROM ${USERS} LIMIT 1`)
            if (existing.rows.length > 0) return false
            const tenant = await db.query<{ id: string }>(
                `INSERT INTO tenants (slug, name) VALUES ($1, $2)
         ON CONFLICT (slug) DO UPDATE SET name = tenants.name RETURNING id`,
                [admin.tenantSlug, admin.tenantName]
            )
            const user = await db.query<{ id: string }>(
                `INSERT INTO ${USERS} (email, email_verified, name, password_hash) VALUES ($1, true, $2, $3) RETURNING id`,
                [admin.email, admin.name, admin.passwordHash]
            )
            await db.query(`INSERT INTO tenant_members (tenant_id, user_id, roles) VALUES ($1, $2, '{admin}')`, [
                tenant.rows[0]?.id,
                user.rows[0]?.id
            ])
            return true
        })
    }

    async deleteExpired(now: Date) {
        await this.query('DELETE FROM oidc_interactions WHERE expires_at <= $1', [now])
        await this.query('DELETE FROM oidc_sessions WHERE expires_at <= $1', [now])
        await this.query('DELETE FROM oidc_codes WHERE expires_at <= $1', [now])
    }
}
