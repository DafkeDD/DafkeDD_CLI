import { Controller, Get, HttpStatus, Param, Post, Req, Res } from '@nestjs/common'
import {
    ApiBadRequestResponse,
    ApiOkResponse,
    ApiOperation,
    ApiProduces,
    ApiResponse,
    ApiTags,
    ApiUnauthorizedResponse
} from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { I18n, I18nContext } from 'nestjs-i18n'
import { interactionCookieName, interactionCookiePath } from './interaction.js'
import { LoginLimiter } from './login-limiter.js'
import { OAuthError } from './oauth.error.js'
import { OIDC, OidcConfig } from './oidc.config.js'
import { type AuthorizeResult, type InteractionCookie, type LoginResult, OidcService } from './oidc.service.js'
import {
    loginPage,
    messagePage,
    mfaPage,
    mfaSetupPage,
    recoveryCodesPage,
    sendPage,
    tenantPage,
    type Translate
} from './pages.js'

type Params = Record<string, unknown>

/** HTTP status of a refused login: wrong password, too many attempts, or an email address that is not verified yet. */
const LOGIN_ERRORS: Record<string, { status: number; error: string }> = {
    'oidc.INVALID_CREDENTIALS': { status: 401, error: 'INVALID_CREDENTIALS' },
    'oidc.TOO_MANY_ATTEMPTS': { status: 429, error: 'TOO_MANY_ATTEMPTS' },
    'oidc.EMAIL_NOT_VERIFIED': { status: 403, error: 'EMAIL_NOT_VERIFIED' },
    'oidc.MFA_INVALID_CODE': { status: 401, error: 'MFA_INVALID_CODE' }
}
const loginError = (key: string) => LOGIN_ERRORS[key] ?? { status: 401, error: 'INVALID_CREDENTIALS' }

/** The login page of the frontend asks for JSON; the server's own HTML page posts forms. */
const wantsJson = (request: Request): boolean =>
    request.method === 'GET' ? request.accepts(['html', 'json']) === 'json' : Boolean(request.is('application/json'))

const translator =
    (i18n: I18nContext): Translate =>
    (key, args) =>
        String(i18n.t(key, args ? { args } : undefined))

/**
 * The OpenID Connect endpoints. Errors of the token and userinfo endpoints use the OAuth format
 * { error, error_description } (RFC 6749 / RFC 6750), not the translated API format: clients depend on these codes.
 */
@ApiTags('oidc')
@Controller('oidc')
export class OidcController {
    constructor(
        private readonly oidc: OidcService,
        private readonly config: OidcConfig,
        private readonly limiter: LoginLimiter
    ) {}

    @Get('.well-known/openid-configuration')
    @ApiOperation({ summary: 'OpenID Connect discovery: the endpoints and features of this server' })
    @ApiOkResponse({ description: 'The discovery document (OpenID Connect Discovery 1.0)' })
    discovery(@Res() response: Response) {
        response.set('Cache-Control', 'public, max-age=300').json(this.oidc.discovery())
    }

    @Get('jwks')
    @ApiOperation({ summary: 'The public keys that verify ID tokens and access tokens (JWKS)' })
    @ApiOkResponse({ description: '{ keys: [...] } (RFC 7517)' })
    async jwks(@Res() response: Response) {
        response.set('Cache-Control', 'public, max-age=300').json(await this.oidc.jwks())
    }

    @Get('authorize')
    @ApiOperation({
        summary: 'Start a login (authorization code flow with PKCE): redirects to the login page or back to the client'
    })
    @ApiResponse({ status: 303, description: 'To the login page, or to redirect_uri with a code or an error' })
    @ApiBadRequestResponse({ description: 'Unknown client or redirect_uri: an HTML error page, no redirect' })
    async authorize(@Req() request: Request, @Res() response: Response, @I18n() i18n: I18nContext) {
        const result = await this.oidc.authorize(request.query as Params, this.sessionId(request))
        this.answer(result, response, i18n)
    }

    @Get('interaction/:id')
    @ApiOperation({
        summary:
            'A running login: the HTML login page, or with Accept: application/json the details for the login page of the frontend'
    })
    @ApiProduces('text/html', 'application/json')
    @ApiOkResponse({ description: 'The login form, or { step, clientName, csrf, loginHint }' })
    @ApiResponse({
        status: 410,
        description: 'The login request expired (HTML page or { status: "expired", message })'
    })
    async interaction(
        @Param('id') id: string,
        @Req() request: Request,
        @Res() response: Response,
        @I18n() i18n: I18nContext
    ) {
        const t = translator(i18n)
        const found = await this.oidc.findInteraction(id, this.interactionCookie(request, id))
        if (wantsJson(request)) {
            if (!found) return this.json(response, 410, { status: 'expired', message: t('oidc.EXPIRED') })
            return this.json(response, 200, {
                step: 'login',
                clientName: found.client.name,
                registration: this.config.registrationOpen,
                csrf: found.interaction.csrf,
                loginHint: found.interaction.params.loginHint ?? ''
            })
        }
        if (!found) return this.expired(response, i18n)
        const page = loginPage(t, {
            action: this.action(id, 'login', request),
            csrf: found.interaction.csrf,
            clientName: found.client.name,
            email: found.interaction.params.loginHint ?? ''
        })
        sendPage(response, {
            lang: i18n.lang,
            ...page,
            formTargets: [new URL(found.interaction.params.redirectUri).origin]
        })
    }

