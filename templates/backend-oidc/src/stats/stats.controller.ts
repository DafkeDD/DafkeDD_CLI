import { Controller, Get, Query } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { IsIn, IsOptional } from 'class-validator'
import { i18nValidationMessage } from 'nestjs-i18n'
import { Access } from '../access/access.js'
import { STATS_RANGES, type StatsRange, StatsService } from './stats.service.js'

export class StatsQueryDto {
    @ApiPropertyOptional({
        enum: STATS_RANGES,
        description:
            '6m: the last 6 months (default); year: January until now; all: since the first organisation (24 months at most)'
    })
    @IsOptional()
    @IsIn(STATS_RANGES, { message: i18nValidationMessage('validation.IS_IN') })
    range?: StatsRange
}

/** Statistics of the whole platform, for superadmins. */
@ApiTags('platform (superadmin)')
@Controller('admin/stats')
@Access('superadmin')
export class StatsController {
    constructor(private readonly stats: StatsService) {}

    @Get()
    @ApiOperation({ summary: 'Organisations, active users, apps bought, revenue, the popular apps and discount codes' })
    @ApiOkResponse({
        description:
            '{ months: ["YYYY-MM"], kpis: { tenants, activeUsers, purchasedApps, revenueMonthCents: { value, deltaPct, spark: number[8] } }, ' +
            'revenueCents: number[], signups: number[], appBreakdown: [{ code, name, color, count }], codes: [{ code, redemptions }], ' +
            'codesRedeemedTotal, codesTotal }'
    })
    get(@Query() query: StatsQueryDto) {
        return this.stats.stats(query.range ?? '6m')
    }
}
