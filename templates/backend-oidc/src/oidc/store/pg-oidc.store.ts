import { randomBytes } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import type { QueryResultRow } from 'pg'
import { USERS_TABLE } from '../../database/database.constants.js'
import { DatabaseService, type Queryable } from '../../database/database.service.js'
import type { JwsAlgorithm } from '../jose.js'
import type {
    AppRole,
    AuthorizationCode,
    BootstrapAdmin,
    ChangeResult,
    ClientChanges,
    ClientSummary,
    Consent,
    IdentifierType,
    Invitation,
    LinkResult,
    LogoutJob,
    MemberStatus,
    Membership,
    MfaState,
    RefreshToken,
    RotateResult,
    NewAccount,
    NewPasskey,
    OidcClient,
    OutOfOffice,
    Presence,
    Profession,
    ProfileChanges,
    TenantChanges,
    TenantDetails,
    TenantSummary,
    UserProfile,
    Passkey,
    OidcStore,
    Session,
    SessionSummary,
    StoredKey,
    StoredUser,
    Tenant,
    TenantMember,
    TenantRole,
    UserIdentifier
} from './oidc.store.js'

const USERS = '"' + USERS_TABLE + '"'
const USER_COLUMNS =
    'id, email, email_verified AS "emailVerified", name, locale, password_hash AS "passwordHash", status, ' +
    'is_superadmin AS "isSuperadmin", totp_enabled AS "mfaEnabled"'
const TENANT_COLUMNS = 'id, slug, name, status, created_at AS "createdAt"'
const PROFILE_COLUMNS =
    'first_name AS "firstName", last_name AS "lastName", phone, pending_email AS "pendingEmail", ' +
    'rrn_enc AS "rrnEncrypted", address'
const DETAIL_COLUMNS =
    'company, vat, billing_address AS "billingAddress", billing_email AS "billingEmail", city, plan, ' +
    'contact_name AS "contactName"'
/** Columns of the fields of a profile and of a tenant that can change. */
const PROFILE_FIELDS: Record<keyof ProfileChanges, string> = {
    firstName: 'first_name',
    lastName: 'last_name',
    phone: 'phone',
    name: 'name',
    locale: 'locale'
}
const TENANT_FIELDS: Record<keyof TenantChanges, string> = {
    name: 'name',
    company: 'company',
    vat: 'vat',
    billingAddress: 'billing_address',
    billingEmail: 'billing_email',
    city: 'city',
    plan: 'plan',
    contactName: 'contact_name'
}

/** "a = $2, b = $3" of the fields that are given (undefined stays as it is), the values from $2 on. */
function setFields<K extends string>(changes: Partial<Record<K, unknown>>, columns: Record<K, string>) {
    const entries = (Object.entries(changes) as [K, unknown][]).filter(
        ([key, value]) => value !== undefined && columns[key]
    )
    return {
        sql: entries.map(([key], index) => `${columns[key]} = $${index + 2}`).join(', '),
        values: entries.map(([, value]) => value)
    }
}

const INVITATION_COLUMNS =
    'id, tenant_id AS "tenantId", email, role, invited_by AS "invitedBy", apps, created_at AS "createdAt", expires_at AS "expiresAt"'

/** A slug that is still free: the wanted one, or the wanted one with a short random suffix. */
const slugCandidate = (slug: string, attempt: number) =>
    attempt === 0 ? slug : slug.slice(0, 57).replace(/-+$/, '') + '-' + randomBytes(2).toString('hex')

async function insertTenant(db: Queryable, name: string, slug: string): Promise<Tenant> {
    for (let attempt = 0; attempt < 8; attempt++) {
        const { rows } = await db.query<Tenant>(
            `INSERT INTO tenants (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING RETURNING ${TENANT_COLUMNS}`,
            [slugCandidate(slug, attempt), name]
        )
        if (rows[0]) return rows[0]
    }
    throw new Error('Could not find a free slug for tenant ' + name)
}

const insertUser = async (db: Queryable, account: NewAccount) =>
    (
        await db.query<StoredUser>(
            `INSERT INTO ${USERS} (email, email_verified, name, locale, password_hash, first_name, last_name, phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (lower(email)) DO NOTHING RETURNING ${USER_COLUMNS}`,
            [
                account.email,
                account.emailVerified,
                account.name,
                account.locale,
                account.passwordHash,
                account.firstName ?? null,
                account.lastName ?? null,
                account.phone ?? null
            ]
        )
    ).rows[0] ?? null
const PASSKEY_COLUMNS =
    'id, user_id AS "userId", credential_id AS "credentialId", public_key AS "publicKey", algorithm, ' +
    'sign_count::int AS "signCount", name, aaguid, backup_eligible AS "backupEligible", backed_up AS "backedUp", ' +
    'transports, created_at AS "createdAt", last_used_at AS "lastUsedAt"'
const IDENTIFIER_COLUMNS =
    'type, value_hash AS "valueHash", user_id AS "userId", created_at AS "createdAt", last_used_at AS "lastUsedAt"'

/** Rolls back registerWithIdentifier and createUserWithIdentifier when the identifier belongs to an account already. */
class IdentifierTaken extends Error {}

