// Checks that the database from .env can be reached, and creates the database when it does not exist yet.
// Usage: npm run db:check
import pg from 'pg'

try {
    process.loadEnvFile()
} catch {
    // no .env file: use the environment as it is
}

const name = process.env.DATABASE_NAME ?? ''

async function connect(database) {
    const client = new pg.Client({
        host: process.env.DATABASE_HOST,
        port: Number(process.env.DATABASE_PORT),
        user: process.env.DATABASE_USER,
        password: process.env.DATABASE_PASSWORD,
        database,
        connectionTimeoutMillis: 5000
    })
    await client.connect()
    return client
}

try {
    let client
    try {
        client = await connect(name)
    } catch (error) {
        // 3D000 = the server works but this database does not exist yet: create it through the "postgres" database.
        if (error?.code !== '3D000') throw error
        const admin = await connect('postgres')
        try {
            await admin.query('CREATE DATABASE "' + name.replaceAll('"', '""') + '"')
        } finally {
            await admin.end()
        }
        console.log('Created database ' + name)
        client = await connect(name)
    }
    const { rows } = await client.query('SELECT version() AS version')
    console.log('Connected: ' + rows[0].version)
    await client.end()
} catch (error) {
    console.error('Could not connect to the database: ' + (error instanceof Error ? error.message : String(error)))
    process.exit(1)
}
