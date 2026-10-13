import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import nodemailer, { type Transporter } from 'nodemailer'

export interface Mail {
    to: string
    subject: string
    text: string
    html: string
}

/**
 * Sends email over SMTP (SMTP_* in .env). During development Mailpit catches every mail (npm run mail:dev, then
 * http://localhost:8025). Without SMTP_HOST, or when sending fails outside production, the mail is printed in the
 * console instead, so the links can still be used. In production the contents are never logged (they hold tokens).
 */
@Injectable()
export class MailService {
    private readonly logger = new Logger('Mail')
    private transport: Transporter | null | undefined

    constructor(private readonly config: ConfigService) {}

    private get production(): boolean {
        return this.config.get<string>('NODE_ENV') === 'production'
    }

    private transporter(): Transporter | null {
        if (this.transport !== undefined) return this.transport
        const host = this.config.get<string>('SMTP_HOST')
        const user = this.config.get<string>('SMTP_USER')
        this.transport = host
            ? nodemailer.createTransport({
                  host,
                  port: Number(this.config.get<string>('SMTP_PORT') ?? 587),
                  secure: this.config.get<string>('SMTP_SECURE') === 'true',
                  auth: user ? { user, pass: this.config.get<string>('SMTP_PASSWORD') ?? '' } : undefined,
                  connectionTimeout: 5000
              })
            : null
        return this.transport
    }

    /** Sends a mail. Never throws: returns false when the mail could not be sent (the reason is logged). */
    async send(mail: Mail): Promise<boolean> {
        const transport = this.transporter()
        if (!transport) {
            if (this.production) {
                this.logger.error(`SMTP_HOST is not set: "${mail.subject}" to ${mail.to} was not sent`)
                return false
            }
            this.print(mail)
            return true
        }
        try {
            await transport.sendMail({
                from: this.config.get<string>('MAIL_FROM') || 'no-reply@localhost',
                to: mail.to,
                subject: mail.subject,
                text: mail.text,
                html: mail.html
            })
            return true
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            this.logger.error(`Could not send "${mail.subject}" to ${mail.to}: ${reason}`)
            if (!this.production) this.print(mail)
            return false
        }
    }

    private print(mail: Mail) {
        this.logger.log(`Mail to ${mail.to}: ${mail.subject}\n${mail.text}`)
    }
}
