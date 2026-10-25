import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator'
import { i18nValidationMessage } from 'nestjs-i18n'

export class CreateTenantDto {
    @ApiProperty({ example: 'Globex' })
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MinLength(2, { message: i18nValidationMessage('validation.MIN_LENGTH') })
    @MaxLength(100, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    name!: string

    @ApiPropertyOptional({
        example: 'boss@globex.com',
        description: 'Gets an invitation to become admin of the tenant'
    })
    @IsOptional()
    @IsEmail({}, { message: i18nValidationMessage('validation.IS_EMAIL') })
    @MaxLength(254, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    adminEmail?: string

    @ApiPropertyOptional({ example: 'Jan Peeters', description: 'Shown as contact until the first admin joined' })
    @IsOptional()
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MaxLength(100, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    contactName?: string

    @ApiPropertyOptional({ example: 'Gent' })
    @IsOptional()
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MaxLength(100, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    city?: string

    @ApiPropertyOptional({ example: 'Pro', description: 'Free text: Starter (default), Pro, Enterprise' })
    @IsOptional()
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MinLength(1, { message: i18nValidationMessage('validation.MIN_LENGTH') })
    @MaxLength(40, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    plan?: string
}

/** What a superadmin changes of a tenant (all optional). */
export class UpdateTenantDto {
    @ApiPropertyOptional({
        enum: ['active', 'suspended'],
        description: 'Members of a suspended tenant cannot log in to it'
    })
    @IsOptional()
    @IsIn(['active', 'suspended'], { message: i18nValidationMessage('validation.IS_IN') })
    status?: 'active' | 'suspended'

    @ApiPropertyOptional({ example: 'Globex' })
    @IsOptional()
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MinLength(2, { message: i18nValidationMessage('validation.MIN_LENGTH') })
    @MaxLength(100, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    name?: string

    @ApiPropertyOptional({ example: 'Enterprise' })
    @IsOptional()
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MinLength(1, { message: i18nValidationMessage('validation.MIN_LENGTH') })
    @MaxLength(40, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    plan?: string

    @ApiPropertyOptional({ example: 'Gent', nullable: true, type: String, description: 'Empty or null: no city' })
    @IsOptional()
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MaxLength(100, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    city?: string | null
}

/** The billing details of a tenant: on its invoices. Empty or null clears a field. */
export class BillingDetailsDto {
    @ApiPropertyOptional({ example: 'Praktijk Peeters BV', nullable: true, type: String })
    @IsOptional()
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MaxLength(200, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    company?: string | null

    @ApiPropertyOptional({
        example: 'BE0123456789',
        nullable: true,
        type: String,
        description: 'At most 32 characters'
    })
    @IsOptional()
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MaxLength(32, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    vat?: string | null

    @ApiPropertyOptional({ example: 'Kerkstraat 1, 9000 Gent', nullable: true, type: String })
    @IsOptional()
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MaxLength(500, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    billingAddress?: string | null

    @ApiPropertyOptional({ example: 'boekhouding@peeters.be', nullable: true, type: String })
    @IsOptional()
    @ValidateIf((_object, value) => value !== '')
    @IsEmail({}, { message: i18nValidationMessage('validation.IS_EMAIL') })
    @MaxLength(254, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    billingEmail?: string | null
}

export class SuperadminDto {
    @ApiProperty({ example: 'ada@example.com', description: 'An existing account' })
    @IsEmail({}, { message: i18nValidationMessage('validation.IS_EMAIL') })
    @MaxLength(254, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    email!: string
}
