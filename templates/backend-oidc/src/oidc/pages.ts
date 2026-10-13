import { randomBytes } from 'node:crypto'
import type { Response } from 'express'
import type { Membership } from './store/oidc.store.js'

/**
 * The HTML pages of the OpenID Connect server (login, organisation choice, errors). Plain server-side HTML: no
 * JavaScript, every value is escaped and a strict Content-Security-Policy is sent along.
 */
export type Translate = (key: string, args?: Record<string, string>) => string

export const escapeHtml = (value: string): string =>
    value.replace(
        /[&<>"']/g,
        char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char
    )

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--fg:#171717;--muted:#6b7280;--line:#e5e7eb;--accent:#4f46e5;--danger:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0f;--card:#15151b;--fg:#ededed;--muted:#9ca3af;--line:#2a2a33;--accent:#818cf8;--danger:#f87171}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px;display:flex;flex-direction:column;gap:18px}
h1{margin:0;font-size:1.5rem}p{margin:0}.muted{color:var(--muted)}.error{color:var(--danger)}
form{display:flex;flex-direction:column;gap:14px}label{display:flex;flex-direction:column;gap:6px;font-weight:600;font-size:.9rem}
input{height:44px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit;font:inherit}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
button{height:44px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.choice{justify-content:flex-start;padding:0 14px;background:transparent;color:inherit;border:1px solid var(--line);text-align:left}
.qr{align-self:center;width:200px;height:200px;padding:8px;background:#fff;border-radius:12px}.qr svg{width:100%;height:100%;display:block}
.secret{font-family:ui-monospace,monospace;font-size:.95rem;letter-spacing:.04em;word-break:break-all}
.codes{margin:0;padding:12px 16px;display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;list-style:none;border:1px solid var(--line);border-radius:10px;font-family:ui-monospace,monospace}
`

interface PageOptions {
    lang: string
    title: string
    body: string
    status?: number
    /** Origins a form on this page may post to or be redirected to (the redirect_uri of the client). */
    formTargets?: string[]
}

/** Sends a page with security headers: no framing, no caching, no scripts, forms only to this server and the client. */
export function sendPage(response: Response, { lang, title, body, status = 200, formTargets = [] }: PageOptions): void {
    const nonce = randomBytes(16).toString('base64')
    const formAction = ["'self'", ...formTargets].join(' ')
    response
        .status(status)
        .set({
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            Pragma: 'no-cache',
            'X-Frame-Options': 'DENY',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`
        })
        .send(
            `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8">` +
                `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">` +
                `<title>${escapeHtml(title)}</title><style nonce="${nonce}">${STYLE}</style></head>` +
                `<body><main>${body}</main></body></html>`
        )
}

export function loginPage(
    t: Translate,
    options: { action: string; csrf: string; clientName: string; email?: string; error?: string }
) {
    const error = options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ''
    return {
        title: t('oidc.LOGIN_TITLE'),
        body:
            `<h1>${escapeHtml(t('oidc.LOGIN_TITLE'))}</h1>` +
            `<p class="muted">${escapeHtml(t('oidc.LOGIN_SUBTITLE', { client: options.clientName }))}</p>` +
            error +
            `<form method="post" action="${escapeHtml(options.action)}">` +
            `<input type="hidden" name="csrf" value="${escapeHtml(options.csrf)}">` +
            `<label>${escapeHtml(t('oidc.EMAIL'))}<input name="email" type="email" autocomplete="username" required maxlength="254" value="${escapeHtml(options.email ?? '')}"></label>` +
            `<label>${escapeHtml(t('oidc.PASSWORD'))}<input name="password" type="password" autocomplete="current-password" required maxlength="128"></label>` +
            `<button type="submit">${escapeHtml(t('oidc.LOGIN_SUBMIT'))}</button></form>`
    }
}

