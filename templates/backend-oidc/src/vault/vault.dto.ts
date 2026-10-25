import { ApiProperty } from '@nestjs/swagger'
import { IsString, MaxLength, MinLength } from 'class-validator'
import { i18nValidationMessage } from 'nestjs-i18n'

const message = (key: string) => ({ message: i18nValidationMessage('validation.' + key) })

export class VaultUploadDto {
    @ApiProperty({ example: 'ehealth.p12', description: 'Must end in .p12 or .pfx' })
    @IsString(message('IS_STRING'))
    @MinLength(5, message('MIN_LENGTH'))
    @MaxLength(200, message('MAX_LENGTH'))
    filename!: string

    @ApiProperty({ description: 'The file in base64 (at most 64 KiB; a data: URL prefix is allowed)' })
    @IsString(message('IS_STRING'))
    @MinLength(4, message('MIN_LENGTH'))
    @MaxLength(90_000, message('MAX_LENGTH'))
    dataBase64!: string
}

export class VaultCredentialsDto {
    @ApiProperty({ description: 'The access token of the doctor, issued to the app that asks' })
    @IsString(message('IS_STRING'))
    @MinLength(10, message('MIN_LENGTH'))
    @MaxLength(8192, message('MAX_LENGTH'))
    accessToken!: string
}

export class VaultPasswordDto {
    @ApiProperty({ description: 'The password of the certificate file' })
    @IsString(message('IS_STRING'))
    @MaxLength(256, message('MAX_LENGTH'))
    password!: string
}
