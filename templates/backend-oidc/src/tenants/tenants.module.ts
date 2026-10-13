import { Module } from '@nestjs/common'
import { TenantMembersService } from './tenant-members.service.js'

/** Tenant-scoped services (Row-Level Security through DatabaseService.withTenant). */
@Module({
    providers: [TenantMembersService],
    exports: [TenantMembersService]
})
export class TenantsModule {}
