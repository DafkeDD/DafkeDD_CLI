/** The users table: the name of the database followed by "users". */
export const USERS_TABLE = '__USERS_TABLE__'

/**
 * Database role used by DatabaseService.withTenant(). It does not own the tables, so Row-Level Security applies to it.
 * Roles are shared by all databases of a PostgreSQL server, so the name starts with the name of the database.
 */
export const TENANT_ROLE = '__TENANT_ROLE__'

/** Tables with customer data: each has a tenant id and a Row-Level Security policy (checked by the tests). */
export const TENANT_TABLES = [
    'tenants',
    'tenant_members',
    'tenant_invitations',
    'oidc_sessions',
    'oidc_codes',
    'oidc_refresh_tokens',
    'tenant_subscriptions',
    'discount_redemptions',
    'license_grants',
    'license_trials',
    'license_assignments',
    'billing_payments',
    'audit_events',
    'app_role_assignments',
    'notifications'
] as const
