import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator'
import { i18nValidationMessage } from 'nestjs-i18n'
import { AUDIT_CATEGORIES, type AuditCategory } from './audit.actions.js'

const message = (key: string) => ({ message: i18nValidationMessage('validation.' + key) })

/** The filters of the audit log (query string). */
export class AuditQueryDto {
    @ApiPropertyOptional({ enum: AUDIT_CATEGORIES, description: 'Only one kind of events' })
    @IsOptional()
    @IsIn(AUDIT_CATEGORIES, message('IS_IN'))
    category?: AuditCategory

    @ApiPropertyOptional({ description: 'Only what this account did (user id)' })
    @IsOptional()
    @IsUUID('all', message('IS_UUID'))
    actor?: string

    @ApiPropertyOptional({ example: '1532', description: 'The `next` of the page before: older events' })
    @IsOptional()
    @Matches(/^\d{1,18}$/, message('MATCHES'))
    before?: string

    @ApiPropertyOptional({ example: 50, description: '1 to 100 (default 50)' })
    @IsOptional()
    @Type(() => Number)
    @IsInt(message('IS_INT'))
    @Min(1, message('MIN'))
    @Max(100, message('MAX'))
    limit?: number
}

/** The audit log of the whole platform: also which organisation. */
export class PlatformAuditQueryDto extends AuditQueryDto {
    @ApiPropertyOptional({ description: 'One organisation (its id), or `platform`: the platform and account events' })
    @IsOptional()
    @Matches(/^(platform|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i, message('MATCHES'))
    tenant?: string
}
