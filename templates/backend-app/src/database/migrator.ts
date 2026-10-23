import { createHash } from 'node:crypto'
import type { Queryable } from './database.service.js'
import { type Migration, MIGRATIONS } from './migrations.js'
import { TENANT_ROLE } from './database.constants.js'

/** Key of the PostgreSQL advisory lock: only one instance of the API migrates at a time. */
export const MIGRATION_LOCK = 'migrations:' + TENANT_ROLE

export const checksum = (sql: string) => createHash('sha256').update(sql).digest('hex')

export interface MigrateOptions {
    /** The key of the advisory lock (default MIGRATION_LOCK): one migrator per key at a time */
    lock?: string
    /** The table that remembers which migrations ran (default schema_migrations) */
    table?: string
}

/**
 * Applies every migration that did not run yet, each in its own transaction, under an advisory lock.
 * Throws when a migration that already ran was changed afterwards.
 */
export async function runMigrations(
    db: Queryable,
    migrations: Migration[] = MIGRATIONS,
    { lock = MIGRATION_LOCK, table = 'schema_migrations' }: MigrateOptions = {}
): Promise<number[]> {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(table)) throw new Error(`Invalid migrations table ${table}`)
    const applied: number[] = []
    await db.query('SELECT pg_advisory_lock(hashtext($1))', [lock])
    try {
        await db.query(
            `CREATE TABLE IF NOT EXISTS ${table} (` +
                'id integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())'
        )
        const { rows } = await db.query<{ id: number; checksum: string }>(`SELECT id, checksum FROM ${table}`)
        const done = new Map(rows.map(row => [row.id, row.checksum]))

        for (const migration of [...migrations].sort((a, b) => a.id - b.id)) {
            const sum = checksum(migration.sql)
            const existing = done.get(migration.id)
            if (existing !== undefined) {
                if (existing !== sum) {
                    throw new Error(
                        `Migration ${migration.id} (${migration.name}) was changed after it ran. Add a new migration instead.`
                    )
                }
                continue
            }
            await db.query('BEGIN')
            try {
                await db.query(migration.sql)
                await db.query(`INSERT INTO ${table} (id, name, checksum) VALUES ($1, $2, $3)`, [
                    migration.id,
                    migration.name,
                    sum
                ])
                await db.query('COMMIT')
                applied.push(migration.id)
            } catch (error) {
                await db.query('ROLLBACK')
                throw error
            }
        }
    } finally {
        await db.query('SELECT pg_advisory_unlock(hashtext($1))', [lock])
    }
    return applied
}
