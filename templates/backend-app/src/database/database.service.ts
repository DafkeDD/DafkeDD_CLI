import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import pg from 'pg'
import { TENANT_ROLE } from './database.constants.js'
import { runMigrations } from './migrator.js'

/** Something that runs SQL: the pool, or one client inside a transaction. */
export interface Queryable {
    query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Thin wrapper around a pg connection pool. The settings come from .env (DATABASE_*).
 *
 * - `query()` runs as the owner of the tables: use it for migrations and data that belongs to no organisation.
 * - `withTenant()` runs as the tenant role: PostgreSQL Row-Level Security then only shows the rows of that tenant,
 *   even when a query forgets a WHERE tenant_id = ... Use it for everything that belongs to a customer.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
    private readonly pool: pg.Pool
    private migrated: Promise<void> | null = null

    constructor(config: ConfigService) {
        this.pool = new pg.Pool({
            host: config.get<string>('DATABASE_HOST'),
            port: Number(config.get<string>('DATABASE_PORT')),
            user: config.get<string>('DATABASE_USER'),
            password: config.get<string>('DATABASE_PASSWORD'),
            database: config.get<string>('DATABASE_NAME'),
            connectionTimeoutMillis: 3000
        })
        // An idle client that loses its connection must not crash the process.
        this.pool.on('error', () => undefined)
    }

    query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]) {
        return this.pool.query<T>(text, params)
    }

    /** True when the database answers. Never throws. */
    async ping(): Promise<boolean> {
        try {
            await this.pool.query('SELECT 1')
            return true
        } catch {
            return false
        }
    }

    /**
     * Runs the migrations of src/database/migrations.ts once per process. When the database is down the next call
     * tries again, so the API also starts without a database.
     */
    ready(): Promise<void> {
        this.migrated ??= this.migrate().catch((error: unknown) => {
            this.migrated = null
            throw error
        })
        return this.migrated
    }

    private async migrate() {
        const client = await this.pool.connect()
        try {
            await runMigrations(client)
        } finally {
            client.release()
        }
    }

    /** Runs `work` in one transaction (as the owner of the tables). */
    async transaction<T>(work: (db: Queryable) => Promise<T>): Promise<T> {
        const client = await this.pool.connect()
        try {
            await client.query('BEGIN')
            const result = await work(client)
            await client.query('COMMIT')
            return result
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined)
            throw error
        } finally {
            client.release()
        }
    }

    /**
     * Runs `work` in one transaction as the tenant role, with app.tenant_id set to `tenantId`. Row-Level Security makes
     * every SELECT, INSERT, UPDATE and DELETE on a tenant table see only this tenant.
     */
    withTenant<T>(tenantId: string, work: (db: Queryable) => Promise<T>): Promise<T> {
        if (!UUID.test(tenantId)) return Promise.reject(new Error('withTenant needs a tenant id (uuid)'))
        return this.transaction(async db => {
            await db.query('SET LOCAL ROLE "' + TENANT_ROLE + '"')
            await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
            return work(db)
        })
    }

    async onModuleDestroy() {
        await this.pool.end()
    }
}
