import {
    Controller,
    Delete,
    Get,
    Headers,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Put,
    Query,
    Req,
    Res
} from '@nestjs/common'
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiBody,
    ApiConflictResponse,
    ApiConsumes,
    ApiForbiddenResponse,
    ApiNoContentResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiPayloadTooLargeResponse,
    ApiProperty,
    ApiTags,
    ApiUnauthorizedResponse,
    ApiUnsupportedMediaTypeResponse
} from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength } from 'class-validator'
import type { Request, Response } from 'express'
import { i18nValidationMessage } from 'nestjs-i18n'
import { AppException } from '../common/app.exception.js'
import { type Caller, CurrentCaller, Roles } from '../pasport/access.js'
import { FilesService, MAX_FILE_BYTES } from './files.service.js'

export class SaveFileQuery {
    @ApiProperty({ required: false, example: 'contract.pdf', description: 'The name of the file (for downloads)' })
    @IsOptional()
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @MaxLength(200, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    name?: string
}

/** The media types the raw body of an upload may have (the real type is read from the first bytes) */
export const UPLOAD_TYPES = ['image/*', 'application/pdf', 'application/octet-stream']

/**
 * The files of the organisation of the caller (images and PDFs). An upload is the raw file as the body of
 * PUT /files/:id, with the id (a uuid) chosen by the app, so a retry is harmless. Editors and viewers read, editors
 * save and remove (the roles of config/app-roles.json).
 */
@ApiTags('files')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'errors.UNAUTHORIZED' })
@ApiForbiddenResponse({ description: 'errors.NO_ORGANISATION, errors.NO_LICENSE or errors.ROLE_REQUIRED' })
@Controller('files')
export class FilesController {
    constructor(private readonly files: FilesService) {}

    @Get()
    @Roles('editor', 'viewer')
    @ApiOperation({ summary: 'The files of the organisation, newest first (at most 100)' })
    list(@CurrentCaller() caller: Caller) {
        return this.files.list(caller.tenant!.id)
    }

    @Get(':id')
    @Roles('editor', 'viewer')
    @ApiOperation({ summary: 'The file itself; its type follows from its content. With If-None-Match: 304' })
    @ApiBadRequestResponse({ description: 'errors.BAD_REQUEST: the id is not a uuid' })
    @ApiNotFoundResponse({ description: 'errors.FILE_NOT_FOUND' })
    async download(
        @CurrentCaller() caller: Caller,
        @Param('id', ParseUUIDPipe) id: string,
        @Headers('if-none-match') etag: string | undefined,
        @Res() res: Response
    ) {
        const { info, data } = await this.files.open(caller.tenant!.id, id)
        const tag = `"${info.sha256}"`
        res.setHeader('ETag', tag)
        // Never cached by a shared cache; the browser checks with the ETag
        res.setHeader('Cache-Control', 'private, no-cache')
        if (etag === tag) {
            res.status(HttpStatus.NOT_MODIFIED).end()
            return
        }
        res.setHeader('Content-Type', info.contentType)
        res.setHeader('Content-Length', data.length)
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(info.name || id)}`)
        res.end(data)
    }

    @Put(':id')
    @Roles('editor')
    @ApiOperation({ summary: `Save a file: JPEG, PNG, WebP or PDF, at most ${MAX_FILE_BYTES / 1024 / 1024} MB` })
    @ApiConsumes('application/octet-stream', 'image/jpeg', 'image/png', 'image/webp', 'application/pdf')
    @ApiBody({ schema: { type: 'string', format: 'binary' } })
    @ApiOkResponse({ description: '{ id, name, contentType, size, sha256, createdBy, createdAt }' })
    @ApiBadRequestResponse({
        description: 'errors.FILE_EMPTY, or errors.BAD_REQUEST (the id is not a uuid, a name over 200 characters)'
    })
    @ApiConflictResponse({ description: 'errors.CONFLICT: other content under the same id' })
    @ApiPayloadTooLargeResponse({
        description: `errors.FILE_TOO_LARGE (over ${MAX_FILE_BYTES / 1024 / 1024} MB), or errors.PAYLOAD_TOO_LARGE (a body over ${MAX_FILE_BYTES / 1024 / 1024 + 1} MB)`
    })
    @ApiUnsupportedMediaTypeResponse({ description: 'errors.FILE_TYPE_NOT_ALLOWED: only JPEG, PNG, WebP or PDF' })
    save(
        @CurrentCaller() caller: Caller,
        @Param('id', ParseUUIDPipe) id: string,
        @Query() query: SaveFileQuery,
        @Req() req: Request
    ) {
        // Only a body that was read as bytes is a file (the parser skips other media types)
        if (!Buffer.isBuffer(req.body))
            throw new AppException('errors.FILE_TYPE_NOT_ALLOWED', HttpStatus.UNSUPPORTED_MEDIA_TYPE)
        return this.files.put(caller.tenant!.id, caller.sub, id, query.name?.trim() ?? '', req.body)
    }

    @Delete(':id')
    @Roles('editor')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Remove a file' })
    @ApiNoContentResponse({ description: 'Removed' })
    @ApiBadRequestResponse({ description: 'errors.BAD_REQUEST: the id is not a uuid' })
    @ApiNotFoundResponse({ description: 'errors.FILE_NOT_FOUND' })
    remove(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
        return this.files.remove(caller.tenant!.id, id)
    }
}
