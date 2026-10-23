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

/** The template of the files module (src/files): uploads and downloads per organisation. */
export const FILES_TEMPLATE_DIR = fileURLToPath(new URL('../../templates/backend-app-files/', import.meta.url))
/** The mail service is the one of the login server (templates/backend-oidc/src/mail). */
const OIDC_MAIL_DIR = fileURLToPath(new URL('../../templates/backend-oidc/src/mail/', import.meta.url))

/**
 * The choices for the backend of an app (asked by the CLI):
 * - mail: sending email over SMTP (src/mail, Mailpit during development)
 * - files: images and PDFs per organisation (src/files; a folder or Google Cloud Storage)
 * - isolation: rls (one database, Row-Level Security) or database (a database per organisation)
 */
export const DEFAULT_OPTIONS = { mail: false, files: false, isolation: 'rls' }
export const ISOLATIONS = ['rls', 'database']

export const options = (value = {}) => {
    const result = { ...DEFAULT_OPTIONS, ...value }
    if (!ISOLATIONS.includes(result.isolation)) throw new Error(`Unknown isolation ${result.isolation}`)
    return result
}

/** The npm packages of the chosen modules. */
export function packages(choice = DEFAULT_OPTIONS) {
    const { mail, files } = options(choice)
    return {
        dependencies: [...(mail ? ['nodemailer@latest'] : []), ...(files ? ['@google-cloud/storage@latest'] : [])],
        devDependencies: mail ? ['@types/nodemailer@latest'] : []
    }
}

/** The scripts of package.json: the base ones, plus Mailpit with the mail module. */
export const scripts = (choice = DEFAULT_OPTIONS) => ({
    ...SCRIPTS,
    ...(options(choice).mail
        ? { 'mail:dev': 'docker run -d --rm --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit' }
        : {})
})

/** The errors of the files module (namespace "errors"). Every language has the same keys. */
export const FILES_ERRORS = {
    en: {
        FILE_NOT_FOUND: 'This file does not exist (anymore)',
        FILE_EMPTY: 'The file is empty',
        FILE_TOO_LARGE: 'The file is too large (at most {mb} MB)',
        FILE_TYPE_NOT_ALLOWED: 'Only JPEG, PNG, WebP or PDF is allowed'
    },
    nl: {
        FILE_NOT_FOUND: 'Dit bestand bestaat niet (meer)',
        FILE_EMPTY: 'Het bestand is leeg',
        FILE_TOO_LARGE: 'Het bestand is te groot (hoogstens {mb} MB)',
        FILE_TYPE_NOT_ALLOWED: 'Enkel JPEG, PNG, WebP of PDF is toegelaten'
    },
    fr: {
        FILE_NOT_FOUND: "Ce fichier n'existe pas (ou plus)",
        FILE_EMPTY: 'Le fichier est vide',
        FILE_TOO_LARGE: 'Le fichier est trop volumineux ({mb} Mo au maximum)',
        FILE_TYPE_NOT_ALLOWED: 'Seuls les formats JPEG, PNG, WebP ou PDF sont acceptés'
    },
    de: {
        FILE_NOT_FOUND: 'Diese Datei gibt es nicht (mehr)',
        FILE_EMPTY: 'Die Datei ist leer',
        FILE_TOO_LARGE: 'Die Datei ist zu groß (höchstens {mb} MB)',
        FILE_TYPE_NOT_ALLOWED: 'Nur JPEG, PNG, WebP oder PDF ist erlaubt'
    }
}

/** The migration of the files module: the descriptions of the files, per organisation (Row-Level Security). */
const FILES_MIGRATION = `    {
        id: 2,
        name: 'files',
        sql: \`
-- The descriptions of the files of an organisation; the bytes are in the FileStore (FILES_DRIVER)
CREATE TABLE files (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  name text NOT NULL DEFAULT '' CHECK (length(name) <= 200),
  content_type text NOT NULL,
  size integer NOT NULL CHECK (size > 0),
  sha256 text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_tenant ON files (tenant_id, created_at DESC);
\${isolate('files')}
\`
    }
`

const MAIL_MODULE = `import { Global, Module } from '@nestjs/common'
import { MailService } from './mail.service.js'

/** Sending email (SMTP from .env, Mailpit during development). Global: inject MailService anywhere. */
@Global()
@Module({
    providers: [MailService],
    exports: [MailService]
})
export class MailModule {}
`

const readDir = dir => {
    const result = {}
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue
        const full = path.join(entry.parentPath ?? entry.path, entry.name)
        result[path.relative(dir, full).split(path.sep).join('/')] = readFileSync(full, 'utf8')
    }
    return result
}

const replaceOnce = (text, from, to) => {
    if (!text.includes(from)) throw new Error(`Template changed: "${from.slice(0, 60)}" not found`)
    return text.replace(from, () => to)
}

