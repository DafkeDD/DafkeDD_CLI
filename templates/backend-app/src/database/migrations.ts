import { TENANT_ROLE } from './database.constants.js'

/**
 * Database migrations, applied in order by runMigrations() (src/database/migrator.ts) when the API starts.
 *
 * Rules:
 * - never change a migration that already ran somewhere: add a new one with the next id (the checksum is checked)
 * - every table with data of an organisation gets a tenant_id, Row-Level Security and a policy (TENANT_TABLES)
 *
 * With TENANT_ISOLATION=rls (one database) MIGRATIONS run in the database of the app. With TENANT_ISOLATION=database
 * every organisation has a database of its own: MIGRATIONS run in each of them (Row-Level Security stays on there as
 * a second wall) and the database of the app only gets MAIN_MIGRATIONS (which organisation has which database).
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

/**
 * Only with TENANT_ISOLATION=database: the migrations of the database of the app itself (table registry_migrations).
 * It belongs to no organisation and only knows which organisation has which database.
 */
export const MAIN_MIGRATIONS: Migration[] = [
    {
        id: 1,
        name: 'register of the databases of the organisations',
        sql: `
-- organisation_id is the id of the organisation at the login server (the tenant claim of the access token)
CREATE TABLE tenant_databases (
  organisation_id uuid PRIMARY KEY,
  database_name text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'ready')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz
);
`
    }
]
