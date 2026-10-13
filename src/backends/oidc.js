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
export const APP_URL = 'http://localhost:3000'
export const SESSION_COOKIE = 'oidc_session'

export const PACKAGES = {
    dependencies: ['cookie-parser@latest', 'nodemailer@latest', 'qrcode@latest'],
    devDependencies: ['@types/cookie-parser@latest', '@types/nodemailer@latest', '@types/qrcode@latest']
}

/** Mailpit catches every mail during development: SMTP on port 1025, the mailbox on http://localhost:8025. */
export const MAILPIT_URL = 'http://localhost:8025'

export const SCRIPTS = {
    'test:db': 'vitest run --config ./vitest.config.db.ts',
    'oidc:user': 'node scripts/oidc-user.mjs',
    'mail:dev': 'docker run -d --rm --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit'
}

/** Extra validation messages (namespace "validation") used by the account and admin endpoints. */
export const VALIDATION = {
    en: { IS_IN: '{property} must be one of: {constraints.0}' },
    nl: { IS_IN: '{property} moet een van deze waarden zijn: {constraints.0}' },
    fr: { IS_IN: "{property} doit être l'une de ces valeurs : {constraints.0}" },
    de: { IS_IN: '{property} muss einer dieser Werte sein: {constraints.0}' }
}

