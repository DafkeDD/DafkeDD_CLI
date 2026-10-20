import { TENANT_ROLE } from './database.constants.js'

/**
 * Database migrations, applied in order by runMigrations() (src/database/migrator.ts) when the API starts.
 *
 * Rules:
 * - never change a migration that already ran somewhere: add a new one with the next id (the checksum is checked)
 * - every table with data of an organisation gets a tenant_id, Row-Level Security and a policy (TENANT_TABLES)
 */
export interface Migration {
    id: number
    name: string
    sql: string
}

const role = '"' + TENANT_ROLE + '"'
// The tenant of the current transaction, set by DatabaseService.withTenant(). NULL when not set: no rows at all.
const currentTenant = "NULLIF(current_setting('app.tenant_id', true), '')::uuid"

/** Row-Level Security for a table with a tenant_id: the tenant role only sees and writes rows of its tenant. */
export const isolate = (table: string, column = 'tenant_id') => `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ${table}
  USING (${column} = ${currentTenant})
  WITH CHECK (${column} = ${currentTenant});
GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO ${role};`

export const MIGRATIONS: Migration[] = [
    {
        id: 1,
        name: 'tenant role and notes',
        sql: `
-- The role of DatabaseService.withTenant(): it owns nothing, so Row-Level Security applies to it
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${TENANT_ROLE}') THEN
    CREATE ROLE ${role} NOLOGIN;
  END IF;
  BEGIN
    GRANT ${role} TO CURRENT_USER;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not grant the tenant role to the current user';
  END;
END
$$;
GRANT USAGE ON SCHEMA public TO ${role};

-- An example of data of an organisation: notes. tenant_id and author_id are ids of the login server.
CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  author_id uuid NOT NULL,
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_tenant ON notes (tenant_id, created_at DESC);
${isolate('notes')}
`
    }
]
