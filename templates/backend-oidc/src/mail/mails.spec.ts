import { buildMail, type MailTranslate } from './mails.js'

// A translator that shows which key was used and with which arguments
const t: MailTranslate = (key, args) =>
    `${key}(${Object.values(args ?? {})
        .filter(Boolean)
        .join(',')})`

describe('account emails', () => {
    it('have a subject, the link in the text and in the HTML, and the right texts per kind', () => {
        for (const kind of ['verify', 'exists', 'reset', 'invite', 'confirm'] as const) {
            const mail = buildMail(t, kind, 'ada@example.com', {
                name: 'Ada',
                app: 'Shop',
                link: 'http://localhost:3000/x?token=abc',
                tenant: 'Acme',
                inviter: 'Bob',
                role: 'admin'
            })
            expect(mail.to).toBe('ada@example.com')
            expect(mail.subject).toContain(`mail.${kind.toUpperCase()}_SUBJECT`)
            expect(mail.text).toContain('http://localhost:3000/x?token=abc')
            expect(mail.html).toContain('href="http://localhost:3000/x?token=abc"')
            expect(mail.text).toContain(`mail.${kind.toUpperCase()}_NOTE`)
        }
    })

    it('an invitation names its apps after the introduction, only when there are any', () => {
        const values = { name: 'Ada', app: 'Pasport', link: 'http://localhost:3000/invite?token=abc', tenant: 'Acme' }
        const withApps = buildMail(t, 'invite', 'ada@example.com', { ...values, apps: 'Planner, <Agenda>' })
        expect(withApps.text).toContain('mail.INVITE_APPS(')
        expect(withApps.text).toContain('Planner, <Agenda>')
        expect(withApps.html).toContain('Planner, &lt;Agenda&gt;')
        expect(buildMail(t, 'invite', 'ada@example.com', values).text).not.toContain('mail.INVITE_APPS')
        expect(buildMail(t, 'verify', 'ada@example.com', { ...values, apps: 'Planner' }).text).not.toContain(
            'mail.INVITE_APPS'
        )
    })

    it('escapes every value in the HTML', () => {
        const mail = buildMail(t, 'invite', 'x@example.com', {
            name: '<script>alert(1)</script>',
            app: 'App',
            link: 'http://localhost:3000/invite?token="x"',
            tenant: '<b>Evil</b>'
        })
        expect(mail.html).not.toContain('<script>')
        expect(mail.html).not.toContain('<b>Evil</b>')
        expect(mail.html).toContain('&lt;script&gt;')
        expect(mail.html).toContain('token=&quot;x&quot;')
    })
})
