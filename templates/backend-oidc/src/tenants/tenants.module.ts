import { Module } from '@nestjs/common'
import { BillingModule } from '../billing/billing.module.js'
import { AppRolesController } from './app-roles.controller.js'
import { OidcModule } from '../oidc/oidc.module.js'
import { AdminMembersController } from './admin-members.controller.js'
import { AuditController } from './audit.controller.js'
import { MembersController } from './members.controller.js'
import { MembersService } from './members.service.js'
import { PlatformController } from './platform.controller.js'
import { PresenceController } from './presence.controller.js'
import { TenantBillingController } from './tenant-billing.controller.js'
import { TenantsService } from './tenants.service.js'

/**
 * Managing tenants: the members of the own tenant (admins), its billing details, and every tenant of the platform with
 * its members (superadmins). Member data is read and changed with PostgreSQL Row-Level Security (see
 * PgOidcStore.listMembers and DatabaseService.withTenant).
 */
@Module({
    imports: [OidcModule, BillingModule],
    controllers: [
        MembersController,
        AppRolesController,
        PlatformController,
        AdminMembersController,
        TenantBillingController,
        PresenceController,
        AuditController
    ],
    providers: [MembersService, TenantsService],
    exports: [MembersService, TenantsService]
})
export class TenantsModule {}