/** The second factor: a code of the authenticator app, or a recovery code. */
export function mfaPage(t: Translate, options: { action: string; csrf: string; error?: string }) {
    const error = options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ''
    return {
        title: t('oidc.MFA_TITLE'),
        body:
            `<h1>${escapeHtml(t('oidc.MFA_TITLE'))}</h1>` +
            `<p class="muted">${escapeHtml(t('oidc.MFA_TEXT'))}</p>` +
            error +
            `<form method="post" action="${escapeHtml(options.action)}">` +
            `<input type="hidden" name="csrf" value="${escapeHtml(options.csrf)}">` +
            `<label>${escapeHtml(t('oidc.MFA_CODE'))}<input name="code" autocomplete="one-time-code" inputmode="text" required minlength="6" maxlength="20" autofocus></label>` +
            `<button type="submit">${escapeHtml(t('oidc.MFA_SUBMIT'))}</button></form>`
    }
}

/**
 * Setting up two-step verification during the login: the QR code (an SVG made by the server, no script, no external
 * image), the secret to type in by hand, and the first code.
 */
export function mfaSetupPage(
    t: Translate,
    options: { action: string; csrf: string; qrSvg: string; secret: string; error?: string }
) {
    const error = options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ''
    const secret = options.secret.replace(/(.{4})/g, '$1 ').trim()
    return {
        title: t('oidc.MFA_SETUP_TITLE'),
        body:
            `<h1>${escapeHtml(t('oidc.MFA_SETUP_TITLE'))}</h1>` +
            `<p class="muted">${escapeHtml(t('oidc.MFA_SETUP_TEXT'))}</p>` +
            `<div class="qr" role="img" aria-label="${escapeHtml(t('oidc.MFA_QR'))}">${options.qrSvg}</div>` +
            `<p class="muted">${escapeHtml(t('oidc.MFA_SECRET'))}</p><p class="secret">${escapeHtml(secret)}</p>` +
            error +
            `<form method="post" action="${escapeHtml(options.action)}">` +
            `<input type="hidden" name="csrf" value="${escapeHtml(options.csrf)}">` +
            `<label>${escapeHtml(t('oidc.MFA_CODE'))}<input name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9 ]{6,7}" required minlength="6" maxlength="7"></label>` +
            `<button type="submit">${escapeHtml(t('oidc.MFA_SUBMIT'))}</button></form>`
    }
}

/** The recovery codes, shown once after setting up two-step verification. */
export function recoveryCodesPage(t: Translate, options: { action: string; csrf: string; codes: string[] }) {
    const codes = options.codes.map(code => `<li>${escapeHtml(code)}</li>`).join('')
    return {
        title: t('oidc.RECOVERY_TITLE'),
        body:
            `<h1>${escapeHtml(t('oidc.RECOVERY_TITLE'))}</h1>` +
            `<p class="muted">${escapeHtml(t('oidc.RECOVERY_TEXT'))}</p>` +
            `<ul class="codes">${codes}</ul>` +
            `<form method="post" action="${escapeHtml(options.action)}">` +
            `<input type="hidden" name="csrf" value="${escapeHtml(options.csrf)}">` +
            `<button type="submit">${escapeHtml(t('oidc.CONTINUE'))}</button></form>`
    }
}

export function tenantPage(t: Translate, options: { action: string; csrf: string; memberships: Membership[] }) {
    const buttons = options.memberships
        .map(
            membership =>
                `<button class="choice" type="submit" name="tenant" value="${escapeHtml(membership.tenantId)}">${escapeHtml(membership.name)}</button>`
        )
        .join('')
    return {
        title: t('oidc.TENANT_TITLE'),
        body:
            `<h1>${escapeHtml(t('oidc.TENANT_TITLE'))}</h1>` +
            `<p class="muted">${escapeHtml(t('oidc.TENANT_SUBTITLE'))}</p>` +
            `<form method="post" action="${escapeHtml(options.action)}">` +
            `<input type="hidden" name="csrf" value="${escapeHtml(options.csrf)}">${buttons}</form>`
    }
}

export function messagePage(t: Translate, titleKey: string, textKey: string) {
    return {
        title: t(titleKey),
        body: `<h1>${escapeHtml(t(titleKey))}</h1><p class="muted">${escapeHtml(t(textKey))}</p>`
    }
}
