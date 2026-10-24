import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Access, Auth, type AuthContext } from '../access/access.js'
import { NotificationsService } from './notifications.service.js'

/** The notifications of the logged in account (the bell): of its organisation, and of the platform for superadmins. */
@ApiTags('notifications')
@Controller('me/notifications')
@Access('account')
export class NotificationsController {
    constructor(private readonly notifications: NotificationsService) {}

    @Get()
    @ApiOperation({
        summary:
            'The newest notifications (at most 40): of the organisation of the token, and the platform ones for superadmins'
    })
    @ApiOkResponse({ description: '[{ id, kind, params, link, createdAt, read }]' })
    list(@Auth() auth: AuthContext) {
        return this.notifications.list(auth)
    }

    @Post('read-all')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Mark every notification as read' })
    @ApiNoContentResponse({ description: 'Read' })
    async readAll(@Auth() auth: AuthContext) {
        await this.notifications.markAllRead(auth)
    }

    @Post(':id/read')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Mark one notification as read' })
    @ApiNoContentResponse({ description: 'Read' })
    @ApiNotFoundResponse({ description: 'errors.NOT_FOUND' })
    async read(@Auth() auth: AuthContext, @Param('id') id: string) {
        await this.notifications.markRead(auth, id)
    }
}
