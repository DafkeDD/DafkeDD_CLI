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

/**
 * The roles of the example app (config/app-roles.json): the developer defines them, the login server learns them with
 * the link code (and later with npm run roles:push), and the beheerders give them to their members.
 */
export const DEFAULT_ROLES = [
    {
        key: 'editor',
        names: { en: 'Editor', nl: 'Bewerker', fr: 'Éditeur', de: 'Bearbeiter' },
        default: true
    },
    {
        key: 'viewer',
        names: { en: 'Viewer', nl: 'Lezer', fr: 'Lecteur', de: 'Leser' },
        default: false
    }
]

/** Extra errors of the app backend (namespace "errors"). Every language has the same keys (checked by the tests). */
export const ERRORS = {
    en: {
        NO_ORGANISATION: 'Log in with an organisation to use this',
        NO_LICENSE:
            'You have no licence for {product} in this organisation: buy one on Licences or ask your administrator',
        NOTE_NOT_FOUND: 'This note does not exist (anymore)',
        ROLE_REQUIRED: 'You need one of these roles for this: {roles}. Ask the administrator of your organisation'
    },
    nl: {
        NO_ORGANISATION: 'Log in met een organisatie om dit te gebruiken',
        NO_LICENSE:
            'Je hebt geen licentie voor {product} in deze organisatie: koop er een bij Licenties of vraag het je beheerder',
        NOTE_NOT_FOUND: 'Deze notitie bestaat niet (meer)',
        ROLE_REQUIRED: 'Hiervoor heb je een van deze rollen nodig: {roles}. Vraag het de beheerder van je organisatie'
    },
    fr: {
        NO_ORGANISATION: 'Connectez-vous avec une organisation pour utiliser ceci',
        NO_LICENSE:
            "Vous n'avez pas de licence pour {product} dans cette organisation : achetez-en une sous Licences ou demandez à votre administrateur",
        NOTE_NOT_FOUND: "Cette note n'existe pas (ou plus)",
        ROLE_REQUIRED: "Il vous faut l'un de ces rôles : {roles}. Demandez-le à l'administrateur de votre organisation"
    },
    de: {
        NO_ORGANISATION: 'Melde dich mit einer Organisation an, um dies zu nutzen',
        NO_LICENSE:
            'Du hast keine Lizenz für {product} in dieser Organisation: kaufe eine unter Lizenzen oder frage deinen Administrator',
        NOTE_NOT_FOUND: 'Diese Notiz gibt es nicht (mehr)',
        ROLE_REQUIRED: 'Dafür brauchst du eine dieser Rollen: {roles}. Frage den Administrator deiner Organisation'
    }
}

/** Extra validation messages (namespace "validation"). */
export const VALIDATION = {
    en: { MAX_LENGTH: '{property} must be at most {constraints.0} characters long' },
    nl: { MAX_LENGTH: '{property} mag hoogstens {constraints.0} tekens lang zijn' },
    fr: { MAX_LENGTH: '{property} doit contenir au maximum {constraints.0} caractères' },
    de: { MAX_LENGTH: '{property} darf höchstens {constraints.0} Zeichen lang sein' }
}

export const SCRIPTS = {
    'test:db': 'vitest run --config ./vitest.config.db.ts',
    'roles:push': 'node scripts/roles-push.mjs'
}

/** All files of templates/backend-app, with the placeholders filled in. */
export function appFiles({ database, link }) {
    const values = {
        __TENANT_ROLE__: tenantRole(database),
        __ISSUER__: link.issuer,
        __AUDIENCE__: link.apiUrl,
        __CLIENT_ID__: link.clientId,
        __PRODUCT__: link.product ?? ''
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
    // The roles of the app, defined by its developer (see README, "Roles")
    result['config/app-roles.json'] = JSON.stringify(DEFAULT_ROLES, null, 2) + '\n'
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
        '# The product (licence) this app sells: members need a trial or a seat of it. Empty: a free app',
        `OIDC_PRODUCT=${link.product ?? ''}`,
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
    [403, 'errors.NO_ORGANISATION'],
    [403, 'errors.NO_LICENSE'],
    [403, 'errors.ROLE_REQUIRED']
]

/** The endpoints of the app backend, for the README (the docs test checks them against the controllers). */
export const appEndpoints = () => [
    {
        method: 'GET',
        path: '/me',
        tag: 'me',
        summary:
            'Who is calling, as the access token of the login server says: account id, organisation with role, superadmin, the licence for the product of this app (`null` when it sells none) and the roles in this app (`null` when the login server has none for it). Also without an organisation, a licence or a role.',
        bearer: true,
        response: {
            status: 200,
            example: {
                sub: NOTE.authorId,
                tenant: { id: '0f9e8d7c-6b5a-4493-8271-605f4e3d2c1b', name: 'Praktijk De Linde', role: 'admin' },
                superadmin: false,
                license: { product: 'planner', status: 'trial', endsAt: '2026-11-03T08:00:00.000Z' },
                roles: ['editor']
            }
        },
        errors: [[401, 'errors.UNAUTHORIZED']]
    },
    {
        method: 'GET',
        path: '/notes',
        tag: 'notes',
        summary:
            'The notes of the organisation of the caller, newest first (at most 100). An example of data per tenant. Role `editor` or `viewer`.',
        bearer: true,
        response: { status: 200, example: [NOTE] },
        errors: TOKEN_ERRORS
    },
    {
        method: 'POST',
        path: '/notes',
        tag: 'notes',
        summary: 'Add a note to the organisation of the caller. Role `editor`.',
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
        errors: [...TOKEN_ERRORS.slice(0, 3), [403, 'errors.FORBIDDEN'], [404, 'errors.NOTE_NOT_FOUND']]
    }
]
