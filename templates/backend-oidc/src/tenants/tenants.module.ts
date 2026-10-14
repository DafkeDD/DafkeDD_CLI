import { Module } from '@nestjs/common'
import { OidcModule } from '../oidc/oidc.module.js'
import { AuditController } from './audit.controller.js'
import { MembersController } from './members.controller.js'
import { PlatformController } from './platform.controller.js'
import { PresenceController } from './presence.controller.js'

/**
 * Managing tenants: the members of the own tenant (admins) and every tenant of the platform (superadmins). Member data
 * is read and changed with PostgreSQL Row-Level Security (see PgOidcStore.listMembers and DatabaseService.withTenant).
 */
@Module({
    imports: [OidcModule],
    controllers: [MembersController, PlatformController, PresenceController, AuditController]
})
export class TenantsModule {}
