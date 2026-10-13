import { TENANT_ROLE, USERS_TABLE } from './database.constants.js'

/**
 * Database migrations, applied in order by runMigrations() (src/database/migrator.ts) when the API starts.
 *
 * Rules:
 * - never change a migration that already ran somewhere: add a new one with the next id (the checksum is checked)
 * - every table with customer data gets a tenant_id, Row-Level Security and a policy (see TENANT_TABLES)
 */
export interface Migration {
    id: number
    name: string
    sql: string
}

const users = '"' + USERS_TABLE + '"'
const role = '"' + TENANT_ROLE + '"'
// The tenant of the current transaction, set by DatabaseService.withTenant(). NULL when not set: no rows at all.
const currentTenant = "NULLIF(current_setting('app.tenant_id', true), '')::uuid"

const isolate = (table: string, column: string) => `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ${table}
  USING (${column} = ${currentTenant})
  WITH CHECK (${column} = ${currentTenant});`

export const MIGRATIONS: Migration[] = [
    {
        id: 1,
        name: 'users, tenants and OpenID Connect',
        sql: `
CREATE TABLE ${users} (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  name text NOT NULL,
  locale text,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  -- Platform administrator: admin of every tenant, also new ones. Never set by registration.
  is_superadmin boolean NOT NULL DEFAULT false,
  -- Two-factor authentication (TOTP): the secret encrypted with OIDC_MASTER_KEY, the last time step used (replay
  -- protection) and sha256 hashes of the unused recovery codes
  totp_secret text,
  totp_enabled boolean NOT NULL DEFAULT false,
  totp_last_step bigint,
  recovery_codes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "${USERS_TABLE}_email_key" ON ${users} (lower(email));

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_members (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES ${users} (id) ON DELETE CASCADE,
  -- user: uses the application; admin: manages this tenant (members, invitations, settings)
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  -- disabled: still a member, but cannot log in to this tenant or use its API (an admin can enable it again)
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  -- The last request of the member in this tenant (who is online), at most once a minute
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX tenant_members_user_idx ON tenant_members (user_id);

-- Invitations that were not accepted yet (an accepted or withdrawn invitation is deleted)
CREATE TABLE tenant_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'admin')),
  invited_by uuid REFERENCES ${users} (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX tenant_invitations_email_key ON tenant_invitations (tenant_id, lower(email));

CREATE TABLE oidc_clients (
  client_id text PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('public', 'confidential')),
  secret_hash text,
  redirect_uris text[] NOT NULL,
  post_logout_redirect_uris text[] NOT NULL DEFAULT '{}',
  grant_types text[] NOT NULL DEFAULT '{authorization_code}',
  scopes text[] NOT NULL DEFAULT '{openid}',
  first_party boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'confidential') = (secret_hash IS NOT NULL))
);

CREATE TABLE oidc_signing_keys (
  kid text PRIMARY KEY,
  alg text NOT NULL CHECK (alg IN ('RS256', 'ES256')),
  public_jwk jsonb NOT NULL,
  private_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'retiring')),
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz
);
CREATE UNIQUE INDEX oidc_signing_keys_one_active ON oidc_signing_keys (alg) WHERE status = 'active';

-- A running login is not stored here: it lives in an encrypted cookie (src/oidc/interaction.ts).
-- interaction_hash is unique, so one login can create only one session (no replay of that cookie).
CREATE TABLE oidc_sessions (
  id_hash text PRIMARY KEY,
  interaction_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES ${users} (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  auth_time timestamptz NOT NULL,
  acr text NOT NULL,
  amr text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX oidc_sessions_user_idx ON oidc_sessions (user_id);

CREATE TABLE oidc_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES oidc_clients (client_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES ${users} (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  session_hash text NOT NULL,
  redirect_uri text NOT NULL,
  scope text NOT NULL,
  nonce text,
  code_challenge text NOT NULL,
  auth_time timestamptz NOT NULL,
  acr text NOT NULL,
  amr text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

-- Row-Level Security: the tenant role only sees the rows of app.tenant_id
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${TENANT_ROLE}') THEN
    CREATE ROLE ${role} NOLOGIN;
  END IF;
  BEGIN
    GRANT ${role} TO CURRENT_USER;
  EXCEPTION WHEN insufficient_privilege OR invalid_grant_operation THEN
    RAISE NOTICE 'Could not grant the tenant role to the current user';
  END;
END
$$;
${isolate('tenants', 'id')}
${isolate('tenant_members', 'tenant_id')}
${isolate('tenant_invitations', 'tenant_id')}
${isolate('oidc_sessions', 'tenant_id')}
${isolate('oidc_codes', 'tenant_id')}

GRANT SELECT, UPDATE ON tenants TO ${role};
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_members TO ${role};
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_invitations TO ${role};
GRANT SELECT (id, email, name, locale, email_verified) ON ${users} TO ${role};
`
    }
]
