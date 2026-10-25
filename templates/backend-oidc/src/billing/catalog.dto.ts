import { ApiPropertyOptional } from '@nestjs/swagger'
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsInt,
    IsOptional,
    IsString,
    Matches,
    Max,
    MaxLength,
    Min
} from 'class-validator'
import { i18nValidationMessage } from 'nestjs-i18n'

const message = (key: string) => ({ message: i18nValidationMessage('validation.' + key) })
const each = (key: string) => ({ each: true, message: i18nValidationMessage('validation.' + key) })

/** How a product looks in the app catalogue (POST and PATCH /admin/products). Every field is optional. */
export class CatalogDto {
    @ApiPropertyOptional({
        example: 'calendar',
        description: 'Icon key: checklist, calendar, roster, invoice, users, idcard, euro, box, ... (default box)'
    })
    @IsOptional()
    @Matches(/^[a-z0-9][a-z0-9-]{0,39}$/, message('MATCHES'))
    icon?: string

    @ApiPropertyOptional({ example: 'Planning' })
    @IsOptional()
    @IsString(message('IS_STRING'))
    @MaxLength(60, message('MAX_LENGTH'))
    category?: string

    @ApiPropertyOptional({ example: 'Appointments online, 24/7', description: 'The line on its card' })
    @IsOptional()
    @IsString(message('IS_STRING'))
    @MaxLength(200, message('MAX_LENGTH'))
    short?: string

    @ApiPropertyOptional({ example: ['Online booking', 'SMS reminders'], type: [String] })
    @IsOptional()
    @IsArray(message('IS_ARRAY'))
    @ArrayMaxSize(20, message('ARRAY_MAX_SIZE'))
    @IsString(each('IS_STRING'))
    @MaxLength(200, each('MAX_LENGTH'))
    features?: string[]

    @ApiPropertyOptional({ example: '#2563eb', nullable: true, type: String, description: 'Hex colour, or null' })
    @IsOptional()
    @Matches(/^#[0-9a-fA-F]{6}$/, message('MATCHES'))
    color?: string | null

    @ApiPropertyOptional({ example: false, description: 'Needs the eHealth vault (a doctor with a certificate)' })
    @IsOptional()
    @IsBoolean(message('IS_BOOLEAN'))
    requiresVault?: boolean

    @ApiPropertyOptional({
        example: true,
        description:
            'Customers can try it for free (a trial of 14 days; a member has to ask it). Default true. ' +
            'Turning it off does not end running trials; a superadmin can always give one'
    })
    @IsOptional()
    @IsBoolean(message('IS_BOOLEAN'))
    demoEnabled?: boolean

    @ApiPropertyOptional({
        example: 'https://{slug}.agenda.example.com',
        nullable: true,
        type: String,
        description: 'Where the app opens; {slug} becomes the slug of the organisation. null: no link'
    })
    @IsOptional()
    @Matches(/^https?:\/\/\S+$/, message('MATCHES'))
    @MaxLength(500, message('MAX_LENGTH'))
    launchUrl?: string | null

    @ApiPropertyOptional({ example: 10, description: 'Lower first in the catalogue (then by name)' })
    @IsOptional()
    @IsInt(message('IS_INT'))
    @Min(-100_000, message('MIN'))
    @Max(100_000, message('MAX'))
    sort?: number
}
