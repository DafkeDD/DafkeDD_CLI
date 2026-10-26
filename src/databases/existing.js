import { run } from '../runner.js'

/**
 * Is the database of a new project already there, with tables (a project of earlier with the same name)? Then its
 * data stays, also the superadmin and its password of then: the CLI asks what to do instead of starting on top of it.
 */

/**
 * The pg driver, loaded only when a database is checked: without it (npm install not run yet) the CLI still starts
 * and simply does not look for a database of earlier.
 */
async function client(config, Client) {
    if (Client) return new Client(config)
    try {
        return new (await import('pg')).default.Client(config)
    } catch {
        return null
    }
}

/** The volume of PostgreSQL in Docker (docker-compose.yml: `name: <project>`, volume postgres-data). */
export const dockerVolume = project => `${project}_postgres-data`

/** A database on a PostgreSQL server that is running: how many tables it has, or null (not there, or no server). */
export async function localTables(db, { Client = null } = {}) {
    const connection = await client(
        {
            host: db.host,
            port: db.port,
            user: db.user,
            password: db.password,
            database: db.database,
            connectionTimeoutMillis: 3000
        },
        Client
    )
    if (!connection) return null
    try {
        await connection.connect()
    } catch {
        // Not there yet (3D000), or the server is not reachable now: nothing to warn about
        return null
    }
    try {
        const { rows } = await connection.query(
            "SELECT count(*)::int AS tables FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')"
        )
        return rows[0]?.tables ?? 0
    } catch {
        return null
    } finally {
        await connection.end().catch(() => undefined)
    }
}

/** Does the Docker volume of this project exist (an earlier database)? False without Docker. */
export async function dockerVolumeExists(project, { exec = run } = {}) {
    try {
        await exec('docker', ['volume', 'inspect', dockerVolume(project)])
        return true
    } catch {
        return false
    }
}

/** Removes the earlier database: on the server (DROP DATABASE), or the Docker volume (and the containers using it). */
export async function emptyDatabase(db, { Client = null, exec = run } = {}) {
    if (db.mode === 'docker') {
        const out = await exec('docker', [
            'ps',
            '-aq',
            '--filter',
            `label=com.docker.compose.project=${db.project}`
        ]).catch(() => '')
        const ids = String(out ?? '')
            .split(/\s+/)
            .filter(Boolean)
        if (ids.length) await exec('docker', ['rm', '-f', ...ids])
        await exec('docker', ['volume', 'rm', '-f', dockerVolume(db.project)])
        return
    }
    const connection = await client(
        {
            host: db.host,
            port: db.port,
            user: db.user,
            password: db.password,
            database: 'postgres',
            connectionTimeoutMillis: 5000
        },
        Client
    )
    if (!connection) throw new Error('Het pakket pg ontbreekt: voer npm install uit in de map van DafkeDD_CLI')
    await connection.connect()
    try {
        await connection.query(`DROP DATABASE IF EXISTS "${db.database.replaceAll('"', '""')}" WITH (FORCE)`)
    } finally {
        await connection.end().catch(() => undefined)
    }
}
