import { ConfigService } from '@nestjs/config'
import { Logger } from '@nestjs/common'
import { MailService } from './mail.service.js'

const MAIL = {
    to: 'ada@example.com',
    subject: 'Hello',
    text: 'Open http://localhost:3000/x?token=abc',
    html: '<p>Hi</p>'
}
const service = (settings: Record<string, string>) =>
    new MailService({ get: (key: string) => settings[key] } as unknown as ConfigService)

describe('MailService', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('without SMTP_HOST prints the mail in the console during development', async () => {
        const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
        expect(await service({ SMTP_HOST: '' }).send(MAIL)).toBe(true)
        expect(String(log.mock.calls[0]?.[0])).toContain('token=abc')
    })

    it('without SMTP_HOST in production sends nothing and never logs the contents', async () => {
        const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
        const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
        expect(await service({ NODE_ENV: 'production' }).send(MAIL)).toBe(false)
        expect(String(error.mock.calls[0]?.[0])).not.toContain('token=abc')
        expect(log).not.toHaveBeenCalled()
    })

    it('reports a mail server that cannot be reached, and still prints the mail during development', async () => {
        vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
        const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
        expect(await service({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '9' }).send(MAIL)).toBe(false)
        expect(log).toHaveBeenCalled()
    })
})
