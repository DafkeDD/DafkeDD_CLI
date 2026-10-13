/**
 * The frontend side of the own OpenID Connect server: the login page of the OIDC server (/login), login through it
 * with PKCE (/api/auth/login, /api/auth/callback, /api/auth/logout), a protected profile page and the session links on
 * the home page. Everything on port 3000; tokens never reach the browser. The files live in templates/frontend-oidc.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

export const TEMPLATE_DIR = fileURLToPath(new URL('../../templates/frontend-oidc/', import.meta.url))

/** Texts (namespace "Oidc"). Every language needs the same keys (checked by the tests). */
export const OIDC_MESSAGES = {
    en: {
        signIn: 'Log in',
        signedInAs: 'Signed in as {name}',
        profile: 'Profile',
        loginTitle: 'Log in',
        loginSubtitle: 'to continue to {client}',
        email: 'Email address',
        password: 'Password',
        submit: 'Log in',
        busy: 'One moment…',
        tenantTitle: 'Choose an organisation',
        tenantSubtitle: 'Your account belongs to several organisations. Which one do you want to use?',
        startText: 'You log in through the login server of this project (OpenID Connect).',
        startAgain: 'Log in again',
        offline: 'The login server cannot be reached. Is the backend running?',
        failed: 'Logging in failed ({error}). Please try again.',
        profileTitle: 'Your profile',
        name: 'Name',
        organisation: 'Organisation',
        roles: 'Roles',
        noRoles: 'none',
        validUntil: 'Session valid until',
        apiCheck: 'The API accepted your access token.',
        apiFailed: 'The API did not accept your access token.',
        logout: 'Log out'
    },
    nl: {
        signIn: 'Inloggen',
        signedInAs: 'Ingelogd als {name}',
        profile: 'Profiel',
        loginTitle: 'Inloggen',
        loginSubtitle: 'om verder te gaan naar {client}',
        email: 'E-mailadres',
        password: 'Wachtwoord',
        submit: 'Inloggen',
        busy: 'Even geduld…',
        tenantTitle: 'Kies een organisatie',
        tenantSubtitle: 'Je account hoort bij meerdere organisaties. Welke wil je gebruiken?',
        startText: 'Je logt in via de loginserver van dit project (OpenID Connect).',
        startAgain: 'Opnieuw inloggen',
        offline: 'De loginserver is niet bereikbaar. Draait de backend?',
        failed: 'Inloggen is mislukt ({error}). Probeer het opnieuw.',
        profileTitle: 'Je profiel',
        name: 'Naam',
        organisation: 'Organisatie',
        roles: 'Rollen',
        noRoles: 'geen',
        validUntil: 'Sessie geldig tot',
        apiCheck: 'De API heeft je access token aanvaard.',
        apiFailed: 'De API heeft je access token niet aanvaard.',
        logout: 'Uitloggen'
    },
    fr: {
        signIn: 'Se connecter',
        signedInAs: 'Connecté en tant que {name}',
        profile: 'Profil',
        loginTitle: 'Se connecter',
        loginSubtitle: 'pour continuer vers {client}',
        email: 'Adresse e-mail',
        password: 'Mot de passe',
        submit: 'Se connecter',
        busy: 'Un instant…',
        tenantTitle: 'Choisissez une organisation',
        tenantSubtitle: 'Votre compte appartient à plusieurs organisations. Laquelle voulez-vous utiliser ?',
        startText: 'Vous vous connectez via le serveur de connexion de ce projet (OpenID Connect).',
        startAgain: 'Se reconnecter',
        offline: 'Le serveur de connexion est injoignable. Le backend est-il démarré ?',
        failed: 'La connexion a échoué ({error}). Veuillez réessayer.',
        profileTitle: 'Votre profil',
        name: 'Nom',
        organisation: 'Organisation',
        roles: 'Rôles',
        noRoles: 'aucun',
        validUntil: "Session valable jusqu'à",
        apiCheck: "L'API a accepté votre jeton d'accès.",
        apiFailed: "L'API n'a pas accepté votre jeton d'accès.",
        logout: 'Se déconnecter'
    },
    de: {
        signIn: 'Anmelden',
        signedInAs: 'Angemeldet als {name}',
        profile: 'Profil',
        loginTitle: 'Anmelden',
        loginSubtitle: 'um mit {client} fortzufahren',
        email: 'E-Mail-Adresse',
        password: 'Passwort',
        submit: 'Anmelden',
        busy: 'Einen Moment…',
        tenantTitle: 'Organisation wählen',
        tenantSubtitle: 'Dein Konto gehört zu mehreren Organisationen. Welche möchtest du verwenden?',
        startText: 'Du meldest dich über den Anmeldeserver dieses Projekts an (OpenID Connect).',
        startAgain: 'Erneut anmelden',
        offline: 'Der Anmeldeserver ist nicht erreichbar. Läuft das Backend?',
        failed: 'Die Anmeldung ist fehlgeschlagen ({error}). Bitte versuche es erneut.',
        profileTitle: 'Dein Profil',
        name: 'Name',
        organisation: 'Organisation',
        roles: 'Rollen',
        noRoles: 'keine',
        validUntil: 'Sitzung gültig bis',
        apiCheck: 'Die API hat dein Zugriffstoken akzeptiert.',
        apiFailed: 'Die API hat dein Zugriffstoken nicht akzeptiert.',
        logout: 'Abmelden'
    }
}

/** All files of templates/frontend-oidc with the placeholders filled in. */
export function oidcFrontendFiles({ apiPort = 4000 } = {}) {
    const result = {}
    for (const entry of readdirSync(TEMPLATE_DIR, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue
        const full = path.join(entry.parentPath ?? entry.path, entry.name)
        const rel = path.relative(TEMPLATE_DIR, full).split(path.sep).join('/')
        result[rel] = readFileSync(full, 'utf8').replaceAll('__API_PORT__', String(apiPort))
    }
    return result
}

/** .env.local of the frontend: where the OIDC server is and the secret that encrypts the session cookie. */
export const envLocal = ({ apiPort = 4000, secret = randomBytes(32).toString('hex') } = {}) =>
    [
        '# Login through the OpenID Connect server of the backend (see README.md, "Login")',
        `OIDC_ISSUER=http://localhost:${apiPort}/oidc`,
        'OIDC_CLIENT_ID=frontend',
        'APP_URL=http://localhost:3000',
        '# Encrypts the session cookie: 64 hex characters, keep it secret, another one in production',
        `AUTH_SECRET=${secret}`,
        ''
    ].join('\n')
