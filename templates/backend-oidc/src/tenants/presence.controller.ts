import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Access } from '../access/access.js'

/** "I am here": the frontend sends this every minute while a page is open (who is online). */
@ApiTags('tenant members')
@Controller('me')
@Access()
export class PresenceController {
    @Post('heartbeat')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary:
            'The logged in member is active (shown as online to the admins of the tenant). Every request counts too.'
    })
    @ApiNoContentResponse({ description: 'Noted' })
    heartbeat() {
        // AccessGuard records the activity (at most once a minute per member)
    }
}
