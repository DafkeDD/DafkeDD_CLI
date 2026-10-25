import { Injectable } from '@nestjs/common'
import type { QueryResultRow } from 'pg'
import { DatabaseService } from '../database/database.service.js'
import type { CertificateMeta, VaultEntry, VaultStore } from './vault.store.js'

const COLUMNS =
    'user_id AS "userId", filename, size_bytes AS "sizeBytes", p12_enc AS "p12Encrypted", ' +
    'password_enc AS "passwordEncrypted", thumbprint, subject, issuer, serial, valid_until AS "validUntil", ' +
    'uploaded_at AS "uploadedAt"'

/** The eHealth vault in PostgreSQL (user_vault). Belongs to the account, not to a tenant: platform code. */
@Injectable()
export class PgVaultStore implements VaultStore {
    constructor(private readonly database: DatabaseService) {}

    private async query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<T[]> {
        await this.database.ready()
        return (await this.database.query<T>(text, params)).rows
    }

    async find(userId: string) {
        return (
            (await this.query<VaultEntry>(`SELECT ${COLUMNS} FROM user_vault WHERE user_id = $1`, [userId]))[0] ?? null
        )
    }

    async save(entry: Omit<VaultEntry, 'uploadedAt'>) {
        const rows = await this.query<VaultEntry>(
            `INSERT INTO user_vault (user_id, filename, size_bytes, p12_enc, password_enc, thumbprint, subject, issuer,
                               serial, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (user_id) DO UPDATE SET
         filename = EXCLUDED.filename, size_bytes = EXCLUDED.size_bytes, p12_enc = EXCLUDED.p12_enc,
         password_enc = EXCLUDED.password_enc, thumbprint = EXCLUDED.thumbprint, subject = EXCLUDED.subject,
         issuer = EXCLUDED.issuer, serial = EXCLUDED.serial, valid_until = EXCLUDED.valid_until, uploaded_at = now()
       RETURNING ${COLUMNS}`,
            [
                entry.userId,
                entry.filename,
                entry.sizeBytes,
                entry.p12Encrypted,
                entry.passwordEncrypted,
                entry.thumbprint,
                entry.subject,
                entry.issuer,
                entry.serial,
                entry.validUntil
            ]
        )
        const row = rows[0]
        if (!row) throw new Error('The certificate was not saved')
        return row
    }

    async setPassword(userId: string, passwordEncrypted: Buffer, meta: CertificateMeta) {
        const rows = await this.query(
            `UPDATE user_vault SET password_enc = $2, thumbprint = $3, subject = $4, issuer = $5, serial = $6,
              valid_until = $7 WHERE user_id = $1 RETURNING 1`,
            [userId, passwordEncrypted, meta.thumbprint, meta.subject, meta.issuer, meta.serial, meta.validUntil]
        )
        return rows.length === 1
    }

    async delete(userId: string) {
        return (await this.query('DELETE FROM user_vault WHERE user_id = $1 RETURNING 1', [userId])).length === 1
    }
}
