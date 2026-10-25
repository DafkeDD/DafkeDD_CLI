import type { Mail } from './mail.service.js'

/** Translates a key of src/i18n/<language>/mail.json with its arguments. */
export type MailTranslate = (key: string, args?: Record<string, string>) => string

export type MailKind = 'verify' | 'exists' | 'reset' | 'invite' | 'confirm'

const escape = (value: string) =>
    value.replace(
        /[&<>"']/g,
        char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char
    )

/**
 * The account emails, as plain text and simple HTML (inline styles: mail programs ignore style sheets). Every value is
 * escaped; the texts come from mail.json in the language of the user.
 */
export function buildMail(
    t: MailTranslate,
    kind: MailKind,
    to: string,
    values: {
        name: string
        app: string
        link: string
        tenant?: string
        inviter?: string
        role?: string
        /** The apps an invitation gives access to, by name ("Planner, Agenda"); empty: none. */
        apps?: string
    }
): Mail {
    const key = kind.toUpperCase()
    const args = {
        name: values.name,
        app: values.app,
        tenant: values.tenant ?? '',
        inviter: values.inviter ?? '',
        role: values.role ?? '',
        apps: values.apps ?? ''
    }
    const subject = t(`mail.${key}_SUBJECT`, args)
    const greeting = t('mail.GREETING', args)
    // An invitation with apps names them right after the introduction
    const intro = [
        t(`mail.${key}_TEXT`, args),
        ...(kind === 'invite' && args.apps ? [t('mail.INVITE_APPS', args)] : [])
    ].join(' ')
    const button = t(`mail.${key}_BUTTON`, args)
    const note = t(`mail.${key}_NOTE`, args)
    const text = [greeting, '', intro, '', values.link, '', note, '', t('mail.SIGNATURE', args)].join('\n')
    const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#171717">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
<p style="margin:0 0 16px">${escape(greeting)}</p>
<p style="margin:0 0 24px;line-height:1.5">${escape(intro)}</p>
<p style="margin:0 0 24px"><a href="${escape(values.link)}" style="display:inline-block;background:#171717;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:12px">${escape(button)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#525252;line-height:1.5">${escape(note)}</p>
<p style="margin:0;font-size:12px;color:#737373;word-break:break-all">${escape(values.link)}</p>
<p style="margin:24px 0 0;font-size:13px;color:#525252">${escape(t('mail.SIGNATURE', args))}</p>
</div></body></html>`
    return { to, subject, text, html }
}
