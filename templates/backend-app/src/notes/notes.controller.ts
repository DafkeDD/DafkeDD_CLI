import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common'
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiForbiddenResponse,
    ApiNoContentResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse
} from '@nestjs/swagger'
import { AppException } from '../common/app.exception.js'
import { Access, type Caller, CurrentCaller, Roles } from '../pasport/access.js'
import { CreateNoteDto } from './notes.dto.js'
import { NOTES_STORE, type NotesStore } from './notes.store.js'

const NOTE = {
    id: '6f1c2b0e-3d4a-4f5b-9c8d-7e6f5a4b3c2d',
    authorId: '1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9',
    text: 'Morgen om 9u teamoverleg',
    createdAt: '2026-10-20T08:00:00.000Z'
}

/**
 * Notes of the organisation of the caller: the example of data that belongs to one tenant. Editors and viewers read
 * the notes, editors add them (the roles of config/app-roles.json); only an admin of the organisation removes
 * them. The organisation comes from the access token.
 */
@ApiTags('notes')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'errors.UNAUTHORIZED: no or no valid access token of the login server' })
@ApiForbiddenResponse({
    description:
        'errors.NO_ORGANISATION (no organisation), errors.NO_LICENSE (no licence) or errors.ROLE_REQUIRED (not the role)'
})
@Controller('notes')
export class NotesController {
    constructor(@Inject(NOTES_STORE) private readonly notes: NotesStore) {}

    @Get()
    @Roles('editor', 'viewer')
    @ApiOperation({ summary: 'The notes of the organisation of the caller, newest first (at most 100)' })
    @ApiOkResponse({ schema: { example: [NOTE] } })
    list(@CurrentCaller() caller: Caller) {
        return this.notes.list(caller.tenant!.id)
    }

    @Post()
    @Roles('editor')
    @ApiOperation({ summary: 'Add a note to the organisation of the caller (role editor)' })
    @ApiCreatedResponse({ schema: { example: NOTE } })
    @ApiBadRequestResponse({ description: 'errors.BAD_REQUEST: no text, or more than 2000 characters' })
    create(@CurrentCaller() caller: Caller, @Body() dto: CreateNoteDto) {
        return this.notes.create(caller.tenant!.id, caller.sub, dto.text.trim())
    }

    @Delete(':id')
    @Access('admin')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Remove a note (only an admin of the organisation)' })
    @ApiNoContentResponse({ description: 'Removed' })
    @ApiBadRequestResponse({ description: 'errors.BAD_REQUEST: the id is not a uuid' })
    @ApiForbiddenResponse({
        description: 'errors.NO_ORGANISATION, errors.NO_LICENSE or errors.FORBIDDEN: not an admin of the organisation'
    })
    @ApiNotFoundResponse({ description: 'errors.NOTE_NOT_FOUND: no such note in this organisation' })
    async remove(@CurrentCaller() caller: Caller, @Param('id', new ParseUUIDPipe()) id: string) {
        if (!(await this.notes.remove(caller.tenant!.id, id)))
            throw new AppException('errors.NOTE_NOT_FOUND', HttpStatus.NOT_FOUND)
    }
}
