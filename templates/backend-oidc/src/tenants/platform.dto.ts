import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
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
}

export class TenantStatusDto {
    @ApiProperty({ enum: ['active', 'suspended'], description: 'Members of a suspended tenant cannot log in to it' })
    @IsIn(['active', 'suspended'], { message: i18nValidationMessage('validation.IS_IN') })
    status!: 'active' | 'suspended'
}

export class SuperadminDto {
    @ApiProperty({ example: 'ada@example.com', description: 'An existing account' })
    @IsEmail({}, { message: i18nValidationMessage('validation.IS_EMAIL') })
    @MaxLength(254, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    email!: string
}
