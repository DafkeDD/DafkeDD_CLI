import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import pg from 'pg'
import { TENANT_ROLE } from './database.constants.js'
import { MAIN_MIGRATIONS, MIGRATIONS } from './migrations.js'
import { runMigrations } from './migrator.js'

/** Something that runs SQL: the pool, or one client inside a transaction. */
export interface Queryable {
    query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>>
}

/**
 * How the data of the organisations is kept apart (TENANT_ISOLATION in .env, chosen when the app was made):
 * - rls: one database, every row has a tenant_id and Row-Level Security only shows the rows of one organisation
 * - database: every organisation gets a PostgreSQL database of its own (<DATABASE_NAME>_t_<organisation id>), made the
 *   first time it is used; Row-Level Security stays on inside it as a second wall
 */
export type TenantIsolation = 'rls' | 'database'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** How many organisations keep an open connection pool at the same time; the one used longest ago closes first. */
const MAX_TENANT_POOLS = 50
/** Connections per organisation (the database of the app keeps the default of 10). */
const TENANT_POOL_SIZE = 5

/**
 * Thin wrapper around a pg connection pool. The settings come from .env (DATABASE_*, TENANT_ISOLATION).
 *
 * - `query()` runs as the owner of the tables in the database of the app: use it for data that belongs to no
 *   organisation.
 * - `withTenant()` runs as the tenant role, in the database of that organisation (TENANT_ISOLATION=database) or in the
 *   one of the app (rls): PostgreSQL Row-Level Security then only shows the rows of that tenant, even when a query
 *   forgets a WHERE tenant_id = ... Use it for everything that belongs to a customer: the code is the same either way.
 * - `withLock()` lets only one instance of the API (or one request) do something at a time.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
    readonly isolation: TenantIsolation
    private readonly pool: pg.Pool
    private readonly settings: pg.PoolConfig
    private readonly base: string
    private migrated: Promise<void> | null = null
    /** The pools of the databases of the organisations (TENANT_ISOLATION=database), the one used last at the end */
    private readonly tenantPools = new Map<string, Promise<pg.Pool>>()

    constructor(config: ConfigService) {
        const isolation = config.get<string>('TENANT_ISOLATION') || 'rls'
        if (isolation !== 'rls' && isolation !== 'database')
            throw new Error(`TENANT_ISOLATION must be rls or database, not "${isolation}"`)
        this.isolation = isolation
        this.base = config.get<string>('DATABASE_NAME') ?? 'app'
        this.settings = {
            host: config.get<string>('DATABASE_HOST'),
            port: Number(config.get<string>('DATABASE_PORT')),
            user: config.get<string>('DATABASE_USER'),
            password: config.get<string>('DATABASE_PASSWORD'),
            connectionTimeoutMillis: 3000
        }
        this.pool = newPool({ ...this.settings, database: this.base })
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
     * Runs the migrations of src/database/migrations.ts once per process in the database of the app: MIGRATIONS, or
     * only MAIN_MIGRATIONS with a database per organisation. When the database is down the next call tries again, so
     * the API also starts without a database.
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
            if (this.isolation === 'rls') await runMigrations(client)
            else
                await runMigrations(client, MAIN_MIGRATIONS, {
                    lock: 'migrations:main:' + this.base,
                    table: 'registry_migrations'
                })
        } finally {
            client.release()
        }
    }

    /** Runs `work` in one transaction (as the owner of the tables, in the database of the app). */
    transaction<T>(work: (db: Queryable) => Promise<T>): Promise<T> {
        return inTransaction(this.pool, work)
    }

    /**
     * Runs `work` while holding a PostgreSQL advisory lock on `key`: only one instance of the API (or one request)
     * does it at a time, for example sending the monthly invoices or making the database of an organisation.
     */
    async withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
        const client = await this.pool.connect()
        try {
            await client.query('SELECT pg_advisory_lock(hashtext($1))', [key])
            try {
                return await work()
            } finally {
                await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key])
            }
        } finally {
            client.release()
        }
    }

    /**
     * Runs `work` in one transaction as the tenant role, with app.tenant_id set to `tenantId`. Row-Level Security makes
     * every SELECT, INSERT, UPDATE and DELETE on a tenant table see only this tenant. With TENANT_ISOLATION=database
     * it runs in the database of that organisation (made and migrated first when needed).
     */
    async withTenant<T>(tenantId: string, work: (db: Queryable) => Promise<T>): Promise<T> {
        if (!UUID.test(tenantId)) throw new Error('withTenant needs a tenant id (uuid)')
        const pool = this.isolation === 'database' ? await this.tenantPool(tenantId) : this.pool
        return inTransaction(pool, async db => {
            await db.query('SET LOCAL ROLE "' + TENANT_ROLE + '"')
            await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
            return work(db)
        })
    }

    /** The name of the database of an organisation (TENANT_ISOLATION=database). */
    tenantDatabaseName(tenantId: string): string {
        if (!UUID.test(tenantId)) throw new Error('A tenant database needs a tenant id (uuid)')
        const name = `${this.base}_t_${tenantId.replaceAll('-', '').toLowerCase()}`
        if (!/^[a-z0-9_]{1,63}$/.test(name))
            throw new Error(`Invalid database name ${name}: DATABASE_NAME may have at most 28 characters (a-z, 0-9, _)`)
        return name
    }

    /** The pool of the database of an organisation: made, registered and migrated the first time in this process. */
    private tenantPool(tenantId: string): Promise<pg.Pool> {
        const key = tenantId.toLowerCase()
        const open = this.tenantPools.get(key)
        if (open) {
            // Used again: to the end of the list, so it closes last
            this.tenantPools.delete(key)
            this.tenantPools.set(key, open)
            return open
        }
        const pool = this.openTenant(key).catch((error: unknown) => {
            this.tenantPools.delete(key)
            throw error
        })
        this.tenantPools.set(key, pool)
        for (const [oldest, closing] of this.tenantPools) {
            if (this.tenantPools.size <= MAX_TENANT_POOLS) break
            this.tenantPools.delete(oldest)
            void closing.then(
                old => old.end(),
                () => undefined
            )
        }
        return pool
    }

    private async openTenant(tenantId: string): Promise<pg.Pool> {
        await this.ready()
        const name = this.tenantDatabaseName(tenantId)
        // Only one instance of the API makes (and migrates) the database of an organisation at a time
        return this.withLock('tenant-database:' + name, async () => {
            await this.pool.query(
                'INSERT INTO tenant_databases (organisation_id, database_name) VALUES ($1, $2) ON CONFLICT (organisation_id) DO NOTHING',
                [tenantId, name]
            )
            const { rowCount } = await this.pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
            // CREATE DATABASE cannot run in a transaction nor take a parameter: the name is checked above
            if (!rowCount) await this.pool.query(`CREATE DATABASE "${name}"`)
            const pool = newPool({ ...this.settings, database: name, max: TENANT_POOL_SIZE })
            try {
                const client = await pool.connect()
                try {
                    // After an update the new migrations run the first time the organisation is used again
                    await runMigrations(client, MIGRATIONS, { lock: 'migrations:' + name })
                } finally {
                    client.release()
                }
                await this.pool.query(
                    "UPDATE tenant_databases SET status = 'ready', ready_at = coalesce(ready_at, now()) WHERE organisation_id = $1",
                    [tenantId]
                )
                return pool
            } catch (error) {
                await pool.end().catch(() => undefined)
                throw error
            }
        })
    }

    async onModuleDestroy() {
        const tenants = [...this.tenantPools.values()]
        this.tenantPools.clear()
        await Promise.all(
            tenants.map(pool =>
                pool.then(
                    open => open.end(),
                    () => undefined
                )
            )
        )
        await this.pool.end()
    }
}

/** A pool whose idle clients may lose their connection without crashing the process. */
function newPool(config: pg.PoolConfig): pg.Pool {
    const pool = new pg.Pool(config)
    pool.on('error', () => undefined)
    return pool
}

/** Runs `work` in one transaction on a client of `pool`. */
async function inTransaction<T>(pool: pg.Pool, work: (db: Queryable) => Promise<T>): Promise<T> {
    const client = await pool.connect()
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