/** A uuid as PostgreSQL accepts it: anything else can never be a session id (and would make the query fail). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SESSION_COLUMNS =
    'id, id_hash AS "idHash", interaction_hash AS "interactionHash", user_id AS "userId", tenant_id AS "tenantId", ' +
    'auth_time AS "authTime", acr, amr, expires_at AS "expiresAt", user_agent AS "userAgent"'
const REFRESH_COLUMNS =
    'token_hash AS "tokenHash", family_id AS "familyId", session_id AS "sessionId", client_id AS "clientId", ' +
    'user_id AS "userId", tenant_id AS "tenantId", scope, expires_at AS "expiresAt", used_at AS "usedAt", revoked_at AS "revokedAt"'

const CLIENT_COLUMNS =
    'client_id AS "clientId", name, type, secret_hash AS "secretHash", redirect_uris AS "redirectUris", ' +
    'post_logout_redirect_uris AS "postLogoutRedirectUris", grant_types AS "grantTypes", scopes, first_party AS "firstParty", ' +
    'backchannel_logout_uri AS "backchannelLogoutUri", backchannel_logout_session_required AS "backchannelLogoutSessionRequired", product, roles'
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
            `SELECT t.id AS "tenantId", t.slug, t.name, m.role
         FROM tenant_members m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = $1 AND m.status = 'active' AND t.status = 'active'
        ORDER BY t.name`,
            [userId]
        )
    }

    async findClient(clientId: string) {
        const rows = await this.query<OidcClient>(
            `SELECT ${CLIENT_COLUMNS} FROM oidc_clients WHERE client_id = $1 AND disabled_at IS NULL`,
            [clientId]
        )
        return rows[0] ?? null
    }

    // ---------------------------------------------------------------- clients on /admin

    private summaries(where: string, params: unknown[]) {
        return this.query<ClientSummary>(
            `SELECT ${CLIENT_COLUMNS}, source, disabled_at IS NOT NULL AS disabled, created_at AS "createdAt",
              updated_at AS "updatedAt",
              (SELECT count(*)::int FROM oidc_consents k WHERE k.client_id = oidc_clients.client_id) AS consents
         FROM oidc_clients ${where} ORDER BY source DESC, lower(name)`,
            params
        )
    }

    async listClients() {
        return this.summaries('', [])
    }

    async findClientSummary(clientId: string) {
        return (await this.summaries('WHERE client_id = $1', [clientId]))[0] ?? null
    }

    async createClient(client: OidcClient, createdBy: string) {
        const rows = await this.query(
            `INSERT INTO oidc_clients (client_id, name, type, secret_hash, redirect_uris, post_logout_redirect_uris, grant_types, scopes,
                           first_party, backchannel_logout_uri, backchannel_logout_session_required, product, roles, source, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $13, $14, 'admin', $12)
       ON CONFLICT (client_id) DO NOTHING RETURNING 1`,
            [
                client.clientId,
                client.name,
                client.type,
                client.secretHash,
                client.redirectUris,
                client.postLogoutRedirectUris,
                client.grantTypes,
                client.scopes,
                client.firstParty,
                client.backchannelLogoutUri ?? null,
                client.backchannelLogoutSessionRequired ?? false,
                createdBy,
                client.product ?? null,
                JSON.stringify(client.roles ?? [])
            ]
        )
        return rows.length === 1
    }

    async updateClient(clientId: string, changes: ClientChanges) {
        const columns: Record<keyof ClientChanges, string> = {
            name: 'name',
            redirectUris: 'redirect_uris',
            postLogoutRedirectUris: 'post_logout_redirect_uris',
            backchannelLogoutUri: 'backchannel_logout_uri',
            scopes: 'scopes',
            grantTypes: 'grant_types',
            firstParty: 'first_party',
            product: 'product'
        }
        const sets: string[] = []
        const params: unknown[] = [clientId]
        for (const [key, column] of Object.entries(columns) as [keyof ClientChanges, string][]) {
            if (changes[key] === undefined) continue
            params.push(changes[key])
            sets.push(`${column} = $${params.length}`)
        }
        const rows = await this.query(
            `UPDATE oidc_clients SET ${[...sets, 'updated_at = now()'].join(', ')}
        WHERE client_id = $1 AND source = 'admin' RETURNING 1`,
            params
        )
        return rows.length === 1
    }

    async setClientSecret(clientId: string, secretHash: string) {
        const rows = await this.query(
            `UPDATE oidc_clients SET secret_hash = $2, updated_at = now()
        WHERE client_id = $1 AND source = 'admin' AND type = 'confidential' RETURNING 1`,
            [clientId, secretHash]
        )
        return rows.length === 1
    }

    async setClientDisabled(clientId: string, disabled: boolean) {
        await this.database.ready()
        return this.database.transaction(async db => {
            const { rowCount } = await db.query(
                `UPDATE oidc_clients SET disabled_at = CASE WHEN $2 THEN coalesce(disabled_at, now()) END, updated_at = now()
          WHERE client_id = $1 AND source = 'admin'`,
                [clientId, disabled]
            )
            if (!rowCount) return false
            if (disabled) {
                // Off at once: no new tokens with its refresh tokens, no code exchanged any more
                await db.query(
                    'UPDATE oidc_refresh_tokens SET revoked_at = now() WHERE client_id = $1 AND revoked_at IS NULL',
                    [clientId]
                )
                await db.query('DELETE FROM oidc_codes WHERE client_id = $1', [clientId])
            }
            return true
        })
    }

    async createLinkCode(codeHash: string, clientId: string, createdBy: string, expiresAt: Date) {
        await this.database.ready()
        await this.database.transaction(async db => {
            // One code at a time per app
            await db.query('DELETE FROM oidc_link_codes WHERE client_id = $1 AND used_at IS NULL', [clientId])
            await db.query(
                'INSERT INTO oidc_link_codes (code_hash, client_id, created_by, expires_at) VALUES ($1, $2, $3, $4)',
                [codeHash, clientId, createdBy, expiresAt]
            )
        })
    }

    async deleteLinkCodes(clientId: string) {
        await this.query('DELETE FROM oidc_link_codes WHERE client_id = $1', [clientId])
    }

    async useLinkCode(codeHash: string) {
        const rows = await this.query<{ clientId: string }>(
            `UPDATE oidc_link_codes l SET used_at = now()
          FROM oidc_clients c
        WHERE l.code_hash = $1 AND l.used_at IS NULL AND l.expires_at > now()
          AND c.client_id = l.client_id AND c.disabled_at IS NULL AND c.source = 'admin'
        RETURNING l.client_id AS "clientId"`,
            [codeHash]
        )
        return rows[0]?.clientId ?? null
    }

    async addClientUris(
        clientId: string,
        uris: { redirectUris: string[]; postLogoutRedirectUris: string[]; backchannelLogoutUri: string | null }
    ) {
        const rows = await this.query(
            `UPDATE oidc_clients SET
           redirect_uris = ARRAY(SELECT DISTINCT unnest(redirect_uris || $2::text[])),
           post_logout_redirect_uris = ARRAY(SELECT DISTINCT unnest(post_logout_redirect_uris || $3::text[])),
           backchannel_logout_uri = coalesce(backchannel_logout_uri, $4),
           updated_at = now()
         WHERE client_id = $1 AND source = 'admin' RETURNING 1`,
            [clientId, uris.redirectUris, uris.postLogoutRedirectUris, uris.backchannelLogoutUri]
        )
        return rows.length === 1
    }

    async deleteClient(clientId: string) {
        const rows = await this.query(
            "DELETE FROM oidc_clients WHERE client_id = $1 AND source = 'admin' RETURNING 1",
            [clientId]
        )
        return rows.length === 1
    }

    async upsertClient(client: OidcClient) {
        const rows = await this.query(
            `INSERT INTO oidc_clients (client_id, name, type, secret_hash, redirect_uris, post_logout_redirect_uris, grant_types, scopes,
                           first_party, backchannel_logout_uri, backchannel_logout_session_required, product, roles)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (client_id) DO UPDATE SET
         name = EXCLUDED.name, type = EXCLUDED.type, secret_hash = EXCLUDED.secret_hash,
         redirect_uris = EXCLUDED.redirect_uris, post_logout_redirect_uris = EXCLUDED.post_logout_redirect_uris,
         grant_types = EXCLUDED.grant_types, scopes = EXCLUDED.scopes, first_party = EXCLUDED.first_party,
         backchannel_logout_uri = EXCLUDED.backchannel_logout_uri,
         backchannel_logout_session_required = EXCLUDED.backchannel_logout_session_required,
         product = EXCLUDED.product, roles = EXCLUDED.roles, updated_at = now()
       -- Never a client made on /admin
       WHERE oidc_clients.source = 'file'
       RETURNING 1`,
            [
                client.clientId,
                client.name,
                client.type,
                client.secretHash,
                client.redirectUris,
                client.postLogoutRedirectUris,
                client.grantTypes,
                client.scopes,
                client.firstParty,
                client.backchannelLogoutUri ?? null,
                client.backchannelLogoutSessionRequired ?? false,
                client.product ?? null,
                JSON.stringify(client.roles ?? [])
            ]
        )
        return rows.length === 1
    }

    // ---------------------------------------------------------------- consent and back-channel logout

    async findConsent(userId: string, clientId: string) {
        const rows = await this.query<Consent>(
            `SELECT client_id AS "clientId", scopes, tenant_ids::text[] AS "tenantIds", created_at AS "createdAt",
              updated_at AS "updatedAt"
         FROM oidc_consents WHERE user_id = $1 AND client_id = $2`,
            [userId, clientId]
        )
        return rows[0] ?? null
    }

    async saveConsent(userId: string, clientId: string, scopes: string[], tenantId: string | null = null) {
        await this.query(
            `INSERT INTO oidc_consents (user_id, client_id, scopes, tenant_ids) VALUES ($1, $2, $3, $4::uuid[])
       ON CONFLICT (user_id, client_id) DO UPDATE
         SET scopes = ARRAY(SELECT DISTINCT unnest(oidc_consents.scopes || EXCLUDED.scopes) ORDER BY 1),
             tenant_ids = ARRAY(SELECT DISTINCT unnest(oidc_consents.tenant_ids || EXCLUDED.tenant_ids)),
             updated_at = now()`,
            [userId, clientId, [...new Set(scopes)].sort(), tenantId ? [tenantId] : []]
        )
    }

    async useInteraction(interactionHash: string, expiresAt: Date) {
        const rows = await this.query(
            `INSERT INTO oidc_used_interactions (interaction_hash, expires_at) VALUES ($1, $2)
       ON CONFLICT (interaction_hash) DO NOTHING RETURNING 1`,
            [interactionHash, expiresAt]
        )
        return rows.length === 1
    }

    async listConsents(userId: string) {
        return this.query<Consent & { clientName: string }>(
            `SELECT k.client_id AS "clientId", c.name AS "clientName", k.scopes, k.tenant_ids::text[] AS "tenantIds",
              k.created_at AS "createdAt",
              k.updated_at AS "updatedAt"
         FROM oidc_consents k JOIN oidc_clients c ON c.client_id = k.client_id
        WHERE k.user_id = $1 ORDER BY k.updated_at DESC`,
            [userId]
        )
    }

    async deleteConsent(userId: string, clientId: string) {
        await this.database.ready()
        return this.database.transaction(async db => {
            const { rowCount } = await db.query('DELETE FROM oidc_consents WHERE user_id = $1 AND client_id = $2', [
                userId,
                clientId
            ])
            if (!rowCount) return false
            // The application loses its access at once: no new access tokens with its refresh tokens
            await db.query(
                `UPDATE oidc_refresh_tokens SET revoked_at = now()
          WHERE user_id = $1 AND client_id = $2 AND revoked_at IS NULL`,
                [userId, clientId]
            )
            return true
        })
    }

    async addSessionClient(sessionId: string, clientId: string) {
        await this.query(
            'INSERT INTO oidc_session_clients (session_id, client_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [sessionId, clientId]
        )
    }

    async claimLogouts(limit: number, maxAttempts: number) {
        // SKIP LOCKED: several API processes never deliver the same token twice at the same moment. The next try is
        // set before delivering (30 seconds, 2, 8, 32 minutes, ...): a crash in between only delays it.
        const rows = await this.query<LogoutJob & { id: string }>(
            `UPDATE oidc_logout_queue q
          SET attempts = q.attempts + 1, next_at = now() + make_interval(secs => 30 * power(4, q.attempts))
        WHERE q.id IN (SELECT id FROM oidc_logout_queue
                        WHERE next_at <= now() AND attempts < $2
                        ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING q.id::text AS id, q.session_id AS "sessionId", q.user_id AS "userId", q.client_id AS "clientId",
                  q.attempts`,
            [limit, maxAttempts]
        )
        return rows
    }

    async finishLogout(id: string) {
        if (!/^\d{1,19}$/.test(id)) return
        await this.query('DELETE FROM oidc_logout_queue WHERE id = $1', [id])
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

    async createSession(session: Session) {
        const rows = await this.query<{ id_hash: string }>(
            `INSERT INTO oidc_sessions (id, id_hash, interaction_hash, user_id, tenant_id, auth_time, acr, amr, expires_at, user_agent)
         VALUES ($9, $1, $2, $3, $4, $5, $6, $7, $8, $10)
         ON CONFLICT (interaction_hash) DO NOTHING RETURNING id_hash`,
            [
                session.idHash,
                session.interactionHash,
                session.userId,
                session.tenantId,
                session.authTime,
                session.acr,
                session.amr,
                session.expiresAt,
                session.id,
                session.userAgent
            ]
        )
        return rows.length === 1
    }

    async findSession(idHash: string) {
        const rows = await this.query<Session>(
            `SELECT ${SESSION_COLUMNS} FROM oidc_sessions WHERE id_hash = $1 AND expires_at > now()`,
            [idHash]
        )
        return rows[0] ?? null
    }

    async findSessionById(id: string) {
        if (!UUID.test(id)) return null
        const rows = await this.query<Session>(
            `SELECT ${SESSION_COLUMNS} FROM oidc_sessions WHERE id = $1 AND expires_at > now()`,
            [id]
        )
        return rows[0] ?? null
    }

    async touchSession(id: string) {
        if (!UUID.test(id)) return
        await this.query('UPDATE oidc_sessions SET last_used_at = now() WHERE id = $1 AND expires_at > now()', [id])
    }

    async listUserSessions(userId: string) {
        return this.query<SessionSummary>(
            `SELECT s.id, s.tenant_id AS "tenantId", t.name AS "tenantName", s.user_agent AS "userAgent", s.acr, s.amr,
              s.auth_time AS "authTime", s.created_at AS "createdAt", s.last_used_at AS "lastUsedAt",
              s.expires_at AS "expiresAt"
         FROM oidc_sessions s LEFT JOIN tenants t ON t.id = s.tenant_id
        WHERE s.user_id = $1 AND s.expires_at > now()
        ORDER BY s.created_at DESC`,
            [userId]
        )
    }

    async endUserSession(userId: string, id: string) {
        if (!UUID.test(id)) return false
        const rows = await this.query(
            'UPDATE oidc_sessions SET expires_at = now() WHERE id = $1 AND user_id = $2 AND expires_at > now() RETURNING 1',
            [id, userId]
        )
        return rows.length > 0
    }

    async endOtherUserSessions(userId: string, keepId: string | null) {
        const rows = await this.query(
            `UPDATE oidc_sessions SET expires_at = now()
        WHERE user_id = $1 AND expires_at > now() AND ($2::uuid IS NULL OR id <> $2::uuid) RETURNING 1`,
            [userId, keepId !== null && UUID.test(keepId) ? keepId : null]
        )
        return rows.length
    }

    // ---------------------------------------------------------------- refresh tokens

    async createRefreshToken(token: Omit<RefreshToken, 'usedAt' | 'revokedAt'>) {
        await this.query(
            `INSERT INTO oidc_refresh_tokens (token_hash, family_id, session_id, client_id, user_id, tenant_id, scope, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                token.tokenHash,
                token.familyId,
                token.sessionId,
                token.clientId,
                token.userId,
                token.tenantId,
                token.scope,
                token.expiresAt
            ]
        )
    }

    async findRefreshToken(tokenHash: string) {
        const rows = await this.query<RefreshToken>(
            `SELECT ${REFRESH_COLUMNS} FROM oidc_refresh_tokens WHERE token_hash = $1`,
            [tokenHash]
        )
        return rows[0] ?? null
    }

    async rotateRefreshToken(
        tokenHash: string,
        next: { tokenHash: string; scope: string; expiresAt: Date },
        graceMs: number
    ): Promise<RotateResult> {
        await this.database.ready()
        return this.database.transaction(async db => {
            // The row lock makes two uses at the same moment wait for each other
            const { rows } = await db.query<RefreshToken & { reused: boolean }>(
                `SELECT ${REFRESH_COLUMNS},
                (used_at IS NOT NULL AND used_at < now() - make_interval(secs => $2::double precision / 1000)) AS reused
           FROM oidc_refresh_tokens
          WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`,
                [tokenHash, graceMs]
            )
            const token = rows[0]
            if (!token) return { status: 'invalid' as const }
            const { reused, ...stored } = token
            if (reused) {
                await db.query(
                    'UPDATE oidc_refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
                    [stored.familyId]
                )
                return { status: 'reused' as const, token: stored }
            }
            await db.query('UPDATE oidc_refresh_tokens SET used_at = coalesce(used_at, now()) WHERE token_hash = $1', [
                tokenHash
            ])
            // Within the grace period the successor exists already (the same one, derived from the token)
            await db.query(
                `INSERT INTO oidc_refresh_tokens (token_hash, family_id, session_id, client_id, user_id, tenant_id, scope, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (token_hash) DO NOTHING`,
                [
                    next.tokenHash,
                    stored.familyId,
                    stored.sessionId,
                    stored.clientId,
                    stored.userId,
                    stored.tenantId,
                    next.scope,
                    next.expiresAt
                ]
            )
            const found = await db.query<RefreshToken>(
                `SELECT ${REFRESH_COLUMNS} FROM oidc_refresh_tokens WHERE token_hash = $1`,
                [next.tokenHash]
            )
            const successor = found.rows[0]
            if (!successor || successor.revokedAt || successor.familyId !== stored.familyId)
                return { status: 'invalid' as const }
            return { status: 'ok' as const, token: successor }
        })
    }

    async revokeRefreshFamily(familyId: string) {
        await this.query(
            'UPDATE oidc_refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
            [familyId]
        )
    }

    async endSession(idHash: string) {
        await this.query('UPDATE oidc_sessions SET expires_at = least(expires_at, now()) WHERE id_hash = $1', [idHash])
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

    async setCodeRefreshFamily(codeHash: string, familyId: string) {
        await this.query('UPDATE oidc_codes SET refresh_family = $2 WHERE code_hash = $1', [codeHash, familyId])
    }

    async usedCodeRefreshFamily(codeHash: string) {
        const rows = await this.query<{ family: string | null }>(
            'SELECT refresh_family AS family FROM oidc_codes WHERE code_hash = $1 AND used_at IS NOT NULL',
            [codeHash]
        )
        return rows[0]?.family ?? null
    }

    async bootstrapAdmin(admin: BootstrapAdmin) {
        await this.database.ready()
        return this.database.transaction(async db => {
            await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['oidc-bootstrap'])
            const existing = await db.query(`SELECT 1 FROM ${USERS} LIMIT 1`)
            if (existing.rows.length > 0) return false
            // The first user is the superadmin of the platform: no organisation needed, it creates them on /admin
            await db.query(
                `INSERT INTO ${USERS} (email, email_verified, name, password_hash, is_superadmin) VALUES ($1, true, $2, $3, true)`,
                [admin.email, admin.name, admin.passwordHash]
            )
            return true
        })
    }

    // ---------------------------------------------------------------- accounts

    async register(account: NewAccount, tenant: { name: string; slug: string }) {
        await this.database.ready()
        return this.database.transaction(async db => {
            const user = await insertUser(db, account)
            if (!user) return null
            const created = await insertTenant(db, tenant.name, tenant.slug)
            await db.query(`INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'admin')`, [
                created.id,
                user.id
            ])
            return { user, tenant: created }
        })
    }

    async registerWithIdentifier(
        account: NewAccount,
        tenant: { name: string; slug: string },
        identifier: { type: IdentifierType; valueHash: string }
    ) {
        await this.database.ready()
        try {
            return await this.database.transaction(async db => {
                const user = await insertUser(db, account)
                if (!user) return null
                const linked = await db.query(
                    `INSERT INTO user_identifiers (type, value_hash, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1`,
                    [identifier.type, identifier.valueHash, user.id]
                )
                if (linked.rows.length === 0) throw new IdentifierTaken()
                const created = await insertTenant(db, tenant.name, tenant.slug)
                await db.query(`INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'admin')`, [
                    created.id,
                    user.id
                ])
                return { user, tenant: created }
            })
        } catch (error) {
            if (error instanceof IdentifierTaken) return 'identifier-taken' as const
            throw error
        }
    }

    // ---------------------------------------------------------------- identifiers (eID)

    async findUserByIdentifier(type: IdentifierType, valueHash: string) {
        const rows = await this.query<StoredUser>(
            `SELECT ${USER_COLUMNS} FROM ${USERS}
        WHERE id = (SELECT user_id FROM user_identifiers WHERE type = $1 AND value_hash = $2)`,
            [type, valueHash]
        )
        return rows[0] ?? null
    }

    async listLinkedUsers(type: IdentifierType, userIds: string[]) {
        const ids = userIds.filter(id => UUID.test(id))
        if (ids.length === 0) return []
        const rows = await this.query<{ userId: string }>(
            `SELECT user_id AS "userId" FROM user_identifiers WHERE type = $1 AND user_id = ANY($2::uuid[])`,
            [type, ids]
        )
        return rows.map(row => row.userId)
    }

    async findIdentifier(userId: string, type: IdentifierType) {
        const rows = await this.query<UserIdentifier>(
            `SELECT ${IDENTIFIER_COLUMNS} FROM user_identifiers WHERE user_id = $1 AND type = $2`,
            [userId, type]
        )
        return rows[0] ?? null
    }

    async linkIdentifier(userId: string, type: IdentifierType, valueHash: string): Promise<LinkResult> {
        await this.database.ready()
        return this.database.transaction(async db => {
            // Locks the account: two links at the same time cannot give it two eIDs
            await db.query(`SELECT 1 FROM ${USERS} WHERE id = $1 FOR UPDATE`, [userId])
            const { rows } = await db.query<{ userId: string; valueHash: string }>(
                `SELECT user_id AS "userId", value_hash AS "valueHash" FROM user_identifiers
          WHERE type = $1 AND (value_hash = $2 OR user_id = $3)`,
                [type, valueHash, userId]
            )
            const owner = rows.find(row => row.valueHash === valueHash)
            if (owner) return owner.userId === userId ? 'ok' : 'taken'
            if (rows.length > 0) return 'exists'
            const inserted = await db.query(
                `INSERT INTO user_identifiers (type, value_hash, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1`,
                [type, valueHash, userId]
            )
            return inserted.rows.length > 0 ? 'ok' : 'taken'
        })
    }

    async unlinkIdentifier(userId: string, type: IdentifierType) {
        const rows = await this.query(`DELETE FROM user_identifiers WHERE user_id = $1 AND type = $2 RETURNING 1`, [
            userId,
            type
        ])
        return rows.length > 0
    }

    async addPasskey(passkey: NewPasskey) {
        await this.database.ready()
        return this.database.transaction(async db => {
            // At most 20 per account: the row lock of the account makes two at once count one after the other
            await db.query(`SELECT 1 FROM ${USERS} WHERE id = $1 FOR UPDATE`, [passkey.userId])
            const count = await db.query<{ n: number }>(
                'SELECT count(*)::int AS n FROM user_passkeys WHERE user_id = $1',
                [passkey.userId]
            )
            if ((count.rows[0]?.n ?? 0) >= 20) return null
            const rows = await db.query<Passkey>(
                `INSERT INTO user_passkeys (user_id, credential_id, public_key, algorithm, sign_count, name, aaguid,
                                    backup_eligible, backed_up, transports)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (credential_id) DO NOTHING
         RETURNING ${PASSKEY_COLUMNS}`,
                [
                    passkey.userId,
                    passkey.credentialId,
                    passkey.publicKey,
                    passkey.algorithm,
                    passkey.signCount,
                    passkey.name,
                    passkey.aaguid,
                    passkey.backupEligible,
                    passkey.backedUp,
                    passkey.transports
                ]
            )
            return rows.rows[0] ?? null
        })
    }

    listPasskeys(userId: string) {
        return this.query<Passkey>(
            `SELECT ${PASSKEY_COLUMNS} FROM user_passkeys WHERE user_id = $1 ORDER BY created_at`,
            [userId]
        )
    }

    async findPasskey(credentialId: string) {
        const rows = await this.query<Passkey>(
            `SELECT ${PASSKEY_COLUMNS} FROM user_passkeys WHERE credential_id = $1`,
            [credentialId]
        )
        return rows[0] ?? null
    }

    async usePasskey(id: string, signCount: number, backedUp: boolean) {
        // The counter only goes up (authenticators that do not count always send 0)
        const rows = await this.query(
            `UPDATE user_passkeys SET sign_count = $2, backed_up = $3, last_used_at = now()
        WHERE id = $1 AND (($2 = 0 AND sign_count = 0) OR sign_count < $2)
        RETURNING 1`,
            [id, signCount, backedUp]
        )
        return rows.length === 1
    }

    async renamePasskey(userId: string, id: string, name: string) {
        const rows = await this.query('UPDATE user_passkeys SET name = $3 WHERE user_id = $1 AND id = $2 RETURNING 1', [
            userId,
            id,
            name
        ])
        return rows.length === 1
    }

    async deletePasskey(userId: string, id: string) {
        const rows = await this.query('DELETE FROM user_passkeys WHERE user_id = $1 AND id = $2 RETURNING 1', [
            userId,
            id
        ])
        return rows.length === 1
    }

    async touchIdentifier(type: IdentifierType, valueHash: string) {
        await this.query(`UPDATE user_identifiers SET last_used_at = now() WHERE type = $1 AND value_hash = $2`, [
            type,
            valueHash
        ])
    }

    async createUser(account: NewAccount) {
        await this.database.ready()
        return insertUser(this.database, account)
    }

    async createUserWithIdentifier(account: NewAccount, identifier: { type: IdentifierType; valueHash: string }) {
        await this.database.ready()
        try {
            return await this.database.transaction(async db => {
                const user = await insertUser(db, account)
                if (!user) return null
                const linked = await db.query(
                    `INSERT INTO user_identifiers (type, value_hash, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1`,
                    [identifier.type, identifier.valueHash, user.id]
                )
                if (linked.rows.length === 0) throw new IdentifierTaken()
                return user
            })
        } catch (error) {
            if (error instanceof IdentifierTaken) return 'identifier-taken' as const
            throw error
        }
    }

    async setEmailVerified(userId: string) {
        await this.query(`UPDATE ${USERS} SET email_verified = true, updated_at = now() WHERE id = $1`, [userId])
    }

    async setPassword(userId: string, passwordHash: string) {
        await this.query(`UPDATE ${USERS} SET password_hash = $2, updated_at = now() WHERE id = $1`, [
            userId,
            passwordHash
        ])
    }

    async setSuperadmin(userId: string, superadmin: boolean): Promise<ChangeResult> {
        await this.database.ready()
        return this.database.transaction(async db => {
            // Lock every superadmin row: two revokes at the same time can never remove the last one.
            const { rows } = await db.query<{ id: string; isSuperadmin: boolean }>(
                `SELECT id, is_superadmin AS "isSuperadmin" FROM ${USERS} WHERE is_superadmin OR id = $1 FOR UPDATE`,
                [userId]
            )
            const target = rows.find(row => row.id === userId)
            if (!target) return 'not-found'
            const superadmins = rows.filter(row => row.isSuperadmin).length
            if (!superadmin && target.isSuperadmin && superadmins === 1) return 'last-admin'
            await db.query(`UPDATE ${USERS} SET is_superadmin = $2, updated_at = now() WHERE id = $1`, [
                userId,
                superadmin
            ])
            return 'ok'
        })
    }

    async listSuperadmins() {
        return this.query<StoredUser>(`SELECT ${USER_COLUMNS} FROM ${USERS} WHERE is_superadmin ORDER BY lower(name)`)
    }

    async endUserSessions(userId: string) {
        await this.query('UPDATE oidc_sessions SET expires_at = least(expires_at, now()) WHERE user_id = $1', [userId])
    }

    // ---------------------------------------------------------------- the own profile

    async findProfile(userId: string) {
        const rows = await this.query<UserProfile>(`SELECT ${PROFILE_COLUMNS} FROM ${USERS} WHERE id = $1`, [userId])
        return rows[0] ?? null
    }

    async updateProfile(userId: string, changes: ProfileChanges) {
        const { sql, values } = setFields(changes, PROFILE_FIELDS)
        if (!sql) return
        await this.query(`UPDATE ${USERS} SET ${sql}, updated_at = now() WHERE id = $1`, [userId, ...values])
    }

    async findPresence(userId: string) {
        const rows = await this.query<{ presence: Presence }>(`SELECT presence FROM ${USERS} WHERE id = $1`, [userId])
        return rows[0]?.presence ?? null
    }

    async setPresence(userId: string, presence: Presence) {
        await this.query(`UPDATE ${USERS} SET presence = $2 WHERE id = $1`, [userId, presence])
    }

    async findOutOfOffice(userId: string) {
        return (await this.listOutOfOffice([userId], false)).get(userId) ?? null
    }

    async setOutOfOffice(userId: string, ooo: OutOfOffice) {
        await this.query(
            `UPDATE ${USERS} SET ooo_enabled = $2, ooo_from = $3, ooo_until = $4, ooo_internal = $5, ooo_external = $6
        WHERE id = $1`,
            [userId, ooo.enabled, ooo.from, ooo.until, ooo.internalMessage, ooo.externalMessage]
        )
    }

    async listOutOfOffice(userIds: string[], onlyEnabled = true) {
        const result = new Map<string, OutOfOffice>()
        if (userIds.length === 0) return result
        const rows = await this.query<OutOfOffice & { id: string }>(
            `SELECT id, ooo_enabled AS enabled, ooo_from AS "from", ooo_until AS "until",
              ooo_internal AS "internalMessage", ooo_external AS "externalMessage"
         FROM ${USERS} WHERE id = ANY($1::uuid[])${onlyEnabled ? ' AND ooo_enabled' : ''}`,
            [userIds]
        )
        for (const { id, ...ooo } of rows) result.set(id, ooo)
        return result
    }

    async setPendingEmail(userId: string, email: string | null) {
        await this.query(`UPDATE ${USERS} SET pending_email = $2, updated_at = now() WHERE id = $1`, [userId, email])
    }

    async changeEmail(userId: string, email: string) {
        // The unique index on lower(email) decides when two accounts take the same address at the same moment
        try {
            const rows = await this.query(
                `UPDATE ${USERS} SET email = $2, email_verified = true, pending_email = NULL, updated_at = now()
          WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM ${USERS} o WHERE lower(o.email) = lower($2) AND o.id <> $1)
          RETURNING 1`,
                [userId, email]
            )
            return rows.length === 1
        } catch (error) {
            if ((error as { code?: string }).code === '23505') return false
            throw error
        }
    }

    async setEidDetails(userId: string, details: { rrnEncrypted: string | null; address: string | null }) {
        await this.query(
            `UPDATE ${USERS} SET rrn_enc = $2, address = CASE WHEN $2::text IS NULL THEN NULL ELSE coalesce($3, address) END,
              updated_at = now() WHERE id = $1`,
            [userId, details.rrnEncrypted, details.address]
        )
    }

    // ---------------------------------------------------------------- two-factor authentication

    async getMfa(userId: string) {
        const rows = await this.query<MfaState & { lastStep: string | null }>(
            `SELECT totp_secret AS secret, totp_enabled AS enabled, totp_last_step AS "lastStep",
              recovery_codes AS "recoveryCodes" FROM ${USERS} WHERE id = $1`,
            [userId]
        )
        const row = rows[0]
        // bigint comes back as text from pg
        return row ? { ...row, lastStep: row.lastStep === null ? null : Number(row.lastStep) } : null
    }

    async setMfaSecret(userId: string, encryptedSecret: string) {
        await this.query(
            `UPDATE ${USERS} SET totp_secret = $2, totp_enabled = false, totp_last_step = NULL, recovery_codes = '{}',
              updated_at = now() WHERE id = $1`,
            [userId, encryptedSecret]
        )
    }

    async enableMfa(userId: string, recoveryCodeHashes: string[], step: number) {
        await this.query(
            `UPDATE ${USERS} SET totp_enabled = true, totp_last_step = $3, recovery_codes = $2, updated_at = now()
        WHERE id = $1 AND totp_secret IS NOT NULL`,
            [userId, recoveryCodeHashes, step]
        )
    }

    async disableMfa(userId: string) {
        await this.query(
            `UPDATE ${USERS} SET totp_secret = NULL, totp_enabled = false, totp_last_step = NULL, recovery_codes = '{}',
              updated_at = now() WHERE id = $1`,
            [userId]
        )
    }

    async setRecoveryCodes(userId: string, hashes: string[]) {
        await this.query(`UPDATE ${USERS} SET recovery_codes = $2, updated_at = now() WHERE id = $1`, [userId, hashes])
    }

    async useTotpStep(userId: string, step: number) {
        // One UPDATE: two requests with the same code can never both pass
        const rows = await this.query(
            `UPDATE ${USERS} SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)
        RETURNING id`,
            [userId, step]
        )
        return rows.length === 1
    }

    async useRecoveryCode(userId: string, hash: string) {
        const rows = await this.query(
            `UPDATE ${USERS} SET recovery_codes = array_remove(recovery_codes, $2), updated_at = now()
        WHERE id = $1 AND $2 = ANY (recovery_codes) RETURNING id`,
            [userId, hash]
        )
        return rows.length === 1
    }

    // ---------------------------------------------------------------- tenants

    async findTenant(id: string) {
        const rows = await this.query<Tenant>(`SELECT ${TENANT_COLUMNS} FROM tenants WHERE id = $1`, [id])
        return rows[0] ?? null
    }

    async listTenants() {
        return this.query<Tenant>(
            `SELECT ${TENANT_COLUMNS}, (SELECT count(*)::int FROM tenant_members m WHERE m.tenant_id = tenants.id) AS members
         FROM tenants ORDER BY lower(name)`
        )
    }

    async createTenant(name: string, slug: string) {
        await this.database.ready()
        return insertTenant(this.database, name, slug)
    }

    async findTenantDetails(id: string) {
        const rows = await this.query<TenantDetails>(`SELECT ${DETAIL_COLUMNS} FROM tenants WHERE id = $1`, [id])
        return rows[0] ?? null
    }

    async updateTenant(id: string, changes: TenantChanges) {
        const { sql, values } = setFields(changes, TENANT_FIELDS)
        if (!sql) return (await this.findTenant(id)) !== null
        const rows = await this.query(`UPDATE tenants SET ${sql} WHERE id = $1 RETURNING 1`, [id, ...values])
        return rows.length === 1
    }

    private tenantSummaries(where: string, params: unknown[]) {
        return this.query<TenantSummary>(
            `SELECT t.id, t.slug, t.name, t.status, t.created_at AS "createdAt",
              t.company, t.vat, t.billing_address AS "billingAddress", t.billing_email AS "billingEmail", t.city, t.plan,
              t.contact_name AS "contactName",
              (SELECT count(*)::int FROM tenant_members m WHERE m.tenant_id = t.id) AS members,
              (SELECT count(*)::int FROM tenant_invitations i WHERE i.tenant_id = t.id AND i.expires_at > now())
                AS invitations,
              coalesce(
                (SELECT json_build_object('name', u.name, 'email', u.email)
                   FROM tenant_members m JOIN ${USERS} u ON u.id = m.user_id
                  WHERE m.tenant_id = t.id AND m.role = 'admin' ORDER BY m.created_at LIMIT 1),
                (SELECT json_build_object('name', t.contact_name, 'email', i.email)
                   FROM tenant_invitations i
                  WHERE i.tenant_id = t.id AND i.role = 'admin' AND i.expires_at > now()
                  ORDER BY i.created_at DESC LIMIT 1)
              ) AS contact
         FROM tenants t ${where} ORDER BY lower(t.name)`,
            params
        )
    }

    listTenantSummaries() {
        return this.tenantSummaries('', [])
    }

    async findTenantSummary(id: string) {
        return (await this.tenantSummaries('WHERE t.id = $1', [id]))[0] ?? null
    }

    async setTenantStatus(id: string, status: Tenant['status']) {
        await this.database.ready()
        const result = await this.database.query('UPDATE tenants SET status = $2 WHERE id = $1', [id, status])
        return (result.rowCount ?? 0) > 0
    }

    async findMemberRole(tenantId: string, userId: string) {
        const rows = await this.query<{ role: TenantRole }>(
            "SELECT role FROM tenant_members WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'",
            [tenantId, userId]
        )
        return rows[0]?.role ?? null
    }

    async findMember(tenantId: string, userId: string) {
        const rows = await this.query<{ role: TenantRole; status: MemberStatus; profession: Profession }>(
            'SELECT role, status, profession FROM tenant_members WHERE tenant_id = $1 AND user_id = $2',
            [tenantId, userId]
        )
        return rows[0] ?? null
    }

    async setClientRoles(clientId: string, roles: AppRole[]) {
        const rows = await this.query(
            `UPDATE oidc_clients SET roles = $2, updated_at = now() WHERE client_id = $1 AND source = 'admin' RETURNING 1`,
            [clientId, JSON.stringify(roles)]
        )
        return rows.length === 1
    }

    async listAppRoles(tenantId: string, clientId: string) {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const { rows } = await db.query<{ userId: string; roles: string[] }>(
                'SELECT user_id AS "userId", roles FROM app_role_assignments WHERE client_id = $1',
                [clientId]
            )
            return rows
        })
    }

    async findAppRoles(tenantId: string, clientId: string, userId: string) {
        // Platform code (the login): runs as the owner of the tables, with the tenant in the WHERE
        const rows = await this.query<{ roles: string[] }>(
            'SELECT roles FROM app_role_assignments WHERE tenant_id = $1 AND client_id = $2 AND user_id = $3',
            [tenantId, clientId, userId]
        )
        return rows[0]?.roles ?? null
    }

    async setAppRoles(tenantId: string, clientId: string, userId: string, roles: string[] | null, by: string | null) {
        await this.database.ready()
        await this.database.withTenant(tenantId, db =>
            roles === null
                ? db.query('DELETE FROM app_role_assignments WHERE client_id = $1 AND user_id = $2', [clientId, userId])
                : db.query(
                      `INSERT INTO app_role_assignments (tenant_id, client_id, user_id, roles, assigned_by)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (tenant_id, client_id, user_id)
                DO UPDATE SET roles = EXCLUDED.roles, assigned_by = EXCLUDED.assigned_by, updated_at = now()`,
                      [tenantId, clientId, userId, roles, by]
                  )
        )
    }

    async touchMember(tenantId: string, userId: string) {
        await this.query('UPDATE tenant_members SET last_seen_at = now() WHERE tenant_id = $1 AND user_id = $2', [
            tenantId,
            userId
        ])
    }

    async endTenantSessions(tenantId: string, userId: string) {
        await this.query(
            'UPDATE oidc_sessions SET expires_at = least(expires_at, now()) WHERE tenant_id = $1 AND user_id = $2',
            [tenantId, userId]
        )
    }

    async addMember(tenantId: string, userId: string, role: TenantRole) {
        await this.query(
            `INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, user_id) DO UPDATE
         SET role = CASE WHEN tenant_members.role = 'admin' OR EXCLUDED.role = 'admin' THEN 'admin' ELSE 'user' END`,
            [tenantId, userId, role]
        )
    }

    // ---------------------------------------------------------------- members (Row-Level Security)
    //
    // These queries have NO "WHERE tenant_id = ...": withTenant() runs them as the tenant role, and Row-Level Security
    // only lets the rows of that tenant through. Write your own tenant code like this.

    async listMembers(tenantId: string) {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const { rows } = await db.query<TenantMember>(
                `SELECT m.user_id AS "userId", u.name, u.email, u.email_verified AS "emailVerified", m.role, m.status,
                m.profession, m.last_seen_at AS "lastSeenAt", u.presence
           FROM tenant_members m JOIN ${USERS} u ON u.id = m.user_id
          ORDER BY lower(u.name), u.email`
            )
            return rows
        })
    }

    async setMemberRole(tenantId: string, userId: string, role: TenantRole) {
        return this.changeMember(tenantId, userId, role === 'user', db =>
            db.query('UPDATE tenant_members SET role = $2 WHERE user_id = $1', [userId, role])
        )
    }

    async removeMember(tenantId: string, userId: string) {
        return this.changeMember(tenantId, userId, true, db =>
            db.query('DELETE FROM tenant_members WHERE user_id = $1', [userId])
        )
    }

    async setMemberStatus(tenantId: string, userId: string, status: MemberStatus) {
        return this.changeMember(tenantId, userId, status === 'disabled', db =>
            db.query('UPDATE tenant_members SET status = $2 WHERE user_id = $1', [userId, status])
        )
    }

    async setMemberProfession(tenantId: string, userId: string, profession: Profession) {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const result = await db.query('UPDATE tenant_members SET profession = $2 WHERE user_id = $1', [
                userId,
                profession
            ])
            return (result.rowCount ?? 0) > 0
        })
    }

    /** Locks the members of the tenant, refuses to lose its last active admin, then applies `change`. */
    private async changeMember(
        tenantId: string,
        userId: string,
        losesAdmin: boolean,
        change: (db: Queryable) => Promise<unknown>
    ): Promise<ChangeResult> {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const { rows } = await db.query<{ userId: string; role: TenantRole; status: MemberStatus }>(
                'SELECT user_id AS "userId", role, status FROM tenant_members FOR UPDATE'
            )
            const target = rows.find(row => row.userId === userId)
            if (!target) return 'not-found'
            const isActiveAdmin = (row: { role: TenantRole; status: MemberStatus }) =>
                row.role === 'admin' && row.status === 'active'
            const admins = rows.filter(isActiveAdmin).length
            if (losesAdmin && isActiveAdmin(target) && admins === 1) return 'last-admin'
            await change(db)
            return 'ok'
        })
    }

    // ---------------------------------------------------------------- invitations (Row-Level Security)

    async saveInvitation(invitation: Omit<Invitation, 'id' | 'createdAt' | 'invitedByName'>) {
        await this.database.ready()
        return this.database.withTenant(invitation.tenantId, async db => {
            const { rows } = await db.query<Invitation>(
                `INSERT INTO tenant_invitations (tenant_id, email, role, invited_by, apps, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, lower(email)) DO UPDATE
           SET role = EXCLUDED.role, invited_by = EXCLUDED.invited_by, apps = EXCLUDED.apps,
               expires_at = EXCLUDED.expires_at, created_at = now()
         RETURNING ${INVITATION_COLUMNS}`,
                [
                    invitation.tenantId,
                    invitation.email,
                    invitation.role,
                    invitation.invitedBy,
                    JSON.stringify(invitation.apps),
                    invitation.expiresAt
                ]
            )
            const row = rows[0]
            if (!row) throw new Error('The invitation was not saved')
            return row
        })
    }

    async listInvitations(tenantId: string) {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const { rows } = await db.query<Invitation>(
                `SELECT i.id, i.tenant_id AS "tenantId", i.email, i.role, i.invited_by AS "invitedBy", i.apps,
                i.created_at AS "createdAt", i.expires_at AS "expiresAt", u.name AS "invitedByName"
           FROM tenant_invitations i LEFT JOIN ${USERS} u ON u.id = i.invited_by
          WHERE i.expires_at > now() ORDER BY i.created_at DESC`
            )
            return rows
        })
    }

    async findInvitation(tenantId: string, id: string) {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const { rows } = await db.query<Invitation>(
                `SELECT ${INVITATION_COLUMNS} FROM tenant_invitations WHERE id = $1 AND expires_at > now()`,
                [id]
            )
            return rows[0] ?? null
        })
    }

    async renewInvitation(tenantId: string, id: string, expiresAt: Date) {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const { rows } = await db.query<Invitation>(
                `UPDATE tenant_invitations SET expires_at = $2 WHERE id = $1 RETURNING ${INVITATION_COLUMNS}`,
                [id, expiresAt]
            )
            return rows[0] ?? null
        })
    }

    async deleteInvitation(tenantId: string, id: string) {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const result = await db.query('DELETE FROM tenant_invitations WHERE id = $1', [id])
            return (result.rowCount ?? 0) > 0
        })
    }

    async deleteExpired(now: Date) {
        await this.query(`DELETE FROM oidc_sessions WHERE expires_at <= $1::timestamptz - interval '1 hour'`, [now])
        // Logout tokens that could not be delivered in a day: the client was down too long
        await this.query(`DELETE FROM oidc_logout_queue WHERE created_at <= $1::timestamptz - interval '1 day'`, [now])
        await this.query('DELETE FROM oidc_used_interactions WHERE expires_at <= $1', [now])
        await this.query(`DELETE FROM oidc_link_codes WHERE expires_at <= $1::timestamptz - interval '1 day'`, [now])
        await this.query('DELETE FROM oidc_codes WHERE expires_at <= $1', [now])
        await this.query('DELETE FROM oidc_refresh_tokens WHERE expires_at <= $1', [now])
        await this.query('DELETE FROM tenant_invitations WHERE expires_at <= $1', [now])
    }
}
