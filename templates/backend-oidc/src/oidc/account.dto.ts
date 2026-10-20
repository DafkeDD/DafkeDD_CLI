import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsEmail,
    IsIn,
    IsObject,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    MinLength,
    ValidateNested
} from 'class-validator'
import { i18nValidationMessage } from 'nestjs-i18n'
import { OIDC } from './oidc.config.js'
import { TENANT_ROLES, type TenantRole } from './store/oidc.store.js'

const isString = { message: i18nValidationMessage('validation.IS_STRING') }
const minLength = { message: i18nValidationMessage('validation.MIN_LENGTH') }
const maxLength = { message: i18nValidationMessage('validation.MAX_LENGTH') }
const isEmail = { message: i18nValidationMessage('validation.IS_EMAIL') }
const isIn = { message: i18nValidationMessage('validation.IS_IN') }
const isObject = { message: i18nValidationMessage('validation.IS_OBJECT') }
const isArray = { message: i18nValidationMessage('validation.IS_ARRAY') }
const arrayMaxSize = { message: i18nValidationMessage('validation.ARRAY_MAX_SIZE') }
const isBoolean = { message: i18nValidationMessage('validation.IS_BOOLEAN') }
const matches = { message: i18nValidationMessage('validation.MATCHES') }

export class RegisterDto {
    @ApiProperty({ example: 'Ada Lovelace' })
    @IsString(isString)
    @MinLength(2, minLength)
    @MaxLength(100, maxLength)
    name!: string

    @ApiProperty({ example: 'ada@example.com' })
    @IsEmail({}, isEmail)
    @MaxLength(254, maxLength)
    email!: string

    @ApiProperty({ example: 'correct-horse-battery', minLength: OIDC.PASSWORD_MIN })
    @IsString(isString)
    @MinLength(OIDC.PASSWORD_MIN, minLength)
    @MaxLength(OIDC.PASSWORD_MAX, maxLength)
    password!: string

    @ApiProperty({ example: 'Acme', description: 'Name of the new organisation; the new account becomes its admin' })
    @IsString(isString)
    @MinLength(2, minLength)
    @MaxLength(100, maxLength)
    organisation!: string
}

export class TokenDto {
    @ApiProperty({ description: 'The token from the link in the email' })
    @IsString(isString)
    @MaxLength(2000, maxLength)
    token!: string
}

export class EmailDto {
    @ApiProperty({ example: 'ada@example.com' })
    @IsEmail({}, isEmail)
    @MaxLength(254, maxLength)
    email!: string
}

export class ResetPasswordDto extends TokenDto {
    @ApiProperty({ example: 'a-new-long-password', minLength: OIDC.PASSWORD_MIN })
    @IsString(isString)
    @MinLength(OIDC.PASSWORD_MIN, minLength)
    @MaxLength(OIDC.PASSWORD_MAX, maxLength)
    password!: string
}

export class AcceptInvitationDto extends TokenDto {
    @ApiPropertyOptional({ example: 'Ada Lovelace', description: 'Only for a new account' })
    @IsOptional()
    @IsString(isString)
    @MinLength(2, minLength)
    @MaxLength(100, maxLength)
    name?: string

    @ApiPropertyOptional({ example: 'correct-horse-battery', description: 'Only for a new account' })
    @IsOptional()
    @IsString(isString)
    @MinLength(OIDC.PASSWORD_MIN, minLength)
    @MaxLength(OIDC.PASSWORD_MAX, maxLength)
    password?: string
}

/** An app in an invitation: the roles the new member gets in it, and whether it gets a seat. */
export class InvitationAppDto {
    @ApiProperty({ example: 'planner', description: 'The app (GET /tenants/current/apps)' })
    @IsString(isString)
    @MaxLength(100, maxLength)
    clientId!: string

    @ApiPropertyOptional({
        example: ['editor'],
        nullable: true,
        description: 'The roles in the app (keys of the app); [] no roles; null or left out: the default roles'
    })
    @IsOptional()
    @IsArray(isArray)
    @ArrayMaxSize(20, arrayMaxSize)
    @IsString({ ...isString, each: true })
    @Matches(/^[a-z][a-z0-9-]{1,39}$/, { ...matches, each: true })
    roles?: string[] | null

    @ApiPropertyOptional({
        example: true,
        description: 'Give one of the free seats of the product of the app (ignored for an app that sells nothing)'
    })
    @IsOptional()
    @IsBoolean(isBoolean)
    seat?: boolean
}

export class InviteDto extends EmailDto {
    @ApiProperty({ enum: TENANT_ROLES, example: 'user' })
    @IsIn(TENANT_ROLES, isIn)
    role!: TenantRole

    @ApiPropertyOptional({
        type: [InvitationAppDto],
        description: 'The apps the invitation gives access to (at most 20); the email names them'
    })
    @IsOptional()
    @IsArray(isArray)
    @ArrayMaxSize(20, arrayMaxSize)
    @ValidateNested({ ...isObject, each: true })
    @Type(() => InvitationAppDto)
    apps?: InvitationAppDto[]
}

export class RoleDto {
    @ApiProperty({ enum: TENANT_ROLES, example: 'admin' })
    @IsIn(TENANT_ROLES, isIn)
    role!: TenantRole
}

export class MemberStatusDto {
    @ApiProperty({ enum: ['active', 'disabled'], example: 'disabled' })
    @IsIn(['active', 'disabled'], isIn)
    status!: 'active' | 'disabled'
}

/** The answer of the eID bridge after the PIN, with the challenge the server gave out for it. */
export class EidTokenDto {
    @ApiProperty({ description: 'The challenge of POST /oidc/account/eid/challenge or POST /me/eid/challenge' })
    @IsString(isString)
    @MaxLength(1000, maxLength)
    challenge!: string

    @ApiProperty({
        description:
            'The token of the eID bridge (useEidLogin().login() in @dafkedd/eid/react): the card signed the nonce',
        type: Object
    })
    @IsObject(isObject)
    token!: Record<string, unknown>
}

export class RegisterEidDto extends EidTokenDto {
    @ApiProperty({ example: 'jan@example.com' })
    @IsEmail({}, isEmail)
    @MaxLength(254, maxLength)
    email!: string

    @ApiProperty({ example: 'Acme', description: 'Name of the new organisation; the new account becomes its admin' })
    @IsString(isString)
    @MinLength(2, minLength)
    @MaxLength(100, maxLength)
    organisation!: string
}