/** Texts of the account emails (namespace "mail"). Every language needs the same keys (checked by the tests). */
export const MAIL_MESSAGES = {
    en: {
        GREETING: 'Hello {name},',
        SIGNATURE: '{app}',
        VERIFY_SUBJECT: 'Confirm your email address for {app}',
        VERIFY_TEXT: 'Thank you for creating an account. Confirm your email address to be able to log in.',
        VERIFY_BUTTON: 'Confirm email address',
        VERIFY_NOTE: 'The link works for 24 hours. Did you not create an account? Then you can ignore this email.',
        EXISTS_SUBJECT: 'You already have an account at {app}',
        EXISTS_TEXT:
            'Someone tried to create a new account with your email address. You already have one: just log in. Forgot your password? Choose a new one with the link below.',
        EXISTS_BUTTON: 'Choose a new password',
        EXISTS_NOTE: 'Was this not you? Then you can ignore this email: nothing changed.',
        RESET_SUBJECT: 'Choose a new password for {app}',
        RESET_TEXT: 'You asked to choose a new password. Open the link to do so.',
        RESET_BUTTON: 'Choose a new password',
        RESET_NOTE:
            'The link works for 1 hour and only once. Did you not ask for this? Then ignore this email: your password stays the same.',
        INVITE_SUBJECT: '{inviter} invites you to {tenant}',
        INVITE_TEXT: '{inviter} invites you to join {tenant} on {app} as {role}.',
        INVITE_BUTTON: 'Accept the invitation',
        INVITE_NOTE: 'The invitation is valid for 7 days. Not expecting this? Then you can ignore this email.',
        ROLE_user: 'user',
        ROLE_admin: 'admin'
    },
    nl: {
        GREETING: 'Hallo {name},',
        SIGNATURE: '{app}',
        VERIFY_SUBJECT: 'Bevestig je e-mailadres voor {app}',
        VERIFY_TEXT: 'Bedankt voor het aanmaken van een account. Bevestig je e-mailadres om te kunnen inloggen.',
        VERIFY_BUTTON: 'E-mailadres bevestigen',
        VERIFY_NOTE: 'De link werkt 24 uur. Heb je geen account aangemaakt? Dan mag je deze e-mail negeren.',
        EXISTS_SUBJECT: 'Je hebt al een account bij {app}',
        EXISTS_TEXT:
            'Iemand probeerde een nieuw account aan te maken met jouw e-mailadres. Je hebt er al een: log gewoon in. Wachtwoord vergeten? Kies een nieuw met de link hieronder.',
        EXISTS_BUTTON: 'Nieuw wachtwoord kiezen',
        EXISTS_NOTE: 'Was jij dit niet? Dan mag je deze e-mail negeren: er is niets veranderd.',
        RESET_SUBJECT: 'Kies een nieuw wachtwoord voor {app}',
        RESET_TEXT: 'Je vroeg om een nieuw wachtwoord te kiezen. Open de link om dat te doen.',
        RESET_BUTTON: 'Nieuw wachtwoord kiezen',
        RESET_NOTE:
            'De link werkt 1 uur en maar één keer. Heb je dit niet gevraagd? Negeer dan deze e-mail: je wachtwoord blijft hetzelfde.',
        INVITE_SUBJECT: '{inviter} nodigt je uit voor {tenant}',
        INVITE_TEXT: '{inviter} nodigt je uit om lid te worden van {tenant} op {app} als {role}.',
        INVITE_BUTTON: 'Uitnodiging aanvaarden',
        INVITE_NOTE: 'De uitnodiging is 7 dagen geldig. Verwachtte je dit niet? Dan mag je deze e-mail negeren.',
        ROLE_user: 'gebruiker',
        ROLE_admin: 'beheerder'
    },
    fr: {
        GREETING: 'Bonjour {name},',
        SIGNATURE: '{app}',
        VERIFY_SUBJECT: 'Confirmez votre adresse e-mail pour {app}',
        VERIFY_TEXT: "Merci d'avoir créé un compte. Confirmez votre adresse e-mail pour pouvoir vous connecter.",
        VERIFY_BUTTON: "Confirmer l'adresse e-mail",
        VERIFY_NOTE:
            "Le lien fonctionne pendant 24 heures. Vous n'avez pas créé de compte ? Ignorez simplement cet e-mail.",
        EXISTS_SUBJECT: 'Vous avez déjà un compte sur {app}',
        EXISTS_TEXT:
            "Quelqu'un a essayé de créer un nouveau compte avec votre adresse e-mail. Vous en avez déjà un : connectez-vous simplement. Mot de passe oublié ? Choisissez-en un nouveau avec le lien ci-dessous.",
        EXISTS_BUTTON: 'Choisir un nouveau mot de passe',
        EXISTS_NOTE: "Ce n'était pas vous ? Ignorez cet e-mail : rien n'a changé.",
        RESET_SUBJECT: 'Choisissez un nouveau mot de passe pour {app}',
        RESET_TEXT: 'Vous avez demandé à choisir un nouveau mot de passe. Ouvrez le lien pour le faire.',
        RESET_BUTTON: 'Choisir un nouveau mot de passe',
        RESET_NOTE:
            "Le lien fonctionne pendant 1 heure et une seule fois. Vous n'avez rien demandé ? Ignorez cet e-mail : votre mot de passe reste le même.",
        INVITE_SUBJECT: '{inviter} vous invite à rejoindre {tenant}',
        INVITE_TEXT: '{inviter} vous invite à rejoindre {tenant} sur {app} en tant que {role}.',
        INVITE_BUTTON: "Accepter l'invitation",
        INVITE_NOTE: "L'invitation est valable 7 jours. Vous ne l'attendiez pas ? Ignorez simplement cet e-mail.",
        ROLE_user: 'utilisateur',
        ROLE_admin: 'administrateur'
    },
    de: {
        GREETING: 'Hallo {name},',
        SIGNATURE: '{app}',
        VERIFY_SUBJECT: 'Bestätige deine E-Mail-Adresse für {app}',
        VERIFY_TEXT:
            'Danke, dass du ein Konto erstellt hast. Bestätige deine E-Mail-Adresse, um dich anmelden zu können.',
        VERIFY_BUTTON: 'E-Mail-Adresse bestätigen',
        VERIFY_NOTE:
            'Der Link funktioniert 24 Stunden. Du hast kein Konto erstellt? Dann ignoriere diese E-Mail einfach.',
        EXISTS_SUBJECT: 'Du hast bereits ein Konto bei {app}',
        EXISTS_TEXT:
            'Jemand hat versucht, mit deiner E-Mail-Adresse ein neues Konto zu erstellen. Du hast schon eins: Melde dich einfach an. Passwort vergessen? Wähle mit dem Link unten ein neues.',
        EXISTS_BUTTON: 'Neues Passwort wählen',
        EXISTS_NOTE: 'Das warst nicht du? Dann ignoriere diese E-Mail: Es hat sich nichts geändert.',
        RESET_SUBJECT: 'Wähle ein neues Passwort für {app}',
        RESET_TEXT: 'Du hast darum gebeten, ein neues Passwort zu wählen. Öffne den Link, um das zu tun.',
        RESET_BUTTON: 'Neues Passwort wählen',
        RESET_NOTE:
            'Der Link funktioniert 1 Stunde und nur einmal. Du hast nichts angefordert? Dann ignoriere diese E-Mail: Dein Passwort bleibt gleich.',
        INVITE_SUBJECT: '{inviter} lädt dich zu {tenant} ein',
        INVITE_TEXT: '{inviter} lädt dich ein, {tenant} auf {app} als {role} beizutreten.',
        INVITE_BUTTON: 'Einladung annehmen',
        INVITE_NOTE:
            'Die Einladung ist 7 Tage gültig. Du hast sie nicht erwartet? Dann ignoriere diese E-Mail einfach.',
        ROLE_user: 'Benutzer',
        ROLE_admin: 'Administrator'
    }
}

