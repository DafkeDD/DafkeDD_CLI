import { ConfigService } from '@nestjs/config'
import type { Response } from 'express'
import { LoginLimiter } from './login-limiter.js'
import { OidcConfig } from './oidc.config.js'
import { consentPage, escapeHtml, loginPage, logoutPage, sendPage } from './pages.js'

describe('pages', () => {
    const t = (key: string, args?: Record<string, string>) => key + (args ? JSON.stringify(args) : '')

    it('escapes HTML', () => {
        expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
            '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;'
        )
    })

    it('puts every value escaped into the login form', () => {
        const page = loginPage(t, {
            action: '/x',
            csrf: 'c"srf',
            clientName: '<Evil>',
            email: '"><script>',
            error: '<b>'
        })
        expect(page.body).not.toContain('<script>')
        expect(page.body).not.toContain('<Evil>')
        expect(page.body).toContain('value="c&quot;srf"')
    })

    it('shows the consent screen with every scope and escaped names, and both answers', () => {
        const page = consentPage(t, {
            action: '/consent',
            csrf: 'c"srf',
            clientName: '<Evil App>',
            email: '"><img>',
            scopes: ['openid', 'email', 'tenant']
        })
        expect(page.body).not.toContain('<Evil App>')
        expect(page.body).not.toContain('<img>')
        for (const key of ['oidc.SCOPE_OPENID', 'oidc.SCOPE_EMAIL', 'oidc.SCOPE_TENANT'])
            expect(page.body).toContain(key)
        expect(page.body).toContain('name="decision" value="allow"')
        expect(page.body).toContain('name="decision" value="deny"')
        expect(page.body).toContain('value="c&quot;srf"')
    })

    it('asks to confirm a logout with every parameter escaped in hidden fields', () => {
        const page = logoutPage(t, {
            action: '/oidc/logout',
            csrf: 'token',
            clientName: '<Evil>',
            fields: { post_logout_redirect_uri: 'http://localhost:3000', state: '"><script>' }
        })
        expect(page.body).not.toContain('<script>')
        expect(page.body).toContain('name="confirm" value="yes"')
        expect(page.body).toContain('name="csrf" value="token"')
        expect(page.body).toContain('&lt;Evil&gt;')
    })

    it('sends security headers with a fresh nonce', () => {
        const headers: Record<string, string> = {}
        let html = ''
        const response = {
            status: () => response,
            set: (values: Record<string, string>) => Object.assign(headers, values) && response,
            send: (body: string) => {
                html = body
            }
        }
        sendPage(response as unknown as Response, {
            lang: 'nl',
            title: 'T',
            body: '<p>x</p>',
            formTargets: ['http://localhost:4400']
        })
        const csp = headers['Content-Security-Policy'] ?? ''
        expect(csp).toContain("default-src 'none'")
        expect(csp).toContain("frame-ancestors 'none'")
        expect(csp).toContain("form-action 'self' http://localhost:4400")
        const nonce = /'nonce-([^']+)'/.exec(csp)?.[1]
        expect(html).toContain(`<style nonce="${nonce}">`)
        expect(html).toContain('<html lang="nl">')
        expect(headers['Cache-Control']).toBe('no-store')
    })
})

describe('LoginLimiter', () => {
    it('allows OIDC_LOGIN_RATE_LIMIT attempts per key per minute', () => {
        const limiter = new LoginLimiter(new OidcConfig(new ConfigService({ OIDC_LOGIN_RATE_LIMIT: '2' })))
        expect(limiter.allow(['ip:1'], 0)).toBe(true)
        expect(limiter.allow(['ip:1'], 1)).toBe(true)
        expect(limiter.allow(['ip:1'], 2)).toBe(false)
        expect(limiter.allow(['ip:2'], 3)).toBe(true)
        expect(limiter.allow(['ip:1'], 70_000)).toBe(true)
    })

    it('blocks when any of the keys (IP or email) is over the limit', () => {
        const limiter = new LoginLimiter(new OidcConfig(new ConfigService({ OIDC_LOGIN_RATE_LIMIT: '1' })))
        expect(limiter.allow(['ip:1', 'email:a'], 0)).toBe(true)
        expect(limiter.allow(['ip:2', 'email:a'], 1)).toBe(false)
    })
})
