// Creates or updates a user and adds it to a tenant: npm run oidc:user -- --email ada@example.com --name "Ada" --tenant acme
// Options: --password <text> (otherwise a random password is printed once), --role user|admin (default user),
// --tenant-name "Acme", --superadmin (admin of every tenant of the platform),
// --reset-mfa (removes two-step verification: the user sets it up again at the next login, e.g. after losing the phone).
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
        role: { type: 'string', default: 'user' },
        superadmin: { type: 'boolean', default: false },
        'reset-mfa': { type: 'boolean', default: false }
    }
})

const email = values.email?.trim().toLowerCase()
const tenantSlug = values.tenant?.trim().toLowerCase()

const connect = async () => {
    const client = new pg.Client({
        host: process.env.DATABASE_HOST,
        port: Number(process.env.DATABASE_PORT),
        user: process.env.DATABASE_USER,
        password: process.env.DATABASE_PASSWORD,
        database: process.env.DATABASE_NAME
    })
    await client.connect()
    return client
}

// npm run oidc:user -- --email ada@example.com --reset-mfa: only removes two-step verification and ends the sessions
if (values['reset-mfa']) {
    if (!email) {
        console.error('Usage: npm run oidc:user -- --email ada@example.com --reset-mfa')
        process.exit(1)
    }
    const client = await connect()
    try {
        const users = '"' + process.env.DATABASE_NAME + 'users"'
        const { rows } = await client.query(
            `UPDATE ${users} SET totp_secret = NULL, totp_enabled = false, totp_last_step = NULL, recovery_codes = '{}',
         updated_at = now() WHERE lower(email) = lower($1) RETURNING id`,
            [email]
        )
        if (!rows[0]) {
            console.error(`No account with ${email}.`)
            process.exitCode = 1
        } else {
            await client.query('UPDATE oidc_sessions SET expires_at = least(expires_at, now()) WHERE user_id = $1', [
                rows[0].id
            ])
            console.log(`Two-step verification of ${email} was reset: it is set up again at the next login.`)
        }
    } finally {
        await client.end()
    }
    process.exit()
}
if (
    !email ||
    !/^[^@\s]+@[^@\s]+$/.test(email) ||
    !tenantSlug ||
    !/^[a-z0-9][a-z0-9-]{1,62}$/.test(tenantSlug) ||
    !['user', 'admin'].includes(values.role)
) {
    console.error(
        'Usage: npm run oidc:user -- --email ada@example.com --name "Ada" --tenant acme [--role user|admin] [--superadmin] [--password ...]'
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
const usersTable = '"' + process.env.DATABASE_NAME + 'users"'

let client
try {
    client = await connect()
    await client.query('BEGIN')
    const tenant = await client.query(
        `INSERT INTO tenants (slug, name) VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET name = COALESCE($3, tenants.name) RETURNING id, name`,
        [tenantSlug, values['tenant-name'] ?? tenantSlug, values['tenant-name'] ?? null]
    )
    const user = await client.query(
        `INSERT INTO ${usersTable} (email, email_verified, name, password_hash, is_superadmin) VALUES ($1, true, $2, $3, $5)
     ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = COALESCE($4, ${usersTable}.name),
       is_superadmin = ${usersTable}.is_superadmin OR $5, email_verified = true, updated_at = now()
     RETURNING id`,
        [email, values.name ?? email, await hashPassword(password), values.name ?? null, values.superadmin]
    )
    await client.query(
        `INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [tenant.rows[0].id, user.rows[0].id, values.role]
    )
    await client.query('COMMIT')
    console.log(
        `User ${email} is ${values.role} of "${tenant.rows[0].name}" (${tenantSlug})${values.superadmin ? ' and superadmin' : ''}.`
    )
    if (generated) console.log(`Password (shown once): ${password}`)
} catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    console.error(
        'Could not save the user: ' +
            message +
            (/does not exist/.test(message) ? ' (start the API once first: it creates the tables)' : '')
    )
    process.exitCode = 1
} finally {
    await client?.end()
}