    @Post('interaction/:id/login')
    @ApiOperation({
        summary: 'Submit email and password (form-encoded from the HTML page, or JSON from the frontend). Rate limited.'
    })
    @ApiProduces('text/html', 'application/json')
    @ApiResponse({ status: 303, description: 'Logged in: back to the client with a code' })
    @ApiOkResponse({ description: 'The login form again with a translated error, or the organisation choice' })
    async login(
        @Param('id') id: string,
        @Req() request: Request,
        @Res() response: Response,
        @I18n() i18n: I18nContext
    ) {
        const body = (request.body ?? {}) as Params
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
        const allowed = this.limiter.allow(['ip:' + (request.ip ?? 'unknown'), 'email:' + email])
        const result = await this.oidc.login(id, this.interactionCookie(request, id), body, allowed)
        this.loginAnswer(id, result, request, response, i18n)
    }

    @Post('interaction/:id/mfa')
    @ApiOperation({
        summary:
            'Submit the second factor (form-encoded or JSON): a code of the authenticator app or a recovery code. Rate limited.'
    })
    @ApiProduces('text/html', 'application/json')
    @ApiResponse({ status: 303, description: 'Back to the client with a code, or the organisation choice' })
    @ApiResponse({ status: 401, description: 'Wrong or used code (the page again, or { status: "mfa", error })' })
    async mfa(@Param('id') id: string, @Req() request: Request, @Res() response: Response, @I18n() i18n: I18nContext) {
        const result = await this.oidc.verifyMfa(
            id,
            this.interactionCookie(request, id),
            (request.body ?? {}) as Params
        )
        this.loginAnswer(id, result, request, response, i18n)
    }

    @Post('interaction/:id/continue')
    @ApiOperation({
        summary:
            'Continue after the recovery codes were shown (form-encoded or JSON): the organisation choice or the client'
    })
    @ApiProduces('text/html', 'application/json')
    @ApiResponse({ status: 303, description: 'Back to the client with a code, or the organisation choice' })
    async continue(
        @Param('id') id: string,
        @Req() request: Request,
        @Res() response: Response,
        @I18n() i18n: I18nContext
    ) {
        const result = await this.oidc.continueLogin(
            id,
            this.interactionCookie(request, id),
            (request.body ?? {}) as Params
        )
        this.loginAnswer(id, result, request, response, i18n)
    }

    @Post('interaction/:id/tenant')
    @ApiOperation({
        summary: 'Submit the organisation choice (form-encoded or JSON) when the user belongs to several tenants'
    })
    @ApiProduces('text/html', 'application/json')
    @ApiResponse({ status: 303, description: 'Back to the client with a code' })
    async tenant(
        @Param('id') id: string,
        @Req() request: Request,
        @Res() response: Response,
        @I18n() i18n: I18nContext
    ) {
        const result = await this.oidc.chooseTenant(
            id,
            this.interactionCookie(request, id),
            (request.body ?? {}) as Params
        )
        this.loginAnswer(id, result, request, response, i18n)
    }

    @Post('token')
    @ApiOperation({ summary: 'Exchange a code (with the PKCE code_verifier) for an ID token and an access token' })
    @ApiOkResponse({ description: '{ access_token, token_type, expires_in, id_token, scope }' })
    @ApiBadRequestResponse({ description: '{ error, error_description } (RFC 6749 section 5.2)' })
    @ApiUnauthorizedResponse({ description: 'invalid_client' })
    async token(@Req() request: Request, @Res() response: Response) {
        response.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' })
        try {
            // 200, not the 201 Nest uses for POST: RFC 6749 section 5.1
            response
                .status(HttpStatus.OK)
                .json(await this.oidc.token(request.headers.authorization, (request.body ?? {}) as Params))
        } catch (error) {
            if (!(error instanceof OAuthError)) throw error
            if (error.status === 401 && request.headers.authorization?.startsWith('Basic ')) {
                response.set('WWW-Authenticate', 'Basic realm="oidc"')
            }
            response.status(error.status).json(error.toJSON())
        }
    }

