import { Body, Controller, Get, Param, Put } from '@nestjs/common'
import {
    ApiBadRequestResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiProperty,
    ApiTags
} from '@nestjs/swagger'
import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches } from 'class-validator'
import { i18nValidationMessage } from 'nestjs-i18n'
import { Access, Auth, type AuthContext } from '../access/access.js'
import { AppRolesService } from '../oidc/app-roles.service.js'

export class AppRolesDto {
    @ApiProperty({
        example: ['editor'],
        nullable: true,
        description: 'The roles of the member in the app (keys of the app); [] no roles; null: the default roles again'
    })
    @IsOptional()
    @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
    @ArrayMaxSize(20, { message: i18nValidationMessage('validation.ARRAY_MAX_SIZE') })
    @IsString({ each: true, message: i18nValidationMessage('validation.IS_STRING') })
    @Matches(/^[a-z][a-z0-9-]{1,39}$/, { each: true, message: i18nValidationMessage('validation.MATCHES') })
    roles!: string[] | null
}

const APP = '{ clientId, name, url, product, roles: [{ key, names: { en, nl, fr, de }, default }] }'

/**
 * The roles per app in the current organisation, for its admins: which apps have roles, who has which,
 * and giving them. The developer of an app defines its roles; the tokens of that app carry the roles of the user.
 */
@ApiTags('tenant members')
@Controller('tenants/current/apps')
@Access('admin')
export class AppRolesController {
    constructor(private readonly roles: AppRolesService) {}

    @Get()
    @ApiOperation({ summary: 'The apps that have roles, with their roles (what an admin can give)' })
    @ApiOkResponse({ description: `[${APP}]` })
    apps() {
        return this.roles.apps()
    }

    @Get(':clientId/members')
    @ApiOperation({
        summary: 'Every member with its roles in the app (assigned false: nobody gave roles, the default roles apply)'
    })
    @ApiOkResponse({ description: '[{ userId, name, email, role, status, roles, assigned }]' })
    @ApiNotFoundResponse({ description: 'oidc.APP_NOT_FOUND' })
    members(@Auth() auth: AuthContext, @Param('clientId') clientId: string) {
        return this.roles.members(auth.tenantId, clientId)
    }

    @Put(':clientId/members/:userId')
    @ApiOperation({ summary: 'Gives a member roles in the app (null: back to the default roles)' })
    @ApiOkResponse({ description: '{ userId, roles, assigned }' })
    @ApiBadRequestResponse({ description: 'oidc.ROLE_UNKNOWN or validation' })
    @ApiNotFoundResponse({ description: 'oidc.APP_NOT_FOUND or oidc.MEMBER_NOT_FOUND' })
    set(
        @Auth() auth: AuthContext,
        @Param('clientId') clientId: string,
        @Param('userId') userId: string,
        @Body() body: AppRolesDto
    ) {
        return this.roles.set(auth, clientId, userId, body.roles ?? null)
    }
}
