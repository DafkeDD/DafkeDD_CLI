import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import pg from 'pg'
import { DatabaseService } from '../src/database/database.service.js'
import { PgFileIndex } from '../src/files/pg-file-index.js'

/**
 * The descriptions of the files in a REAL PostgreSQL (the one from .env): npm run test:db
 * It uses a separate database <DATABASE_NAME>_files and removes it again afterwards.
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
    DATABASE_NAME: (process.env.DATABASE_NAME ?? 'app') + '_files',
    TENANT_ISOLATION: 'rls'
}

async function admin(sql: string) {
    const client = new pg.Client({
        host: settings.DATABASE_HOST,
        port: Number(settings.DATABASE_PORT),
        user: settings.DATABASE_USER,
        password: settings.DATABASE_PASSWORD,
        database: 'postgres'
    })
    await client.connect()
    try {
        await client.query(sql)
    } finally {
        await client.end()
    }
}

describe('the descriptions of the files per organisation (real PostgreSQL, Row-Level Security)', () => {
    let database: DatabaseService
    const a = randomUUID()
    const b = randomUUID()
    const file = (name: string) => ({
        id: randomUUID(),
        name,
        contentType: 'image/png',
        size: 12,
        sha256: 'a'.repeat(64),
        createdBy: randomUUID(),
        createdAt: new Date().toISOString()
    })

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

    it('an organisation only finds, lists and removes its own files', async () => {
        const index = new PgFileIndex(database)
        const own = await index.add(a, file('a.png'))
        await index.add(b, file('b.png'))
        expect((await index.list(a)).map(info => info.name)).toEqual(['a.png'])
        expect(await index.find(a, own.id)).toMatchObject({ id: own.id, name: 'a.png', size: 12 })
        expect(await index.find(b, own.id)).toBeNull()
        expect(await index.remove(b, own.id)).toBe(false)
        expect(await index.remove(a, own.id)).toBe(true)
        const all = await database.withTenant(b, db => db.query<{ name: string }>('SELECT name FROM files'))
        expect(all.rows.map(row => row.name)).toEqual(['b.png'])
    })

    it('the tenant role cannot write a file for another organisation', async () => {
        await expect(
            database.withTenant(a, db =>
                db.query(
                    "INSERT INTO files (id, tenant_id, name, content_type, size, sha256, created_by) VALUES ($1, $2, 'x', 'image/png', 1, 'x', $3)",
                    [randomUUID(), b, randomUUID()]
                )
            )
        ).rejects.toThrow(/row-level security/)
    })
})
