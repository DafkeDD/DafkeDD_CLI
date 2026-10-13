// Creates or updates a user and adds it to a tenant: npm run oidc:user -- --email ada@example.com --name "Ada" --tenant acme
// Options: --password <text> (otherwise a random password is printed once), --roles admin,editor, --tenant-name "Acme".
// Start the API once first: it creates the tables.
import { randomBytes, scrypt } from 'node:crypto'
import { parseArgs } from 'node:util'
import pg from 'pg'

try {
    process.loadEnvFile()
} catch {
    // no .env file: use the environment as it is
}

const { values } = parseArgs({
    options: {
        email: { type: 'string' },
        name: { type: 'string' },
        password: { type: 'string' },
        tenant: { type: 'string' },
        'tenant-name': { type: 'string' },
        roles: { type: 'string', default: '' }
    }
})

const email = values.email?.trim().toLowerCase()
const tenantSlug = values.tenant?.trim().toLowerCase()
if (!email || !/^[^@\s]+@[^@\s]+$/.test(email) || !tenantSlug || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(tenantSlug)) {
    console.error(
        'Usage: npm run oidc:user -- --email ada@example.com --name "Ada" --tenant acme [--roles admin] [--password ...]'
    )
    process.exit(1)
}

// Same format as src/oidc/password.ts: scrypt$<N>$<salt>$<hash>
const N = 2 ** 15
function hashPassword(password) {
    const salt = randomBytes(16)
    return new Promise((resolve, reject) =>
        scrypt(password, salt, 64, { N, r: 8, p: 1, maxmem: 128 * N * 8 * 2 }, (error, key) =>
            error ? reject(error) : resolve(['scrypt', N, salt.toString('hex'), key.toString('hex')].join('$'))
        )
    )
}

const generated = !values.password
const password = values.password ?? randomBytes(12).toString('base64url')
if (password.length < 12) {
    console.error('Use a password of at least 12 characters.')
    process.exit(1)
}
const roles = values.roles
    .split(',')
    .map(role => role.trim())
    .filter(Boolean)
const usersTable = '"' + process.env.DATABASE_NAME + 'users"'

const client = new pg.Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME
})

try {
    await client.connect()
    await client.query('BEGIN')
    const tenant = await client.query(
        `INSERT INTO tenants (slug, name) VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET name = COALESCE($3, tenants.name) RETURNING id, name`,
        [tenantSlug, values['tenant-name'] ?? tenantSlug, values['tenant-name'] ?? null]
    )
    const user = await client.query(
        `INSERT INTO ${usersTable} (email, email_verified, name, password_hash) VALUES ($1, true, $2, $3)
     ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = COALESCE($4, ${usersTable}.name), updated_at = now()
     RETURNING id`,
        [email, values.name ?? email, await hashPassword(password), values.name ?? null]
    )
    await client.query(
        `INSERT INTO tenant_members (tenant_id, user_id, roles) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET roles = EXCLUDED.roles`,
        [tenant.rows[0].id, user.rows[0].id, roles]
    )
    await client.query('COMMIT')
    console.log(
        `User ${email} is a member of "${tenant.rows[0].name}" (${tenantSlug})${roles.length ? ' with roles ' + roles.join(', ') : ''}.`
    )
    if (generated) console.log(`Password (shown once): ${password}`)
} catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    console.error(
        'Could not save the user: ' +
            message +
            (/does not exist/.test(message) ? ' (start the API once first: it creates the tables)' : '')
    )
    process.exitCode = 1
} finally {
    await client.end()
}
