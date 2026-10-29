import {
    Body,
    Controller,
    Get,
    Header,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    StreamableFile
} from '@nestjs/common'
import {
    ApiBadRequestResponse,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiPayloadTooLargeResponse,
    ApiProduces,
    ApiTags
} from '@nestjs/swagger'
import { Access, Auth, type AuthContext } from '../access/access.js'
import {
    CreateTicketDto,
    RateTicketDto,
    SupportCreateTicketDto,
    SupportTicketAttachmentDto,
    TicketAttachmentDto,
    TicketMessageDto,
    TicketNoteDto,
    TicketsQueryDto
} from './support.dto.js'
import { TicketsService } from './tickets.service.js'

const TICKET =
    '{ id, number: "TIC-1042", subject, tenant: { id, name }, customer: { id, name } | null, app, appCode, status, ' +
    'priority, assignee: { id, name } | null, createdAt, updatedAt, rating: { score, comment, ratedAt } | null, messages: [{ id, from: { id, name } | null, role, text, createdAt }] }'
const LIST =
    '[{ id, number, subject, tenant, customer, app, appCode, status, priority, assignee, createdAt, updatedAt, ' +
    'lastMessage: { role, text } | null, rating: { score, comment, ratedAt } | null }] (newest activity first; ' +
    'lastMessage.text without markup, at most 200 characters)'
const ATTACHMENT =
    '{ id, filename, contentType: "image/png" | "image/jpeg" | "image/gif" | "image/webp", size } (refer to it as ![name](att:<id>))'
