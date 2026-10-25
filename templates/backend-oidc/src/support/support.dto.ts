import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
    ArrayMaxSize,
    IsArray,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Max,
    MaxLength,
    Min,
    MinLength
} from 'class-validator'
import { i18nValidationMessage } from 'nestjs-i18n'
import { PRODUCT_CODE } from '../billing/billing.dto.js'
import { TICKET_PRIORITIES, TICKET_STATUSES, type TicketPriority, type TicketStatus } from './tickets.store.js'

const message = (key: string) => ({ message: i18nValidationMessage('validation.' + key) })

export class TicketMessageDto {
    @ApiProperty({
        example:
            'The planner does **not** show my appointments:\n\n![screenshot.png](att:1fb82908-476c-4460-951a-0fae1f01fcc6)',
        description:
            'Markdown subset: **bold**, _italic_, ~~strike~~, `code`, [text](https://...), \\ escapes, "- " and "1. " ' +
            'lists, a blank line between paragraphs; images ![name](att:<id>) of an uploaded attachment of the organisation'
    })
    @IsString(message('IS_STRING'))
    @MinLength(1, message('MIN_LENGTH'))
    @MaxLength(20_000, message('MAX_LENGTH'))
    text!: string
}

export class TicketAttachmentDto {
    @ApiProperty({ example: 'screenshot.png', description: 'Only its base name is kept' })
    @IsString(message('IS_STRING'))
    @MinLength(1, message('MIN_LENGTH'))
    @MaxLength(200, message('MAX_LENGTH'))
    filename!: string

    @ApiProperty({
        description:
            'The image in base64 (a data: URL prefix is allowed): PNG, JPEG, GIF or WebP (detected from the content), at most 2 MiB'
    })
    @IsString(message('IS_STRING'))
    @MinLength(4, message('MIN_LENGTH'))
    @MaxLength(3_000_000, message('MAX_LENGTH'))
    dataBase64!: string
}

export class SupportTicketAttachmentDto extends TicketAttachmentDto {
    @ApiProperty({ example: '1fb82908-476c-4460-951a-0fae1f01fcc6', description: 'The organisation' })
    @IsUUID('all', message('IS_UUID'))
    tenantId!: string
}

export class CreateTicketDto extends TicketMessageDto {
    @ApiProperty({ example: 'Appointments missing' })
    @IsString(message('IS_STRING'))
    @MinLength(3, message('MIN_LENGTH'))
    @MaxLength(200, message('MAX_LENGTH'))
    subject!: string

    @ApiPropertyOptional({
        example: 'planner',
        nullable: true,
        type: String,
        description: 'The product it is about; null or left out: a general question'
    })
    @IsOptional()
    @Matches(PRODUCT_CODE, message('MATCHES'))
    appCode?: string | null
}

export class SupportCreateTicketDto extends CreateTicketDto {
    @ApiProperty({ example: '1fb82908-476c-4460-951a-0fae1f01fcc6', description: 'The organisation' })
    @IsUUID('all', message('IS_UUID'))
    tenantId!: string

    @ApiProperty({ enum: TICKET_PRIORITIES, example: 'normal' })
    @IsIn(TICKET_PRIORITIES, message('IS_IN'))
    priority!: TicketPriority
}

export class RateTicketDto {
    @ApiProperty({ example: 5, minimum: 1, maximum: 5, description: '1 (bad) to 5 (very good)' })
    @IsInt(message('IS_INT'))
    @Min(1, message('MIN'))
    @Max(5, message('MAX'))
    score!: number

    @ApiPropertyOptional({
        example: 'Quick and friendly help.',
        nullable: true,
        type: String,
        description: 'Trimmed; empty, null or left out: no comment'
    })
    @IsOptional()
    @IsString(message('IS_STRING'))
    @MaxLength(1000, message('MAX_LENGTH'))
    comment?: string | null
}

export class TicketNoteDto extends TicketMessageDto {
    @ApiPropertyOptional({
        type: [String],
        example: ['1fb82908-476c-4460-951a-0fae1f01fcc6'],
        description: 'Members of the support team (superadmins) to mention'
    })
    @IsOptional()
    @IsArray(message('IS_ARRAY'))
    @ArrayMaxSize(20, message('ARRAY_MAX_SIZE'))
    @IsUUID('all', { each: true, ...message('IS_UUID') })
    mentions?: string[]
}

export class TicketsQueryDto {
    @ApiPropertyOptional({ enum: TICKET_STATUSES })
    @IsOptional()
    @IsIn(TICKET_STATUSES, message('IS_IN'))
    status?: TicketStatus

    @ApiPropertyOptional({ enum: ['me', 'none'], description: 'me: assigned to me; none: nobody handles it yet' })
    @IsOptional()
    @IsIn(['me', 'none'], message('IS_IN'))
    assignee?: 'me' | 'none'

    @ApiPropertyOptional({ example: 'TIC-1042', description: 'Number, subject, organisation or customer' })
    @IsOptional()
    @IsString(message('IS_STRING'))
    @MaxLength(100, message('MAX_LENGTH'))
    q?: string
}
