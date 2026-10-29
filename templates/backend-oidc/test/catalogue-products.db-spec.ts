import { ConfigService } from '@nestjs/config'
import pg from 'pg'
import { DatabaseService } from '../src/database/database.service.js'
import { MIGRATIONS } from '../src/database/migrations.js'

/**
 * Migration 24 against a REAL PostgreSQL (the one from .env): npm run test:db. The apps of the catalogue that got no
 * product get the product of their code again, and the migration never fails on a product another app sells already.
 * Uses its own database <DATABASE_NAME>_test_catalogue and removes it afterwards.
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
    DATABASE_NAME: (process.env.DATABASE_NAME ?? 'app') + '_test_catalogue'
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

describe('migration 24: catalogue apps sell their product (real PostgreSQL)', () => {
    let database: DatabaseService

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

    it('gives the apps without a product theirs, leaves the others alone, and never fails on a product in use', async () => {
        for (const code of ['kids', 'agenda', 'shop'])
            await database.query(
                `INSERT INTO license_products (code, name, price_month_cents, price_year_cents) VALUES ($1, $1, 1000, 10000)`,
                [code]
            )
        const client = (clientId: string, source: 'admin' | 'file', product: string | null) =>
            database.query(
                `INSERT INTO oidc_clients (client_id, name, type, redirect_uris, source, product)
                 VALUES ($1, $1, 'public', ARRAY['https://app.example.com/callback'], $2, $3)`,
                [clientId, source, product]
            )
        // Made by an older admin page: no product (NULL) or an empty one
        await client('kids', 'admin', null)
        await client('agenda', 'admin', '')
        // Another app sells "shop" already: the app with that code stays as it is (the product is unique)
        await client('shop-old', 'admin', 'shop')
        await client('shop', 'admin', null)
        // An internal app (no product has its id) and an app of the clients file: left alone
        await client('intern.tool', 'admin', null)
        await client('frontend', 'file', null)

        const migration = MIGRATIONS.find(item => item.id === 24)!
        await database.query(migration.sql)
        // Twice: nothing changes the second time
        await database.query(migration.sql)

        const { rows } = await database.query<{ client_id: string; product: string | null }>(
            `SELECT client_id, product FROM oidc_clients ORDER BY client_id`
        )
        expect(Object.fromEntries(rows.map(row => [row.client_id, row.product]))).toEqual({
            agenda: 'agenda',
            frontend: null,
            'intern.tool': null,
            kids: 'kids',
            shop: null,
            'shop-old': 'shop'
        })
    })
})