/** Texts of the login pages (namespace "oidc"). Every language needs the same keys (checked by the tests). */
export const MESSAGES = {
    en: {
        MFA_SETUP_TITLE: 'Set up two-step verification',
        MFA_SETUP_TEXT:
            'Two-step verification is required. Scan this QR code with an authenticator app (for example Google Authenticator, Microsoft Authenticator or 1Password) and enter the 6-digit code it shows.',
        MFA_QR: 'QR code for the authenticator app',
        MFA_SECRET: 'Cannot scan? Type in this key:',
        RECOVERY_TITLE: 'Save your recovery codes',
        RECOVERY_TEXT:
            'Each code logs you in once when you do not have your phone. Keep them somewhere safe: they are shown only now.',
        CONTINUE: 'I saved them, continue',
        MFA_REQUIRED: 'Two-step verification is required and cannot be turned off.',
        MFA_TITLE: 'Two-step verification',
        MFA_TEXT: 'Enter the 6-digit code of your authenticator app, or one of your recovery codes.',
        MFA_CODE: 'Code',
        MFA_SUBMIT: 'Verify',
        MFA_INVALID_CODE: 'This code is not correct or was already used. Try the next code.',
        MFA_ALREADY_ENABLED: 'Two-step verification is already on.',
        MFA_SETUP_FIRST: 'Start setting up two-step verification first.',
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
        INVALID_REDIRECT: 'The application asked to return to an address that is not registered.',
        EMAIL_NOT_VERIFIED: 'Confirm your email address first: open the link in the email we sent you.',
        REGISTRATION_CLOSED: 'Creating an account is not possible here. Ask an administrator for an invitation.',
        INVALID_LINK: 'This link is invalid or has expired. Ask for a new one.',
        ALREADY_MEMBER: 'This person is already a member of the organisation.',
        MEMBER_NOT_FOUND: 'This member was not found in the organisation.',
        LAST_ADMIN: 'An organisation needs at least one admin. Make someone else admin first.',
        LAST_SUPERADMIN: 'The platform needs at least one superadmin.',
        TENANT_NOT_FOUND: 'This organisation was not found.',
        USER_NOT_FOUND: 'No account was found with this email address.',
        ACCOUNT_DETAILS_NEEDED: 'Fill in your name and a password to create your account.'
    },
    nl: {
        MFA_SETUP_TITLE: 'Tweestapsverificatie instellen',
        MFA_SETUP_TEXT:
            'Tweestapsverificatie is verplicht. Scan deze QR-code met een authenticator-app (bijvoorbeeld Google Authenticator, Microsoft Authenticator of 1Password) en geef de code van 6 cijfers die de app toont.',
        MFA_QR: 'QR-code voor de authenticator-app',
        MFA_SECRET: 'Lukt scannen niet? Typ deze sleutel over:',
        RECOVERY_TITLE: 'Bewaar je herstelcodes',
        RECOVERY_TEXT:
            'Met elke code kun je één keer inloggen als je je telefoon niet bij de hand hebt. Bewaar ze op een veilige plek: ze worden alleen nu getoond.',
        CONTINUE: 'Bewaard, verder',
        MFA_REQUIRED: 'Tweestapsverificatie is verplicht en kan niet uitgezet worden.',
        MFA_TITLE: 'Tweestapsverificatie',
        MFA_TEXT: 'Geef de code van 6 cijfers uit je authenticator-app, of een van je herstelcodes.',
        MFA_CODE: 'Code',
        MFA_SUBMIT: 'Bevestigen',
        MFA_INVALID_CODE: 'Deze code klopt niet of werd al gebruikt. Probeer de volgende code.',
        MFA_ALREADY_ENABLED: 'Tweestapsverificatie staat al aan.',
        MFA_SETUP_FIRST: 'Begin eerst met het instellen van tweestapsverificatie.',
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
        INVALID_REDIRECT: 'De toepassing vroeg om terug te keren naar een adres dat niet geregistreerd is.',
        EMAIL_NOT_VERIFIED: 'Bevestig eerst je e-mailadres: open de link in de e-mail die we je stuurden.',
        REGISTRATION_CLOSED: 'Een account aanmaken kan hier niet. Vraag een beheerder om een uitnodiging.',
        INVALID_LINK: 'Deze link is ongeldig of verlopen. Vraag een nieuwe aan.',
        ALREADY_MEMBER: 'Deze persoon is al lid van de organisatie.',
        MEMBER_NOT_FOUND: 'Dit lid werd niet gevonden in de organisatie.',
        LAST_ADMIN: 'Een organisatie heeft minstens één beheerder nodig. Maak eerst iemand anders beheerder.',
        LAST_SUPERADMIN: 'Het platform heeft minstens één superadmin nodig.',
        TENANT_NOT_FOUND: 'Deze organisatie werd niet gevonden.',
        USER_NOT_FOUND: 'Er is geen account met dit e-mailadres.',
        ACCOUNT_DETAILS_NEEDED: 'Vul je naam en een wachtwoord in om je account aan te maken.'
    },
    fr: {
        MFA_SETUP_TITLE: 'Configurer la vérification en deux étapes',
        MFA_SETUP_TEXT:
            "La vérification en deux étapes est obligatoire. Scannez ce code QR avec une application d'authentification (par exemple Google Authenticator, Microsoft Authenticator ou 1Password) et saisissez le code à 6 chiffres affiché.",
        MFA_QR: "Code QR pour l'application d'authentification",
        MFA_SECRET: 'Impossible de scanner ? Saisissez cette clé :',
        RECOVERY_TITLE: 'Conservez vos codes de récupération',
        RECOVERY_TEXT:
            "Chaque code vous connecte une fois lorsque vous n'avez pas votre téléphone. Gardez-les en lieu sûr : ils ne sont affichés que maintenant.",
        CONTINUE: 'Je les ai conservés, continuer',
        MFA_REQUIRED: 'La vérification en deux étapes est obligatoire et ne peut pas être désactivée.',
        MFA_TITLE: 'Vérification en deux étapes',
        MFA_TEXT:
            "Saisissez le code à 6 chiffres de votre application d'authentification, ou l'un de vos codes de récupération.",
        MFA_CODE: 'Code',
        MFA_SUBMIT: 'Vérifier',
        MFA_INVALID_CODE: "Ce code n'est pas correct ou a déjà été utilisé. Essayez le code suivant.",
        MFA_ALREADY_ENABLED: 'La vérification en deux étapes est déjà activée.',
        MFA_SETUP_FIRST: "Commencez d'abord la configuration de la vérification en deux étapes.",
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
        INVALID_REDIRECT: "L'application demande à revenir vers une adresse qui n'est pas enregistrée.",
        EMAIL_NOT_VERIFIED:
            "Confirmez d'abord votre adresse e-mail : ouvrez le lien de l'e-mail que nous vous avons envoyé.",
        REGISTRATION_CLOSED:
            "Il n'est pas possible de créer un compte ici. Demandez une invitation à un administrateur.",
        INVALID_LINK: 'Ce lien est invalide ou a expiré. Demandez-en un nouveau.',
        ALREADY_MEMBER: "Cette personne est déjà membre de l'organisation.",
        MEMBER_NOT_FOUND: "Ce membre est introuvable dans l'organisation.",
        LAST_ADMIN:
            "Une organisation a besoin d'au moins un administrateur. Nommez d'abord quelqu'un d'autre administrateur.",
        LAST_SUPERADMIN: "La plateforme a besoin d'au moins un superadmin.",
        TENANT_NOT_FOUND: 'Cette organisation est introuvable.',
        USER_NOT_FOUND: "Aucun compte n'existe avec cette adresse e-mail.",
        ACCOUNT_DETAILS_NEEDED: 'Indiquez votre nom et un mot de passe pour créer votre compte.'
    },
    de: {
        MFA_SETUP_TITLE: 'Zwei-Schritt-Verifizierung einrichten',
        MFA_SETUP_TEXT:
            'Die Zwei-Schritt-Verifizierung ist Pflicht. Scanne diesen QR-Code mit einer Authenticator-App (zum Beispiel Google Authenticator, Microsoft Authenticator oder 1Password) und gib den 6-stelligen Code ein, den sie anzeigt.',
        MFA_QR: 'QR-Code für die Authenticator-App',
        MFA_SECRET: 'Scannen klappt nicht? Gib diesen Schlüssel ein:',
        RECOVERY_TITLE: 'Bewahre deine Wiederherstellungscodes auf',
        RECOVERY_TEXT:
            'Mit jedem Code kannst du dich einmal anmelden, wenn du dein Telefon nicht dabei hast. Bewahre sie sicher auf: Sie werden nur jetzt angezeigt.',
        CONTINUE: 'Gespeichert, weiter',
        MFA_REQUIRED: 'Die Zwei-Schritt-Verifizierung ist Pflicht und kann nicht ausgeschaltet werden.',
        MFA_TITLE: 'Zwei-Schritt-Verifizierung',
        MFA_TEXT: 'Gib den 6-stelligen Code deiner Authenticator-App oder einen deiner Wiederherstellungscodes ein.',
        MFA_CODE: 'Code',
        MFA_SUBMIT: 'Bestätigen',
        MFA_INVALID_CODE: 'Dieser Code ist nicht korrekt oder wurde schon verwendet. Versuche den nächsten Code.',
        MFA_ALREADY_ENABLED: 'Die Zwei-Schritt-Verifizierung ist bereits aktiv.',
        MFA_SETUP_FIRST: 'Beginne zuerst mit der Einrichtung der Zwei-Schritt-Verifizierung.',
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
        INVALID_REDIRECT: 'Die Anwendung möchte zu einer Adresse zurückkehren, die nicht registriert ist.',
        EMAIL_NOT_VERIFIED:
            'Bestätige zuerst deine E-Mail-Adresse: Öffne den Link in der E-Mail, die wir dir geschickt haben.',
        REGISTRATION_CLOSED: 'Hier kann kein Konto erstellt werden. Bitte einen Administrator um eine Einladung.',
        INVALID_LINK: 'Dieser Link ist ungültig oder abgelaufen. Fordere einen neuen an.',
        ALREADY_MEMBER: 'Diese Person ist bereits Mitglied der Organisation.',
        MEMBER_NOT_FOUND: 'Dieses Mitglied wurde in der Organisation nicht gefunden.',
        LAST_ADMIN:
            'Eine Organisation braucht mindestens einen Administrator. Mache zuerst jemand anderen zum Administrator.',
        LAST_SUPERADMIN: 'Die Plattform braucht mindestens einen Superadmin.',
        TENANT_NOT_FOUND: 'Diese Organisation wurde nicht gefunden.',
        USER_NOT_FOUND: 'Es gibt kein Konto mit dieser E-Mail-Adresse.',
        ACCOUNT_DETAILS_NEEDED: 'Gib deinen Namen und ein Passwort ein, um dein Konto zu erstellen.'
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
        __OIDC_MESSAGES__: JSON.stringify(MESSAGES),
        __MAIL_MESSAGES__: JSON.stringify(MAIL_MESSAGES)
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
            message: 'E-mailadres van de eerste beheerder (superadmin, beheert alle organisaties):',
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
        loginUi: hasFrontend,
        // The name of the application in emails
        appName: basename(projectDir)
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
        '# Two-step verification (authenticator app): required for every account (set up at the first login).',
        '# Only for tests or demos: optional',
        'OIDC_MFA=required',
        '# open: anyone can create an account (with a new organisation); closed: only by invitation',
        'OIDC_REGISTRATION=open',
        '',
        '# Accounts: links in emails go to the pages of the frontend (/verify-email, /reset-password, /invite)',
        `APP_URL=${APP_URL}`,
        '# The name of the application in emails',
        `APP_NAME=${quote(oidc.appName ?? 'App')}`,
        '',
        '# Email (SMTP). During development Mailpit catches every mail: npm run mail:dev, then open http://localhost:8025.',
        '# Fill in your own SMTP server for production. Leave SMTP_HOST empty to print the mails in the console instead.',
        'SMTP_HOST=localhost',
        'SMTP_PORT=1025',
        '# true for port 465 (TLS from the start); false for 587 and 25 (STARTTLS when the server offers it) and Mailpit',
        'SMTP_SECURE=false',
        'SMTP_USER=',
        'SMTP_PASSWORD=',
        `MAIL_FROM=${quote(`${oidc.appName ?? 'App'} <no-reply@example.com>`)}`,
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

const TENANT = { id: '6b1d7c4e-0f1a-4c55-9e1e-2b9c1f3d8a10', name: 'Acme', role: 'admin' }
const USER_ID = '1fb82908-476c-4460-951a-0fae1f01fcc6'
const TOKEN = 'v1.Qm9u…'
const BAD_REQUEST = [400, 'errors.BAD_REQUEST']
const INVALID_LINK = [400, 'oidc.INVALID_LINK']
const TOO_MANY = [429, 'oidc.TOO_MANY_ATTEMPTS']
const ACCESS = level => [
    [401, 'errors.UNAUTHORIZED'],
    [403, 'errors.FORBIDDEN', `not ${level}`]
]
const PASSWORD_RULE = 'required, 12 to 128 characters'
const CHECK_EMAIL = { status: 202, example: { status: 'check-email' } }

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
        path: '/oidc/interaction/:id/mfa',
        tag: 'oidc',
        summary:
            'The second factor (form-encoded, or JSON from the frontend) after the right password, when two-step verification is on: a code of the authenticator app or a recovery code. Each code works once; rate limited.',
        form: true,
        body: {
            example: { csrf: 'from-the-page', code: '492039' },
            fields: [
                ['csrf', 'string', 'required, the hidden field of the page'],
                ['code', 'string', 'required, 6 digits, or a recovery code like `k7qm-2xpd`']
            ]
        },
        response: null,
        errors: []
    },
    {
        method: 'POST',
        path: '/oidc/interaction/:id/continue',
        tag: 'oidc',
        summary:
            'After setting up two-step verification during the login and showing the recovery codes: continue to the organisation choice or back to the client.',
        form: true,
        body: {
            example: { csrf: 'from-the-page' },
            fields: [['csrf', 'string', 'required, the hidden field of the page']]
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
    },
    // ---------------------------------------------------------------- accounts (JSON, for the pages of the frontend)
    {
        method: 'POST',
        path: '/oidc/account/register',
        tag: 'account',
        summary:
            'Create an account and a new organisation; the account becomes its admin and gets a verification email (link valid 24 hours). Always answers the same, also when the address has an account (its owner gets an email instead). Rate limited.',
        body: {
            example: {
                name: 'Ada Lovelace',
                email: 'ada@example.com',
                password: 'correct-horse-battery',
                organisation: 'Acme'
            },
            fields: [
                ['name', 'string', 'required, 2 to 100 characters'],
                ['email', 'string', 'required, a valid email address (at most 254), stored in lower case'],
                ['password', 'string', PASSWORD_RULE],
                ['organisation', 'string', 'required, 2 to 100 characters: the name of the new tenant']
            ]
        },
        response: CHECK_EMAIL,
        errors: [BAD_REQUEST, [403, 'oidc.REGISTRATION_CLOSED'], TOO_MANY]
    },
    {
        method: 'POST',
        path: '/oidc/account/verify-email',
        tag: 'account',
        summary:
            'Confirm the email address with the token of the link in the verification email. Then the account can log in.',
        body: { example: { token: TOKEN }, fields: [['token', 'string', 'required, from the link']] },
        response: { status: 200, example: { status: 'verified', email: 'ada@example.com' } },
        errors: [BAD_REQUEST, INVALID_LINK]
    },
    {
        method: 'POST',
        path: '/oidc/account/resend-verification',
        tag: 'account',
        summary:
            'Send the verification email again (only to an account that is not verified; always answers the same).',
        body: {
            example: { email: 'ada@example.com' },
            fields: [['email', 'string', 'required, a valid email address']]
        },
        response: CHECK_EMAIL,
        errors: [BAD_REQUEST, TOO_MANY]
    },
    {
        method: 'POST',
        path: '/oidc/account/forgot-password',
        tag: 'account',
        summary: 'Send a link to choose a new password (valid 1 hour, works once). Always answers the same.',
        body: {
            example: { email: 'ada@example.com' },
            fields: [['email', 'string', 'required, a valid email address']]
        },
        response: CHECK_EMAIL,
        errors: [BAD_REQUEST, TOO_MANY]
    },
    {
        method: 'POST',
        path: '/oidc/account/reset-password',
        tag: 'account',
        summary:
            'Choose a new password with the token of the link. Every session of the account ends (log in again everywhere); the email address counts as verified.',
        body: {
            example: { token: TOKEN, password: 'a-new-long-password' },
            fields: [
                ['token', 'string', 'required, from the link'],
                ['password', 'string', PASSWORD_RULE]
            ]
        },
        response: { status: 200, example: { status: 'password-changed' } },
        errors: [BAD_REQUEST, INVALID_LINK]
    },
    {
        method: 'GET',
        path: '/oidc/account/invitation',
        tag: 'account',
        summary: 'The details of an invitation, for the page that accepts it.',
        curl: `curl 'http://localhost:${port}/oidc/account/invitation?token=TOKEN'`,
        query: [['token', 'required', 'The token from the link in the invitation email']],
        response: {
            status: 200,
            example: {
                email: 'bob@example.com',
                tenantName: 'Acme',
                role: 'user',
                inviterName: 'Ada Lovelace',
                accountExists: false
            }
        },
        errors: [INVALID_LINK]
    },
    {
        method: 'POST',
        path: '/oidc/account/invitation/accept',
        tag: 'account',
        summary:
            'Accept an invitation. An existing account joins the organisation; otherwise name and password create a (verified) account. The inviter must still be admin and the tenant active.',
        body: {
            example: { token: TOKEN, name: 'Bob', password: 'correct-horse-battery' },
            fields: [
                ['token', 'string', 'required, from the link'],
                ['name', 'string', 'only for a new account, 2 to 100 characters'],
                ['password', 'string', 'only for a new account, 12 to 128 characters']
            ]
        },
        response: { status: 200, example: { status: 'accepted', tenantName: 'Acme', accountExists: false } },
        errors: [BAD_REQUEST, INVALID_LINK, [400, 'oidc.ACCOUNT_DETAILS_NEEDED']]
    },
    // ---------------------------------------------------------------- members of the own tenant (admins)
    {
        method: 'GET',
        path: '/tenants/current/members',
        tag: 'tenant members',
        summary:
            'The members of the tenant of the access token, with their role. For admins of that tenant (and superadmins).',
        bearer: true,
        response: {
            status: 200,
            example: [
                { userId: USER_ID, name: 'Ada Lovelace', email: 'ada@example.com', emailVerified: true, role: 'admin' }
            ]
        },
        errors: ACCESS('admin')
    },
    {
        method: 'POST',
        path: '/tenants/current/invitations',
        tag: 'tenant members',
        summary: 'Invite someone by email as user or admin of the tenant (the link is valid 7 days).',
        bearer: true,
        body: {
            example: { email: 'bob@example.com', role: 'user' },
            fields: [
                ['email', 'string', 'required, a valid email address'],
                ['role', 'string', '`user` or `admin`']
            ]
        },
        response: { status: 202, example: { status: 'invited', email: 'bob@example.com' } },
        errors: [BAD_REQUEST, ...ACCESS('admin'), [409, 'oidc.ALREADY_MEMBER']]
    },
    {
        method: 'PATCH',
        path: '/tenants/current/members/:userId',
        tag: 'tenant members',
        summary: 'Change the role of a member. The tenant always keeps at least one admin.',
        bearer: true,
        pathExample: `/tenants/current/members/${USER_ID}`,
        body: { example: { role: 'admin' }, fields: [['role', 'string', '`user` or `admin`']] },
        response: { status: 200, example: { userId: USER_ID, role: 'admin' } },
        errors: [BAD_REQUEST, ...ACCESS('admin'), [404, 'oidc.MEMBER_NOT_FOUND'], [409, 'oidc.LAST_ADMIN']]
    },
    {
        method: 'DELETE',
        path: '/tenants/current/members/:userId',
        tag: 'tenant members',
        summary: 'Remove a member from the tenant (the account stays). Not the last admin. Answers 204.',
        bearer: true,
        pathExample: `/tenants/current/members/${USER_ID}`,
        response: null,
        errors: [...ACCESS('admin'), [404, 'oidc.MEMBER_NOT_FOUND'], [409, 'oidc.LAST_ADMIN']]
    },
    // ---------------------------------------------------------------- the platform (superadmins)
    {
        method: 'GET',
        path: '/admin/tenants',
        tag: 'platform (superadmin)',
        summary: 'Every tenant with its status and number of members. Superadmins only.',
        bearer: true,
        response: {
            status: 200,
            example: [
                {
                    id: TENANT.id,
                    slug: 'acme',
                    name: 'Acme',
                    status: 'active',
                    createdAt: '2026-10-13T09:00:00.000Z',
                    members: 3
                }
            ]
        },
        errors: ACCESS('superadmin')
    },
    {
        method: 'POST',
        path: '/admin/tenants',
        tag: 'platform (superadmin)',
        summary: 'Create a tenant. With adminEmail that person gets an invitation to become its admin.',
        bearer: true,
        body: {
            example: { name: 'Globex', adminEmail: 'boss@globex.com' },
            fields: [
                ['name', 'string', 'required, 2 to 100 characters'],
                ['adminEmail', 'string', 'optional, gets an invitation as admin']
            ]
        },
        response: {
            status: 201,
            example: {
                tenant: {
                    id: TENANT.id,
                    slug: 'globex',
                    name: 'Globex',
                    status: 'active',
                    createdAt: '2026-10-13T09:00:00.000Z'
                },
                invited: 'boss@globex.com'
            }
        },
        errors: [BAD_REQUEST, ...ACCESS('superadmin')]
    },
    {
        method: 'PATCH',
        path: '/admin/tenants/:id',
        tag: 'platform (superadmin)',
        summary: 'Suspend or reactivate a tenant. Members of a suspended tenant cannot log in to it or use the API.',
        bearer: true,
        pathExample: `/admin/tenants/${TENANT.id}`,
        body: { example: { status: 'suspended' }, fields: [['status', 'string', '`active` or `suspended`']] },
        response: { status: 200, example: { id: TENANT.id, status: 'suspended' } },
        errors: [BAD_REQUEST, ...ACCESS('superadmin'), [404, 'oidc.TENANT_NOT_FOUND']]
    },
    {
        method: 'GET',
        path: '/admin/superadmins',
        tag: 'platform (superadmin)',
        summary: 'The superadmins of the platform.',
        bearer: true,
        response: { status: 200, example: [{ userId: USER_ID, name: 'Ada Lovelace', email: 'ada@example.com' }] },
        errors: ACCESS('superadmin')
    },
    {
        method: 'POST',
        path: '/admin/superadmins',
        tag: 'platform (superadmin)',
        summary: 'Make an existing account superadmin (admin of every tenant).',
        bearer: true,
        body: { example: { email: 'bob@example.com' }, fields: [['email', 'string', 'required, an existing account']] },
        response: { status: 200, example: { userId: USER_ID, name: 'Bob', email: 'bob@example.com' } },
        errors: [BAD_REQUEST, ...ACCESS('superadmin'), [404, 'oidc.USER_NOT_FOUND']]
    },
    {
        method: 'DELETE',
        path: '/admin/superadmins/:userId',
        tag: 'platform (superadmin)',
        summary: 'Take superadmin away. The platform always keeps at least one superadmin. Answers 204.',
        bearer: true,
        pathExample: `/admin/superadmins/${USER_ID}`,
        response: null,
        errors: [...ACCESS('superadmin'), [404, 'oidc.USER_NOT_FOUND'], [409, 'oidc.LAST_SUPERADMIN']]
    },
    {
        method: 'DELETE',
        path: '/admin/users/:userId/mfa',
        tag: 'platform (superadmin)',
        summary:
            'Reset two-step verification of an account that lost its phone and recovery codes. Its sessions end; it sets it up again at the next login. Answers 204.',
        bearer: true,
        pathExample: `/admin/users/${USER_ID}/mfa`,
        response: null,
        errors: [...ACCESS('superadmin'), [404, 'oidc.USER_NOT_FOUND']]
    },
    // ---------------------------------------------------------------- two-step verification of the own account
    {
        method: 'GET',
        path: '/me/mfa',
        tag: 'two-factor authentication',
        summary: 'Is two-step verification on for the logged in account, and how many recovery codes are left?',
        bearer: true,
        response: { status: 200, example: { enabled: true, recoveryCodesLeft: 9 } },
        errors: [[401, 'errors.UNAUTHORIZED']]
    },
    {
        method: 'POST',
        path: '/me/mfa/setup',
        tag: 'two-factor authentication',
        summary:
            'Start setting up: a new secret, with a QR code (SVG) and the otpauth:// URL for the authenticator app. Stays off until /me/mfa/enable.',
        bearer: true,
        response: {
            status: 200,
            example: {
                secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
                otpauthUrl:
                    'otpauth://totp/shop:ada%40example.com?secret=JBSW…&issuer=shop&algorithm=SHA1&digits=6&period=30',
                qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" …>…</svg>'
            }
        },
        errors: [
            [401, 'errors.UNAUTHORIZED'],
            [409, 'oidc.MFA_ALREADY_ENABLED']
        ]
    },
    {
        method: 'POST',
        path: '/me/mfa/enable',
        tag: 'two-factor authentication',
        summary:
            'Confirm with a first code of the app: two-step verification is on. Returns ten recovery codes (shown only now). Other sessions of the account end.',
        bearer: true,
        body: { example: { code: '492039' }, fields: [['code', 'string', 'required, 6 digits from the app']] },
        response: { status: 200, example: { enabled: true, recoveryCodes: ['k7qm-2xpd', 'a3fz-q8wn', '…'] } },
        errors: [
            BAD_REQUEST,
            [400, 'oidc.MFA_INVALID_CODE'],
            [400, 'oidc.MFA_SETUP_FIRST'],
            [401, 'errors.UNAUTHORIZED'],
            [409, 'oidc.MFA_ALREADY_ENABLED'],
            [429, 'oidc.TOO_MANY_ATTEMPTS']
        ]
    },
    {
        method: 'POST',
        path: '/me/mfa/disable',
        tag: 'two-factor authentication',
        summary:
            'Turn two-step verification off. Only with OIDC_MFA=optional (with required, the default, it answers 403). Needs a code of the app or a recovery code.',
        bearer: true,
        body: { example: { code: '492039' }, fields: [['code', 'string', 'required, a code or a recovery code']] },
        response: { status: 200, example: { enabled: false } },
        errors: [
            BAD_REQUEST,
            [400, 'oidc.MFA_INVALID_CODE'],
            [401, 'errors.UNAUTHORIZED'],
            [403, 'oidc.MFA_REQUIRED'],
            [429, 'oidc.TOO_MANY_ATTEMPTS']
        ]
    },
    {
        method: 'POST',
        path: '/me/mfa/recovery-codes',
        tag: 'two-factor authentication',
        summary: 'Ten new recovery codes; the old ones stop working. Needs a code of the app or a recovery code.',
        bearer: true,
        body: { example: { code: '492039' }, fields: [['code', 'string', 'required, a code or a recovery code']] },
        response: { status: 200, example: { recoveryCodes: ['k7qm-2xpd', 'a3fz-q8wn', '…'] } },
        errors: [
            BAD_REQUEST,
            [400, 'oidc.MFA_INVALID_CODE'],
            [401, 'errors.UNAUTHORIZED'],
            [429, 'oidc.TOO_MANY_ATTEMPTS']
        ]
    }
]
