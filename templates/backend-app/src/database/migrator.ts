import { createHash } from 'node:crypto'
import type { Queryable } from './database.service.js'
import { type Migration, MIGRATIONS } from './migrations.js'
import { TENANT_ROLE } from './database.constants.js'

/** Key of the PostgreSQL advisory lock: only one instance of the API migrates at a time. */
export const MIGRATION_LOCK = 'migrations:' + TENANT_ROLE

export const checksum = (sql: string) => createHash('sha256').update(sql).digest('hex')

/**
 * Applies every migration that did not run yet, each in its own transaction, under an advisory lock.
 * Throws when a migration that already ran was changed afterwards.
 */
export async function runMigrations(db: Queryable, migrations: Migration[] = MIGRATIONS): Promise<number[]> {
    const applied: number[] = []
    await db.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK])
    try {
        await db.query(
            'CREATE TABLE IF NOT EXISTS schema_migrations (' +
                'id integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())'
        )
        const { rows } = await db.query<{ id: number; checksum: string }>('SELECT id, checksum FROM schema_migrations')
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
                await db.query('INSERT INTO schema_migrations (id, name, checksum) VALUES ($1, $2, $3)', [
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
        await db.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK])
    }
    return applied
}
