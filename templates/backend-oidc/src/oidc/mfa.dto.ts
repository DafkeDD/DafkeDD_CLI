import { ApiProperty } from '@nestjs/swagger'
import { IsString, MaxLength, MinLength } from 'class-validator'
import { i18nValidationMessage } from 'nestjs-i18n'

export class MfaCodeDto {
    @ApiProperty({ example: '492039', description: 'A code of the authenticator app, or a recovery code (k7qm-2xpd)' })
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MinLength(6, { message: i18nValidationMessage('validation.MIN_LENGTH') })
    @MaxLength(20, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    code!: string
}
