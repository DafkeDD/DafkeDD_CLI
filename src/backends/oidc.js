/**
 * Optional OpenID Connect server in the NestJS backend (phase 1 of the plan): multi-tenant from the start, PostgreSQL
 * Row-Level Security, signing keys encrypted in the database, the authorization code flow with mandatory PKCE, the
 * token and userinfo endpoints, discovery and JWKS. Our own code on node:crypto, no OIDC or JWT library.
 *
 * The TypeScript files live as real files in templates/backend-oidc and are copied into ./backend; a few placeholders
 * (__USERS_TABLE__, __TENANT_ROLE__, __PORT__, __OIDC_MESSAGES__) are filled in for the project.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, scrypt } from 'node:crypto'
import { basename } from 'node:path'

export const TEMPLATE_DIR = fileURLToPath(new URL('../../templates/backend-oidc/', import.meta.url))
export const ISSUER_PATH = '/oidc'
export const FRONTEND_CALLBACK = 'http://localhost:3000/api/auth/callback'
export const LOGIN_UI_URL = 'http://localhost:3000/login'
export const SESSION_COOKIE = 'oidc_session'

export const PACKAGES = {
    dependencies: ['cookie-parser@latest'],
    devDependencies: ['@types/cookie-parser@latest']
}

export const SCRIPTS = {
    'test:db': 'vitest run --config ./vitest.config.db.ts',
    'oidc:user': 'node scripts/oidc-user.mjs'
}

/** Texts of the login pages (namespace "oidc"). Every language needs the same keys (checked by the tests). */
export const MESSAGES = {
    en: {
        LOGIN_TITLE: 'Log in',
        LOGIN_SUBTITLE: 'to continue to {client}',
        EMAIL: 'Email address',
        PASSWORD: 'Password',
        LOGIN_SUBMIT: 'Log in',
        INVALID_CREDENTIALS: 'Incorrect email address or password',
        TOO_MANY_ATTEMPTS: 'Too many attempts, try again in a minute',
        TENANT_TITLE: 'Choose an organisation',
        TENANT_SUBTITLE: 'Your account belongs to several organisations. Which one do you want to use?',
        NO_TENANT_TITLE: 'No access',
        NO_TENANT: 'Your account does not belong to an organisation yet. Ask an administrator to add you.',
        EXPIRED_TITLE: 'This login has expired',
        EXPIRED: 'Go back to the application and log in again.',
        ERROR_TITLE: 'Logging in is not possible',
        INVALID_REQUEST: 'The application sent an invalid login request.',
        UNKNOWN_CLIENT: 'This application is not known to the login server.',
        INVALID_REDIRECT: 'The application asked to return to an address that is not registered.'
    },
    nl: {
        LOGIN_TITLE: 'Inloggen',
        LOGIN_SUBTITLE: 'om verder te gaan naar {client}',
        EMAIL: 'E-mailadres',
        PASSWORD: 'Wachtwoord',
        LOGIN_SUBMIT: 'Inloggen',
        INVALID_CREDENTIALS: 'Onjuist e-mailadres of wachtwoord',
        TOO_MANY_ATTEMPTS: 'Te veel pogingen, probeer het over een minuut opnieuw',
        TENANT_TITLE: 'Kies een organisatie',
        TENANT_SUBTITLE: 'Je account hoort bij meerdere organisaties. Welke wil je gebruiken?',
        NO_TENANT_TITLE: 'Geen toegang',
        NO_TENANT: 'Je account hoort nog niet bij een organisatie. Vraag een beheerder om je toe te voegen.',
        EXPIRED_TITLE: 'Deze login is verlopen',
        EXPIRED: 'Ga terug naar de toepassing en log opnieuw in.',
        ERROR_TITLE: 'Inloggen is niet mogelijk',
        INVALID_REQUEST: 'De toepassing stuurde een ongeldige loginaanvraag.',
        UNKNOWN_CLIENT: 'Deze toepassing is niet bekend bij de loginserver.',
        INVALID_REDIRECT: 'De toepassing vroeg om terug te keren naar een adres dat niet geregistreerd is.'
    },
    fr: {
        LOGIN_TITLE: 'Se connecter',
        LOGIN_SUBTITLE: 'pour continuer vers {client}',
        EMAIL: 'Adresse e-mail',
        PASSWORD: 'Mot de passe',
        LOGIN_SUBMIT: 'Se connecter',
        INVALID_CREDENTIALS: 'Adresse e-mail ou mot de passe incorrect',
        TOO_MANY_ATTEMPTS: 'Trop de tentatives, réessayez dans une minute',
        TENANT_TITLE: 'Choisissez une organisation',
        TENANT_SUBTITLE: 'Votre compte appartient à plusieurs organisations. Laquelle voulez-vous utiliser ?',
        NO_TENANT_TITLE: 'Accès refusé',
        NO_TENANT:
            "Votre compte n'appartient encore à aucune organisation. Demandez à un administrateur de vous ajouter.",
        EXPIRED_TITLE: 'Cette connexion a expiré',
        EXPIRED: "Retournez à l'application et reconnectez-vous.",
        ERROR_TITLE: 'Connexion impossible',
        INVALID_REQUEST: "L'application a envoyé une demande de connexion invalide.",
        UNKNOWN_CLIENT: "Cette application n'est pas connue du serveur de connexion.",
        INVALID_REDIRECT: "L'application demande à revenir vers une adresse qui n'est pas enregistrée."
    },
    de: {
        LOGIN_TITLE: 'Anmelden',
        LOGIN_SUBTITLE: 'um mit {client} fortzufahren',
        EMAIL: 'E-Mail-Adresse',
        PASSWORD: 'Passwort',
        LOGIN_SUBMIT: 'Anmelden',
        INVALID_CREDENTIALS: 'E-Mail-Adresse oder Passwort ist falsch',
        TOO_MANY_ATTEMPTS: 'Zu viele Versuche, bitte in einer Minute erneut versuchen',
        TENANT_TITLE: 'Organisation wählen',
        TENANT_SUBTITLE: 'Dein Konto gehört zu mehreren Organisationen. Welche möchtest du verwenden?',
        NO_TENANT_TITLE: 'Kein Zugriff',
        NO_TENANT: 'Dein Konto gehört noch zu keiner Organisation. Bitte einen Administrator, dich hinzuzufügen.',
        EXPIRED_TITLE: 'Diese Anmeldung ist abgelaufen',
        EXPIRED: 'Gehe zurück zur Anwendung und melde dich erneut an.',
        ERROR_TITLE: 'Anmeldung nicht möglich',
        INVALID_REQUEST: 'Die Anwendung hat eine ungültige Anmeldeanfrage gesendet.',
        UNKNOWN_CLIENT: 'Diese Anwendung ist dem Anmeldeserver nicht bekannt.',
        INVALID_REDIRECT: 'Die Anwendung möchte zu einer Adresse zurückkehren, die nicht registriert ist.'
    }
}

