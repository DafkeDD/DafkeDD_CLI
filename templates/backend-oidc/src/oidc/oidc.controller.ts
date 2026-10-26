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
import { ExternalService } from './external/external.service.js'
import { interactionCookieName, interactionCookiePath } from './interaction.js'
import { LoginLimiter } from './login-limiter.js'
import { OAuthError } from './oauth.error.js'
import { OIDC, OidcConfig } from './oidc.config.js'
import {
    type AuthorizeResult,
    externalCookieName,
    type InteractionCookie,
    type LoginResult,
    OidcService
} from './oidc.service.js'
import { type LogoutResult, SessionsService } from './sessions.service.js'
import { TokensService } from './tokens.service.js'
import {
    consentPage,
    loginPage,
    logoutPage,
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
    'oidc.MFA_INVALID_CODE': { status: 401, error: 'MFA_INVALID_CODE' },
    'oidc.ACCOUNT_DISABLED': { status: 403, error: 'ACCOUNT_DISABLED' },
    'oidc.EID_INVALID': { status: 401, error: 'EID_INVALID' },
    'oidc.EID_EXPIRED': { status: 400, error: 'EID_EXPIRED' },
    'oidc.EID_NOT_LINKED': { status: 404, error: 'EID_NOT_LINKED' },
    'oidc.EID_UNAVAILABLE': { status: 503, error: 'EID_UNAVAILABLE' },
    'oidc.PASSWORD_LOGIN_OFF': { status: 403, error: 'PASSWORD_LOGIN_OFF' },
    'oidc.PASSKEY_INVALID': { status: 401, error: 'PASSKEY_INVALID' },
    'oidc.PASSKEY_UNKNOWN': { status: 401, error: 'PASSKEY_UNKNOWN' },
    'oidc.PASSKEY_EXPIRED': { status: 400, error: 'PASSKEY_EXPIRED' },
    'oidc.EXTERNAL_FAILED': { status: 401, error: 'EXTERNAL_FAILED' },
    'oidc.EXTERNAL_NO_EMAIL': { status: 400, error: 'EXTERNAL_NO_EMAIL' },
    'oidc.EXTERNAL_EMAIL_UNVERIFIED': { status: 403, error: 'EXTERNAL_EMAIL_UNVERIFIED' },
    'oidc.EXTERNAL_EMAIL_TAKEN': { status: 409, error: 'EXTERNAL_EMAIL_TAKEN' },
    'oidc.EXTERNAL_OTHER_LINKED': { status: 409, error: 'EXTERNAL_OTHER_LINKED' }
}

