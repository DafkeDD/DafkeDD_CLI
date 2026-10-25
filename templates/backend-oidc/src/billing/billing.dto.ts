import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
    IsBoolean,
    IsDateString,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Max,
    MaxLength,
    Min,
    MinLength
} from 'class-validator'
import { i18nValidationMessage } from 'nestjs-i18n'
import { PAYMENT_METHODS, type PaymentMethod } from './billing.service.js'
import { CatalogDto } from './catalog.dto.js'
import { INTERVALS, type Interval, type DiscountDuration } from './store/billing.store.js'

const message = (key: string) => ({ message: i18nValidationMessage('validation.' + key) })
export const PRODUCT_CODE = /^[a-z0-9][a-z0-9-]{1,62}$/
const DISCOUNT_CODE = /^[A-Za-z0-9][A-Za-z0-9-]{2,39}$/
const DURATIONS: readonly DiscountDuration[] = ['once', 'repeating', 'forever']
const MAX_SEATS = 10_000
const MAX_CENTS = 10_000_000

export class ProductDto extends CatalogDto {
    @ApiProperty({
        example: 'planner',
        description: 'Fixed code (lowercase letters, digits, dashes): used in @License()'
    })
    @Matches(PRODUCT_CODE, message('MATCHES'))
    code!: string

    @ApiProperty({ example: 'Planner' })
    @IsString(message('IS_STRING'))
    @MinLength(2, message('MIN_LENGTH'))
    @MaxLength(100, message('MAX_LENGTH'))
    name!: string

    @ApiPropertyOptional({ example: 'Plan the week of your team' })
    @IsOptional()
    @IsString(message('IS_STRING'))
    @MaxLength(500, message('MAX_LENGTH'))
    description?: string

    @ApiProperty({ example: 900, description: 'Price per seat per month, in cents (as charged)' })
    @IsInt(message('IS_INT'))
    @Min(1, message('MIN'))
    @Max(MAX_CENTS, message('MAX'))
    priceMonthCents!: number

    @ApiProperty({ example: 9000, description: 'Price per seat per year, in cents: less than 12 months' })
    @IsInt(message('IS_INT'))
    @Min(1, message('MIN'))
    @Max(MAX_CENTS, message('MAX'))
    priceYearCents!: number
}

export class UpdateProductDto extends CatalogDto {
    @ApiPropertyOptional({ example: 'Planner Pro' })
    @IsOptional()
    @IsString(message('IS_STRING'))
    @MinLength(2, message('MIN_LENGTH'))
    @MaxLength(100, message('MAX_LENGTH'))
    name?: string

    @ApiPropertyOptional()
    @IsOptional()
    @IsString(message('IS_STRING'))
    @MaxLength(500, message('MAX_LENGTH'))
    description?: string

    @ApiPropertyOptional({ example: 1000 })
    @IsOptional()
    @IsInt(message('IS_INT'))
    @Min(1, message('MIN'))
    @Max(MAX_CENTS, message('MAX'))
    priceMonthCents?: number

    @ApiPropertyOptional({ example: 10000 })
    @IsOptional()
    @IsInt(message('IS_INT'))
    @Min(1, message('MIN'))
    @Max(MAX_CENTS, message('MAX'))
    priceYearCents?: number

    @ApiPropertyOptional({ description: 'false: no longer sold (existing seats keep working until they end)' })
    @IsOptional()
    @IsBoolean(message('IS_BOOLEAN'))
    active?: boolean
}

export class PurchaseDto {
    @ApiProperty({ example: 'planner' })
    @Matches(PRODUCT_CODE, message('MATCHES'))
    productCode!: string

    @ApiProperty({ enum: INTERVALS, example: 'year' })
    @IsIn(INTERVALS, message('IS_IN'))
    interval!: Interval

    @ApiProperty({ example: 5, description: 'Number of seats (users)' })
    @IsInt(message('IS_INT'))
    @Min(1, message('MIN'))
    @Max(MAX_SEATS, message('MAX'))
    seats!: number

    @ApiPropertyOptional({ example: 'WELCOME-25' })
    @IsOptional()
    @Matches(DISCOUNT_CODE, message('MATCHES'))
    discountCode?: string
}

export const REGIONS = ['eu-west-1', 'eu-west-3', 'eu-central-1'] as const
/** A page of the frontend: one / at the start (never //), letters, digits and the usual URL characters. */
export const RETURN_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~%/]*(\?[A-Za-z0-9\-._~%=&]*)?$/

/** A purchase from the wizard: also where the app runs, how to pay and where to come back after the checkout. */
export class SubscribeDto extends PurchaseDto {
    @ApiPropertyOptional({ example: 'Praktijk De Linde', description: 'The name of the practice (environment)' })
    @IsOptional()
    @IsString(message('IS_STRING'))
    @MaxLength(100, message('MAX_LENGTH'))
    environmentName?: string

