import { TENANT_ROLE, TENANT_TABLES, USERS_TABLE } from './database.constants.js'
import { MIGRATIONS } from './migrations.js'
import { checksum, runMigrations } from './migrator.js'

const sql = MIGRATIONS.map(migration => migration.sql).join('\n')

/** Names of the tables that have a tenant_id column (or are the tenants table itself). */
function tablesWithTenant(): string[] {
    const tables: string[] = []
    for (const match of sql.matchAll(/CREATE TABLE ("?[\w]+"?) \(([\s\S]*?)\n\);/g)) {
        const name = (match[1] ?? '').replaceAll('"', '')
        if (name === 'tenants' || /\btenant_id\b/.test(match[2] ?? '')) tables.push(name)
    }
    return tables
}

describe('migrations', () => {
    it('have unique, increasing ids', () => {
        const ids = MIGRATIONS.map(migration => migration.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect([...ids].sort((a, b) => a - b)).toEqual(ids)
    })

    it('create the users table named after the database', () => {
        expect(USERS_TABLE.endsWith('users')).toBe(true)
        expect(sql).toContain(`CREATE TABLE "${USERS_TABLE}"`)
        expect(sql).toContain('(lower(email))')
    })

    it('protect EVERY table with tenant data with Row-Level Security and a policy', () => {
        const tables = tablesWithTenant()
        expect([...tables].sort()).toEqual([...TENANT_TABLES].sort())
        for (const table of TENANT_TABLES) {
            expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`)
            expect(sql).toMatch(new RegExp(`CREATE POLICY tenant_isolation ON ${table}\\s+USING`))
        }
    })

    it('never give the tenant role access to the OpenID Connect tables or the password hashes', () => {
        const grants = [...sql.matchAll(/GRANT ([^;]+) TO "?(\w+)"?;/g)].filter(grant => grant[2] === TENANT_ROLE)
        expect(grants.length).toBeGreaterThan(0)
        for (const grant of grants) {
            expect(grant[1]).not.toMatch(/oidc_/)
            expect(grant[1]).not.toMatch(/password_hash/)
        }
    })
})

describe('runMigrations', () => {
    function fakeDb(applied: { id: number; checksum: string }[] = []) {
        const statements: string[] = []
        return {
            statements,
            query: vi.fn(async (text: string) => {
                statements.push(text)
                if (text.startsWith('SELECT id, checksum')) return { rows: applied }
                return { rows: [] }
            })
        }
    }

    it('applies every migration in a transaction and records it, under an advisory lock', async () => {
        const db = fakeDb()
        expect(await runMigrations(db as never)).toEqual(MIGRATIONS.map(migration => migration.id))
        expect(db.statements[0]).toContain('pg_advisory_lock')
        expect(db.statements).toContain('BEGIN')
        expect(db.statements).toContain('COMMIT')
        expect(db.statements.some(statement => statement.startsWith('INSERT INTO schema_migrations'))).toBe(true)
        expect(db.statements.at(-1)).toContain('pg_advisory_unlock')
    })

    it('skips migrations that already ran', async () => {
        const db = fakeDb(MIGRATIONS.map(migration => ({ id: migration.id, checksum: checksum(migration.sql) })))
        expect(await runMigrations(db as never)).toEqual([])
        expect(db.statements).not.toContain('BEGIN')
    })

    it('refuses a migration that was changed after it ran, and still releases the lock', async () => {
        const db = fakeDb([{ id: 1, checksum: 'something else' }])
        await expect(runMigrations(db as never)).rejects.toThrow('was changed')
        expect(db.statements.at(-1)).toContain('pg_advisory_unlock')
    })

    it('rolls back a failing migration', async () => {
        const db = fakeDb()
        db.query.mockImplementation(async (text: string) => {
            db.statements.push(text)
            if (text.includes('CREATE TABLE "')) throw new Error('boom')
            return { rows: [] }
        })
        await expect(runMigrations(db as never)).rejects.toThrow('boom')
        expect(db.statements).toContain('ROLLBACK')
        expect(db.statements).not.toContain('COMMIT')
    })
})
