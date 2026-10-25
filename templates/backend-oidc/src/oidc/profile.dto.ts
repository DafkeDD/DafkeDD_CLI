import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { i18nValidationMessage } from 'nestjs-i18n'
import { PHONE } from './account.dto.js'
import { OIDC } from './oidc.config.js'

const message = (key: string) => ({ message: i18nValidationMessage('validation.' + key) })

/** What the account changes of its own profile. The national register number and the address come from the eID. */
export class UpdateProfileDto {
    @ApiPropertyOptional({ example: 'Ada' })
    @IsOptional()
    @IsString(message('IS_STRING'))
    @MinLength(1, message('MIN_LENGTH'))
    @MaxLength(60, message('MAX_LENGTH'))
    firstName?: string

    @ApiPropertyOptional({ example: 'Lovelace' })
    @IsOptional()
    @IsString(message('IS_STRING'))
    @MinLength(1, message('MIN_LENGTH'))
    @MaxLength(60, message('MAX_LENGTH'))
    lastName?: string

    @ApiPropertyOptional({ example: '+32 470 12 34 56', description: 'Empty: no phone number' })
    @IsOptional()
    @Matches(PHONE, message('MATCHES'))
    phone?: string

    @ApiPropertyOptional({ enum: OIDC.LOCALES, example: 'nl' })
    @IsOptional()
    @IsIn(OIDC.LOCALES, message('IS_IN'))
    locale?: string

    @ApiPropertyOptional({
        example: 'ada@example.org',
        description:
            'A new address changes only when the link sent to it is opened (pendingEmail until then). The current address withdraws a pending change.'
    })
    @IsOptional()
    @IsEmail({}, message('IS_EMAIL'))
    @MaxLength(254, message('MAX_LENGTH'))
    email?: string
}
