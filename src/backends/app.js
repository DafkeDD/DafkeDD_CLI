import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The backend of an app that is linked to a DafkeDD login server (Pasport): NestJS with its own PostgreSQL database
 * (on the same server, another database), multi-tenant with Row-Level Security. It has no users or organisations of
 * its own: it accepts the access tokens of the login server and takes the organisation from their tenant claim.
 * The TypeScript files live in templates/backend-app.
 */
export const TEMPLATE_DIR = fileURLToPath(new URL('../../templates/backend-app/', import.meta.url))

/** The API of the app (the login server itself uses 4000). */
export const APP_PORT = 4001

/** The role of DatabaseService.withTenant(): roles are shared by the databases of a server, so it is prefixed. */
export const tenantRole = database => `${database}_tenant`

/** Extra errors of the app backend (namespace "errors"). Every language has the same keys (checked by the tests). */
export const ERRORS = {
    en: {
        NO_ORGANISATION: 'Log in with an organisation to use this',
        NOTE_NOT_FOUND: 'This note does not exist (anymore)'
    },
    nl: {
        NO_ORGANISATION: 'Log in met een organisatie om dit te gebruiken',
        NOTE_NOT_FOUND: 'Deze notitie bestaat niet (meer)'
    },
    fr: {
        NO_ORGANISATION: 'Connectez-vous avec une organisation pour utiliser ceci',
        NOTE_NOT_FOUND: "Cette note n'existe pas (ou plus)"
    },
    de: {
        NO_ORGANISATION: 'Melde dich mit einer Organisation an, um dies zu nutzen',
        NOTE_NOT_FOUND: 'Diese Notiz gibt es nicht (mehr)'
    }
}

/** Extra validation messages (namespace "validation"). */
export const VALIDATION = {
    en: { MAX_LENGTH: '{property} must be at most {constraints.0} characters long' },
    nl: { MAX_LENGTH: '{property} mag hoogstens {constraints.0} tekens lang zijn' },
    fr: { MAX_LENGTH: '{property} doit contenir au maximum {constraints.0} caractères' },
    de: { MAX_LENGTH: '{property} darf höchstens {constraints.0} Zeichen lang sein' }
}

export const SCRIPTS = { 'test:db': 'vitest run --config ./vitest.config.db.ts' }

/** All files of templates/backend-app, with the placeholders filled in. */
export function appFiles({ database, link }) {
    const values = {
        __TENANT_ROLE__: tenantRole(database),
        __ISSUER__: link.issuer,
        __AUDIENCE__: link.apiUrl,
        __CLIENT_ID__: link.clientId
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

/** The .env lines of the login server whose tokens this API accepts. */
export const envLines = link =>
    [
        '',
        '# The login server (Pasport): this API accepts its access tokens (see README.md, "Login through the login server")',
        `OIDC_ISSUER=${link.issuer}`,
        '# The aud of its access tokens: the API of the login server',
        `OIDC_AUDIENCE=${link.apiUrl}`,
        '# The apps whose tokens are accepted (comma separated): the frontend of this app',
        `OIDC_CLIENT_IDS=${link.clientId}`,
        ''
    ].join('\n')

const NOTE = {
    id: '6f1c2b0e-3d4a-4f5b-9c8d-7e6f5a4b3c2d',
    authorId: '1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9',
    text: 'Morgen om 9u teamoverleg',
    createdAt: '2026-10-20T08:00:00.000Z'
}
const TOKEN_ERRORS = [
    [401, 'errors.UNAUTHORIZED'],
    [403, 'errors.NO_ORGANISATION']
]

/** The endpoints of the app backend, for the README (the docs test checks them against the controllers). */
export const appEndpoints = () => [
    {
        method: 'GET',
        path: '/me',
        tag: 'me',
        summary:
            'Who is calling, as the access token of the login server says: account id, organisation with role, superadmin. Also without an organisation.',
        bearer: true,
        response: {
            status: 200,
            example: {
                sub: NOTE.authorId,
                tenant: { id: '0f9e8d7c-6b5a-4493-8271-605f4e3d2c1b', name: 'Praktijk De Linde', role: 'admin' },
                superadmin: false
            }
        },
        errors: [[401, 'errors.UNAUTHORIZED']]
    },
    {
        method: 'GET',
        path: '/notes',
        tag: 'notes',
        summary:
            'The notes of the organisation of the caller, newest first (at most 100). An example of data per tenant.',
        bearer: true,
        response: { status: 200, example: [NOTE] },
        errors: TOKEN_ERRORS
    },
    {
        method: 'POST',
        path: '/notes',
        tag: 'notes',
        summary: 'Add a note to the organisation of the caller.',
        bearer: true,
        body: { example: { text: NOTE.text }, fields: [['text', 'string', 'required, at most 2000 characters']] },
        response: { status: 201, example: NOTE },
        errors: [[400, 'errors.BAD_REQUEST'], ...TOKEN_ERRORS]
    },
    {
        method: 'DELETE',
        path: '/notes/:id',
        tag: 'notes',
        summary: 'Remove a note. Only the beheerder (admin) of the organisation. Answers 204 without a body.',
        bearer: true,
        pathExample: '/notes/' + NOTE.id,
        response: null,
        errors: [...TOKEN_ERRORS, [403, 'errors.FORBIDDEN'], [404, 'errors.NOTE_NOT_FOUND']]
    }
]
