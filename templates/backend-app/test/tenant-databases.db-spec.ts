import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import pg from 'pg'
import { DatabaseService, rememberTenantSlug } from '../src/database/database.service.js'
import { PgNotesStore } from '../src/notes/pg-notes.store.js'

/**
 * TENANT_ISOLATION=database against a REAL PostgreSQL (the one from .env): npm run test:db
 * It uses a separate database <DATABASE_NAME>_dbt plus one database per organisation of the test, and removes them all
 * again afterwards. The user of DATABASE_USER needs the right to make databases (CREATEDB).
 */
try {
    process.loadEnvFile()
} catch {
    // no .env file: use the environment as it is
}

const settings = {
    DATABASE_HOST: process.env.DATABASE_HOST ?? 'localhost',
    DATABASE_PORT: process.env.DATABASE_PORT ?? '5432',
    DATABASE_USER: process.env.DATABASE_USER ?? 'postgres',
    DATABASE_PASSWORD: process.env.DATABASE_PASSWORD ?? '',
    // Short enough for <name>_t_<32 characters> (at most 63)
    DATABASE_NAME: (process.env.DATABASE_NAME ?? 'app').slice(0, 24) + '_dbt',
    TENANT_ISOLATION: 'database'
}

async function admin<T extends pg.QueryResultRow>(sql: string, params?: unknown[]) {
    const client = new pg.Client({
        host: settings.DATABASE_HOST,
        port: Number(settings.DATABASE_PORT),
        user: settings.DATABASE_USER,
        password: settings.DATABASE_PASSWORD,
        database: 'postgres'
    })
    await client.connect()
    try {
        return await client.query<T>(sql, params)
    } finally {
        await client.end()
    }
}

/** Removes the database of the test and the ones of its organisations. */
async function dropAll() {
    const { rows } = await admin<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname = $1 OR datname LIKE $1 || '\\_%'",
        [settings.DATABASE_NAME]
    )
    for (const row of rows) await admin(`DROP DATABASE IF EXISTS "${row.datname}" WITH (FORCE)`)
}

describe('a database per organisation (real PostgreSQL, TENANT_ISOLATION=database)', () => {
    let database: DatabaseService
    const a = randomUUID()
    const b = randomUUID()

    beforeAll(async () => {
        await dropAll()
        await admin(`CREATE DATABASE "${settings.DATABASE_NAME}"`)
        database = new DatabaseService(new ConfigService(settings))
        await database.ready()
    })

    afterAll(async () => {
        await database?.onModuleDestroy()
        await dropAll()
    })

    it('the database of the app only keeps the register, no data of organisations', async () => {
        const { rows } = await database.query<{ table_name: string }>(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
        )
        expect(rows.map(row => row.table_name)).toEqual(['registry_migrations', 'tenant_databases'])
    })

    it('makes, migrates and registers the database of an organisation the first time it is used', async () => {
        const store = new PgNotesStore(database)
        await store.create(a, randomUUID(), 'Van A')
        await store.create(b, randomUUID(), 'Van B')
        const { rows } = await database.query<{ organisation_id: string; database_name: string; status: string }>(
            'SELECT organisation_id, database_name, status FROM tenant_databases ORDER BY database_name'
        )
        expect(rows).toHaveLength(2)
        for (const row of rows) {
            expect(row.status).toBe('ready')
            expect(row.database_name).toBe(database.tenantDatabaseName(row.organisation_id))
        }
        const made = await admin('SELECT 1 FROM pg_database WHERE datname = ANY($1)', [
            rows.map(row => row.database_name)
        ])
        expect(made.rowCount).toBe(2)
    })

    it('every organisation only has its own notes, in its own database', async () => {
        const store = new PgNotesStore(database)
        expect((await store.list(a)).map(note => note.text)).toEqual(['Van A'])
        expect((await store.list(b)).map(note => note.text)).toEqual(['Van B'])
        const name = await database.withTenant(a, db => db.query<{ name: string }>('SELECT current_database() AS name'))
        expect(name.rows[0]?.name).toBe(database.tenantDatabaseName(a))
    })

    it('a second instance of the API uses the same databases (nothing is made twice)', async () => {
        const second = new DatabaseService(new ConfigService(settings))
        try {
            const [first, again] = await Promise.all([
                new PgNotesStore(second).list(a),
                new PgNotesStore(second).list(a)
            ])
            expect(first.map(note => note.text)).toEqual(['Van A'])
            expect(again.map(note => note.text)).toEqual(['Van A'])
        } finally {
            await second.onModuleDestroy()
        }
        const { rows } = await database.query<{ count: number }>('SELECT count(*)::int AS count FROM tenant_databases')
        expect(rows[0]?.count).toBe(2)
    })

    it('names a new database after the slug of the organisation, and never takes a database that exists already', async () => {
        const linde = randomUUID()
        const other = randomUUID()
        rememberTenantSlug(linde, 'de-linde')
        await new PgNotesStore(database).create(linde, randomUUID(), 'Van De Linde')
        const name = await database.withTenant(linde, db =>
            db.query<{ name: string }>('SELECT current_database() AS name')
        )
        expect(name.rows[0]?.name).toBe(`${settings.DATABASE_NAME}_de_linde`)
        // Another organisation with the same slug (renamed, or another one later): the start of its id is added
        rememberTenantSlug(other, 'de-linde')
        await new PgNotesStore(database).create(other, randomUUID(), 'Van de andere')
        const second = await database.withTenant(other, db =>
            db.query<{ name: string }>('SELECT current_database() AS name')
        )
        expect(second.rows[0]?.name).toBe(`${settings.DATABASE_NAME}_de_linde_${other.replaceAll('-', '').slice(0, 8)}`)
        // The register decides afterwards: a new slug changes nothing
        rememberTenantSlug(linde, 'nieuwe-naam')
        expect((await new PgNotesStore(database).list(linde)).map(note => note.text)).toEqual(['Van De Linde'])
        expect(database.tenantDatabaseNames(other, 'x'.repeat(63)).every(item => item.length <= 63)).toBe(true)
    })

    it('refuses a tenant id that is not a uuid, before any database is touched', async () => {
        await expect(database.withTenant('x; DROP DATABASE postgres', async () => 1)).rejects.toThrow(/uuid/)
        expect(() => database.tenantDatabaseName('../etc')).toThrow(/uuid/)
    })
})

describe('withLock', () => {
    it('lets one caller at a time do the work for the same key', async () => {
        const database = new DatabaseService(
            new ConfigService({ ...settings, DATABASE_NAME: 'postgres', TENANT_ISOLATION: 'rls' })
        )
        const order: string[] = []
        const job = (name: string) =>
            database.withLock('test-lock', async () => {
                order.push(name + ':start')
                await new Promise(resolve => setTimeout(resolve, 50))
                order.push(name + ':end')
            })
        try {
            await Promise.all([job('a'), job('b')])
        } finally {
            await database.onModuleDestroy()
        }
        expect(order.join(' ')).toMatch(/^(a:start a:end b:start b:end|b:start b:end a:start a:end)$/)
    })
})
