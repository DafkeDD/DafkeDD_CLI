import { Module } from '@nestjs/common'
import { MailService } from './mail.service.js'

/** Sending email (SMTP from .env, Mailpit during development). */
@Module({
    providers: [MailService],
    exports: [MailService]
})
export class MailModule {}
