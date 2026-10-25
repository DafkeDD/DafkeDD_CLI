import { Module } from '@nestjs/common'
import { OidcModule } from '../oidc/oidc.module.js'
import { PgStatsStore } from './pg-stats.store.js'
import { StatsController } from './stats.controller.js'
import { StatsService } from './stats.service.js'
import { STATS_STORE } from './stats.store.js'

/** Statistics of the platform for superadmins (src/stats). */
@Module({
    imports: [OidcModule],
    controllers: [StatsController],
    providers: [StatsService, { provide: STATS_STORE, useClass: PgStatsStore }]
})
export class StatsModule {}
