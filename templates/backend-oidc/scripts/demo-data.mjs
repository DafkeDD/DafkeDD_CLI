// Demo data for development and demos: npm run demo:data (again: nothing changes), npm run demo:data -- --remove
// Two organisations with users (doctors and staff), apps in the catalogue, a subscription with seats, a trial, a free
// grant, invoices (one open), support tickets (answered, closed with a rating) and a discount code. Every demo account
// has an address @demo.example.com and the same password: --password <text>, otherwise a random one printed once.
// The tables come from the migrations: the API makes them at its first start, or this script after `npm run build`.
// Never in production: the script stops when NODE_ENV is production.
import { randomBytes, scrypt } from 'node:crypto'
import { existsSync } from 'node:fs'
import { parseArgs } from 'node:util'
import pg from 'pg'

try {
    process.loadEnvFile()
} catch {
    // no .env file: use the environment as it is
}

const { values } = parseArgs({
    options: {
        password: { type: 'string' },
        remove: { type: 'boolean', default: false }
    }
})

if (process.env.NODE_ENV === 'production') {
    console.error('Demo data is for development only (NODE_ENV=production).')
    process.exit(1)
}

// The same table as USERS_TABLE in src/database/database.constants.ts (fixed, whatever DATABASE_NAME is)
const USERS_TABLE = '"__USERS_TABLE__"'
const DOMAIN = 'demo.example.com'
const TENANTS = ['demo-de-linde', 'demo-noord']
const DISCOUNT = 'DEMO20'

/** The apps of the catalogue (icons of ICONS in src/components/pasport/ui.tsx of the frontend). */
const PRODUCTS = [
    {
        code: 'agenda',
        name: 'Agenda',
        category: 'Planning',
        icon: 'calendar',
        color: '#2563eb',
        short: 'Appointments of the practice, online booking for patients.',
        description: 'Plan consultations, let patients book online and send reminders by email and text message.',
        features: ['Online booking', 'Reminders', 'Several calendars'],
        month: 2900,
        year: 29000,
        vault: false,
        sort: 1
    },
    {
        code: 'dossier',
        name: 'Patient record',
        category: 'Care',
        icon: 'fileKey',
        color: '#ea580c',
        short: 'The electronic patient record, signed with your eHealth certificate.',
        description: 'Consultations, prescriptions and referrals, linked to the eHealth platform.',
        features: ['eHealth', 'Prescriptions', 'Referral letters'],
        month: 4900,
        year: 49000,
        vault: true,
        sort: 2
    },
    {
        code: 'facturatie',
        name: 'Invoicing',
        category: 'Finance',
        icon: 'invoice',
        color: '#7c3aed',
        short: 'Invoices and payments of the practice.',
        description: 'Invoices, credit notes and payment follow-up, with an export for the accountant.',
        features: ['Invoices', 'Payment follow-up', 'Export'],
        month: 1900,
        year: 19000,
        vault: false,
        sort: 3
    },
    {
        code: 'todo',
        name: 'Tasks',
        category: 'Team',
        icon: 'checklist',
        color: '#0d9488',
        short: 'The tasks of the team, per person and per day.',
        description: 'Shared task lists for the practice: who does what, and when.',
        features: ['Lists', 'Deadlines', 'Assign'],
        month: 900,
        year: 9000,
        vault: false,
        sort: 4
    }
]

const PEOPLE = [
    { key: 'an', first: 'An', last: 'Peeters', tenant: 'demo-de-linde', role: 'admin', profession: 'doctor' },
    { key: 'bram', first: 'Bram', last: 'Janssens', tenant: 'demo-de-linde', role: 'user', profession: 'doctor' },
    { key: 'sofie', first: 'Sofie', last: 'Maes', tenant: 'demo-de-linde', role: 'user', profession: 'staff' },
    { key: 'koen', first: 'Koen', last: 'Wouters', tenant: 'demo-noord', role: 'admin', profession: 'doctor' }
]
const email = person => `${person.first}.${person.last}@${DOMAIN}`.toLowerCase()

const client = new pg.Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME
})
await client.connect()

/** The tables of the migrations: there when the API started once, else made with the migrations of dist/. */
async function ensureTables() {
    const { rows } = await client.query("SELECT to_regclass('schema_migrations') IS NOT NULL AS ok")
    const done = rows[0].ok ? (await client.query('SELECT max(id)::int AS id FROM schema_migrations')).rows[0].id : 0
    const migrator = new URL('../dist/database/migrator.js', import.meta.url)
    if (existsSync(migrator)) {
        const { runMigrations } = await import(migrator.href)
        await runMigrations(client)
        return
    }
    if (!done) throw new Error('The tables are not there yet: start the API once (npm run start:dev) or npm run build.')
}