/** The database role used for Row-Level Security: <database>_tenant (roles are shared by a whole server). */
export const tenantRole = database => `${database}_tenant`

/** All files of templates/backend-oidc, with the placeholders filled in. */
export function oidcFiles({ usersTable, database, port }) {
    const values = {
        __USERS_TABLE__: usersTable,
        __TENANT_ROLE__: tenantRole(database),
        __PORT__: String(port),
        __OIDC_MESSAGES__: JSON.stringify(MESSAGES)
    }
    const result = {}
    for (const entry of readdirSync(TEMPLATE_DIR, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue
        const full = path.join(entry.parentPath ?? entry.path, entry.name)
        const rel = path.relative(TEMPLATE_DIR, full).split(path.sep).join('/')
        let content = readFileSync(full, 'utf8')
        for (const [placeholder, value] of Object.entries(values)) content = content.replaceAll(placeholder, value)
        result[rel] = content
    }
    return result
}

// Same format as src/oidc/password.ts in the backend: scrypt$<N>$<salt>$<hash>
const N = 2 ** 15
export const hashPassword = password =>
    new Promise((resolve, reject) => {
        const salt = randomBytes(16)
        scrypt(password, salt, 64, { N, r: 8, p: 1, maxmem: 128 * N * 8 * 2 }, (error, key) =>
            error ? reject(error) : resolve(['scrypt', N, salt.toString('hex'), key.toString('hex')].join('$'))
        )
    })

/** A random temporary password (16 characters, shown once at the end of the CLI run). */
export const generatePassword = () => randomBytes(12).toString('base64url')

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Questions after choosing the OpenID Connect server: name of the first tenant and email of its admin. */
export async function ask({ projectDir = process.cwd(), prompts, hasFrontend = false }) {
    const tenantName = (
        await prompts.input({
            message: 'Naam van de eerste organisatie (tenant):',
            default: basename(projectDir),
            validate: value => (value.trim().length >= 2 && value.trim().length <= 100) || 'Gebruik 2 tot 100 tekens'
        })
    ).trim()
    const adminEmail = (
        await prompts.input({
            message: 'E-mailadres van de eerste beheerder:',
            validate: value => EMAIL_PATTERN.test(value.trim()) || 'Geef een geldig e-mailadres op'
        })
    )
        .trim()
        .toLowerCase()
    const adminPassword = generatePassword()
    return {
        tenantName,
        adminEmail,
        adminPassword,
        adminPasswordHash: await hashPassword(adminPassword),
        masterKey: randomBytes(32).toString('hex'),
        // With a frontend the login pages live there (port 3000), not in the API
        loginUi: hasFrontend
    }
}

const quote = value => `'${String(value).replaceAll("'", '')}'`

/** .env lines. With `example: true` (for .env.example) secrets are replaced by placeholders. */
export function envLines(oidc, { port, example = false }) {
    return [
        '',
        '# OpenID Connect server (src/oidc). The issuer is the public base URL of the login server.',
        `OIDC_ISSUER=http://localhost:${port}${ISSUER_PATH}`,
        '# The API that accepts the access tokens (their "aud")',
        `OIDC_AUDIENCE=http://localhost:${port}`,
        '# Encrypts the private signing keys in the database: 64 hex characters, never commit it, keep a backup.',
        "# Generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        `OIDC_MASTER_KEY=${example ? 'change-me-to-64-hex-characters' : oidc.masterKey}`,
        ...(oidc.loginUi
            ? [
                  '# The login page of the frontend: /oidc/authorize sends the browser there (leave empty for the HTML page of the API)',
                  `OIDC_LOGIN_UI_URL=${LOGIN_UI_URL}`
              ]
            : []),
        '# Maximum login attempts per minute, per IP address and per email address',
        'OIDC_LOGIN_RATE_LIMIT=10',
        '# The first tenant and its admin: created at the first start when there are no users yet.',
        `OIDC_BOOTSTRAP_TENANT=${quote(oidc.tenantName)}`,
        `OIDC_BOOTSTRAP_ADMIN_EMAIL=${example ? 'admin@example.com' : oidc.adminEmail}`,
        `OIDC_BOOTSTRAP_ADMIN_PASSWORD_HASH=${example ? "''" : quote(oidc.adminPasswordHash)}`,
        ''
    ].join('\n')
}

const DISCOVERY_EXAMPLE = port => ({
    issuer: `http://localhost:${port}/oidc`,
    authorization_endpoint: `http://localhost:${port}/oidc/authorize`,
    token_endpoint: `http://localhost:${port}/oidc/token`,
    userinfo_endpoint: `http://localhost:${port}/oidc/userinfo`,
    jwks_uri: `http://localhost:${port}/oidc/jwks`,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    '...': '...'
})

const TENANT = { id: '6b1d7c4e-0f1a-4c55-9e1e-2b9c1f3d8a10', name: 'Acme', roles: ['admin'] }

/** The documentation of every OpenID Connect endpoint (used for the README; the tests compare it with the controllers). */
export const endpoints = ({ port = 4000 } = {}) => [
    {
        method: 'GET',
        path: '/oidc/.well-known/openid-configuration',
        tag: 'oidc',
        summary: 'OpenID Connect discovery: every endpoint and feature of the login server. Clients start here.',
        response: { status: 200, example: DISCOVERY_EXAMPLE(port) },
        errors: []
    },
    {
        method: 'GET',
        path: '/.well-known/oauth-authorization-server/oidc',
        tag: 'oidc',
        summary: 'OAuth 2.0 authorization server metadata (RFC 8414): the same document as the discovery.',
        response: { status: 200, example: DISCOVERY_EXAMPLE(port) },
        errors: []
    },
    {
        method: 'GET',
        path: '/oidc/jwks',
        tag: 'oidc',
        summary: 'The public signing keys (JWKS). Verify ID tokens (RS256) and access tokens (ES256) with them.',
        response: {
            status: 200,
            example: {
                keys: [
                    { kty: 'RSA', kid: 'Xq4…', alg: 'RS256', use: 'sig', n: '…', e: 'AQAB' },
                    { kty: 'EC', kid: 'pL9…', alg: 'ES256', use: 'sig', crv: 'P-256', x: '…', y: '…' }
                ]
            }
        },
        errors: []
    },
    {
        method: 'GET',
        path: '/oidc/authorize',
        tag: 'oidc',
        summary:
            'Start a login (authorization code flow, PKCE S256 required). Redirects (303) to the login page, or straight back to the client when the browser is already logged in.',
        curl: `curl -i 'http://localhost:${port}/oidc/authorize?client_id=frontend&redirect_uri=${encodeURIComponent(FRONTEND_CALLBACK)}&response_type=code&scope=openid%20profile%20email%20tenant&state=xyz&nonce=abc&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'`,
        query: [
            ['client_id', 'required', 'A registered client (config/oidc-clients.json)'],
            ['redirect_uri', 'required', 'Exactly one of the registered redirect URIs'],
            ['response_type', 'required', '`code`'],
            ['scope', 'required', '`openid`, optionally `profile`, `email`, `tenant`'],
            ['code_challenge', 'required', 'BASE64URL(SHA256(code_verifier))'],
            ['code_challenge_method', 'required', '`S256`'],
            ['state', 'recommended', 'Returned unchanged; protects the client against CSRF'],
            ['nonce', 'recommended', 'Copied into the ID token'],
            ['prompt', 'optional', '`none` (no login page), `login` (always ask the password), `select_account`'],
            ['max_age', 'optional', 'Seconds: log in again when the session is older'],
            ['login_hint', 'optional', 'Email address to fill in'],
            ['tenant_hint', 'optional', 'Tenant id or slug to use without asking'],
            ['ui_locales', 'optional', 'Language of the login page, for example `nl`']
        ],
        response: null,
        oauthErrors: [
            'invalid_request',
            'unsupported_response_type',
            'invalid_scope',
            'unauthorized_client',
            'login_required',
            'request_not_supported',
            'request_uri_not_supported'
        ],
        errors: []
    },
    {
        method: 'GET',
        path: '/oidc/interaction/:id',
        tag: 'oidc',
        summary:
            'The login page (HTML, in the language of the browser or ui_locales) of a running login. Valid 10 minutes.',
        response: null,
        errors: []
    },
    {
        method: 'POST',
        path: '/oidc/interaction/:id/login',
        tag: 'oidc',
        summary:
            'The login form (form-encoded). Rate limited per IP and per email. On success: a session cookie and a 303 back to the client with a code.',
        form: true,
        body: {
            example: { csrf: 'from-the-page', email: 'ada@example.com', password: 'a-long-password' },
            fields: [
                ['csrf', 'string', 'required, the hidden field of the page'],
                ['email', 'string', 'required'],
                ['password', 'string', 'required']
            ]
        },
        response: null,
        errors: []
    },
    {
        method: 'POST',
        path: '/oidc/interaction/:id/tenant',
        tag: 'oidc',
        summary: 'The organisation choice (form-encoded), only for users that belong to several tenants.',
        form: true,
        body: {
            example: { csrf: 'from-the-page', tenant: TENANT.id },
            fields: [
                ['csrf', 'string', 'required, the hidden field of the page'],
                ['tenant', 'uuid', 'required, a tenant the user belongs to']
            ]
        },
        response: null,
        errors: []
    },
    {
        method: 'POST',
        path: '/oidc/token',
        tag: 'oidc',
        summary:
            'Exchange the code for tokens. Public clients send client_id and the PKCE code_verifier; confidential clients also authenticate (Basic or client_secret).',
        form: true,
        body: {
            example: {
                grant_type: 'authorization_code',
                code: 'code-from-the-redirect',
                redirect_uri: FRONTEND_CALLBACK,
                client_id: 'frontend',
                code_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
            },
            fields: [
                ['grant_type', 'string', '`authorization_code`'],
                ['code', 'string', 'required, valid 60 seconds and only once'],
                ['redirect_uri', 'string', 'required, the same as in /oidc/authorize'],
                ['client_id', 'string', 'required for public clients'],
                ['code_verifier', 'string', 'required, 43 to 128 characters']
            ]
        },
        response: {
            status: 200,
            example: {
                access_token: 'eyJhbGciOiJFUzI1NiIsInR5cCI6ImF0K2p3dCJ9…',
                token_type: 'Bearer',
                expires_in: 600,
                id_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9…',
                scope: 'openid profile email tenant'
            }
        },
        oauthErrors: [
            'invalid_request',
            'invalid_client',
            'invalid_grant',
            'unauthorized_client',
            'unsupported_grant_type'
        ],
        errors: []
    },
    {
        method: 'GET',
        path: '/oidc/userinfo',
        tag: 'oidc',
        summary: 'Claims about the logged in user, depending on the scopes. Needs the access token as Bearer token.',
        bearer: true,
        response: {
            status: 200,
            example: {
                sub: '1fb82908-476c-4460-951a-0fae1f01fcc6',
                name: 'Ada Lovelace',
                email: 'ada@example.com',
                email_verified: true,
                tenant: TENANT
            }
        },
        oauthErrors: ['invalid_token', 'insufficient_scope'],
        errors: []
    },
    {
        method: 'POST',
        path: '/oidc/userinfo',
        tag: 'oidc',
        summary:
            'The same as GET /oidc/userinfo, for clients that send the access token as access_token in a form body.',
        form: true,
        body: {
            example: { access_token: 'eyJhbGciOiJFUzI1NiIs…' },
            fields: [['access_token', 'string', 'the access token']]
        },
        response: { status: 200, example: { sub: '1fb82908-476c-4460-951a-0fae1f01fcc6', '...': '...' } },
        oauthErrors: ['invalid_token', 'insufficient_scope'],
        errors: []
    }
]
