import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString, MaxLength } from 'class-validator'
import { i18nValidationMessage } from 'nestjs-i18n'

export class CreateNoteDto {
    @ApiProperty({ example: 'Morgen om 9u teamoverleg' })
    @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
    @IsNotEmpty({ message: i18nValidationMessage('validation.NOT_EMPTY') })
    @MaxLength(2000, { message: i18nValidationMessage('validation.MAX_LENGTH') })
    text!: string
}