const ago = days => new Date(Date.now() - days * 86_400_000)
const ahead = days => new Date(Date.now() + days * 86_400_000)

async function add() {
    const { rows: existing } = await client.query('SELECT 1 FROM tenants WHERE slug = ANY($1)', [TENANTS])
    if (existing.length) {
        console.log('The demo data is there already (npm run demo:data -- --remove takes it away).')
        return
    }
    const generated = !values.password
    const password = values.password ?? randomBytes(12).toString('base64url')
    const hash = await hashPassword(password)

    await client.query('BEGIN')
    // Who answers the tickets: the first superadmin (none yet: the answers have no author)
    const { rows: admins } = await client.query(
        `SELECT id, name FROM ${USERS_TABLE} WHERE is_superadmin ORDER BY created_at LIMIT 1`
    )
    const support = admins[0] ?? null

    const tenants = {}
    for (const [slug, name, city, company] of [
        ['demo-de-linde', 'Huisartsenpraktijk De Linde', 'Gent', 'De Linde BV'],
        ['demo-noord', 'Tandartsen Noord', 'Brugge', 'Tandartsen Noord BV']
    ]) {
        const { rows } = await client.query(
            `INSERT INTO tenants (slug, name, city, company, vat, billing_address, billing_email, plan, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pro', $8) RETURNING id`,
            [
                slug,
                name,
                city,
                company,
                slug === 'demo-de-linde' ? 'BE0123456789' : 'BE0987654321',
                `Kerkstraat 1, 9000 ${city}`,
                `billing@${DOMAIN}`,
                ago(slug === 'demo-de-linde' ? 120 : 30)
            ]
        )
        tenants[slug] = { id: rows[0].id, name, company, city }
    }

    const users = {}
    for (const person of PEOPLE) {
        const { rows } = await client.query(
            `INSERT INTO ${USERS_TABLE} (email, email_verified, name, first_name, last_name, locale, password_hash, presence)
             VALUES ($1, true, $2, $3, $4, 'nl', $5, $6) RETURNING id`,
            [
                email(person),
                `${person.first} ${person.last}`,
                person.first,
                person.last,
                hash,
                person.key === 'bram' ? 'busy' : 'available'
            ]
        )
        users[person.key] = rows[0].id
        await client.query(
            `INSERT INTO tenant_members (tenant_id, user_id, role, profession, last_seen_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [tenants[person.tenant].id, rows[0].id, person.role, person.profession, ago(1), ago(90)]
        )
    }
    // Sofie is out of office this week
    await client.query(
        `UPDATE ${USERS_TABLE} SET ooo_enabled = true, ooo_from = $2, ooo_until = $3,
         ooo_internal = 'Op verlof, vragen naar An.', ooo_external = 'Ik ben afwezig; An Peeters helpt je verder.'
         WHERE id = $1`,
        [users.sofie, ago(1), ahead(5)]
    )
    // An invitation that is still open
    await client.query(
        `INSERT INTO tenant_invitations (tenant_id, email, role, invited_by, expires_at, apps)
         VALUES ($1, $2, 'user', $3, $4, '[]')`,
        [tenants['demo-de-linde'].id, `lotte.claes@${DOMAIN}`, users.an, ahead(6)]
    )

    // The catalogue: products that are there already (same code) stay as they are
    const products = {}
    for (const product of PRODUCTS) {
        const { rows } = await client.query(
            `INSERT INTO license_products (code, name, description, short_description, category, icon, color, features,
               price_month_cents, price_year_cents, requires_vault, sort)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`,
            [
                product.code,
                product.name,
                product.description,
                product.short,
                product.category,
                product.icon,
                product.color,
                JSON.stringify(product.features),
                product.month,
                product.year,
                product.vault,
                product.sort
            ]
        )
        products[product.code] = { id: rows[0].id, ...product }
    }

    // De Linde: Agenda per year (5 seats, An and Bram have one), a free Tasks for the team, Sofie tries the record
    const linde = tenants['demo-de-linde']
    const { rows: subscription } = await client.query(
        `INSERT INTO tenant_subscriptions (tenant_id, product_id, interval, seats, status, provider_subscription_id,
           current_period_end, environment_name, region, created_at)
         VALUES ($1, $2, 'year', 5, 'active', 'demo_sub_linde_agenda', $3, 'De Linde', 'europe-west1', $4)
         RETURNING id`,
        [linde.id, products.agenda.id, ahead(245), ago(120)]
    )
    for (const user of [users.an, users.bram])
        await client.query(
            'INSERT INTO license_assignments (tenant_id, product_id, user_id, assigned_by) VALUES ($1, $2, $3, $4)',
            [linde.id, products.agenda.id, user, users.an]
        )
    await client.query(
        `INSERT INTO license_grants (tenant_id, product_id, seats, ends_at, note, granted_by)
         VALUES ($1, $2, 10, NULL, 'Demo: free for the team', $3)`,
        [linde.id, products.todo.id, support?.id ?? null]
    )
    await client.query(
        'INSERT INTO license_trials (tenant_id, product_id, user_id, started_at, ends_at) VALUES ($1, $2, $3, $4, $5)',
        [linde.id, products.dossier.id, users.sofie, ago(4), ahead(10)]
    )

    // The invoices: the agenda (4 seats) paid 120 days ago, a fifth seat added this week and still open
    const vat = 21
    const invoice = async ({ tenant, product, seats, amount, status, issued, payment }) => {
        const year = issued.getFullYear()
        const { rows } = await client.query(
            `INSERT INTO invoice_numbers (year, last) VALUES ($1, 1)
             ON CONFLICT (year) DO UPDATE SET last = invoice_numbers.last + 1 RETURNING last`,
            [year]
        )
        const vatCents = Math.round((amount * vat) / 100)
        await client.query(
            `INSERT INTO invoices (number, tenant_id, payment_id, subscription_id, product_code, product_name, description,
               period, seats, vat_percent, amount_cents, vat_cents, total_cents, status, issued_at, paid_at, tenant_name,
               company, vat, billing_address, billing_email)
             SELECT $1, t.id, $2, $3, $4, $5, $6, 'year', $7, $8, $9, $10, $11, $12, $13, $14, t.name, t.company, t.vat,
               t.billing_address, t.billing_email
             FROM tenants t WHERE t.id = $15`,
            [
                `FAC-${year}-${String(rows[0].last).padStart(4, '0')}`,
                payment,
                subscription[0].id,
                product.code,
                product.name,
                `${product.name} · ${seats} ${seats === 1 ? 'seat' : 'seats'} · per year`,
                seats,
                vat,
                amount,
                vatCents,
                amount + vatCents,
                status,
                issued,
                status === 'paid' ? issued : null,
                tenant.id
            ]
        )
    }
    const firstAmount = products.agenda.year * 4
    await client.query(
        `INSERT INTO billing_payments (id, tenant_id, subscription_id, kind, seats, amount_cents, status, period_end,
           created_at, paid_at, applied_at)
         VALUES ('demo_pay_linde_first', $1, $2, 'first', 4, $3, 'paid', $4, $5, $5, $5)`,
        [linde.id, subscription[0].id, Math.round(firstAmount * 1.21), ahead(245), ago(120)]
    )
    await invoice({
        tenant: linde,
        product: products.agenda,
        seats: 4,
        amount: firstAmount,
        status: 'paid',
        issued: ago(120),
        payment: 'demo_pay_linde_first'
    })
    await invoice({
        tenant: linde,
        product: products.agenda,
        seats: 1,
        amount: Math.round(products.agenda.year * (245 / 365)),
        status: 'open',
        issued: ago(3),
        payment: null
    })

    // A discount code for the marketplace
    await client.query(
        `INSERT INTO discount_codes (code, percent_off, duration, max_redemptions, expires_at, created_by)
         VALUES ($1, 20, 'once', 50, $2, $3) ON CONFLICT (code) DO NOTHING`,
        [DISCOUNT, ahead(60), support?.id ?? null]
    )

    // Support: an answered question, a closed one with a rating, and a new one of the other organisation
    const ticket = async ({ tenant, by, subject, app, status, priority = 'normal', messages, rating, days }) => {
        const { rows } = await client.query(
            `INSERT INTO tickets (tenant_id, created_by, subject, app_code, status, priority, assignee_id, created_at,
               updated_at, rating, rating_comment, rated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, number`,
            [
                tenant.id,
                by,
                subject,
                app,
                status,
                priority,
                status === 'open' ? null : (support?.id ?? null),
                ago(days),
                ago(Math.max(0, days - 1)),
                rating?.score ?? null,
                rating?.comment ?? null,
                rating ? ago(Math.max(0, days - 1)) : null
            ]
        )
        for (const [index, [role, body]] of messages.entries())
            await client.query(
                `INSERT INTO ticket_messages (ticket_id, tenant_id, author_id, role, body, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    rows[0].id,
                    tenant.id,
                    role === 'customer' ? by : (support?.id ?? null),
                    role,
                    body,
                    new Date(ago(days).getTime() + index * 3_600_000)
                ]
            )
        return rows[0]
    }
    await ticket({
        tenant: linde,
        by: users.an,
        subject: 'Herinneringen per sms voor de agenda',
        app: 'agenda',
        status: 'answered',
        days: 2,
        messages: [
            ['customer', 'Kunnen patiënten ook een **sms** krijgen een dag voor hun afspraak?'],
            ['support', 'Ja: zet in de agenda onder _Instellingen → Herinneringen_ de sms aan. Lukt het niet, laat het weten.']
        ]
    })
    await ticket({
        tenant: linde,
        by: users.bram,
        subject: 'eHealth-certificaat wordt niet herkend',
        app: 'dossier',
        status: 'closed',
        priority: 'high',
        days: 9,
        messages: [
            ['customer', 'Na het opladen van mijn certificaat zegt het dossier dat het niet geldig is.'],
            ['support', 'Het wachtwoord van het certificaat ontbrak in de vault. Na het invullen werkt het.'],
            ['customer', 'Klopt, het werkt nu. Bedankt!']
        ],
        rating: { score: 5, comment: 'Snel en duidelijk geholpen.' }
    })
    await ticket({
        tenant: tenants['demo-noord'],
        by: users.koen,
        subject: 'Factuur op naam van de vennootschap',
        app: null,
        status: 'open',
        days: 0,
        messages: [['customer', 'Kan de volgende factuur op naam van **Tandartsen Noord BV** komen?']]
    })
    await client.query('COMMIT')

    console.log('Demo data added:')
    console.log(`- ${tenants['demo-de-linde'].name} (Gent) and ${tenants['demo-noord'].name} (Brugge)`)
    for (const person of PEOPLE)
        console.log(`- ${email(person)}: ${person.role}, ${person.profession} (${tenants[person.tenant].name})`)
    console.log(`- apps ${PRODUCTS.map(product => product.name).join(', ')}, discount code ${DISCOUNT}, invoices and tickets`)
    console.log(
        generated
            ? `Password of every demo account (shown once): ${password}`
            : 'Every demo account has the password you gave.'
    )
    if (!support) console.log('No superadmin yet: the answers on the tickets have no author.')
}

async function remove() {
    await client.query('BEGIN')
    const { rows } = await client.query('DELETE FROM tenants WHERE slug = ANY($1) RETURNING name', [TENANTS])
    const { rowCount: people } = await client.query(`DELETE FROM ${USERS_TABLE} WHERE lower(email) LIKE $1`, [
        `%@${DOMAIN}`
    ])
    // The apps of the demo, only when no other organisation uses them
    const { rowCount: products } = await client.query(
        `DELETE FROM license_products p WHERE p.code = ANY($1)
           AND NOT EXISTS (SELECT 1 FROM tenant_subscriptions s WHERE s.product_id = p.id)
           AND NOT EXISTS (SELECT 1 FROM license_grants g WHERE g.product_id = p.id)
           AND NOT EXISTS (SELECT 1 FROM license_trials t WHERE t.product_id = p.id)
           AND NOT EXISTS (SELECT 1 FROM oidc_clients c WHERE c.product = p.code)`,
        [PRODUCTS.map(product => product.code)]
    )
    await client.query('DELETE FROM discount_codes WHERE code = $1 AND redemptions = 0', [DISCOUNT])
    await client.query('COMMIT')
    console.log(
        rows.length
            ? `Demo data removed: ${rows.map(row => row.name).join(', ')}, ${people} accounts, ${products} apps.`
            : 'There was no demo data.'
    )
}

// Same format as src/oidc/password.ts: scrypt$<N>$<salt>$<hash>
function hashPassword(text) {
    const N = 2 ** 15
    const salt = randomBytes(16)
    return new Promise((resolve, reject) =>
        scrypt(text, salt, 64, { N, r: 8, p: 1, maxmem: 128 * N * 8 * 2 }, (error, key) =>
            error ? reject(error) : resolve(['scrypt', N, salt.toString('hex'), key.toString('hex')].join('$'))
        )
    )
}

try {
    await ensureTables()
    if (values.remove) await remove()
    else await add()
} catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
} finally {
    await client.end()
}
