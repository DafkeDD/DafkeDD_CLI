import { createRequire } from 'node:module'
import path from 'node:path'
import { accountPrefix, readEnv } from './env'

type Client = {
    connect(): Promise<void>
    query(sql: string, values: unknown[]): Promise<unknown>
    end(): Promise<void>
}

/**
 * After the run: removes every test account of this run from the users table (`<database>users`), with the pg of the
 * API and its database (backend/.env; the DATABASE_* settings of the environment win, as in the CI).
 */
export default async function globalTeardown() {
    const env = { ...readEnv('../backend/.env'), ...process.env }
    const pg = createRequire(path.resolve('../backend/package.json'))('pg') as {
        Client: new (config: object) => Client
    }
    const client = new pg.Client({
        host: env.DATABASE_HOST,
        port: Number(env.DATABASE_PORT),
        user: env.DATABASE_USER,
        password: env.DATABASE_PASSWORD,
        database: env.DATABASE_NAME
    })
    await client.connect()
    try {
        const table = `${env.DATABASE_NAME}users`.replaceAll('"', '""')
        await client.query(`DELETE FROM "${table}" WHERE lower(email) LIKE $1`, [`${accountPrefix()}%@example.com`])
    } finally {
        await client.end()
    }
}
