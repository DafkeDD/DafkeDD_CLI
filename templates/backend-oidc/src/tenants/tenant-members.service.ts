import { Injectable } from '@nestjs/common'
import { USERS_TABLE } from '../database/database.constants.js'
import { DatabaseService } from '../database/database.service.js'

export interface TenantMember {
    userId: string
    name: string
    email: string
    roles: string[]
}

/**
 * Example of tenant-scoped code. Note that the queries have NO "WHERE tenant_id = ...": withTenant() runs them as the
 * tenant role, and Row-Level Security only lets the rows of that tenant through. Write your own tenant code like this.
 */
@Injectable()
export class TenantMembersService {
    constructor(private readonly database: DatabaseService) {}

    async list(tenantId: string): Promise<TenantMember[]> {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const result = await db.query<TenantMember>(
                `SELECT m.user_id AS "userId", u.name, u.email, m.roles
           FROM tenant_members m JOIN "${USERS_TABLE}" u ON u.id = m.user_id
          ORDER BY u.name`
            )
            return result.rows
        })
    }

    async setRoles(tenantId: string, userId: string, roles: string[]): Promise<boolean> {
        await this.database.ready()
        return this.database.withTenant(tenantId, async db => {
            const result = await db.query('UPDATE tenant_members SET roles = $2 WHERE user_id = $1', [userId, roles])
            return (result.rowCount ?? 0) > 0
        })
    }
}
