import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { i18nValidationMessage } from 'nestjs-i18n'

export class AddPasskeyDto {
    @ApiProperty({ description: 'The token of POST /me/passkeys/options (the sealed challenge, 5 minutes)' })
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MaxLength(1000, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    token!: string

    @ApiProperty({
        description:
            'The answer of navigator.credentials.create(), base64url: { id, rawId, type, response: { clientDataJSON, attestationObject, transports } }'
    })
    @IsObject({ message: i18nValidationMessage('validation.IS_OBJECT') })
    credential!: Record<string, unknown>

    @ApiPropertyOptional({ example: 'Laptop', description: 'A name to recognise it by (max 60)' })
    @IsOptional()
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MaxLength(60, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    name?: string
}

export class RenamePasskeyDto {
    @ApiProperty({ example: 'Phone', description: 'The new name (1 to 60 characters)' })
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MinLength(1, { message: i18nValidationMessage('validation.MIN_LENGTH') })
    @MaxLength(60, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    name!: string
}
