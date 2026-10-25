import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Put } from '@nestjs/common'
import {
    ApiNoContentResponse,
    ApiOkResponse,
    ApiOperation,
    ApiProperty,
    ApiPropertyOptional,
    ApiTags
} from '@nestjs/swagger'
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator'
import { i18nValidationMessage } from 'nestjs-i18n'
import { Access, Auth, type AuthContext, EidOptional } from '../access/access.js'
import { presence } from '../access/presence.js'
import { AppException } from '../common/app.exception.js'
import {
    OIDC_STORE,
    type OidcStore,
    type OutOfOffice,
    outOfOfficeActive,
    type Presence,
    PRESENCES
} from '../oidc/store/oidc.store.js'

const message = (key: string) => ({ message: i18nValidationMessage('validation.' + key) })

/** The status the account chooses in the menu of its avatar. */
export class SetPresenceDto {
    @ApiProperty({ enum: PRESENCES, example: 'busy' })
    @IsIn(PRESENCES, message('IS_IN'))
    status!: Presence
}

/** The heartbeat: whether the page was used in the last 5 minutes (mouse, keyboard, scrolling, touch). */
export class HeartbeatDto {
    @ApiPropertyOptional({ description: 'true: nobody used the page for 5 minutes ("available" shows as "away")' })
    @IsOptional()
    @IsBoolean(message('IS_BOOLEAN'))
    idle?: boolean
}

/** The out-of-office reply (like Outlook). */
export class OutOfOfficeDto {
    @ApiProperty({ example: true })
    @IsBoolean(message('IS_BOOLEAN'))
    enabled!: boolean

    @ApiPropertyOptional({ example: '2026-10-20T08:00:00.000Z', description: 'null: from now', nullable: true })
    @ValidateIf((_, value) => value !== null && value !== undefined)
    @IsDateString({}, message('IS_DATE'))
    from?: string | null

    @ApiPropertyOptional({
        example: '2026-10-27T08:00:00.000Z',
        description: 'null: until it is turned off',
        nullable: true
    })
    @ValidateIf((_, value) => value !== null && value !== undefined)
    @IsDateString({}, message('IS_DATE'))
    until?: string | null

    @ApiPropertyOptional({ example: 'Ik ben afwezig. Voor dringende vragen: Sofie.', nullable: true })
    @ValidateIf((_, value) => value !== null && value !== undefined)
    @IsString(message('IS_STRING'))
    @MaxLength(1000, message('MAX_LENGTH'))
    internalMessage?: string | null

    @ApiPropertyOptional({ example: 'Ik ben afwezig tot maandag; een collega helpt je verder.', nullable: true })
    @ValidateIf((_, value) => value !== null && value !== undefined)
    @IsString(message('IS_STRING'))
    @MaxLength(1000, message('MAX_LENGTH'))
    externalMessage?: string | null
}

const STATUS = '{ status, outOfOffice: { enabled, from, until, internalMessage, externalMessage, active } }'

/**
 * "I am here": the frontend sends this every minute while a page is open (who is online, and whether the page is
 * used). The status the account chose (like Microsoft Teams) and its out-of-office reply (like Outlook).
 */
@ApiTags('tenant members')
@Controller('me')
@Access('account')
// Also without a linked eID (OIDC_EID_REQUIRED)
@EidOptional()
export class PresenceController {
    constructor(@Inject(OIDC_STORE) private readonly store: OidcStore) {}

    @Post('heartbeat')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary:
            'The logged in member is active (shown as online to the admins of the tenant). Every request counts too. idle: the page is open but was not used for 5 minutes ("available" shows as "away").'
    })
    @ApiNoContentResponse({ description: 'Noted' })
    heartbeat(@Auth() auth: AuthContext, @Body() body: HeartbeatDto) {
        // AccessGuard records the activity (at most once a minute per member)
        presence.setIdle(auth.userId, body.idle === true)
    }

    @Get('status')
    @ApiOperation({ summary: 'My status (available, busy, dnd, brb, away or offline) and my out-of-office reply' })
    @ApiOkResponse({ description: STATUS })
    async status(@Auth() auth: AuthContext) {
        return this.view(auth.userId)
    }

    @Put('status')
    @ApiOperation({
        summary: 'Change my status. Others see it while I am online; "offline" makes me look offline (appear offline).'
    })
    @ApiOkResponse({ description: STATUS })
    async setStatus(@Auth() auth: AuthContext, @Body() body: SetPresenceDto) {
        await this.store.setPresence(auth.userId, body.status)
        return this.view(auth.userId)
    }

    @Put('out-of-office')
    @ApiOperation({
        summary:
            'Turn my out-of-office reply on or off. While it is on (and inside its period) others see me as out of office: colleagues get the internal message when they mention me in a note, customers the external one on the tickets I handle.'
    })
    @ApiOkResponse({ description: STATUS })
    async setOutOfOffice(@Auth() auth: AuthContext, @Body() body: OutOfOfficeDto) {
        const ooo: OutOfOffice = {
            enabled: body.enabled,
            from: body.from ? new Date(body.from) : null,
            until: body.until ? new Date(body.until) : null,
            internalMessage: body.internalMessage?.trim() || null,
            externalMessage: body.externalMessage?.trim() || null
        }
        if (ooo.from && ooo.until && ooo.until.getTime() <= ooo.from.getTime())
            throw new AppException('errors.OUT_OF_OFFICE_DATES', HttpStatus.BAD_REQUEST)
        await this.store.setOutOfOffice(auth.userId, ooo)
        return this.view(auth.userId)
    }

    private async view(userId: string) {
        const [status, ooo] = await Promise.all([this.store.findPresence(userId), this.store.findOutOfOffice(userId)])
        return {
            status: status ?? 'available',
            outOfOffice: ooo
                ? { ...ooo, active: outOfOfficeActive(ooo) }
                : {
                      enabled: false,
                      from: null,
                      until: null,
                      internalMessage: null,
                      externalMessage: null,
                      active: false
                  }
        }
    }
}
