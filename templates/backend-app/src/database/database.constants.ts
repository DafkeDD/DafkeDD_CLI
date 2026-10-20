/**
 * Database role used by DatabaseService.withTenant(). It does not own the tables, so Row-Level Security applies to it.
 * Roles are shared by all databases of a PostgreSQL server, so the name starts with the name of the database.
 */
export const TENANT_ROLE = '__TENANT_ROLE__'

/**
 * Tables with data of an organisation: each has a tenant_id and a Row-Level Security policy (checked by the tests).
 * Add every table you make for an organisation here. The tenant ids are the ids of the organisations at the login
 * server (the tenant claim of the access token): this database has no table of organisations or users of its own.
 */
export const TENANT_TABLES = ['notes'] as const
