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

    @ApiPropertyOptional({
        example: 'planner',
        description:
            'The product (its code in the app catalogue, /admin/catalog) this app sells: one licence per user; empty or null: a free app; left out on PUT: keeps the product'
    })
    @IsOptional()
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @Matches(/^([a-z0-9][a-z0-9-]{1,62})?$/, { message: i18nValidationMessage('validation.MATCHES') })
    product?: string | null
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

export class LinkDto {
    @ApiProperty({
        example: 'K7QM-2XPD-9HRT-W4NB-C8ZF-3VJE',
        description: 'The link code of /admin (one time, 15 minutes)'
    })
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MinLength(24, { message: i18nValidationMessage('validation.MIN_LENGTH') })
    @MaxLength(48, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    code!: string

    @ApiPropertyOptional({
        example: ['http://localhost:3001/api/auth/callback'],
        description: 'Redirect URIs of the new project, added to the app'
    })
    @IsOptional()
    @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
    @ArrayMaxSize(URIS, { message: i18nValidationMessage('validation.ARRAY_MAX_SIZE') })
    @IsString({ each: true, message: i18nValidationMessage('validation.IS_STRING') })
    @MaxLength(500, { each: true, message: i18nValidationMessage('validation.MAX_LENGTH') })
    redirectUris?: string[]

    @ApiPropertyOptional({ example: ['http://localhost:3001'], description: 'After logging out, added to the app' })
    @IsOptional()
    @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
    @ArrayMaxSize(URIS, { message: i18nValidationMessage('validation.ARRAY_MAX_SIZE') })
    @IsString({ each: true, message: i18nValidationMessage('validation.IS_STRING') })
    @MaxLength(500, { each: true, message: i18nValidationMessage('validation.MAX_LENGTH') })
    postLogoutRedirectUris?: string[]

    @ApiPropertyOptional({
        example: 'http://localhost:3001/api/auth/backchannel-logout',
        description: 'Back-channel logout of the new project (only when the app has none yet)'
    })
    @IsOptional()
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MaxLength(500, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    backchannelLogoutUri?: string

    @ApiPropertyOptional({
        example: [
            { key: 'editor', names: { en: 'Editor', nl: 'Bewerker', fr: 'Éditeur', de: 'Bearbeiter' }, default: true }
        ],
        description:
            'The roles of the app (config/app-roles.json of the new project): they replace the roles of the app'
    })
    @IsOptional()
    @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
    roles?: unknown[]
}

export class LinkRolesDto {
    @ApiProperty({
        example: 'K7QM-2XPD-9HRT-W4NB-C8ZF-3VJE',
        description: 'A link code of the app on /admin (one time, 15 minutes)'
    })
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MinLength(24, { message: i18nValidationMessage('validation.MIN_LENGTH') })
    @MaxLength(48, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    code!: string

    @ApiProperty({
        example: [{ key: 'viewer', names: { en: 'Viewer', nl: 'Lezer', fr: 'Lecteur', de: 'Leser' }, default: false }],
        description: 'The roles of the app (1 to 20): key (a-z, 0-9, -), a name in en, nl, fr and de, default'
    })
    @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
    roles!: unknown[]
}
