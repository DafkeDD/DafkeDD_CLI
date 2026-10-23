import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import pg from 'pg'
import { TENANT_TABLES } from '../src/database/database.constants.js'
import { DatabaseService } from '../src/database/database.service.js'
import { runMigrations } from '../src/database/migrator.js'
import { PgNotesStore } from '../src/notes/pg-notes.store.js'

/**
 * Runs against a REAL PostgreSQL (the one from .env): npm run test:db
 * It creates a separate database <DATABASE_NAME>_test, runs the migrations in it and removes it again afterwards.
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
    DATABASE_NAME: (process.env.DATABASE_NAME ?? 'app') + '_test',
    // One database (TENANT_ISOLATION=database is tested in tenant-databases.db-spec.ts)
    TENANT_ISOLATION: 'rls'
}
const connection = (database: string) => ({
    host: settings.DATABASE_HOST,
    port: Number(settings.DATABASE_PORT),
    user: settings.DATABASE_USER,
    password: settings.DATABASE_PASSWORD,
    database
})

async function admin(sql: string) {
    const client = new pg.Client(connection('postgres'))
    await client.connect()
    try {
        await client.query(sql)
    } finally {
        await client.end()
    }
}

describe('notes per organisation (real PostgreSQL, Row-Level Security)', () => {
    let database: DatabaseService
    const a = randomUUID()
    const b = randomUUID()

    beforeAll(async () => {
        await admin(`DROP DATABASE IF EXISTS "${settings.DATABASE_NAME}" WITH (FORCE)`)
        await admin(`CREATE DATABASE "${settings.DATABASE_NAME}"`)
        database = new DatabaseService(new ConfigService(settings))
        await database.ready()
    })

    afterAll(async () => {
        await database?.onModuleDestroy()
        await admin(`DROP DATABASE IF EXISTS "${settings.DATABASE_NAME}" WITH (FORCE)`)
    })

    it('runs the migrations once (a second run changes nothing)', async () => {
        const client = new pg.Client(connection(settings.DATABASE_NAME))
        await client.connect()
        try {
            expect(await runMigrations(client)).toEqual([])
        } finally {
            await client.end()
        }
    })

    it('has Row-Level Security and a policy on every table with a tenant_id', async () => {
        const { rows } = await database.query<{ table: string; rls: boolean; policies: number }>(
            `SELECT c.relname AS "table", c.relrowsecurity AS rls,
              (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = c.relname) AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND EXISTS (
            SELECT 1 FROM information_schema.columns col
             WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id')`
        )
        expect(rows.map(row => row.table).sort()).toEqual([...TENANT_TABLES].sort())
        for (const row of rows) {
            expect(row.rls, row.table).toBe(true)
            expect(row.policies, row.table).toBeGreaterThan(0)
        }
    })

    it('an organisation only sees and removes its own notes, even without a WHERE clause', async () => {
        const store = new PgNotesStore(database)
        const author = randomUUID()
        const noteA = await store.create(a, author, 'Van A')
        await store.create(b, author, 'Van B')
        expect((await store.list(a)).map(note => note.text)).toEqual(['Van A'])
        expect((await store.list(b)).map(note => note.text)).toEqual(['Van B'])
        const all = await database.withTenant(a, db => db.query<{ text: string }>('SELECT text FROM notes'))
        expect(all.rows.map(row => row.text)).toEqual(['Van A'])
        expect(await store.remove(b, noteA.id)).toBe(false)
        const deleted = await database.withTenant(b, db => db.query('DELETE FROM notes'))
        expect(deleted.rowCount).toBe(1)
        expect((await store.list(a)).map(note => note.text)).toEqual(['Van A'])
    })

    it('the tenant role cannot write a note for another organisation', async () => {
        await expect(
            database.withTenant(a, db =>
                db.query('INSERT INTO notes (tenant_id, author_id, text) VALUES ($1, $2, $3)', [b, randomUUID(), 'x'])
            )
        ).rejects.toThrow(/row-level security/)
    })
})
