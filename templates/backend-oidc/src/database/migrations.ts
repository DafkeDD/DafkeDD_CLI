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
  -- NULL: a platform session of a superadmin, without an organisation (invisible for the tenant role)
  tenant_id uuid REFERENCES tenants (id) ON DELETE CASCADE,
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
  tenant_id uuid REFERENCES tenants (id) ON DELETE CASCADE,
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
    },
    {
        id: 2,
        name: 'login with the Belgian eID',
        sql: `
-- An account registered with the eID has no password until it chooses one (forgot password).
ALTER TABLE ${users} ALTER COLUMN password_hash DROP NOT NULL;

-- Other ways to recognise a person. eid: an HMAC-SHA256 of the national register number with a key derived from
-- OIDC_MASTER_KEY: the number itself is never stored, and without the key the hash says nothing.
-- Not tenant data (an account can belong to several tenants), so no Row-Level Security; the tenant role has no access.
CREATE TABLE user_identifiers (
  type text NOT NULL CHECK (type IN ('eid')),
  value_hash text NOT NULL,
  user_id uuid NOT NULL REFERENCES ${users} (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  PRIMARY KEY (type, value_hash),
  UNIQUE (user_id, type)
);
`
    },
    {
        id: 3,
        name: 'sessions you can see, refresh tokens',
        sql: `
-- A public id per session (the sid claim of the tokens, and the id on /me/sessions), the browser that started it and
-- when it was last used. The cookie value itself stays known only as its hash (id_hash).
ALTER TABLE oidc_sessions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE oidc_sessions ADD CONSTRAINT oidc_sessions_id_key UNIQUE (id);
ALTER TABLE oidc_sessions ADD COLUMN user_agent text;
ALTER TABLE oidc_sessions ADD COLUMN last_used_at timestamptz;

-- Refresh tokens (only their sha256). Bound to a session: they stop with it (logout, password reset, a disabled
-- member). Every use gives a new one (rotation); an old one used again ends its whole family and the session.
CREATE TABLE oidc_refresh_tokens (
  token_hash text PRIMARY KEY,
  family_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES oidc_sessions (id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES oidc_clients (client_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES ${users} (id) ON DELETE CASCADE,
  -- NULL: a platform login of a superadmin
  tenant_id uuid REFERENCES tenants (id) ON DELETE CASCADE,
  scope text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX oidc_refresh_tokens_family_idx ON oidc_refresh_tokens (family_id);
CREATE INDEX oidc_refresh_tokens_session_idx ON oidc_refresh_tokens (session_id);
-- The refresh tokens a code gave: when the code comes back (stolen), they are revoked (RFC 6749 section 4.1.2)
ALTER TABLE oidc_codes ADD COLUMN refresh_family uuid;
${isolate('oidc_refresh_tokens', 'tenant_id')}
`
    },
    {
        id: 4,
        name: 'licences, trials, subscriptions and discount codes',
        sql: `
-- Products that are sold per user (seat), per organisation. Prices in cents, as charged (VAT included); a year is
-- always cheaper than twelve months (checked by the API).
CREATE TABLE license_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_month_cents integer NOT NULL CHECK (price_month_cents > 0),
  price_year_cents integer NOT NULL CHECK (price_year_cents > 0),
  currency text NOT NULL DEFAULT 'EUR',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The customer of an organisation at the payment provider (Mollie), created at its first purchase
ALTER TABLE tenants ADD COLUMN payment_customer_id text;

-- Discount codes, made by superadmins. percent_off (1 to 100) or amount_off_cents; for one product or all of them;
-- duration: once (the first payment), repeating (duration_periods periods) or forever.
CREATE TABLE discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{2,39}$'),
  percent_off integer CHECK (percent_off BETWEEN 1 AND 100),
  amount_off_cents integer CHECK (amount_off_cents > 0),
  product_id uuid REFERENCES license_products (id) ON DELETE CASCADE,
  duration text NOT NULL CHECK (duration IN ('once', 'repeating', 'forever')),
  duration_periods integer CHECK (duration_periods > 0),
  max_redemptions integer CHECK (max_redemptions > 0),
  redemptions integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES ${users} (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((percent_off IS NULL) <> (amount_off_cents IS NULL)),
  CHECK ((duration = 'repeating') = (duration_periods IS NOT NULL))
);

-- One subscription per organisation per product: a number of paid seats, per month or per year. status pending: the
-- first payment is not paid yet. current_period_end: paid until then (NULL while pending).
CREATE TABLE tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES license_products (id) ON DELETE CASCADE,
  interval text NOT NULL CHECK (interval IN ('month', 'year')),
  seats integer NOT NULL CHECK (seats >= 1),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'past_due', 'canceled')),
  provider_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  discount_code_id uuid REFERENCES discount_codes (id) ON DELETE SET NULL,
  -- Periods that still get the discount (NULL: forever, or no discount)
  discount_periods_left integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_id)
);

-- A code works once per organisation
CREATE TABLE discount_redemptions (
  discount_code_id uuid NOT NULL REFERENCES discount_codes (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (discount_code_id, tenant_id)
);

-- Free seats a superadmin gives an organisation (until ends_at, or for good when NULL)
CREATE TABLE license_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES license_products (id) ON DELETE CASCADE,
  seats integer NOT NULL CHECK (seats >= 1),
  ends_at timestamptz,
  note text NOT NULL DEFAULT '',
  granted_by uuid REFERENCES ${users} (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Every user first gets a trial per product in an organisation, once; a superadmin can extend it
CREATE TABLE license_trials (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES license_products (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES ${users} (id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, product_id, user_id)
);

-- Seats in use: which user has one of the (paid or free) seats of a product
CREATE TABLE license_assignments (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES license_products (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES ${users} (id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES ${users} (id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, product_id, user_id)
);

-- Payments at the provider (the id is theirs): what they were for, and how they ended
CREATE TABLE billing_payments (
  id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES tenant_subscriptions (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('first', 'seats', 'recurring')),
  seats integer NOT NULL,
  amount_cents integer NOT NULL,
  status text NOT NULL,
  -- seats: the end of the period it was priced for (a later period does not get the seats)
  period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  -- What it paid for is applied once: claimed for a short while, then applied_at (a failure can be tried again)
  applying_until timestamptz,
  applied_at timestamptz
);
${isolate('tenant_subscriptions', 'tenant_id')}
${isolate('discount_redemptions', 'tenant_id')}
${isolate('license_grants', 'tenant_id')}
${isolate('license_trials', 'tenant_id')}
${isolate('license_assignments', 'tenant_id')}
${isolate('billing_payments', 'tenant_id')}

-- The application may check licences itself, inside DatabaseService.withTenant()
GRANT SELECT ON license_products TO ${role};
GRANT SELECT ON tenant_subscriptions, license_grants, license_trials, license_assignments TO ${role};
-- Tenant code may rename its tenant, but never change payment_customer_id or its status
REVOKE UPDATE ON tenants FROM ${role};
GRANT UPDATE (name) ON tenants TO ${role};
`
    },
    {
        id: 5,
        name: 'audit log',
        sql: `
-- Who did what, when and from where. Append-only: an UPDATE or a DELETE fails (only the retention purge, with
-- app.audit_purge set in its own transaction, deletes old rows). No foreign keys: an event stays when what it is
-- about changes or goes.
CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The organisation it happened in; NULL for the platform and the account itself (only superadmins see those)
  tenant_id uuid,
  -- Who did it; NULL for the system (a payment coming in) or someone who is not logged in (a failed login)
  actor_id uuid,
  action text NOT NULL CHECK (action ~ '^[a-z]+\\.[a-z_]+$'),
  target_type text,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}',
  ip text,
  user_agent text
);
CREATE INDEX audit_events_tenant ON audit_events (tenant_id, id DESC);
CREATE INDEX audit_events_actor ON audit_events (actor_id, id DESC);
CREATE INDEX audit_events_target ON audit_events (target_type, target_id, id DESC);
CREATE INDEX audit_events_created ON audit_events (created_at);

CREATE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.audit_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();
${isolate('audit_events', 'tenant_id')}

-- The admins of an organisation read its log inside DatabaseService.withTenant(): Row-Level Security shows only
-- its own events (never the platform and account events, whose tenant_id is NULL)
GRANT SELECT ON audit_events TO ${role};
`
    },
    {
        id: 6,
        name: 'login at another OpenID Connect server',
        sql: `
-- external: an HMAC of the issuer and the subject (sub) of the other server, like the eID never in plain text
ALTER TABLE user_identifiers DROP CONSTRAINT user_identifiers_type_check;
ALTER TABLE user_identifiers ADD CONSTRAINT user_identifiers_type_check CHECK (type IN ('eid', 'external'));
`
    },
    {
        id: 7,
        name: 'passkeys',
        sql: `
-- Passkeys (WebAuthn): the public key of each credential; the private key never leaves the device of the user
CREATE TABLE user_passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES ${users} (id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  algorithm integer NOT NULL CHECK (algorithm IN (-7, -257, -8)),
  sign_count bigint NOT NULL DEFAULT 0,
  name text NOT NULL,
  aaguid text NOT NULL DEFAULT '',
  backup_eligible boolean NOT NULL DEFAULT false,
  backed_up boolean NOT NULL DEFAULT false,
  transports text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX user_passkeys_user ON user_passkeys (user_id);
`
    },
    {
        id: 8,
        name: 'external applications: consent and back-channel logout',
        sql: `
-- Back-channel logout (OpenID Connect Back-Channel Logout 1.0): where the server tells a client that a session ended
ALTER TABLE oidc_clients ADD COLUMN backchannel_logout_uri text;
ALTER TABLE oidc_clients ADD COLUMN backchannel_logout_session_required boolean NOT NULL DEFAULT false;

-- What a user allowed an application that is not our own (firstParty false): the scopes, until revoked
CREATE TABLE oidc_consents (
  user_id uuid NOT NULL REFERENCES ${users} (id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES oidc_clients (client_id) ON DELETE CASCADE,
  scopes text[] NOT NULL,
  -- With the tenant scope: the organisations whose name and role the application may see
  tenant_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_id)
);

-- Consent screens answered already: a copy of the login cookie cannot answer twice (also with several API processes)
CREATE TABLE oidc_used_interactions (
  interaction_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);

-- Which clients got a code in a session: they hear about its end
CREATE TABLE oidc_session_clients (
  session_id uuid NOT NULL REFERENCES oidc_sessions (id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES oidc_clients (client_id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, client_id)
);

-- Logout tokens still to deliver (with retries); filled by the trigger below, whatever ended the session
CREATE TABLE oidc_logout_queue (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  client_id text NOT NULL REFERENCES oidc_clients (client_id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  next_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oidc_logout_queue_next ON oidc_logout_queue (next_at);

CREATE FUNCTION oidc_session_ended() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO oidc_logout_queue (session_id, user_id, client_id)
  SELECT NEW.id, NEW.user_id, sc.client_id
    FROM oidc_session_clients sc JOIN oidc_clients c ON c.client_id = sc.client_id
   WHERE sc.session_id = NEW.id AND c.backchannel_logout_uri IS NOT NULL;
  RETURN NEW;
END;
$$;
-- Only when an active session ends (logout, ended on /security, password reset, member disabled, a stolen refresh
-- token): not when it simply runs out after 12 hours
CREATE TRIGGER oidc_session_ended AFTER UPDATE OF expires_at ON oidc_sessions
  FOR EACH ROW WHEN (OLD.expires_at > now() AND NEW.expires_at <= now())
  EXECUTE FUNCTION oidc_session_ended();
`
    },
    {
        id: 9,
        name: 'clients managed on /admin',
        sql: `
-- file: from config/oidc-clients.json (applied at every start); admin: made by a superadmin on /admin
ALTER TABLE oidc_clients ADD COLUMN source text NOT NULL DEFAULT 'file' CHECK (source IN ('file', 'admin'));
-- A disabled client cannot log anyone in and its refresh tokens stop
ALTER TABLE oidc_clients ADD COLUMN disabled_at timestamptz;
ALTER TABLE oidc_clients ADD COLUMN created_by uuid REFERENCES ${users} (id) ON DELETE SET NULL;
`
    },
    {
        id: 10,
        name: 'link codes for apps',
        sql: `
-- A one-time code (15 minutes) a superadmin makes on /admin: the CLI links a new project to an app with it
CREATE TABLE oidc_link_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES oidc_clients (client_id) ON DELETE CASCADE,
  created_by uuid REFERENCES ${users} (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX oidc_link_codes_client ON oidc_link_codes (client_id);
`
    },
    {
        id: 11,
        name: 'an app is a product',
        sql: `
-- The product (license_products.code) an app sells: one licence per user per app. NULL: the app is free (the login
-- server itself, or an application of others). One product belongs to one app.
ALTER TABLE oidc_clients ADD COLUMN product text;
CREATE UNIQUE INDEX oidc_clients_product_key ON oidc_clients (product) WHERE product IS NOT NULL;
`
    },
    {
        id: 12,
        name: 'roles per app',
        sql: `
-- The roles an app has, defined by its developer (config/app-roles.json of the app, pushed with a link code, or
-- "roles" in the clients file): [{ "key": "editor", "names": { "en": "Editor", ... }, "default": true }]
ALTER TABLE oidc_clients ADD COLUMN roles jsonb NOT NULL DEFAULT '[]';

-- The roles of a member in an app, given by the admins (beheerders) of the organisation. No row: the default roles.
CREATE TABLE app_role_assignments (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES oidc_clients (client_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES ${users} (id) ON DELETE CASCADE,
  roles text[] NOT NULL,
  assigned_by uuid REFERENCES ${users} (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, client_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_members (tenant_id, user_id) ON DELETE CASCADE
);
${isolate('app_role_assignments', 'tenant_id')}
GRANT SELECT, INSERT, UPDATE, DELETE ON app_role_assignments TO ${role};
`
    },
    {
        id: 13,
        name: 'apps in invitations',
        sql: `
-- The apps an invitation gives access to, chosen by the admin who invites:
-- [{ "clientId": "planner", "roles": ["editor"] or null (the default roles), "seat": true }]
ALTER TABLE tenant_invitations ADD COLUMN apps jsonb NOT NULL DEFAULT '[]';
`
    },
    {
        id: 14,
        name: 'profiles, billing details, professions, app catalogue and the eHealth vault',
        sql: `
-- The own profile. name stays the display name (first_name + ' ' + last_name when both are set). pending_email: a
-- new address that is not confirmed yet (the link in the email is an encrypted token, see account-token.ts).
-- rrn_enc: the national register number, encrypted with a key derived from OIDC_MASTER_KEY, only filled from the eID
-- and only ever shown to the account itself. address: from the eID when it gives one.
ALTER TABLE ${users} ADD COLUMN first_name text;
ALTER TABLE ${users} ADD COLUMN last_name text;
ALTER TABLE ${users} ADD COLUMN phone text;
ALTER TABLE ${users} ADD COLUMN pending_email text;
ALTER TABLE ${users} ADD COLUMN rrn_enc text;
ALTER TABLE ${users} ADD COLUMN address text;

-- Billing details of an organisation (on its invoices), where it is and its plan (free text, set by superadmins)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS company text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS vat text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_address text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_email text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'Starter';
-- The contact a superadmin gave when creating the organisation (shown until its first admin joined)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_name text;

-- doctor: may use the eHealth vault (and the apps that need it) in this organisation
ALTER TABLE tenant_members ADD COLUMN profession text NOT NULL DEFAULT 'staff' CHECK (profession IN ('doctor', 'staff'));

-- How a product looks in the app catalogue. description is the long text, short_description the line on its card.
-- launch_url may contain {slug}: the slug of the organisation.
ALTER TABLE license_products ADD COLUMN icon text NOT NULL DEFAULT 'box';
ALTER TABLE license_products ADD COLUMN category text NOT NULL DEFAULT '';
ALTER TABLE license_products ADD COLUMN short_description text NOT NULL DEFAULT '';
ALTER TABLE license_products ADD COLUMN features jsonb NOT NULL DEFAULT '[]';
ALTER TABLE license_products ADD COLUMN color text;
ALTER TABLE license_products ADD COLUMN requires_vault boolean NOT NULL DEFAULT false;
ALTER TABLE license_products ADD COLUMN launch_url text;
ALTER TABLE license_products ADD COLUMN sort integer NOT NULL DEFAULT 0;

-- The environment of a purchase (the practice name and the region it runs in)
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS environment_name text;
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS region text;

-- The eHealth certificate (PKCS#12) of an account: the file and its password encrypted (AES-256-GCM, a key derived
-- from OIDC_MASTER_KEY), and what the certificate says (filled in once it could be opened). Belongs to the account,
-- not to an organisation: no Row-Level Security; the tenant role has no access.
CREATE TABLE user_vault (
  user_id uuid PRIMARY KEY REFERENCES ${users} (id) ON DELETE CASCADE,
  filename text NOT NULL,
  size_bytes integer NOT NULL,
  p12_enc bytea NOT NULL,
  password_enc bytea,
  thumbprint text,
  subject text,
  issuer text,
  serial text,
  valid_until timestamptz,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
`
    },
    {
        id: 15,
        name: 'support tickets, invoices and notifications',
        sql: `
-- Support tickets of an organisation: shown as TIC-<number> (from 1001). app_code: the product it is about (NULL:
-- a general question). assignee_id: the superadmin who handles it.
CREATE SEQUENCE ticket_numbers START WITH 1001;
CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number integer NOT NULL UNIQUE DEFAULT nextval('ticket_numbers'),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  created_by uuid REFERENCES ${users} (id) ON DELETE SET NULL,
  subject text NOT NULL,
  app_code text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'answered', 'closed')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
  assignee_id uuid REFERENCES ${users} (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER SEQUENCE ticket_numbers OWNED BY tickets.number;
CREATE INDEX tickets_tenant ON tickets (tenant_id, updated_at DESC);
CREATE INDEX tickets_updated ON tickets (updated_at DESC);

-- The conversation: customer (a member) or support (a superadmin)
CREATE TABLE ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  author_id uuid REFERENCES ${users} (id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('customer', 'support')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_messages_ticket ON ticket_messages (ticket_id, created_at);

-- Internal notes of the support team (never shown to the organisation: the tenant role has no access)
CREATE TABLE ticket_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  author_id uuid REFERENCES ${users} (id) ON DELETE SET NULL,
  body text NOT NULL,
  mentions uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_notes_ticket ON ticket_notes (ticket_id, created_at);

-- A payment for several open invoices at once has no subscription
ALTER TABLE billing_payments ALTER COLUMN subscription_id DROP NOT NULL;
ALTER TABLE billing_payments DROP CONSTRAINT billing_payments_kind_check;
ALTER TABLE billing_payments ADD CONSTRAINT billing_payments_kind_check
  CHECK (kind IN ('first', 'seats', 'recurring', 'invoices'));
ALTER TABLE billing_payments ADD CONSTRAINT billing_payments_subscription_check
  CHECK ((kind = 'invoices') = (subscription_id IS NULL));

-- Invoices: FAC-<year>-<number>, numbered per year without gaps (invoice_numbers, in the same transaction). Amounts
-- in cents: amount (without VAT) + vat = total. The billing details of the organisation are copied when it is issued.
-- payment_id: the payment it was made for; settled_by: a later payment of all open invoices at once.
CREATE TABLE invoice_numbers (
  year integer PRIMARY KEY,
  last integer NOT NULL
);
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  payment_id text REFERENCES billing_payments (id) ON DELETE SET NULL,
  settled_by text REFERENCES billing_payments (id) ON DELETE SET NULL,
  subscription_id uuid REFERENCES tenant_subscriptions (id) ON DELETE SET NULL,
  product_code text NOT NULL,
  product_name text NOT NULL,
  description text NOT NULL,
  period text NOT NULL CHECK (period IN ('month', 'year')),
  seats integer NOT NULL,
  vat_percent integer NOT NULL CHECK (vat_percent BETWEEN 0 AND 100),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  vat_cents integer NOT NULL CHECK (vat_cents >= 0),
  total_cents integer NOT NULL CHECK (total_cents = amount_cents + vat_cents),
  status text NOT NULL CHECK (status IN ('open', 'paid', 'free', 'void')),
  checkout_url text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  tenant_name text NOT NULL,
  company text,
  vat text,
  billing_address text,
  billing_email text
);
CREATE INDEX invoices_tenant ON invoices (tenant_id, issued_at DESC);
-- One invoice per payment (a webhook that comes twice)
CREATE UNIQUE INDEX invoices_payment_key ON invoices (payment_id);

-- Notifications of an account (in one organisation, or tenant_id NULL: the platform, for superadmins). The text is
-- made by the frontend from kind and params; nav says which screen it opens.
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES ${users} (id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind ~ '^[a-z]+\\.[a-z_]+$'),
  params jsonb NOT NULL DEFAULT '{}',
  nav jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);
-- Read notifications that are computed when asked (a contract that ends soon): their stable id per account
CREATE TABLE notification_reads (
  user_id uuid NOT NULL REFERENCES ${users} (id) ON DELETE CASCADE,
  key text NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- The environment of a purchase (also in migration 14; here for databases that ran an older version of it)
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS environment_name text;
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS region text;

${isolate('tickets', 'tenant_id')}
${isolate('ticket_messages', 'tenant_id')}
${isolate('invoices', 'tenant_id')}
${isolate('notifications', 'tenant_id')}

-- Members read and write the tickets of their organisation inside DatabaseService.withTenant(); they can only change
-- the status (close, reopen). Admins read its invoices there.
GRANT SELECT, INSERT ON tickets TO ${role};
GRANT UPDATE (status, updated_at) ON tickets TO ${role};
GRANT USAGE ON SEQUENCE ticket_numbers TO ${role};
GRANT SELECT, INSERT ON ticket_messages TO ${role};
GRANT SELECT ON invoices TO ${role};
`
    },
    {
        id: 16,
        name: 'ratings of support tickets',
        sql: `
-- How satisfied the customer was with a closed ticket: 1 (bad) to 5 (very good), an optional comment. Rating again
-- overwrites it; reopening the ticket keeps it.
ALTER TABLE tickets ADD COLUMN rating smallint CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE tickets ADD COLUMN rating_comment text;
ALTER TABLE tickets ADD COLUMN rated_at timestamptz;

-- Members rate the tickets of their organisation (inside DatabaseService.withTenant())
GRANT UPDATE (rating, rating_comment, rated_at) ON tickets TO ${role};
`
    },
    {
        id: 17,
        name: 'images of support tickets',
        sql: `
-- Images in the messages of the tickets (![name](att:<id>)), of an organisation: PNG, JPEG, GIF or WebP (the type is
-- detected from the content), at most 2 MiB. They are never changed; they go with the organisation.
CREATE TABLE ticket_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES ${users} (id) ON DELETE SET NULL,
  filename text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  size integer NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_attachments_tenant ON ticket_attachments (tenant_id);

${isolate('ticket_attachments', 'tenant_id')}

-- Members upload and read the images of their organisation (inside DatabaseService.withTenant())
GRANT SELECT, INSERT ON ticket_attachments TO ${role};
`
    },
    {
        id: 18,
        name: 'demo per product',
        sql: `
-- Whether customers can try a product for free (a trial): new members get one automatically and a member may ask one.
-- A superadmin can always give one. Turning it off does not end the trials that are running.
ALTER TABLE license_products ADD COLUMN demo_enabled boolean NOT NULL DEFAULT true;
`
    },
    {
        id: 19,
        name: 'presence status',
        sql: `
-- The status the account chose (like Microsoft Teams). Others see it only while the account is online (a request in
-- the last 2 minutes); "offline" makes it look offline anyway.
ALTER TABLE ${users} ADD COLUMN presence text NOT NULL DEFAULT 'available'
  CHECK (presence IN ('available', 'busy', 'dnd', 'brb', 'away', 'offline'));

-- The list of members (inside DatabaseService.withTenant()) shows it
GRANT SELECT (presence) ON ${users} TO ${role};
`
    },
    {
        id: 20,
        name: 'out of office',
        sql: `
-- An out-of-office reply (like Outlook): on or off, optionally only from/until a moment, with a message for colleagues
-- (the support team, e.g. when they mention the account in an internal note) and one for customers (on their tickets).
ALTER TABLE ${users}
  ADD COLUMN ooo_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN ooo_from timestamptz,
  ADD COLUMN ooo_until timestamptz,
  ADD COLUMN ooo_internal text CHECK (length(ooo_internal) <= 1000),
  ADD COLUMN ooo_external text CHECK (length(ooo_external) <= 1000),
  ADD CONSTRAINT ooo_period CHECK (ooo_from IS NULL OR ooo_until IS NULL OR ooo_until > ooo_from);
`
    },
    {
        id: 21,
        name: 'catalogue apps sell their product',
        sql: `
-- An app of the catalogue has the code of its product as client id: it sells that product from now on
UPDATE oidc_clients c SET product = c.client_id FROM license_products p WHERE p.code = c.client_id AND c.product IS NULL;
`
    },
    {
        id: 22,
        name: 'several other OpenID Connect servers',
        sql: `
-- An account can be linked to several other servers at once (Google and Microsoft): one kind per server, external for
-- the first (OIDC_EXTERNAL_*) and external_<n> for OIDC_EXTERNAL_<n>_*
ALTER TABLE user_identifiers DROP CONSTRAINT user_identifiers_type_check;
ALTER TABLE user_identifiers ADD CONSTRAINT user_identifiers_type_check
  CHECK (type IN ('eid', 'external') OR type ~ '^external_[2-9]$');
`
    },
    {
        id: 23,
        name: 'colleagues who use the eHealth certificate of a doctor',
        sql: `
-- A doctor lets colleagues of the same organisation (the secretariat) use the eHealth certificate in the apps: for
-- that organisation only, and it goes away with the membership of either. Platform code reads it (the tenant role
-- has no access); Row-Level Security like every table with a tenant_id.
CREATE TABLE vault_delegates (
  tenant_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  delegate_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, owner_id, delegate_id),
  CHECK (owner_id <> delegate_id),
  FOREIGN KEY (tenant_id, owner_id) REFERENCES tenant_members (tenant_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, delegate_id) REFERENCES tenant_members (tenant_id, user_id) ON DELETE CASCADE
);
CREATE INDEX vault_delegates_delegate ON vault_delegates (delegate_id, tenant_id);
${isolate('vault_delegates', 'tenant_id')}
`
    },
    {
        id: 24,
        name: 'catalogue apps sell their product, again',
        sql: `
-- An app of the catalogue made between migration 21 and 0.54.1 got no product (its admin page did not send it), so
-- everyone of an organisation could log in to it without a licence: it sells the product with its code from now on.
-- Not when another app sells that product already (one app per product)
UPDATE oidc_clients c SET product = c.client_id FROM license_products p
  WHERE p.code = c.client_id AND COALESCE(c.product, '') = '' AND c.source = 'admin'
    AND NOT EXISTS (SELECT 1 FROM oidc_clients o WHERE o.product = c.client_id);
`
    }
]