const IMAGES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** The image as it is sent: its own type, shown in the browser (never sniffed), cached privately for a day. */
function imageFile(image: { filename: string; contentType: string; data: Buffer }) {
    // A header is Latin-1: an ASCII name in filename, the real one (UTF-8) in filename*
    const ascii = image.filename.replace(/[^\x20-\x7e]|["\\]/g, '_')
    return new StreamableFile(image.data, {
        type: image.contentType,
        disposition: `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(image.filename)}`,
        length: image.data.length
    })
}

/** The support tickets of the own organisation, for its members. */
@ApiTags('support')
@Controller('tenants/current/tickets')
@Access('user')
export class TicketsController {
    constructor(private readonly tickets: TicketsService) {}

    @Get()
    @ApiOperation({ summary: 'The tickets of the current organisation' })
    @ApiOkResponse({ description: LIST })
    list(@Auth() auth: AuthContext) {
        return this.tickets.listForTenant(auth.tenantId)
    }

    @Post('attachments')
    @ApiOperation({ summary: 'Upload an image to put in a message (JSON with base64, at most 2 MiB)' })
    @ApiCreatedResponse({ description: ATTACHMENT })
    @ApiBadRequestResponse({ description: 'support.IMAGE_INVALID: not a PNG, JPEG, GIF or WebP' })
    @ApiPayloadTooLargeResponse({
        description: 'support.IMAGE_TOO_LARGE: more than 2 MiB, or errors.PAYLOAD_TOO_LARGE: a body over 3 MB'
    })
    upload(@Auth() auth: AuthContext, @Body() body: TicketAttachmentDto) {
        return this.tickets.uploadForTenant(auth, body)
    }

    @Get('attachments/:id')
    @Header('X-Content-Type-Options', 'nosniff')
    @Header('Cache-Control', 'private, max-age=86400')
    @ApiOperation({ summary: 'An image of the current organisation' })
    @ApiProduces(...IMAGES)
    @ApiOkResponse({ description: 'The image, inline, with its own content type' })
    @ApiNotFoundResponse({ description: 'support.ATTACHMENT_NOT_FOUND' })
    async attachment(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
        return imageFile(await this.tickets.attachmentForTenant(auth.tenantId, id))
    }

    @Get(':id')
    @ApiOperation({ summary: 'One ticket with its conversation' })
    @ApiOkResponse({ description: TICKET })
    @ApiNotFoundResponse({ description: 'support.TICKET_NOT_FOUND' })
    get(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
        return this.tickets.getForTenant(auth.tenantId, id)
    }

    @Post()
    @ApiOperation({ summary: 'Ask the support team a question (about an app, or in general): an open ticket' })
    @ApiCreatedResponse({ description: TICKET })
    @ApiBadRequestResponse({ description: 'support.ATTACHMENT_UNKNOWN: an image that is not of the organisation' })
    @ApiNotFoundResponse({ description: 'support.APP_NOT_FOUND' })
    create(@Auth() auth: AuthContext, @Body() body: CreateTicketDto) {
        return this.tickets.create(auth, body)
    }

    @Post(':id/messages')
    @ApiOperation({ summary: 'Write in a ticket: it is open again (it needs the support team)' })
    @ApiCreatedResponse({ description: TICKET })
    @ApiBadRequestResponse({ description: 'support.ATTACHMENT_UNKNOWN: an image that is not of the organisation' })
    @ApiNotFoundResponse({ description: 'support.TICKET_NOT_FOUND' })
    @ApiConflictResponse({ description: 'support.TICKET_CLOSED: reopen it first' })
    reply(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: TicketMessageDto) {
        return this.tickets.replyAsCustomer(auth, id, body.text)
    }

    @Post(':id/close')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Close a ticket (the question is answered)' })
    @ApiOkResponse({ description: TICKET })
    @ApiNotFoundResponse({ description: 'support.TICKET_NOT_FOUND' })
    close(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
        return this.tickets.closeForTenant(auth.tenantId, id, auth.userId)
    }

    @Post(':id/reopen')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Reopen a closed ticket: open again' })
    @ApiOkResponse({ description: TICKET })
    @ApiNotFoundResponse({ description: 'support.TICKET_NOT_FOUND' })
    reopen(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
        return this.tickets.reopenForTenant(auth.tenantId, id)
    }

    @Post(':id/rating')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Rate a closed ticket (1 to 5, an optional comment); rating again overwrites it' })
    @ApiOkResponse({ description: TICKET })
    @ApiNotFoundResponse({ description: 'support.TICKET_NOT_FOUND' })
    @ApiConflictResponse({ description: 'support.TICKET_NOT_CLOSED: only a closed ticket can be rated' })
    rate(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: RateTicketDto) {
        return this.tickets.rateForTenant(auth.tenantId, id, body)
    }
}

/** Every ticket of the platform, for the support team (superadmins). */
@ApiTags('support (superadmin)')
@Controller('admin')
@Access('superadmin')
export class SupportAdminController {
    constructor(private readonly tickets: TicketsService) {}

    @Get('tickets')
    @ApiOperation({ summary: 'Every ticket, filtered on status, on who handles it (me, none) and a search text' })
    @ApiOkResponse({ description: LIST })
    list(@Auth() auth: AuthContext, @Query() query: TicketsQueryDto) {
        return this.tickets.list(query, auth.userId)
    }

    @Post('tickets/attachments')
    @ApiOperation({ summary: 'Upload an image for a message to an organisation (JSON with base64, at most 2 MiB)' })
    @ApiCreatedResponse({ description: ATTACHMENT })
    @ApiBadRequestResponse({ description: 'support.IMAGE_INVALID: not a PNG, JPEG, GIF or WebP' })
    @ApiNotFoundResponse({ description: 'oidc.TENANT_NOT_FOUND' })
    @ApiPayloadTooLargeResponse({
        description: 'support.IMAGE_TOO_LARGE: more than 2 MiB, or errors.PAYLOAD_TOO_LARGE: a body over 3 MB'
    })
    upload(@Auth() auth: AuthContext, @Body() body: SupportTicketAttachmentDto) {
        const { tenantId, ...image } = body
        return this.tickets.uploadAsSupport(auth.userId, tenantId, image)
    }

    @Get('tickets/attachments/:id')
    @Header('X-Content-Type-Options', 'nosniff')
    @Header('Cache-Control', 'private, max-age=86400')
    @ApiOperation({ summary: 'An image of any organisation' })
    @ApiProduces(...IMAGES)
    @ApiOkResponse({ description: 'The image, inline, with its own content type' })
    @ApiNotFoundResponse({ description: 'support.ATTACHMENT_NOT_FOUND' })
    async attachment(@Param('id', new ParseUUIDPipe()) id: string) {
        return imageFile(await this.tickets.attachment(id))
    }

    @Get('tickets/:id')
    @ApiOperation({ summary: 'One ticket with its conversation and the internal notes' })
    @ApiOkResponse({
        description: TICKET.replace(/ }$/, ', notes: [{ id, from, text, mentions: [{ id, name }], createdAt }] }')
    })
    @ApiNotFoundResponse({ description: 'support.TICKET_NOT_FOUND' })
    get(@Param('id', new ParseUUIDPipe()) id: string) {
        return this.tickets.get(id)
    }

    @Post('tickets')
    @ApiOperation({
        summary: 'Open a ticket for an organisation (as support): assigned to me and in progress; its admins are told'
    })
    @ApiCreatedResponse({ description: 'The ticket, with notes' })
    @ApiBadRequestResponse({ description: 'support.ATTACHMENT_UNKNOWN: an image that is not of the organisation' })
    @ApiNotFoundResponse({ description: 'oidc.TENANT_NOT_FOUND or support.APP_NOT_FOUND' })
    create(@Auth() auth: AuthContext, @Body() body: SupportCreateTicketDto) {
        return this.tickets.createAsSupport(auth.userId, body)
    }

    @Post('tickets/:id/claim')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Take a ticket: assigned to me (an open ticket is in progress)' })
    @ApiOkResponse({ description: 'The ticket, with notes' })
    @ApiNotFoundResponse({ description: 'support.TICKET_NOT_FOUND' })
    claim(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
        return this.tickets.claim(auth.userId, id)
    }

    @Post('tickets/:id/messages')
    @ApiOperation({ summary: 'Answer as support: answered, mine when nobody had it; the customer gets a notification' })
    @ApiCreatedResponse({ description: 'The ticket, with notes' })
    @ApiBadRequestResponse({ description: 'support.ATTACHMENT_UNKNOWN: an image that is not of the organisation' })
    @ApiNotFoundResponse({ description: 'support.TICKET_NOT_FOUND' })
    @ApiConflictResponse({ description: 'support.TICKET_CLOSED: reopen it first' })
    reply(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: TicketMessageDto) {
        return this.tickets.replyAsSupport(auth.userId, id, body.text)
    }

    @Post('tickets/:id/close')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Close a ticket' })
    @ApiOkResponse({ description: 'The ticket, with notes' })
    @ApiNotFoundResponse({ description: 'support.TICKET_NOT_FOUND' })
    close(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
        return this.tickets.close(id, auth.userId)
    }

    @Post('tickets/:id/reopen')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Reopen a closed ticket: in progress again' })
    @ApiOkResponse({ description: 'The ticket, with notes' })
    @ApiNotFoundResponse({ description: 'support.TICKET_NOT_FOUND' })
    reopen(@Param('id', new ParseUUIDPipe()) id: string) {
        return this.tickets.reopen(id)
    }

    @Post('tickets/:id/notes')
    @ApiOperation({ summary: 'An internal note (never shown to the organisation), mentioning superadmins' })
    @ApiCreatedResponse({ description: 'The ticket, with notes' })
    @ApiBadRequestResponse({
        description: 'support.MENTION_NOT_SUPPORT: a mention of someone outside the support team'
    })
    @ApiNotFoundResponse({ description: 'support.TICKET_NOT_FOUND' })
    note(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: TicketNoteDto) {
        return this.tickets.addNote(auth.userId, id, body)
    }

    @Get('support-team')
    @ApiOperation({ summary: 'The support team: every superadmin (to assign and mention)' })
    @ApiOkResponse({ description: '[{ id, name, email }]' })
    team() {
        return this.tickets.supportTeam()
    }
}