    @Get('userinfo')
    @ApiOperation({ summary: 'Claims about the logged in user (needs the access token as a Bearer token)' })
    @ApiOkResponse({ description: '{ sub, name, email, email_verified, tenant }, depending on the scopes' })
    @ApiUnauthorizedResponse({ description: 'invalid_token' })
    async userinfo(@Req() request: Request, @Res() response: Response) {
        await this.answerUserinfo(this.bearer(request), response)
    }

    @Post('userinfo')
    @ApiOperation({ summary: 'Same as GET /oidc/userinfo; the token may also be sent as access_token in a form body' })
    @ApiOkResponse({ description: '{ sub, name, email, email_verified, tenant }, depending on the scopes' })
    @ApiUnauthorizedResponse({ description: 'invalid_token' })
    async userinfoPost(@Req() request: Request, @Res() response: Response) {
        const body = (request.body ?? {}) as Params
        const token = this.bearer(request) ?? (typeof body.access_token === 'string' ? body.access_token : undefined)
        await this.answerUserinfo(token, response)
    }

    // ------------------------------------------------------------------ helpers

    private sessionId(request: Request): string | undefined {
        const value: unknown = (request.cookies as Record<string, unknown> | undefined)?.[OIDC.SESSION_COOKIE]
        return typeof value === 'string' ? value : undefined
    }

    /** The encrypted cookie of a running login (oidc_ia_<id>). */
    private interactionCookie(request: Request, id: string): string | undefined {
        const value: unknown = (request.cookies as Record<string, unknown> | undefined)?.[interactionCookieName(id)]
        return typeof value === 'string' ? value : undefined
    }

    /** Sets (or with value null removes) the cookie of a running login; only sent to /oidc/interaction/<id>. */
    private setInteractionCookie(response: Response, cookie: InteractionCookie) {
        const options = {
            httpOnly: true,
            sameSite: 'lax' as const,
            secure: this.config.secureCookies,
            path: interactionCookiePath(cookie.id)
        }
        if (cookie.value === null) response.clearCookie(interactionCookieName(cookie.id), options)
        else
            response.cookie(interactionCookieName(cookie.id), cookie.value, {
                ...options,
                maxAge: OIDC.INTERACTION_SECONDS * 1000
            })
    }

    private bearer(request: Request): string | undefined {
        const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/i.exec(request.headers.authorization ?? '')
        return match?.[1]
    }

    /** Action URL of a form on the login page; keeps ?lang= so errors come back in the same language. */
    private action(id: string, step: 'login' | 'mfa' | 'continue' | 'tenant', request: Request): string {
        const url = new URL(this.config.issuer + '/interaction/' + encodeURIComponent(id) + '/' + step)
        if (typeof request.query.lang === 'string') url.searchParams.set('lang', request.query.lang)
        return url.toString()
    }

    private answer(result: AuthorizeResult, response: Response, i18n: I18nContext) {
        if (result.kind === 'redirect') {
            if (result.interaction) this.setInteractionCookie(response, result.interaction)
            response.set('Cache-Control', 'no-store').redirect(HttpStatus.SEE_OTHER, result.location)
            return
        }
        sendPage(response, {
            lang: i18n.lang,
            status: result.status,
            ...messagePage(translator(i18n), result.titleKey, result.textKey)
        })
    }

    private loginAnswer(id: string, result: LoginResult, request: Request, response: Response, i18n: I18nContext) {
        const t = translator(i18n)
        if ('cookie' in result) this.setInteractionCookie(response, result.cookie)
        if (wantsJson(request)) return this.loginJson(result, response, t)
        switch (result.kind) {
            case 'expired':
                return this.expired(response, i18n)
            case 'no-tenant':
                return sendPage(response, {
                    lang: i18n.lang,
                    status: 403,
                    ...messagePage(t, 'oidc.NO_TENANT_TITLE', 'oidc.NO_TENANT')
                })
            case 'form':
                return sendPage(response, {
                    lang: i18n.lang,
                    status: loginError(result.errorKey).status,
                    formTargets: [new URL(result.interaction.params.redirectUri).origin],
                    ...loginPage(t, {
                        action: this.action(id, 'login', request),
                        csrf: result.interaction.csrf,
                        clientName: result.client.name,
                        email: result.email,
                        error: t(result.errorKey)
                    })
                })
            case 'mfa':
                return sendPage(response, {
                    lang: i18n.lang,
                    status: result.errorKey ? loginError(result.errorKey).status : 200,
                    formTargets: [new URL(result.interaction.params.redirectUri).origin],
                    ...mfaPage(t, {
                        action: this.action(id, 'mfa', request),
                        csrf: result.interaction.csrf,
                        error: result.errorKey ? t(result.errorKey) : undefined
                    })
                })
            case 'mfa-setup':
                return sendPage(response, {
                    lang: i18n.lang,
                    status: result.errorKey ? loginError(result.errorKey).status : 200,
                    formTargets: [new URL(result.interaction.params.redirectUri).origin],
                    ...mfaSetupPage(t, {
                        action: this.action(id, 'mfa', request),
                        csrf: result.interaction.csrf,
                        qrSvg: result.setup.qrSvg,
                        secret: result.setup.secret,
                        error: result.errorKey ? t(result.errorKey) : undefined
                    })
                })
            case 'recovery-codes':
                return sendPage(response, {
                    lang: i18n.lang,
                    formTargets: [new URL(result.interaction.params.redirectUri).origin],
                    ...recoveryCodesPage(t, {
                        action: this.action(id, 'continue', request),
                        csrf: result.interaction.csrf,
                        codes: result.recoveryCodes
                    })
                })
            case 'choose-tenant':
                return sendPage(response, {
                    lang: i18n.lang,
                    formTargets: [new URL(result.interaction.params.redirectUri).origin],
                    ...tenantPage(t, {
                        action: this.action(id, 'tenant', request),
                        csrf: result.interaction.csrf,
                        memberships: result.memberships,
                        platform: result.platform
                    })
                })
            case 'done':
                this.setSessionCookie(response, result.sessionId)
                response.set('Cache-Control', 'no-store').redirect(HttpStatus.SEE_OTHER, result.location)
                return
        }
    }

