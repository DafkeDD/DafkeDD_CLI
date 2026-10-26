import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'
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

export class VaultTokenDto {
    @ApiProperty({ description: 'The access token of the logged in account, issued to the app that asks' })
    @IsString(message('IS_STRING'))
    @MinLength(10, message('MIN_LENGTH'))
    @MaxLength(8192, message('MAX_LENGTH'))
    accessToken!: string
}

export class VaultCredentialsDto extends VaultTokenDto {
    @ApiPropertyOptional({
        description:
            'The doctor whose certificate is used (a colleague who chose this account on /vault: the secretariat). Left out: the own certificate of a doctor'
    })
    @IsOptional()
    @IsUUID('all', message('IS_UUID'))
    doctorId?: string
}

export class VaultColleaguesDto {
    @ApiProperty({
        example: ['3f2c8a1e-0b7d-4c6e-9a5f-1d2e3c4b5a60'],
        description: 'The colleagues (account ids, members of the organisation) who may use my certificate; [] nobody'
    })
    @IsArray(message('IS_ARRAY'))
    @ArrayMaxSize(500, message('ARRAY_MAX_SIZE'))
    @IsUUID('all', { ...message('IS_UUID'), each: true })
    userIds!: string[]
}

export class VaultPasswordDto {
    @ApiProperty({ description: 'The password of the certificate file' })
    @IsString(message('IS_STRING'))
    @MaxLength(256, message('MAX_LENGTH'))
    password!: string
}