/** All files of templates/backend-app (and the chosen modules), with the placeholders filled in. */
export function appFiles({ database, link, choice = DEFAULT_OPTIONS }) {
    const chosen = options(choice)
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
    if (chosen.files) {
        Object.assign(result, readDir(FILES_TEMPLATE_DIR))
        result['src/database/migrations.ts'] = replaceOnce(
            result['src/database/migrations.ts'],
            "${isolate('notes')}\n`\n    }\n]",
            "${isolate('notes')}\n`\n    },\n" + FILES_MIGRATION + ']'
        )
        result['src/database/database.constants.ts'] = replaceOnce(
            result['src/database/database.constants.ts'],
            "export const TENANT_TABLES = ['notes'] as const",
            "export const TENANT_TABLES = ['notes', 'files'] as const"
        )
    }
    if (chosen.mail) {
        for (const name of ['mail.service.ts', 'mail.service.spec.ts'])
            result['src/mail/' + name] = readFileSync(path.join(OIDC_MAIL_DIR, name), 'utf8')
        result['src/mail/mail.module.ts'] = MAIL_MODULE
    }
    return result
}

/** The .env lines of the chosen modules and of the isolation of the organisations. */
export function optionLines(choice = DEFAULT_OPTIONS, { appName = 'App' } = {}) {
    const chosen = options(choice)
    return [
        '',
        '# How the data of the organisations is kept apart (see README, "Data per organisation"):',
        '# rls: one database with Row-Level Security; database: a PostgreSQL database per organisation (needs CREATEDB)',
        `TENANT_ISOLATION=${chosen.isolation}`,
        ...(chosen.files
            ? [
                  '',
                  '# Files (see README, "Files"). local: a folder on this machine; gcs: a private Google Cloud Storage bucket',
                  'FILES_DRIVER=local',
                  'FILES_DIR=./storage',
                  '# gcs only. The login is the one of the environment (the service account of the server, or',
                  '# gcloud auth application-default login), so no key is kept here',
                  'GCS_BUCKET=',
                  'GCS_PROJECT=',
                  'GCS_PREFIX='
              ]
            : []),
        ...(chosen.mail
            ? [
                  '',
                  '# Email (SMTP). During development Mailpit catches every mail: npm run mail:dev, then open http://localhost:8025.',
                  '# Fill in your own SMTP server for production. Leave SMTP_HOST empty to print the mails in the console instead.',
                  'SMTP_HOST=localhost',
                  'SMTP_PORT=1025',
                  'SMTP_SECURE=false',
                  'SMTP_USER=',
                  'SMTP_PASSWORD=',
                  `MAIL_FROM='${appName.replaceAll("'", '')} <no-reply@example.com>'`
              ]
            : []),
        ''
    ].join('\n')
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

const FILE = {
    id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
    name: 'contract.pdf',
    contentType: 'application/pdf',
    size: 48213,
    sha256: '3f1c…',
    createdBy: NOTE.authorId,
    createdAt: '2026-10-21T09:30:00.000Z'
}

/** The endpoints of the files module (src/files). */
const fileEndpoints = () => [
    {
        method: 'GET',
        path: '/files',
        tag: 'files',
        summary: 'The files of the organisation of the caller, newest first (at most 100). Role `editor` or `viewer`.',
        bearer: true,
        response: { status: 200, example: [FILE] },
        errors: TOKEN_ERRORS
    },
    {
        method: 'GET',
        path: '/files/:id',
        tag: 'files',
        summary:
            'The file itself, with the type read from its bytes, `Content-Disposition` (its name), an `ETag` and `Cache-Control: private, no-cache`; with `If-None-Match` of that ETag: 304 without a body. Role `editor` or `viewer`.',
        bearer: true,
        pathExample: '/files/' + FILE.id,
        curl: `curl -H 'Accept-Language: nl' -H "Authorization: Bearer $ACCESS_TOKEN" -o contract.pdf http://localhost:${APP_PORT}/files/${FILE.id}`,
        response: null,
        errors: [...TOKEN_ERRORS, [404, 'errors.FILE_NOT_FOUND']]
    },
    {
        method: 'PUT',
        path: '/files/:id',
        tag: 'files',
        summary:
            'Save a file: the raw file is the body (`Content-Type` an image type, `application/pdf` or `application/octet-stream`), the id a uuid chosen by the app, so a retry is harmless (the same content again changes nothing, other content under the same id is a 409). Only JPEG, PNG, WebP and PDF, at most 8 MB; the type is read from the bytes. Role `editor`.',
        bearer: true,
        query: [['name', 'optional', 'the name of the file, at most 200 characters (for downloads)']],
        curl: `curl -X PUT -H 'Accept-Language: nl' -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/pdf' --data-binary @contract.pdf 'http://localhost:${APP_PORT}/files/${FILE.id}?name=contract.pdf'`,
        response: { status: 200, example: FILE },
        errors: [
            [400, 'errors.BAD_REQUEST'],
            [400, 'errors.FILE_EMPTY'],
            ...TOKEN_ERRORS,
            [409, 'errors.CONFLICT'],
            [413, 'errors.FILE_TOO_LARGE'],
            [415, 'errors.FILE_TYPE_NOT_ALLOWED']
        ]
    },
    {
        method: 'DELETE',
        path: '/files/:id',
        tag: 'files',
        summary: 'Remove a file (its description and its bytes). Role `editor`. Answers 204 without a body.',
        bearer: true,
        pathExample: '/files/' + FILE.id,
        response: null,
        errors: [...TOKEN_ERRORS, [404, 'errors.FILE_NOT_FOUND']]
    }
]

const baseEndpoints = () => [
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

/** The endpoints of the app backend, for the README (the docs test checks them against the controllers). */
export const appEndpoints = (choice = DEFAULT_OPTIONS) => [
    ...baseEndpoints(),
    ...(options(choice).files ? fileEndpoints() : [])
]