    /**
     * The same answers as JSON, for the login page of the frontend. The browser stores the session cookie of this
     * server from the response (fetch with credentials: 'include'), then goes to `location`.
     */
    private loginJson(result: LoginResult, response: Response, t: Translate) {
        switch (result.kind) {
            case 'expired':
                return this.json(response, 410, { status: 'expired', message: t('oidc.EXPIRED') })
            case 'no-tenant':
                return this.json(response, 403, { status: 'no-tenant', message: t('oidc.NO_TENANT') })
            case 'form': {
                const { status, error } = loginError(result.errorKey)
                return this.json(response, status, { status: 'error', error, message: t(result.errorKey) })
            }
            case 'mfa': {
                if (!result.errorKey) return this.json(response, 200, { status: 'mfa', csrf: result.interaction.csrf })
                const { status, error } = loginError(result.errorKey)
                return this.json(response, status, {
                    status: 'mfa',
                    csrf: result.interaction.csrf,
                    error,
                    message: t(result.errorKey)
                })
            }
            case 'mfa-setup': {
                const setup = {
                    status: 'mfa-setup',
                    csrf: result.interaction.csrf,
                    secret: result.setup.secret,
                    otpauthUrl: result.setup.otpauthUrl,
                    qrSvg: result.setup.qrSvg
                }
                if (!result.errorKey) return this.json(response, 200, setup)
                const { status, error } = loginError(result.errorKey)
                return this.json(response, status, { ...setup, error, message: t(result.errorKey) })
            }
            case 'recovery-codes':
                return this.json(response, 200, {
                    status: 'recovery-codes',
                    csrf: result.interaction.csrf,
                    recoveryCodes: result.recoveryCodes
                })
            case 'choose-tenant':
                return this.json(response, 200, {
                    status: 'choose-tenant',
                    csrf: result.interaction.csrf,
                    tenants: result.memberships.map(membership => ({
                        id: membership.tenantId,
                        name: membership.name,
                        role: membership.role
                    })),
                    // A superadmin can also continue without an organisation: { tenant: "platform" }
                    platform: result.platform
                })
            case 'done':
                this.setSessionCookie(response, result.sessionId)
                return this.json(response, 200, { status: 'redirect', location: result.location })
        }
    }

    private setSessionCookie(response: Response, sessionId: string) {
        response.cookie(OIDC.SESSION_COOKIE, sessionId, {
            httpOnly: true,
            sameSite: 'lax',
            secure: this.config.secureCookies,
            path: OIDC.COOKIE_PATH,
            maxAge: OIDC.SESSION_SECONDS * 1000
        })
    }

    private json(response: Response, status: number, body: Record<string, unknown>) {
        response.status(status).set('Cache-Control', 'no-store').json(body)
    }

    private expired(response: Response, i18n: I18nContext) {
        sendPage(response, {
            lang: i18n.lang,
            status: 400,
            ...messagePage(translator(i18n), 'oidc.EXPIRED_TITLE', 'oidc.EXPIRED')
        })
    }

    private async answerUserinfo(token: string | undefined, response: Response) {
        response.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' })
        try {
            response.status(HttpStatus.OK).json(await this.oidc.userinfo(token))
        } catch (error) {
            if (!(error instanceof OAuthError)) throw error
            const challenge = token
                ? `Bearer realm="oidc", error="${error.error}", error_description="${error.description}"`
                : 'Bearer realm="oidc"'
            response.status(error.status).set('WWW-Authenticate', challenge).json(error.toJSON())
        }
    }
}