/** The cookies of logins at another OpenID Connect server (oidc_ext_<...>): only sent to our callback. */
const EXTERNAL_PATH = OIDC.COOKIE_PATH + '/external'
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
        private readonly tokens: TokensService,
        private readonly sessions: SessionsService,
        private readonly config: OidcConfig,
        private readonly limiter: LoginLimiter,
        private readonly external: ExternalService
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
        const result = await this.oidc.authorize(
            request.query as Params,
            this.sessionId(request),
            request.headers['user-agent'] ?? ''
        )
        this.answer(result, response, i18n)
    }

    @Get('interaction/:id')
    @ApiOperation({
        summary:
            'A running login: the HTML login page, or with Accept: application/json the details for the login page of the frontend'
    })
    @ApiProduces('text/html', 'application/json')
    @ApiOkResponse({
        description:
            'The login form, or { step, clientId, clientName, registration, password, eid, external, externals, pending, csrf, loginHint }'
    })
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
            const externals = this.config.externals
            return this.json(response, 200, {
                step: 'login',
                // The app that asked for the login: its own login screen says "Log in to <app>" for another app
                clientId: found.interaction.params.clientId,
                clientName: found.client.name,
                registration: this.config.registrationOpen,
                // Email and password (not when only the other OpenID Connect server is allowed)
                password: !this.config.externalOnly,
                // Login with the Belgian eID is available (OIDC_EID=on or test)
                eid: this.config.eid !== 'off' && !this.config.externalOnly,
                // "Log in with a passkey" (OIDC_PASSKEYS, not with OIDC_EXTERNAL_ONLY)
                passkey: this.config.passkeys,
                // "Log in with <name>": other OpenID Connect servers (OIDC_EXTERNAL_*, OIDC_EXTERNAL_<n>_*); external is
                // the first (as before several were possible)
                external: externals[0] ? { name: externals[0].name } : null,
                externals: externals.map(item => ({ id: item.id, name: item.name })),
                // Back from that server, halfway (second factor, organisation): POST .../resume goes on
                pending: found.interaction.userId !== null,
                csrf: found.interaction.csrf,
                loginHint: found.interaction.params.loginHint ?? ''
            })
        }
        if (!found) return this.expired(response, i18n)
        // Halfway after the other server (second factor, organisation): go on there
        if (found.interaction.userId !== null)
            return this.loginAnswer(
                id,
                await this.oidc.resume(id, this.interactionCookie(request, id), { csrf: found.interaction.csrf }),
                request,
                response,
                i18n
            )
        const page = loginPage(
            t,
            this.loginOptions(
                id,
                request,
                found.interaction.csrf,
                found.client.name,
                found.interaction.params.loginHint ?? ''
            )
        )
        sendPage(response, {
            lang: i18n.lang,
            ...page,
            formTargets: await this.loginTargets(found.interaction.params.redirectUri)
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

    @Post('interaction/:id/eid/challenge')
    @ApiOperation({
        summary:
            'Log in with the Belgian eID, step 1 (JSON { csrf }): a nonce for the eID bridge, kept in the login cookie (used once)'
    })
    @ApiOkResponse({ description: '{ status: "eid-challenge", nonce }' })
    @ApiResponse({ status: 404, description: 'oidc.EID_DISABLED (OIDC_EID=off)' })
    @ApiResponse({ status: 410, description: 'The login request expired' })
    async eidChallenge(
        @Param('id') id: string,
        @Req() request: Request,
        @Res() response: Response,
        @I18n() i18n: I18nContext
    ) {
        const result = await this.oidc.eidChallenge(
            id,
            this.interactionCookie(request, id),
            (request.body ?? {}) as Params
        )
        this.loginAnswer(id, result, request, response, i18n)
    }

    @Post('interaction/:id/eid')
    @ApiOperation({
        summary:
            'Log in with the Belgian eID, step 2 (JSON { csrf, token }): the token of the bridge after the PIN. Only the first factor: the code of the authenticator app follows (or its setup). Rate limited.'
    })
    @ApiOkResponse({ description: '{ status: "redirect", location } or the organisation choice' })
    @ApiResponse({
        status: 401,
        description:
            'EID_INVALID (signature, origin, nonce or certificate) or 404 EID_NOT_LINKED (no account has this eID)'
    })
    @ApiResponse({ status: 503, description: 'EID_UNAVAILABLE: the OCSP service of the eID could not be reached' })
    async eidLogin(
        @Param('id') id: string,
        @Req() request: Request,
        @Res() response: Response,
        @I18n() i18n: I18nContext
    ) {
        const allowed = this.limiter.allow(['ip:' + (request.ip ?? 'unknown'), 'eid:' + id])
        const result = await this.oidc.eidLogin(
            id,
            this.interactionCookie(request, id),
            (request.body ?? {}) as Params,
            allowed
        )
        this.loginAnswer(id, result, request, response, i18n)
    }

    @Post('interaction/:id/external')
    @ApiOperation({
        summary:
            'Log in at another OpenID Connect server (form-encoded or JSON { csrf, provider }; provider: its id, default 1): to its login page with PKCE, state and nonce'
    })
    @ApiResponse({ status: 303, description: 'To the other server (form), or JSON { status: "redirect", location }' })
    @ApiResponse({ status: 404, description: 'oidc.EXTERNAL_DISABLED: no other server is set up' })
    async externalStart(
        @Param('id') id: string,
        @Req() request: Request,
        @Res() response: Response,
        @I18n() i18n: I18nContext
    ) {
        const result = await this.oidc.externalStart(
            id,
            this.interactionCookie(request, id),
            (request.body ?? {}) as Params
        )
        this.loginAnswer(id, result, request, response, i18n)
    }

    @Get('external/callback')
    @ApiOperation({
        summary:
            'Back from the other OpenID Connect server (register this URL there as redirect URI): the code is exchanged and the ID token checked, then the login goes on'
    })
    @ApiResponse({
        status: 303,
        description: 'Back to the client, or to the login page (second factor, organisation, error)'
    })
    async externalCallback(@Req() request: Request, @Res() response: Response, @I18n() i18n: I18nContext) {
        // The cookie of the login with this state (other logins in other tabs stay as they are)
        const state = typeof request.query.state === 'string' ? request.query.state : ''
        const name = externalCookieName(state)
        const cookies = request.cookies as Record<string, unknown> | undefined
        const sealed = state && typeof cookies?.[name] === 'string' ? (cookies[name] as string) : undefined
        if (sealed) response.clearCookie(name, this.externalCookieOptions())
        const { id, result } = await this.oidc.externalCallback(request.query as Params, sealed)
        const ui = this.config.loginUiUrl
        if (
            !id ||
            !ui ||
            result.kind === 'done' ||
            result.kind === 'redirect' ||
            result.kind === 'expired' ||
            result.kind === 'no-tenant'
        )
            return this.loginAnswer(id ?? '', result, request, response, i18n)
        // The login page of the frontend goes on (GET .../interaction/<id> says "pending", or shows the error)
        if ('cookie' in result && result.cookie) this.setInteractionCookie(response, result.cookie)
        if (result.kind === 'consent' && result.sessionId) this.setSessionCookie(response, result.sessionId)
        const location = new URL(ui)
        location.searchParams.set('interaction', id)
        if (typeof request.query.lang === 'string') location.searchParams.set('lang', request.query.lang)
        if (result.kind === 'form') location.searchParams.set('error', loginError(result.errorKey).error)
        response.set('Cache-Control', 'no-store').redirect(HttpStatus.SEE_OTHER, location.toString())
    }

    @Post('interaction/:id/resume')
    @ApiOperation({
        summary:
            'Go on after the other OpenID Connect server (JSON { csrf }): the second factor, setting it up, or the organisation choice'
    })
    @ApiOkResponse({ description: '{ status: "mfa" | "mfa-setup" | "choose-tenant" | "redirect", ... }' })
    @ApiResponse({ status: 410, description: 'The login request expired' })
    async resume(
        @Param('id') id: string,
        @Req() request: Request,
        @Res() response: Response,
        @I18n() i18n: I18nContext
    ) {
        const result = await this.oidc.resume(id, this.interactionCookie(request, id), (request.body ?? {}) as Params)
        this.loginAnswer(id, result, request, response, i18n)
    }

    @Post('interaction/:id/consent')
    @ApiOperation({
        summary:
            'The consent screen of an application that is not our own (form-encoded or JSON { csrf, decision }): "allow" gives the client its code and remembers the scopes; anything else sends error=access_denied'
    })
    @ApiProduces('text/html', 'application/json')
    @ApiResponse({ status: 303, description: 'Back to the client: with a code, or with error=access_denied' })
    @ApiOkResponse({ description: '{ status: "redirect", location } (JSON)' })
    @ApiResponse({ status: 410, description: 'The login request expired, or the session ended meanwhile' })
    async consent(
        @Param('id') id: string,
        @Req() request: Request,
        @Res() response: Response,
        @I18n() i18n: I18nContext
    ) {
        const result = await this.oidc.consent(id, this.interactionCookie(request, id), (request.body ?? {}) as Params)
        this.loginAnswer(id, result, request, response, i18n)
    }

    @Post('interaction/:id/passkey/challenge')
    @ApiOperation({
        summary:
            'Log in with a passkey, step 1 (JSON { csrf }): the options for navigator.credentials.get() with a challenge kept in the login cookie (used once)'
    })
    @ApiOkResponse({
        description: '{ status: "passkey-challenge", options: { challenge, rpId, userVerification, timeout } }'
    })
    @ApiResponse({ status: 404, description: 'oidc.PASSKEYS_DISABLED' })
    async passkeyChallenge(
        @Param('id') id: string,
        @Req() request: Request,
        @Res() response: Response,
        @I18n() i18n: I18nContext
    ) {
        const result = await this.oidc.passkeyChallenge(
            id,
            this.interactionCookie(request, id),
            (request.body ?? {}) as Params
        )
        this.loginAnswer(id, result, request, response, i18n)
    }

    @Post('interaction/:id/passkey')
    @ApiOperation({
        summary:
            'Log in with a passkey, step 2 (JSON { csrf, credential }): the answer of navigator.credentials.get(). Counts as two-step verification. Rate limited.'
    })
    @ApiOkResponse({ description: '{ status: "redirect", location } or the organisation choice' })
    @ApiResponse({ status: 401, description: 'PASSKEY_INVALID (signature, origin, challenge) or PASSKEY_UNKNOWN' })
    async passkeyLogin(
        @Param('id') id: string,
        @Req() request: Request,
        @Res() response: Response,
        @I18n() i18n: I18nContext
    ) {
        const allowed = this.limiter.allow(['ip:' + (request.ip ?? 'unknown'), 'passkey:' + id])
        const result = await this.oidc.passkeyLogin(
            id,
            this.interactionCookie(request, id),
            (request.body ?? {}) as Params,
            allowed
        )
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
    @ApiOperation({
        summary:
            'Exchange a code (with the PKCE code_verifier) for tokens, or a refresh token for new tokens (rotation: the old refresh token is used up)'
    })
    @ApiOkResponse({ description: '{ access_token, token_type, expires_in, id_token, scope, refresh_token? }' })
    @ApiBadRequestResponse({ description: '{ error, error_description } (RFC 6749 section 5.2)' })
    @ApiUnauthorizedResponse({ description: 'invalid_client' })
    async token(@Req() request: Request, @Res() response: Response) {
        await this.oauth(request, response, async () =>
            this.tokens.token(request.headers.authorization, (request.body ?? {}) as Params)
        )
    }

    @Post('revoke')
    @ApiOperation({
        summary:
            'Revoke a refresh token (RFC 7009), with every token of its family. Unknown tokens get the same 200 answer.'
    })
    @ApiOkResponse({ description: 'Empty: revoked, or nothing to revoke' })
    @ApiBadRequestResponse({ description: 'invalid_request, or unsupported_token_type for an access token' })
    @ApiUnauthorizedResponse({ description: 'invalid_client' })
    async revoke(@Req() request: Request, @Res() response: Response) {
        await this.oauth(request, response, async () => {
            await this.tokens.revoke(request.headers.authorization, (request.body ?? {}) as Params)
            return {}
        })
    }

    @Post('introspect')
    @ApiOperation({
        summary:
            'Is a token active, and what does it say (RFC 7662)? For confidential clients only (resource servers, other backends).'
    })
    @ApiOkResponse({ description: '{ active: true, sub, scope, client_id, exp, tenant, ... } or { active: false }' })
    @ApiUnauthorizedResponse({ description: 'invalid_client: unknown, wrong secret, or a public client' })
    async introspect(@Req() request: Request, @Res() response: Response) {
        await this.oauth(request, response, async () =>
            this.tokens.introspect(request.headers.authorization, (request.body ?? {}) as Params)
        )
    }

    @Get('logout')
    @ApiOperation({
        summary:
            'Log out (end_session_endpoint, OpenID Connect RP-Initiated Logout): ends the session of this browser and goes back to post_logout_redirect_uri'
    })
    @ApiProduces('text/html')
    @ApiResponse({ status: 303, description: 'Logged out: to post_logout_redirect_uri (with state)' })
    @ApiOkResponse({ description: 'The page "You are logged out", or "Log out?" when nothing proves which user' })
    @ApiBadRequestResponse({
        description: 'Unknown client, a forged id_token_hint or an unregistered post_logout_redirect_uri'
    })
    async logout(@Req() request: Request, @Res() response: Response, @I18n() i18n: I18nContext) {
        const result = await this.sessions.logout(request.query as Params, this.sessionId(request), false)
        this.logoutAnswer(result, request, response, i18n)
    }

    @Post('logout')
    @ApiOperation({
        summary:
            'The same as GET /oidc/logout, form-encoded; with confirm=yes and the csrf of the "Log out?" page it logs out'
    })
    @ApiProduces('text/html')
    @ApiResponse({ status: 303, description: 'Logged out: to post_logout_redirect_uri (with state)' })
    async logoutPost(@Req() request: Request, @Res() response: Response, @I18n() i18n: I18nContext) {
        const body = (request.body ?? {}) as Params
        const result = await this.sessions.logout(body, this.sessionId(request), body.confirm === 'yes')
        this.logoutAnswer(result, request, response, i18n)
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

    /** Answers of the token, revocation and introspection endpoints: JSON, never cached, OAuth errors (RFC 6749). */
    private async oauth(request: Request, response: Response, work: () => Promise<object>) {
        response.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' })
        try {
            // 200, not the 201 Nest uses for POST: RFC 6749 section 5.1, RFC 7009 section 2.2, RFC 7662 section 2.2
            response.status(HttpStatus.OK).json(await work())
        } catch (error) {
            if (!(error instanceof OAuthError)) throw error
            if (error.status === 401 && request.headers.authorization?.startsWith('Basic ')) {
                response.set('WWW-Authenticate', 'Basic realm="oidc"')
            }
            response.status(error.status).json(error.toJSON())
        }
    }

    private logoutAnswer(result: LogoutResult, request: Request, response: Response, i18n: I18nContext) {
        const t = translator(i18n)
        if (result.kind === 'error') {
            return sendPage(response, {
                lang: i18n.lang,
                status: 400,
                ...messagePage(t, 'oidc.ERROR_TITLE', result.textKey)
            })
        }
        if (result.kind === 'confirm') {
            const action = new URL(this.config.issuer + '/logout')
            if (typeof request.query.lang === 'string') action.searchParams.set('lang', request.query.lang)
            return sendPage(response, {
                lang: i18n.lang,
                formTargets: result.formTargets,
                ...logoutPage(t, {
                    action: action.toString(),
                    csrf: result.csrf,
                    clientName: result.client?.name,
                    fields: result.fields
                })
            })
        }
        // The session ended (or there was none): the browser forgets its cookie
        response.clearCookie(OIDC.SESSION_COOKIE, {
            httpOnly: true,
            sameSite: 'lax',
            secure: this.config.secureCookies,
            path: OIDC.COOKIE_PATH
        })
        if (result.kind === 'redirect') {
            response.set('Cache-Control', 'no-store').redirect(HttpStatus.SEE_OTHER, result.location)
            return
        }
        sendPage(response, { lang: i18n.lang, ...messagePage(t, 'oidc.LOGGED_OUT_TITLE', 'oidc.LOGGED_OUT') })
    }

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
    private action(
        id: string,
        step: 'login' | 'mfa' | 'continue' | 'tenant' | 'external' | 'consent',
        request: Request
    ): string {
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

    private externalCookieOptions() {
        return { httpOnly: true, sameSite: 'lax' as const, secure: this.config.secureCookies, path: EXTERNAL_PATH }
    }

    /** What the HTML login page shows: email and password, and/or "Log in with <the other server>". */
    private loginOptions(
        id: string,
        request: Request,
        csrf: string,
        clientName: string,
        email: string,
        error?: string
    ) {
        return {
            action: this.action(id, 'login', request),
            csrf,
            clientName,
            email,
            error,
            password: !this.config.externalOnly,
            externals: this.config.externals.map(item => ({
                id: item.id,
                name: item.name,
                action: this.action(id, 'external', request)
            }))
        }
    }

    /** Where the forms of the login page may go (Content-Security-Policy form-action): the client and the other servers. */
    private async loginTargets(redirectUri: string): Promise<string[]> {
        const targets = [new URL(redirectUri).origin]
        for (const item of this.config.externals) {
            const authorize = await this.external.metadata(item.id).catch(() => null)
            if (authorize) targets.push(new URL(authorize.authorization_endpoint).origin)
        }
        return targets
    }

    private loginAnswer(id: string, result: LoginResult, request: Request, response: Response, i18n: I18nContext) {
        const t = translator(i18n)
        if ('cookie' in result && result.cookie) this.setInteractionCookie(response, result.cookie)
        // Logged in just now, the consent screen follows: the browser keeps the session either way
        if (result.kind === 'consent' && result.sessionId) this.setSessionCookie(response, result.sessionId)
        if (result.kind === 'external') {
            response.cookie(result.cookieName, result.external, {
                ...this.externalCookieOptions(),
                maxAge: OIDC.INTERACTION_SECONDS * 1000
            })
            if (wantsJson(request)) return this.json(response, 200, { status: 'redirect', location: result.location })
            response.set('Cache-Control', 'no-store').redirect(HttpStatus.SEE_OTHER, result.location)
            return
        }
        if (wantsJson(request) || result.kind === 'eid-challenge' || result.kind === 'passkey-challenge')
            return this.loginJson(result, response, t)
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
                    ...loginPage(
                        t,
                        this.loginOptions(
                            id,
                            request,
                            result.interaction.csrf,
                            result.client.name,
                            result.email,
                            t(result.errorKey)
                        )
                    )
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
            case 'consent':
                return sendPage(response, {
                    lang: i18n.lang,
                    formTargets: [new URL(result.interaction.params.redirectUri).origin],
                    ...consentPage(t, {
                        action: this.action(id, 'consent', request),
                        csrf: result.interaction.csrf,
                        clientName: result.client.name,
                        email: result.email,
                        scopes: result.scopes
                    })
                })
            case 'redirect':
                response.set('Cache-Control', 'no-store').redirect(HttpStatus.SEE_OTHER, result.location)
                return
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
            case 'eid-challenge':
                return this.json(response, 200, { status: 'eid-challenge', nonce: result.nonce })
            case 'external':
                return this.json(response, 200, { status: 'redirect', location: result.location })
            case 'passkey-challenge':
                return this.json(response, 200, { status: 'passkey-challenge', options: result.options })
            case 'consent':
                return this.json(response, 200, {
                    status: 'consent',
                    csrf: result.interaction.csrf,
                    clientName: result.client.name,
                    email: result.email,
                    // openid, profile, email, tenant: the frontend shows what each one gives
                    scopes: result.scopes
                })
            case 'redirect':
                return this.json(response, 200, { status: 'redirect', location: result.location })
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
