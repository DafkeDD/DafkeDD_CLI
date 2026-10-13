import { randomBytes } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import type { QueryResultRow } from 'pg'
import { USERS_TABLE } from '../../database/database.constants.js'
import { DatabaseService, type Queryable } from '../../database/database.service.js'
import type { JwsAlgorithm } from '../jose.js'
import type {
    AuthorizationCode,
    BootstrapAdmin,
    ChangeResult,
    Membership,
    MfaState,
    NewAccount,
    OidcClient,
    OidcStore,
    Session,
    StoredKey,
    StoredUser,
    Tenant,
    TenantMember,
    TenantRole
} from './oidc.store.js'

const USERS = '"' + USERS_TABLE + '"'
const USER_COLUMNS =
    'id, email, email_verified AS "emailVerified", name, locale, password_hash AS "passwordHash", status, ' +
    'is_superadmin AS "isSuperadmin", totp_enabled AS "mfaEnabled"'
const TENANT_COLUMNS = 'id, slug, name, status, created_at AS "createdAt"'

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
            `INSERT INTO ${USERS} (email, email_verified, name, locale, password_hash) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (lower(email)) DO NOTHING RETURNING ${USER_COLUMNS}`,
            [account.email, account.emailVerified, account.name, account.locale, account.passwordHash]
        )
    ).rows[0] ?? null
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
            `SELECT t.id AS "tenantId", t.slug, t.name, m.role
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

    async createSession(session: Session) {
        const rows = await this.query<{ id_hash: string }>(
            `INSERT INTO oidc_sessions (id_hash, interaction_hash, user_id, tenant_id, auth_time, acr, amr, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (interaction_hash) DO NOTHING RETURNING id_hash`,
            [
                session.idHash,
                session.interactionHash,
                session.userId,
                session.tenantId,
                session.authTime,
                session.acr,
                session.amr,
                session.expiresAt
            ]
        )
        return rows.length === 1
    }

    async findSession(idHash: string) {
        const rows = await this.query<Session>(
            `SELECT id_hash AS "idHash", interaction_hash AS "interactionHash", user_id AS "userId", tenant_id AS "tenantId", auth_time AS "authTime", acr, amr,
              expires_at AS "expiresAt"
         FROM oidc_sessions WHERE id_hash = $1 AND expires_at > now()`,
            [idHash]
        )
        return rows[0] ?? null
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
            // The first user is the superadmin of the platform, and admin of the first tenant
            const user = await db.query<{ id: string }>(
                `INSERT INTO ${USERS} (email, email_verified, name, password_hash, is_superadmin)
         VALUES ($1, true, $2, $3, true) RETURNING id`,
                [admin.email, admin.name, admin.passwordHash]
            )
            await db.query(`INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'admin')`, [
                tenant.rows[0]?.id,
                user.rows[0]?.id
            ])
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

    async createUser(account: NewAccount) {
        await this.database.ready()
        return insertUser(this.database, account)
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

    async setTenantStatus(id: string, status: Tenant['status']) {
        await this.database.ready()
        const result = await this.database.query('UPDATE tenants SET status = $2 WHERE id = $1', [id, status])
        return (result.rowCount ?? 0) > 0
    }

    async findMemberRole(tenantId: string, userId: string) {
        const rows = await this.query<{ role: TenantRole }>(
            'SELECT role FROM tenant_members WHERE tenant_id = $1 AND user_id = $2',
            [tenantId, userId]
        )
        return rows[0]?.role ?? null
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
                `SELECT m.user_id AS "userId", u.name, u.email, u.email_verified AS "emailVerified", m.role
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

    /** Locks the members of the tenant, refuses to remove its last admin, then applies `change`. */
    private async changeMember(
        tenantId: string,
        userId: string,
        losesAdmin: boolean,
        change: (db: Queryable) => Promise<unknown>
    ): Promise<ChangeResult> {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const { rows } = await db.query<{ userId: string; role: TenantRole }>(
                'SELECT user_id AS "userId", role FROM tenant_members FOR UPDATE'
            )
            const target = rows.find(row => row.userId === userId)
            if (!target) return 'not-found'
            const admins = rows.filter(row => row.role === 'admin').length
            if (losesAdmin && target.role === 'admin' && admins === 1) return 'last-admin'
            await change(db)
            return 'ok'
        })
    }

    async deleteExpired(now: Date) {
        await this.query(`DELETE FROM oidc_sessions WHERE expires_at <= $1::timestamptz - interval '1 hour'`, [now])
        await this.query('DELETE FROM oidc_codes WHERE expires_at <= $1', [now])
    }
}
