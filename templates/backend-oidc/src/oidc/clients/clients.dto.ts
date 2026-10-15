import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    MinLength
} from 'class-validator'
import { i18nValidationMessage } from 'nestjs-i18n'

const URIS = 10

/** What a superadmin fills in for an app (create and change). */
export class ClientFieldsDto {
    @ApiProperty({ example: 'Partner Planner', description: 'Shown on the consent screen and on /security' })
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MinLength(2, { message: i18nValidationMessage('validation.MIN_LENGTH') })
    @MaxLength(100, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    name!: string

    @ApiProperty({
        example: ['https://planner.partner.com/callback'],
        description: 'Exact addresses the browser may come back to (https; http only on localhost), 1 to 10'
    })
    @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
    @ArrayMaxSize(URIS, { message: i18nValidationMessage('validation.ARRAY_MAX_SIZE') })
    @IsString({ each: true, message: i18nValidationMessage('validation.IS_STRING') })
    @MaxLength(500, { each: true, message: i18nValidationMessage('validation.MAX_LENGTH') })
    redirectUris!: string[]

    @ApiPropertyOptional({ example: ['https://planner.partner.com'], description: 'After logging out (0 to 10)' })
    @IsOptional()
    @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
    @ArrayMaxSize(URIS, { message: i18nValidationMessage('validation.ARRAY_MAX_SIZE') })
    @IsString({ each: true, message: i18nValidationMessage('validation.IS_STRING') })
    @MaxLength(500, { each: true, message: i18nValidationMessage('validation.MAX_LENGTH') })
    postLogoutRedirectUris?: string[]

    @ApiPropertyOptional({
        example: 'https://planner.partner.com/backchannel-logout',
        description: 'Back-channel logout: gets a logout token when a session ends; empty: none'
    })
    @IsOptional()
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MaxLength(500, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    backchannelLogoutUri?: string

    @ApiProperty({ example: ['openid', 'profile', 'email'], description: 'openid (always), profile, email, tenant' })
    @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
    @IsIn(['openid', 'profile', 'email', 'tenant'], { each: true, message: i18nValidationMessage('validation.IS_IN') })
    scopes!: string[]

    @ApiProperty({ example: true, description: 'Also refresh tokens (bound to the session, rotated at every use)' })
    @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
    refreshTokens!: boolean

    @ApiProperty({
        example: false,
        description:
            'true: your own application (no consent screen, may call this API as the user); false: an application of others'
    })
    @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
    firstParty!: boolean
}

export class CreateClientDto extends ClientFieldsDto {
    @ApiPropertyOptional({
        example: 'partner.planner',
        description: 'Letters, digits, . _ - (3 to 100); empty: made from the name'
    })
    @IsOptional()
    @Matches(/^[A-Za-z0-9._-]{3,100}$/, { message: i18nValidationMessage('validation.MATCHES') })
    clientId?: string

    @ApiProperty({
        enum: ['public', 'confidential'],
        description:
            'public: a browser or mobile app (PKCE, no secret); confidential: a server (gets a secret, shown once)'
    })
    @IsIn(['public', 'confidential'], { message: i18nValidationMessage('validation.IS_IN') })
    type!: 'public' | 'confidential'
}

export class ClientStatusDto {
    @ApiProperty({ example: false, description: 'false: nobody can log in with it any more; its refresh tokens stop' })
    @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
    enabled!: boolean
}