    @ApiPropertyOptional({ enum: REGIONS, example: 'eu-west-1' })
    @IsOptional()
    @IsIn(REGIONS, message('IS_IN'))
    region?: (typeof REGIONS)[number]

    @ApiPropertyOptional({
        enum: Object.keys(PAYMENT_METHODS),
        description: 'Opens the checkout on this method (card, bancontact; qr: Bancontact with its QR code)'
    })
    @IsOptional()
    @IsIn(Object.keys(PAYMENT_METHODS), message('IS_IN'))
    method?: PaymentMethod

    @ApiPropertyOptional({
        example: '/apps/planner/welcome',
        description:
            'The page of the frontend after the checkout (default /licenses/return); ?subscription=<id> is added'
    })
    @IsOptional()
    @MaxLength(200, message('MAX_LENGTH'))
    @Matches(RETURN_PATH, message('MATCHES'))
    returnPath?: string
}

export class PayInvoicesDto {
    @ApiPropertyOptional({
        example: '/invoices',
        description: 'The page of the frontend after the checkout (default /invoices); ?payment=invoices is added'
    })
    @IsOptional()
    @MaxLength(200, message('MAX_LENGTH'))
    @Matches(RETURN_PATH, message('MATCHES'))
    returnPath?: string
}

export class SeatsDto {
    @ApiProperty({ example: 8 })
    @IsInt(message('IS_INT'))
    @Min(1, message('MIN'))
    @Max(MAX_SEATS, message('MAX'))
    seats!: number
}

export class DiscountDto {
    @ApiPropertyOptional({ example: 'WELCOME-25', description: 'Left out: a random code like K7QM-2XPD' })
    @IsOptional()
    @Matches(DISCOUNT_CODE, message('MATCHES'))
    code?: string

    @ApiPropertyOptional({ example: 25, description: 'Percent off (100: free); or amountOffCents' })
    @IsOptional()
    @IsInt(message('IS_INT'))
    @Min(1, message('MIN'))
    @Max(100, message('MAX'))
    percentOff?: number

    @ApiPropertyOptional({ example: 500, description: 'Cents off every payment; or percentOff' })
    @IsOptional()
    @IsInt(message('IS_INT'))
    @Min(1, message('MIN'))
    @Max(MAX_CENTS, message('MAX'))
    amountOffCents?: number

    @ApiPropertyOptional({ example: 'planner', description: 'Left out: every product' })
    @IsOptional()
    @Matches(PRODUCT_CODE, message('MATCHES'))
    productCode?: string

    @ApiProperty({
        enum: DURATIONS,
        example: 'repeating',
        description: 'once: the first payment; repeating: durationPeriods periods'
    })
    @IsIn(DURATIONS, message('IS_IN'))
    duration!: DiscountDuration

    @ApiPropertyOptional({ example: 3 })
    @IsOptional()
    @IsInt(message('IS_INT'))
    @Min(1, message('MIN'))
    @Max(120, message('MAX'))
    durationPeriods?: number

    @ApiPropertyOptional({ example: 100, description: 'How many organisations may use it (each once)' })
    @IsOptional()
    @IsInt(message('IS_INT'))
    @Min(1, message('MIN'))
    maxRedemptions?: number

    @ApiPropertyOptional({ example: '2026-12-31T23:59:59Z' })
    @IsOptional()
    @IsDateString({}, message('IS_DATE'))
    expiresAt?: string
}

export class DiscountActiveDto {
    @ApiProperty({ example: false })
    @IsBoolean(message('IS_BOOLEAN'))
    active!: boolean
}

export class GrantDto {
    @ApiProperty({ example: 'planner' })
    @Matches(PRODUCT_CODE, message('MATCHES'))
    productCode!: string

    @ApiProperty({ example: 3, description: 'Free seats' })
    @IsInt(message('IS_INT'))
    @Min(1, message('MIN'))
    @Max(MAX_SEATS, message('MAX'))
    seats!: number

    @ApiPropertyOptional({ example: '2027-06-30T00:00:00Z', description: 'Left out: for good' })
    @IsOptional()
    @IsDateString({}, message('IS_DATE'))
    endsAt?: string

    @ApiPropertyOptional({ example: 'Partner' })
    @IsOptional()
    @IsString(message('IS_STRING'))
    @MaxLength(200, message('MAX_LENGTH'))
    note?: string
}

export class ExtendTrialDto {
    @ApiProperty({ example: 'planner' })
    @Matches(PRODUCT_CODE, message('MATCHES'))
    productCode!: string

    @ApiProperty({ example: '1fb82908-476c-4460-951a-0fae1f01fcc6' })
    @IsUUID('all', message('IS_UUID'))
    userId!: string

    @ApiProperty({ example: 14, description: 'Days added to the trial (from its end, or from today when it ended)' })
    @IsInt(message('IS_INT'))
    @Min(1, message('MIN'))
    @Max(365, message('MAX'))
    days!: number
}
