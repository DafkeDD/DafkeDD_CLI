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
import { EID_PACKAGE } from '../eid.js'

export const TEMPLATE_DIR = fileURLToPath(new URL('../../templates/backend-oidc/', import.meta.url))
export const ISSUER_PATH = '/oidc'
export const FRONTEND_CALLBACK = 'http://localhost:3000/api/auth/callback'
export const LOGIN_UI_URL = 'http://localhost:3000/login'
export const APP_URL = 'http://localhost:3000'
export const SESSION_COOKIE = 'oidc_session'

export const PACKAGES = {
    dependencies: ['cookie-parser@latest', 'nodemailer@latest', 'qrcode@latest', EID_PACKAGE],
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
    en: {
        IS_IN: '{property} must be one of: {constraints.0}',
        IS_OBJECT: '{property} must be an object',
        IS_INT: '{property} must be a whole number',
        MIN: '{property} must be at least {constraints.0}',
        MAX: '{property} must be at most {constraints.0}',
        MATCHES: '{property} has an invalid format',
        IS_BOOLEAN: '{property} must be true or false',
        IS_UUID: '{property} must be an id (uuid)',
        IS_DATE: '{property} must be a date (ISO 8601)',
        IS_ARRAY: '{property} must be a list',
        ARRAY_MAX_SIZE: '{property} may have at most {constraints.0} items'
    },
    nl: {
        IS_IN: '{property} moet een van deze waarden zijn: {constraints.0}',
        IS_OBJECT: '{property} moet een object zijn',
        IS_INT: '{property} moet een geheel getal zijn',
        MIN: '{property} moet minstens {constraints.0} zijn',
        MAX: '{property} mag hoogstens {constraints.0} zijn',
        MATCHES: '{property} heeft een ongeldige vorm',
        IS_BOOLEAN: '{property} moet true of false zijn',
        IS_UUID: '{property} moet een id (uuid) zijn',
        IS_DATE: '{property} moet een datum zijn (ISO 8601)',
        IS_ARRAY: '{property} moet een lijst zijn',
        ARRAY_MAX_SIZE: '{property} mag hoogstens {constraints.0} elementen hebben'
    },
    fr: {
        IS_IN: "{property} doit être l'une de ces valeurs : {constraints.0}",
        IS_OBJECT: '{property} doit être un objet',
        IS_INT: '{property} doit être un nombre entier',
        MIN: '{property} doit être au moins {constraints.0}',
        MAX: '{property} doit être au plus {constraints.0}',
        MATCHES: "{property} n'a pas un format valable",
        IS_BOOLEAN: '{property} doit être true ou false',
        IS_UUID: '{property} doit être un identifiant (uuid)',
        IS_DATE: '{property} doit être une date (ISO 8601)',
        IS_ARRAY: '{property} doit être une liste',
        ARRAY_MAX_SIZE: '{property} peut contenir au plus {constraints.0} éléments'
    },
    de: {
        IS_IN: '{property} muss einer dieser Werte sein: {constraints.0}',
        IS_OBJECT: '{property} muss ein Objekt sein',
        IS_INT: '{property} muss eine ganze Zahl sein',
        MIN: '{property} muss mindestens {constraints.0} sein',
        MAX: '{property} darf höchstens {constraints.0} sein',
        MATCHES: '{property} hat ein ungültiges Format',
        IS_BOOLEAN: '{property} muss true oder false sein',
        IS_UUID: '{property} muss eine ID (uuid) sein',
        IS_DATE: '{property} muss ein Datum sein (ISO 8601)',
        IS_ARRAY: '{property} muss eine Liste sein',
        ARRAY_MAX_SIZE: '{property} darf höchstens {constraints.0} Einträge haben'
    }
}

/** Texts of the licences (namespace "billing"): errors and the fake checkout. Every language has the same keys. */
export const BILLING_MESSAGES = {
    en: {
        PRODUCT_NOT_FOUND: 'This product was not found.',
        PRODUCT_EXISTS: 'A product with this code exists already.',
        YEAR_NOT_CHEAPER: 'The price per year must be lower than twelve times the price per month.',
        DISCOUNT_INVALID:
            'This discount code is not valid (unknown, expired, used up, used before or for another product).',
        DISCOUNT_EXISTS: 'This discount code exists already.',
        DISCOUNT_AMOUNT: 'Give either a percentage or an amount off.',
        DISCOUNT_PERIODS: 'A repeating discount needs a number of periods (and only a repeating one).',
        SUBSCRIPTION_EXISTS:
            'Your organisation has a subscription for this product already: change its number of seats instead.',
        NO_SUBSCRIPTION: 'Your organisation has no running subscription for this product.',
        FREE_SUBSCRIPTION:
            'These seats are free (a discount code): they cannot be changed. Buy a subscription when they end.',
        NO_FREE_SEAT: 'Every seat is in use. Buy more seats, or take one back from another member.',
        SEATS_IN_USE: 'More seats are in use than that. Take seats back first.',
        RENEWAL_PENDING: 'The renewal of this subscription is on its way. Change the seats when it is paid.',
        SEAT_NOT_FOUND: 'This member has no seat for this product.',
        TRIAL_USED: 'This member had a trial of this product already.',
        NOT_A_MEMBER: 'This person is not an active member of the organisation.',
        LICENSE_REQUIRED: 'You need a licence for {product}. Ask an admin of your organisation.',
        PAYMENTS_DISABLED: 'Buying is not available on this server (PAYMENTS=off).',
        PAYMENT_NOT_FOUND: 'This payment was not found.',
        FAKE_TITLE: 'Test payment',
        FAKE_TEXT: 'This is not a real payment (PAYMENTS=fake, for development). Choose how it ends.',
        FAKE_PAY: 'Pay',
        FAKE_CANCEL: 'Cancel'
    },
    nl: {
        PRODUCT_NOT_FOUND: 'Dit product werd niet gevonden.',
        PRODUCT_EXISTS: 'Er bestaat al een product met deze code.',
        YEAR_NOT_CHEAPER: 'De prijs per jaar moet lager zijn dan twaalf keer de prijs per maand.',
        DISCOUNT_INVALID:
            'Deze kortingscode is niet geldig (onbekend, verlopen, opgebruikt, al gebruikt of voor een ander product).',
        DISCOUNT_EXISTS: 'Deze kortingscode bestaat al.',
        DISCOUNT_AMOUNT: 'Geef een percentage of een bedrag korting, niet allebei.',
        DISCOUNT_PERIODS: 'Een herhalende korting heeft een aantal periodes nodig (en alleen een herhalende).',
        SUBSCRIPTION_EXISTS: 'Je organisatie heeft al een abonnement op dit product: wijzig het aantal plaatsen.',
        NO_SUBSCRIPTION: 'Je organisatie heeft geen lopend abonnement op dit product.',
        FREE_SUBSCRIPTION:
            'Deze plaatsen zijn gratis (een kortingscode): ze kunnen niet gewijzigd worden. Koop een abonnement als ze aflopen.',
        NO_FREE_SEAT: 'Alle plaatsen zijn in gebruik. Koop extra plaatsen, of neem er een terug van een ander lid.',
        SEATS_IN_USE: 'Er zijn meer plaatsen in gebruik. Neem eerst plaatsen terug.',
        RENEWAL_PENDING: 'De verlenging van dit abonnement is onderweg. Wijzig de plaatsen zodra ze betaald is.',
        SEAT_NOT_FOUND: 'Dit lid heeft geen plaats voor dit product.',
        TRIAL_USED: 'Dit lid had al een proefperiode voor dit product.',
        NOT_A_MEMBER: 'Deze persoon is geen actief lid van de organisatie.',
        LICENSE_REQUIRED: 'Je hebt een licentie nodig voor {product}. Vraag het aan een beheerder van je organisatie.',
        PAYMENTS_DISABLED: 'Kopen is niet beschikbaar op deze server (PAYMENTS=off).',
        PAYMENT_NOT_FOUND: 'Deze betaling werd niet gevonden.',
        FAKE_TITLE: 'Testbetaling',
        FAKE_TEXT: 'Dit is geen echte betaling (PAYMENTS=fake, voor ontwikkeling). Kies hoe ze afloopt.',
        FAKE_PAY: 'Betalen',
        FAKE_CANCEL: 'Annuleren'
    },
    fr: {
        PRODUCT_NOT_FOUND: 'Ce produit est introuvable.',
        PRODUCT_EXISTS: 'Un produit avec ce code existe déjà.',
        YEAR_NOT_CHEAPER: 'Le prix annuel doit être inférieur à douze fois le prix mensuel.',
        DISCOUNT_INVALID:
            "Ce code de réduction n'est pas valable (inconnu, expiré, épuisé, déjà utilisé ou pour un autre produit).",
        DISCOUNT_EXISTS: 'Ce code de réduction existe déjà.',
        DISCOUNT_AMOUNT: 'Indiquez soit un pourcentage, soit un montant de réduction.',
        DISCOUNT_PERIODS: 'Une réduction répétée demande un nombre de périodes (et seulement une réduction répétée).',
        SUBSCRIPTION_EXISTS:
            'Votre organisation a déjà un abonnement pour ce produit : modifiez plutôt le nombre de places.',
        NO_SUBSCRIPTION: "Votre organisation n'a pas d'abonnement en cours pour ce produit.",
        FREE_SUBSCRIPTION:
            'Ces places sont gratuites (un code de réduction) : elles ne peuvent pas être modifiées. Achetez un abonnement à leur fin.',
        NO_FREE_SEAT: 'Toutes les places sont utilisées. Achetez des places, ou reprenez-en une à un autre membre.',
        SEATS_IN_USE: "Plus de places sont utilisées. Reprenez d'abord des places.",
        RENEWAL_PENDING:
            "Le renouvellement de cet abonnement est en cours. Modifiez les places une fois qu'il est payé.",
        SEAT_NOT_FOUND: "Ce membre n'a pas de place pour ce produit.",
        TRIAL_USED: "Ce membre a déjà eu une période d'essai pour ce produit.",
        NOT_A_MEMBER: "Cette personne n'est pas un membre actif de l'organisation.",
        LICENSE_REQUIRED:
            "Vous avez besoin d'une licence pour {product}. Demandez à un administrateur de votre organisation.",
        PAYMENTS_DISABLED: "L'achat n'est pas disponible sur ce serveur (PAYMENTS=off).",
        PAYMENT_NOT_FOUND: 'Ce paiement est introuvable.',
        FAKE_TITLE: 'Paiement de test',
        FAKE_TEXT:
            "Ce n'est pas un vrai paiement (PAYMENTS=fake, pour le développement). Choisissez comment il se termine.",
        FAKE_PAY: 'Payer',
        FAKE_CANCEL: 'Annuler'
    },
    de: {
        PRODUCT_NOT_FOUND: 'Dieses Produkt wurde nicht gefunden.',
        PRODUCT_EXISTS: 'Ein Produkt mit diesem Code gibt es bereits.',
        YEAR_NOT_CHEAPER: 'Der Jahrespreis muss niedriger sein als zwölfmal der Monatspreis.',
        DISCOUNT_INVALID:
            'Dieser Rabattcode ist ungültig (unbekannt, abgelaufen, aufgebraucht, schon benutzt oder für ein anderes Produkt).',
        DISCOUNT_EXISTS: 'Diesen Rabattcode gibt es bereits.',
        DISCOUNT_AMOUNT: 'Gib entweder einen Prozentsatz oder einen Betrag als Rabatt an.',
        DISCOUNT_PERIODS: 'Ein wiederholter Rabatt braucht eine Anzahl Perioden (und nur ein wiederholter).',
        SUBSCRIPTION_EXISTS:
            'Deine Organisation hat bereits ein Abonnement für dieses Produkt: Ändere stattdessen die Anzahl der Plätze.',
        NO_SUBSCRIPTION: 'Deine Organisation hat kein laufendes Abonnement für dieses Produkt.',
        FREE_SUBSCRIPTION:
            'Diese Plätze sind kostenlos (ein Rabattcode): Sie können nicht geändert werden. Kaufe ein Abonnement, wenn sie enden.',
        NO_FREE_SEAT: 'Alle Plätze sind belegt. Kaufe weitere Plätze oder nimm einem anderen Mitglied einen weg.',
        SEATS_IN_USE: 'Es sind mehr Plätze belegt. Nimm zuerst Plätze zurück.',
        RENEWAL_PENDING: 'Die Verlängerung dieses Abos ist unterwegs. Ändere die Plätze, sobald sie bezahlt ist.',
        SEAT_NOT_FOUND: 'Dieses Mitglied hat keinen Platz für dieses Produkt.',
        TRIAL_USED: 'Dieses Mitglied hatte bereits eine Testphase für dieses Produkt.',
        NOT_A_MEMBER: 'Diese Person ist kein aktives Mitglied der Organisation.',
        LICENSE_REQUIRED: 'Du brauchst eine Lizenz für {product}. Frage einen Administrator deiner Organisation.',
        PAYMENTS_DISABLED: 'Kaufen ist auf diesem Server nicht möglich (PAYMENTS=off).',
        PAYMENT_NOT_FOUND: 'Diese Zahlung wurde nicht gefunden.',
        FAKE_TITLE: 'Testzahlung',
        FAKE_TEXT: 'Dies ist keine echte Zahlung (PAYMENTS=fake, für die Entwicklung). Wähle, wie sie endet.',
        FAKE_PAY: 'Bezahlen',
        FAKE_CANCEL: 'Abbrechen'
    }
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
        INVITE_APPS: 'You get access to {apps}.',
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
        INVITE_APPS: 'Je krijgt toegang tot {apps}.',
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
        INVITE_APPS: 'Vous aurez accès à {apps}.',
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
        INVITE_APPS: 'Du bekommst Zugang zu {apps}.',
        ROLE_user: 'Benutzer',
        ROLE_admin: 'Administrator'
    }
}

/** Texts of the login pages (namespace "oidc"). Every language needs the same keys (checked by the tests). */
export const MESSAGES = {
    en: {
        LOGOUT_TITLE: 'Log out?',
        LOGOUT_TEXT: 'Do you want to log out on this device?',
        LOGOUT_TEXT_CLIENT: 'Do you want to log out of {client} on this device?',
        LOGOUT_SUBMIT: 'Log out',
        LOGGED_OUT_TITLE: 'Logged out',
        LOGGED_OUT: 'You are logged out. You can close this page.',
        LOGOUT_INVALID_HINT:
            'This logout request is not valid (the ID token is not ours or does not belong to this application).',
        INVALID_POST_LOGOUT_REDIRECT:
            'The address to go back to after logging out is not registered for this application.',
        SESSION_NOT_FOUND: 'This session was not found (it ended already).',
        ACCOUNT_DISABLED: 'This account is disabled.',
        EID_DISABLED: 'Logging in with the eID is not available on this server.',
        EXTERNAL_LOGIN: 'Log in with {name}',
        EXTERNAL_DISABLED: 'Logging in with another server is not set up.',
        EXTERNAL_FAILED: 'Logging in with the other server did not work. Try again.',
        EXTERNAL_NO_EMAIL: 'The other server did not give an email address: an account needs one.',
        EXTERNAL_EMAIL_UNVERIFIED:
            'The other server did not verify this email address: log in there with a verified address.',
        EXTERNAL_EMAIL_TAKEN:
            'An account with this email address exists already. Log in with it, or ask an admin to link it.',
        EXTERNAL_OTHER_LINKED: 'This account is linked to another account of the other server already.',
        PASSWORD_LOGIN_OFF: 'Logging in with a password is turned off: use the button below.',
        LINK_CODE_INVALID: 'This link code is unknown, used already or expired: make a new one on /admin.',
        CLIENT_INVALID_URI: 'The address {uri} is not valid: use https (http only on localhost) and no #fragment.',
        CLIENT_NO_REDIRECT: 'An app needs at least one redirect URI.',
        CLIENT_EXISTS: 'An app with this client id exists already.',
        CLIENT_NOT_FOUND: 'This app was not found.',
        CLIENT_FROM_FILE: 'This app comes from config/oidc-clients.json: change it in that file.',
        CLIENT_PUBLIC: 'A public app has no secret.',
        CLIENT_DISABLE_FIRST: 'Disable the app first, then remove it.',
        CLIENT_UNKNOWN_PRODUCT: 'The product {product} does not exist: make it on /licenses first.',
        APP_NOT_FOUND: 'This app does not exist or has no roles.',
        INVITATION_APP_UNKNOWN: 'The app {app} does not exist or cannot be given in an invitation.',
        ROLE_UNKNOWN: 'The app has no role {role}.',
        ROLES_INVALID: 'The roles of the app are not valid: {reason}.',
        CLIENT_PRODUCT_TAKEN: 'The product {product} is sold by the app {app} already: one product belongs to one app.',
        CONSENT_TITLE: 'Allow {client}?',
        CONSENT_TEXT: '{client} wants to use your account {email}. It gets:',
        CONSENT_NOTE: 'You can take this back at any time on Security.',
        CONSENT_ALLOW: 'Allow',
        CONSENT_DENY: 'Do not allow',
        CONSENT_NOT_FOUND: 'This application has no permission of this account.',
        SCOPE_OPENID: 'Who you are (an id, no personal data)',
        SCOPE_PROFILE: 'Your name and language',
        SCOPE_EMAIL: 'Your email address',
        SCOPE_TENANT: 'Your organisation and your role there',
        PASSKEYS_DISABLED: 'Passkeys are not available on this server.',
        PASSKEY_EXPIRED: 'The passkey request expired. Please try again.',
        PASSKEY_INVALID: 'The passkey could not be verified. Please try again.',
        PASSKEY_EXISTS: 'This passkey was added already, or the account has the maximum of 20.',
        PASSKEY_NOT_FOUND: 'This passkey was not found.',
        PASSKEY_LAST_LOGIN: 'This is the only way left to log in: add a password or another passkey first.',
        PASSKEY_UNKNOWN: 'This passkey does not belong to an account here (any more).',
        EID_INVALID: 'The eID could not be verified. Please try again.',
        EID_EXPIRED: 'The eID request expired. Please try again.',
        EID_NOT_LINKED:
            'No account is linked to this eID. Register with your eID, or log in with your password and link it under Security.',
        EID_UNAVAILABLE: 'The validity of the eID cannot be checked right now. Please try again in a moment.',
        EID_ALREADY_LINKED: 'This eID is already linked to an account.',
        EID_OTHER_LINKED: 'Another eID is linked to your account. Unlink it first.',
        EID_ONLY_LOGIN: 'Your eID is your only way to log in. Choose a password first (forgot password).',
        PLATFORM_CHOICE: 'Platform management (no organisation)',
        INVITATION_NOT_FOUND: 'This invitation was not found (accepted, withdrawn or expired).',
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
        LOGOUT_TITLE: 'Uitloggen?',
        LOGOUT_TEXT: 'Wil je uitloggen op dit toestel?',
        LOGOUT_TEXT_CLIENT: 'Wil je uitloggen bij {client} op dit toestel?',
        LOGOUT_SUBMIT: 'Uitloggen',
        LOGGED_OUT_TITLE: 'Uitgelogd',
        LOGGED_OUT: 'Je bent uitgelogd. Je kunt deze pagina sluiten.',
        LOGOUT_INVALID_HINT:
            'Deze uitlogaanvraag is niet geldig (het ID-token is niet van ons of hoort niet bij deze applicatie).',
        INVALID_POST_LOGOUT_REDIRECT:
            'Het adres om na het uitloggen naar terug te gaan is niet geregistreerd voor deze applicatie.',
        SESSION_NOT_FOUND: 'Deze sessie werd niet gevonden (ze is al beëindigd).',
        ACCOUNT_DISABLED: 'Dit account is uitgeschakeld.',
        EID_DISABLED: 'Inloggen met de eID is niet beschikbaar op deze server.',
        EXTERNAL_LOGIN: 'Inloggen met {name}',
        EXTERNAL_DISABLED: 'Inloggen via een andere server is niet ingesteld.',
        EXTERNAL_FAILED: 'Inloggen via de andere server is niet gelukt. Probeer het opnieuw.',
        EXTERNAL_NO_EMAIL: 'De andere server gaf geen e-mailadres: een account heeft er een nodig.',
        EXTERNAL_EMAIL_UNVERIFIED:
            'De andere server heeft dit e-mailadres niet bevestigd: log daar in met een bevestigd adres.',
        EXTERNAL_EMAIL_TAKEN:
            'Er bestaat al een account met dit e-mailadres. Log daarmee in, of vraag een beheerder om het te koppelen.',
        EXTERNAL_OTHER_LINKED: 'Dit account is al gekoppeld aan een ander account van de andere server.',
        PASSWORD_LOGIN_OFF: 'Inloggen met een wachtwoord staat uit: gebruik de knop hieronder.',
        LINK_CODE_INVALID: 'Deze koppelcode is onbekend, al gebruikt of verlopen: maak een nieuwe op /admin.',
        CLIENT_INVALID_URI:
            'Het adres {uri} is niet geldig: gebruik https (http alleen op localhost) en geen #fragment.',
        CLIENT_NO_REDIRECT: 'Een app heeft minstens één redirect-URI nodig.',
        CLIENT_EXISTS: 'Er bestaat al een app met deze client-id.',
        CLIENT_NOT_FOUND: 'Deze app werd niet gevonden.',
        CLIENT_FROM_FILE: 'Deze app komt uit config/oidc-clients.json: pas ze in dat bestand aan.',
        CLIENT_PUBLIC: 'Een publieke app heeft geen secret.',
        CLIENT_DISABLE_FIRST: 'Schakel de app eerst uit en verwijder ze daarna.',
        CLIENT_UNKNOWN_PRODUCT: 'Het product {product} bestaat niet: maak het eerst aan op /licenses.',
        APP_NOT_FOUND: 'Deze app bestaat niet of heeft geen rollen.',
        INVITATION_APP_UNKNOWN: 'De app {app} bestaat niet of kan niet meegegeven worden in een uitnodiging.',
        ROLE_UNKNOWN: 'De app heeft geen rol {role}.',
        ROLES_INVALID: 'De rollen van de app zijn niet geldig: {reason}.',
        CLIENT_PRODUCT_TAKEN:
            'Het product {product} wordt al verkocht door de app {app}: één product hoort bij één app.',
        CONSENT_TITLE: '{client} toestaan?',
        CONSENT_TEXT: '{client} wil je account {email} gebruiken. Het krijgt:',
        CONSENT_NOTE: 'Je kunt dit altijd intrekken onder Beveiliging.',
        CONSENT_ALLOW: 'Toestaan',
        CONSENT_DENY: 'Niet toestaan',
        CONSENT_NOT_FOUND: 'Deze toepassing heeft geen toestemming van dit account.',
        SCOPE_OPENID: 'Wie je bent (een id, geen persoonsgegevens)',
        SCOPE_PROFILE: 'Je naam en taal',
        SCOPE_EMAIL: 'Je e-mailadres',
        SCOPE_TENANT: 'Je organisatie en je rol daar',
        PASSKEYS_DISABLED: 'Passkeys zijn niet beschikbaar op deze server.',
        PASSKEY_EXPIRED: 'De passkey-aanvraag is verlopen. Probeer opnieuw.',
        PASSKEY_INVALID: 'De passkey kon niet gecontroleerd worden. Probeer opnieuw.',
        PASSKEY_EXISTS: 'Deze passkey is al toegevoegd, of het account heeft het maximum van 20.',
        PASSKEY_NOT_FOUND: 'Deze passkey werd niet gevonden.',
        PASSKEY_LAST_LOGIN:
            'Dit is de enige manier die overblijft om in te loggen: voeg eerst een wachtwoord of een andere passkey toe.',
        PASSKEY_UNKNOWN: 'Deze passkey hoort (niet meer) bij een account hier.',
        EID_INVALID: 'De eID kon niet gecontroleerd worden. Probeer het opnieuw.',
        EID_EXPIRED: 'De eID-aanvraag is verlopen. Probeer het opnieuw.',
        EID_NOT_LINKED:
            'Er is geen account gekoppeld aan deze eID. Registreer met je eID, of log in met je wachtwoord en koppel ze bij Beveiliging.',
        EID_UNAVAILABLE: 'De geldigheid van de eID kan nu niet gecontroleerd worden. Probeer het zo meteen opnieuw.',
        EID_ALREADY_LINKED: 'Deze eID is al aan een account gekoppeld.',
        EID_OTHER_LINKED: 'Er is al een andere eID aan je account gekoppeld. Ontkoppel die eerst.',
        EID_ONLY_LOGIN: 'Je eID is je enige manier om in te loggen. Kies eerst een wachtwoord (wachtwoord vergeten).',
        PLATFORM_CHOICE: 'Platformbeheer (geen organisatie)',
        INVITATION_NOT_FOUND: 'Deze uitnodiging werd niet gevonden (aanvaard, ingetrokken of verlopen).',
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
        LOGOUT_TITLE: 'Se déconnecter ?',
        LOGOUT_TEXT: 'Voulez-vous vous déconnecter sur cet appareil ?',
        LOGOUT_TEXT_CLIENT: 'Voulez-vous vous déconnecter de {client} sur cet appareil ?',
        LOGOUT_SUBMIT: 'Se déconnecter',
        LOGGED_OUT_TITLE: 'Déconnecté',
        LOGGED_OUT: 'Vous êtes déconnecté. Vous pouvez fermer cette page.',
        LOGOUT_INVALID_HINT:
            "Cette demande de déconnexion n'est pas valable (le jeton d'identité ne vient pas de nous ou n'appartient pas à cette application).",
        INVALID_POST_LOGOUT_REDIRECT:
            "L'adresse de retour après la déconnexion n'est pas enregistrée pour cette application.",
        SESSION_NOT_FOUND: 'Cette session est introuvable (elle est déjà terminée).',
        ACCOUNT_DISABLED: 'Ce compte est désactivé.',
        EID_DISABLED: "La connexion avec l'eID n'est pas disponible sur ce serveur.",
        EXTERNAL_LOGIN: 'Se connecter avec {name}',
        EXTERNAL_DISABLED: "La connexion via un autre serveur n'est pas configurée.",
        EXTERNAL_FAILED: "La connexion via l'autre serveur n'a pas fonctionné. Réessayez.",
        EXTERNAL_NO_EMAIL: "L'autre serveur n'a pas donné d'adresse e-mail : un compte en a besoin.",
        EXTERNAL_EMAIL_UNVERIFIED:
            "L'autre serveur n'a pas confirmé cette adresse e-mail : connectez-vous là-bas avec une adresse confirmée.",
        EXTERNAL_EMAIL_TAKEN:
            'Un compte avec cette adresse e-mail existe déjà. Connectez-vous avec celui-ci, ou demandez à un administrateur de le lier.',
        EXTERNAL_OTHER_LINKED: "Ce compte est déjà lié à un autre compte de l'autre serveur.",
        PASSWORD_LOGIN_OFF: 'La connexion par mot de passe est désactivée : utilisez le bouton ci-dessous.',
        LINK_CODE_INVALID: 'Ce code de liaison est inconnu, déjà utilisé ou expiré : créez-en un nouveau sur /admin.',
        CLIENT_INVALID_URI:
            "L'adresse {uri} n'est pas valable : utilisez https (http seulement sur localhost) et pas de #fragment.",
        CLIENT_NO_REDIRECT: "Une application a besoin d'au moins une URI de redirection.",
        CLIENT_EXISTS: 'Une application avec ce client id existe déjà.',
        CLIENT_NOT_FOUND: 'Cette application est introuvable.',
        CLIENT_FROM_FILE: 'Cette application vient de config/oidc-clients.json : modifiez-la dans ce fichier.',
        CLIENT_PUBLIC: "Une application publique n'a pas de secret.",
        CLIENT_DISABLE_FIRST: "Désactivez d'abord l'application, puis supprimez-la.",
        CLIENT_UNKNOWN_PRODUCT: "Le produit {product} n'existe pas : créez-le d'abord sur /licenses.",
        APP_NOT_FOUND: "Cette application n'existe pas ou n'a pas de rôles.",
        INVITATION_APP_UNKNOWN: "L'application {app} n'existe pas ou ne peut pas être donnée dans une invitation.",
        ROLE_UNKNOWN: "L'application n'a pas de rôle {role}.",
        ROLES_INVALID: "Les rôles de l'application ne sont pas valides : {reason}.",
        CLIENT_PRODUCT_TAKEN:
            "Le produit {product} est déjà vendu par l'application {app} : un produit appartient à une seule application.",
        CONSENT_TITLE: 'Autoriser {client} ?',
        CONSENT_TEXT: '{client} souhaite utiliser votre compte {email}. Il reçoit :',
        CONSENT_NOTE: 'Vous pouvez retirer cette autorisation à tout moment dans Sécurité.',
        CONSENT_ALLOW: 'Autoriser',
        CONSENT_DENY: 'Ne pas autoriser',
        CONSENT_NOT_FOUND: "Cette application n'a pas d'autorisation de ce compte.",
        SCOPE_OPENID: 'Qui vous êtes (un identifiant, aucune donnée personnelle)',
        SCOPE_PROFILE: 'Votre nom et votre langue',
        SCOPE_EMAIL: 'Votre adresse e-mail',
        SCOPE_TENANT: 'Votre organisation et votre rôle',
        PASSKEYS_DISABLED: "Les clés d'accès ne sont pas disponibles sur ce serveur.",
        PASSKEY_EXPIRED: "La demande de clé d'accès a expiré. Veuillez réessayer.",
        PASSKEY_INVALID: "La clé d'accès n'a pas pu être vérifiée. Veuillez réessayer.",
        PASSKEY_EXISTS: "Cette clé d'accès a déjà été ajoutée, ou le compte en a le maximum de 20.",
        PASSKEY_NOT_FOUND: "Cette clé d'accès est introuvable.",
        PASSKEY_LAST_LOGIN:
            "C'est le seul moyen de connexion restant : ajoutez d'abord un mot de passe ou une autre clé d'accès.",
        PASSKEY_UNKNOWN: "Cette clé d'accès n'appartient (plus) à aucun compte ici.",
        EID_INVALID: "L'eID n'a pas pu être vérifiée. Veuillez réessayer.",
        EID_EXPIRED: 'La demande eID a expiré. Veuillez réessayer.',
        EID_NOT_LINKED:
            "Aucun compte n'est lié à cette eID. Inscrivez-vous avec votre eID, ou connectez-vous avec votre mot de passe et liez-la dans Sécurité.",
        EID_UNAVAILABLE:
            "La validité de l'eID ne peut pas être vérifiée pour le moment. Veuillez réessayer dans un instant.",
        EID_ALREADY_LINKED: 'Cette eID est déjà liée à un compte.',
        EID_OTHER_LINKED: "Une autre eID est liée à votre compte. Déliez-la d'abord.",
        EID_ONLY_LOGIN:
            "Votre eID est votre seul moyen de connexion. Choisissez d'abord un mot de passe (mot de passe oublié).",
        PLATFORM_CHOICE: 'Gestion de la plateforme (sans organisation)',
        INVITATION_NOT_FOUND: 'Cette invitation est introuvable (acceptée, retirée ou expirée).',
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
        LOGOUT_TITLE: 'Abmelden?',
        LOGOUT_TEXT: 'Möchtest du dich auf diesem Gerät abmelden?',
        LOGOUT_TEXT_CLIENT: 'Möchtest du dich auf diesem Gerät bei {client} abmelden?',
        LOGOUT_SUBMIT: 'Abmelden',
        LOGGED_OUT_TITLE: 'Abgemeldet',
        LOGGED_OUT: 'Du bist abgemeldet. Du kannst diese Seite schließen.',
        LOGOUT_INVALID_HINT:
            'Diese Abmeldeanfrage ist ungültig (das ID-Token stammt nicht von uns oder gehört nicht zu dieser Anwendung).',
        INVALID_POST_LOGOUT_REDIRECT:
            'Die Adresse für die Rückkehr nach der Abmeldung ist für diese Anwendung nicht registriert.',
        SESSION_NOT_FOUND: 'Diese Sitzung wurde nicht gefunden (sie ist bereits beendet).',
        ACCOUNT_DISABLED: 'Dieses Konto ist deaktiviert.',
        EID_DISABLED: 'Die Anmeldung mit der eID ist auf diesem Server nicht verfügbar.',
        EXTERNAL_LOGIN: 'Mit {name} anmelden',
        EXTERNAL_DISABLED: 'Die Anmeldung über einen anderen Server ist nicht eingerichtet.',
        EXTERNAL_FAILED: 'Die Anmeldung über den anderen Server hat nicht funktioniert. Versuche es erneut.',
        EXTERNAL_NO_EMAIL: 'Der andere Server hat keine E-Mail-Adresse geliefert: ein Konto braucht eine.',
        EXTERNAL_EMAIL_UNVERIFIED:
            'Der andere Server hat diese E-Mail-Adresse nicht bestätigt: melde dich dort mit einer bestätigten Adresse an.',
        EXTERNAL_EMAIL_TAKEN:
            'Es gibt bereits ein Konto mit dieser E-Mail-Adresse. Melde dich damit an oder bitte einen Admin, es zu verknüpfen.',
        EXTERNAL_OTHER_LINKED: 'Dieses Konto ist bereits mit einem anderen Konto des anderen Servers verknüpft.',
        PASSWORD_LOGIN_OFF: 'Die Anmeldung mit Passwort ist ausgeschaltet: nutze die Schaltfläche unten.',
        LINK_CODE_INVALID:
            'Dieser Verknüpfungscode ist unbekannt, schon benutzt oder abgelaufen: erstelle einen neuen auf /admin.',
        CLIENT_INVALID_URI:
            'Die Adresse {uri} ist ungültig: verwende https (http nur auf localhost) und kein #Fragment.',
        CLIENT_NO_REDIRECT: 'Eine App braucht mindestens eine Redirect-URI.',
        CLIENT_EXISTS: 'Es gibt bereits eine App mit dieser Client-ID.',
        CLIENT_NOT_FOUND: 'Diese App wurde nicht gefunden.',
        CLIENT_FROM_FILE: 'Diese App stammt aus config/oidc-clients.json: ändere sie in dieser Datei.',
        CLIENT_PUBLIC: 'Eine öffentliche App hat kein Secret.',
        CLIENT_DISABLE_FIRST: 'Deaktiviere die App zuerst und entferne sie dann.',
        CLIENT_UNKNOWN_PRODUCT: 'Das Produkt {product} gibt es nicht: lege es zuerst unter /licenses an.',
        APP_NOT_FOUND: 'Diese App gibt es nicht oder sie hat keine Rollen.',
        INVITATION_APP_UNKNOWN: 'Die App {app} gibt es nicht oder sie kann nicht in einer Einladung vergeben werden.',
        ROLE_UNKNOWN: 'Die App hat keine Rolle {role}.',
        ROLES_INVALID: 'Die Rollen der App sind nicht gültig: {reason}.',
        CLIENT_PRODUCT_TAKEN:
            'Das Produkt {product} wird bereits von der App {app} verkauft: ein Produkt gehört zu einer App.',
        CONSENT_TITLE: '{client} erlauben?',
        CONSENT_TEXT: '{client} möchte dein Konto {email} verwenden. Es erhält:',
        CONSENT_NOTE: 'Du kannst das jederzeit unter Sicherheit widerrufen.',
        CONSENT_ALLOW: 'Erlauben',
        CONSENT_DENY: 'Nicht erlauben',
        CONSENT_NOT_FOUND: 'Diese Anwendung hat keine Erlaubnis dieses Kontos.',
        SCOPE_OPENID: 'Wer du bist (eine ID, keine persönlichen Daten)',
        SCOPE_PROFILE: 'Deinen Namen und deine Sprache',
        SCOPE_EMAIL: 'Deine E-Mail-Adresse',
        SCOPE_TENANT: 'Deine Organisation und deine Rolle dort',
        PASSKEYS_DISABLED: 'Passkeys sind auf diesem Server nicht verfügbar.',
        PASSKEY_EXPIRED: 'Die Passkey-Anfrage ist abgelaufen. Bitte versuche es erneut.',
        PASSKEY_INVALID: 'Der Passkey konnte nicht geprüft werden. Bitte versuche es erneut.',
        PASSKEY_EXISTS: 'Dieser Passkey wurde bereits hinzugefügt, oder das Konto hat das Maximum von 20.',
        PASSKEY_NOT_FOUND: 'Dieser Passkey wurde nicht gefunden.',
        PASSKEY_LAST_LOGIN:
            'Dies ist die letzte Möglichkeit zur Anmeldung: füge zuerst ein Passwort oder einen anderen Passkey hinzu.',
        PASSKEY_UNKNOWN: 'Dieser Passkey gehört hier (nicht mehr) zu einem Konto.',
        EID_INVALID: 'Die eID konnte nicht geprüft werden. Bitte versuche es erneut.',
        EID_EXPIRED: 'Die eID-Anfrage ist abgelaufen. Bitte versuche es erneut.',
        EID_NOT_LINKED:
            'Mit dieser eID ist kein Konto verknüpft. Registriere dich mit deiner eID, oder melde dich mit deinem Passwort an und verknüpfe sie unter Sicherheit.',
        EID_UNAVAILABLE:
            'Die Gültigkeit der eID kann gerade nicht geprüft werden. Bitte versuche es gleich noch einmal.',
        EID_ALREADY_LINKED: 'Diese eID ist bereits mit einem Konto verknüpft.',
        EID_OTHER_LINKED: 'Mit deinem Konto ist bereits eine andere eID verknüpft. Hebe diese Verknüpfung zuerst auf.',
        EID_ONLY_LOGIN:
            'Deine eID ist deine einzige Anmeldemöglichkeit. Wähle zuerst ein Passwort (Passwort vergessen).',
        PLATFORM_CHOICE: 'Plattformverwaltung (keine Organisation)',
        INVITATION_NOT_FOUND: 'Diese Einladung wurde nicht gefunden (angenommen, zurückgezogen oder abgelaufen).',
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

/**
 * Question after choosing the OpenID Connect server: the email address of the superadmin. No organisation is needed:
 * the superadmin creates them on /admin (or people register their own).
 */
export async function ask({ projectDir = process.cwd(), prompts, hasFrontend = false }) {
    const adminEmail = (
        await prompts.input({
            message: 'E-mailadres van de superadmin (beheert het platform en alle organisaties):',
            validate: value => EMAIL_PATTERN.test(value.trim()) || 'Geef een geldig e-mailadres op'
        })
    )
        .trim()
        .toLowerCase()
    const adminPassword = generatePassword()
    return {
        adminEmail,
        adminPassword,
        adminPasswordHash: await hashPassword(adminPassword),
        masterKey: randomBytes(32).toString('hex'),
        // With a frontend the login pages live there (port 3000), not in the API
        loginUi: hasFrontend,
        // The name of the application in emails
        appName: basename(projectDir),
        external: await askExternal(prompts)
    }
}

/** An issuer: https (http only on this computer), without a trailing slash. */
export function validIssuer(value) {
    try {
        const url = new URL(value.trim())
        if (url.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname)) return true
    } catch {
        // below
    }
    return 'Geef de https-URL van de issuer op (bv. https://login.microsoftonline.com/<tenant-id>/v2.0)'
}

/**
 * Logging in at another OpenID Connect server (Microsoft Entra ID, Keycloak, Google, ...): its issuer, our client
 * there and the text of the button. Null when not wanted.
 */
async function askExternal(prompts) {
    const how = await prompts.select({
        message: 'Ook inloggen via een bestaande OIDC-server (Entra ID, Keycloak, Google, ...)?',
        choices: [
            { name: 'Nee', value: 'no' },
            { name: 'Ja, naast e-mail en wachtwoord', value: 'also' },
            { name: 'Ja, enkel via die server', value: 'only' }
        ]
    })
    if (how !== 'also' && how !== 'only') return null
    const issuer = (
        await prompts.input({
            message: 'Issuer-URL van die server (exact zoals "issuer" in zijn /.well-known/openid-configuration):',
            validate: validIssuer
        })
    ).trim()
    const clientId = (
        await prompts.input({
            message: 'Client-id van deze applicatie bij die server:',
            validate: value => value.trim().length > 0 || 'Geef de client-id op'
        })
    ).trim()
    const secret = await (prompts.password ?? prompts.input)({
        message: 'Client-secret (leeg laten voor een publieke client met PKCE):',
        mask: '*'
    })
    const name = (
        await prompts.input({
            message: 'Tekst op de knop "Inloggen met ...":',
            default: new URL(issuer).hostname
        })
    ).trim()
    return {
        issuer,
        clientId,
        clientSecret: secret.trim(),
        name: name || new URL(issuer).hostname,
        only: how === 'only'
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
        '# The superadmin: created at the first start when there are no users yet (it needs no organisation).',
        `OIDC_BOOTSTRAP_ADMIN_EMAIL=${example ? 'admin@example.com' : oidc.adminEmail}`,
        `OIDC_BOOTSTRAP_ADMIN_PASSWORD_HASH=${example ? "''" : quote(oidc.adminPasswordHash)}`,
        '# Two-step verification (authenticator app): required for every account (set up at the first login).',
        '# Only for tests or demos: optional',
        'OIDC_MFA=required',
        '# open: anyone can create an account (with a new organisation, password or eID); eid: only with the eID;',
        '# closed: only by invitation',
        'OIDC_REGISTRATION=open',
        '# Login with the Belgian eID (through the DafkeDD eID bridge on the PC of the user): off, on (real cards,',
        '# with OCSP) or test (also the virtual card of the bridge: npm run eid:mock in the frontend; never in production)',
        `OIDC_EID=${example ? 'on' : 'test'}`,
        '# Passkeys (fingerprint, face or PIN of the device, or a security key; counts as two-step verification): on or off',
        'OIDC_PASSKEYS=on',
        '# The domain the passkeys belong to (default: the host name of APP_URL) and the websites that may use them (default:',
        '# the origin of APP_URL, comma separated). A passkey only works on its domain: changing it later loses them all.',
        'OIDC_PASSKEY_RP_ID=',
        'OIDC_PASSKEY_ORIGINS=',
        '# Back-channel logout: how often (seconds) the logout tokens of ended sessions go to the applications; 0: never',
        'OIDC_BACKCHANNEL_INTERVAL=5',
        '',
        '# Log in at another OpenID Connect server (Microsoft Entra ID, Keycloak, Google, ...). Register this redirect URI',
        `# there: http://localhost:${port}${ISSUER_PATH}/external/callback. Leave OIDC_EXTERNAL_ISSUER empty to turn it off.`,
        `OIDC_EXTERNAL_ISSUER=${oidc.external?.issuer ?? ''}`,
        `OIDC_EXTERNAL_CLIENT_ID=${oidc.external?.clientId ?? ''}`,
        '# Empty: a public client (PKCE only); otherwise the secret of our client there (client_secret_basic)',
        `OIDC_EXTERNAL_CLIENT_SECRET=${example ? '' : quote(oidc.external?.clientSecret ?? '')}`,
        '# The text of the button: "Log in with <name>"',
        `OIDC_EXTERNAL_NAME=${quote(oidc.external?.name ?? '')}`,
        '# true: only that server (no password, no eID, no registration here)',
        `OIDC_EXTERNAL_ONLY=${oidc.external?.only ? 'true' : 'false'}`,
        '# Does a login there count as two-step verification? external: when it says so (amr "mfa"); trust: always;',
        '# local: never (our own code follows)',
        'OIDC_EXTERNAL_MFA=external',
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
        '',
        '# Licences: every user of an organisation needs a seat of a product, after a free trial of BILLING_TRIAL_DAYS days.',
        '# PAYMENTS: mollie (MOLLIE_API_KEY, test_... or live_...), fake (a checkout page of this API, development only)',
        '# or off (nothing can be bought; trials and free seats of a superadmin still work)',
        `PAYMENTS=${example ? 'mollie' : 'fake'}`,
        'MOLLIE_API_KEY=',
        'BILLING_TRIAL_DAYS=14',
        '# The public address of this API, where Mollie calls /billing/webhook (default: the origin of OIDC_ISSUER).',
        '# Mollie cannot call localhost: use a tunnel (ngrok) here to test renewals; the return page works without it.',
        '# PUBLIC_API_URL=https://api.example.com',
        '',
        '# Audit log (who did what, when, from where): days an event is kept (0 keeps everything)',
        'AUDIT_RETENTION_DAYS=365',
        '# Proxies that may tell the IP address of the user (X-Forwarded-For): loopback (this computer, the default: the',
        '# frontend and nginx on the same server), false, a number of proxies, or addresses like loopback, 10.0.0.0/8',
        'TRUST_PROXY=loopback',
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
const INVITATION_ID = '9d2c4e7a-3b1f-4c8e-a5d6-0e7f8a9b1c2d'
const TOKEN = 'v1.Qm9u…'
const BAD_REQUEST = [400, 'errors.BAD_REQUEST']
const INVALID_LINK = [400, 'oidc.INVALID_LINK']
/** An app as /admin/clients shows it. */
const APP_EXAMPLE = {
    clientId: 'partner.planner',
    name: 'Partner Planner',
    type: 'confidential',
    source: 'admin',
    disabled: false,
    redirectUris: ['https://planner.partner.com/callback'],
    postLogoutRedirectUris: ['https://planner.partner.com'],
    backchannelLogoutUri: 'https://planner.partner.com/backchannel-logout',
    backchannelLogoutSessionRequired: false,
    scopes: ['openid', 'profile', 'email'],
    grantTypes: ['authorization_code', 'refresh_token'],
    firstParty: false,
    product: 'planner',
    hasSecret: true,
    consents: 3,
    createdAt: '2026-10-15T09:00:00.000Z',
    updatedAt: '2026-10-15T09:00:00.000Z'
}
const APP_ROLES = [
    { key: 'editor', names: { en: 'Editor', nl: 'Bewerker', fr: 'Éditeur', de: 'Bearbeiter' }, default: true },
    { key: 'viewer', names: { en: 'Viewer', nl: 'Lezer', fr: 'Lecteur', de: 'Leser' }, default: false }
]
/** The apps of an invitation as the invited person sees them (GET /oidc/account/invitation). */
const INVITATION_APPS = [
    {
        clientId: 'planner',
        name: 'Planner',
        url: 'http://localhost:3001',
        roles: [{ key: 'viewer', names: APP_ROLES[1].names }],
        seat: true
    }
]
const TOO_MANY = [429, 'oidc.TOO_MANY_ATTEMPTS']
const ACCESS = level => [
    [401, 'errors.UNAUTHORIZED'],
    [403, 'errors.FORBIDDEN', `not ${level}`]
]
const PASSWORD_RULE = 'required, 12 to 128 characters'
/** A page of the audit log. */
const AUDIT_PAGE = {
    events: [
        {
            id: '1532',
            createdAt: '2026-10-14T10:02:45.000Z',
            tenant: { id: TENANT.id, name: 'Acme' },
            actor: { id: USER_ID, name: 'Ada', email: 'ada@example.com' },
            action: 'members.role_changed',
            target: { type: 'user', id: '9a4c1e2b-7d3f-4b8a-9c6e-5f1d2a3b4c5d', label: 'bob@example.com' },
            details: { from: 'user', to: 'admin' },
            ip: '203.0.113.7',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) … Chrome/141.0'
        }
    ],
    next: '1532'
}
const SUBSCRIPTION_ID = '3c8e1f0a-7b2d-4e5f-9a6b-1d2c3e4f5a6b'
const PRODUCT = {
    id: '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    code: 'planner',
    name: 'Planner',
    description: 'Plan the week of your team',
    priceMonthCents: 900,
    priceYearCents: 9000,
    currency: 'EUR',
    active: true,
    createdAt: '2026-10-01T08:00:00.000Z'
}
const DISCOUNT = {
    id: '7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b',
    code: 'WELCOME-50',
    percentOff: 50,
    amountOffCents: null,
    productId: PRODUCT.id,
    productCode: 'planner',
    duration: 'repeating',
    durationPeriods: 3,
    maxRedemptions: 100,
    redemptions: 0,
    expiresAt: '2026-12-31T23:59:59.000Z',
    active: true,
    createdAt: '2026-10-14T08:00:00.000Z'
}
const GRANT = {
    id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
    tenantId: TENANT.id,
    productId: PRODUCT.id,
    seats: 3,
    endsAt: '2027-06-30T00:00:00.000Z',
    note: 'Partner',
    createdAt: '2026-10-14T08:00:00.000Z'
}
const OVERVIEW = {
    product: PRODUCT,
    subscription: {
        id: SUBSCRIPTION_ID,
        tenantId: TENANT.id,
        productId: PRODUCT.id,
        interval: 'year',
        seats: 5,
        status: 'active',
        currentPeriodEnd: '2027-10-14T08:00:00.000Z',
        cancelAtPeriodEnd: false,
        discountPeriodsLeft: null,
        paid: true,
        valid: true,
        renewalCents: 45000,
        discount: null
    },
    grants: [{ ...GRANT, valid: true }],
    seats: { paid: 5, free: 3, total: 8, used: 2 },
    trials: [{ userId: USER_ID, endsAt: '2026-10-28T08:00:00.000Z', active: true }],
    assignments: [{ userId: USER_ID, assignedAt: '2026-10-14T09:00:00.000Z', active: true }]
}
/** The body of a purchase (and of its quote). */
const PURCHASE = {
    example: { productCode: 'planner', interval: 'year', seats: 5, discountCode: 'WELCOME-50' },
    fields: [
        ['productCode', 'string', 'required'],
        ['interval', 'string', '`month` or `year` (cheaper)'],
        ['seats', 'number', 'required, 1 to 10000: one per user'],
        ['discountCode', 'string', 'optional']
    ]
}
const CHECK_EMAIL = { status: 202, example: { status: 'check-email' } }
const EID_DISABLED = [404, 'oidc.EID_DISABLED']
/** The token of the DafkeDD eID bridge after the PIN (shortened). */
const EID_TOKEN = {
    unverifiedCertificate: 'MIIDezCCAmOg…',
    algorithm: 'ES384',
    signature: 'Mz9k…',
    format: 'web-eid:1.0',
    appVersion: 'https://github.com/DafkeDD/DafkeDD_EID'
}
const EID_CHALLENGE = {
    challenge: 'v1.eid-challenge…',
    nonce: 'q8Xz…44 characters…',
    expiresAt: '2026-10-14T09:05:00.000Z'
}
const EID_TOKEN_FIELDS = [
    ['challenge', 'string', 'required, from the challenge endpoint (valid 5 minutes)'],
    ['token', 'object', 'required, the answer of the eID bridge after the PIN (`useEidLogin().login()`)']
]

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
            'The login page (HTML, in the language of the browser or ui_locales) of a running login. Valid 10 minutes. With `Accept: application/json` (the login page of the frontend): what the page shows — email and password (`password`), the eID, "Log in with <name>" (`external`) — and `pending: true` when the login came back from the other server halfway (then POST .../resume).',
        response: {
            status: 200,
            example: {
                step: 'login',
                clientName: 'Frontend',
                registration: true,
                password: true,
                eid: true,
                external: { name: 'Contoso' },
                pending: false,
                csrf: 'from-the-page',
                loginHint: ''
            }
        },
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
        path: '/oidc/interaction/:id/eid/challenge',
        tag: 'oidc',
        summary:
            'Log in with the Belgian eID, step 1 (JSON, from the login page of the frontend): a nonce for the DafkeDD eID bridge. The login cookie remembers it; it works once.',
        body: {
            example: { csrf: 'from-the-page' },
            fields: [['csrf', 'string', 'required, from GET /oidc/interaction/:id']]
        },
        response: { status: 200, example: { status: 'eid-challenge', nonce: 'q8Xz…44 characters…' } },
        errors: [EID_DISABLED]
    },
    {
        method: 'POST',
        path: '/oidc/interaction/:id/eid',
        tag: 'oidc',
        summary:
            'Log in with the Belgian eID, step 2: the token of the bridge (the card signed the nonce after the PIN). Counts as two-step verification: acr `loa4`, amr `sc pin mfa`. Errors as JSON { status: "error", error }: EID_INVALID (401), EID_EXPIRED (400), EID_NOT_LINKED (404), EID_UNAVAILABLE (503, OCSP), EMAIL_NOT_VERIFIED (403). Rate limited.',
        body: {
            example: { csrf: 'from-the-page', token: EID_TOKEN },
            fields: [
                ['csrf', 'string', 'required, from GET /oidc/interaction/:id'],
                ['token', 'object', 'required, the answer of the eID bridge after the PIN']
            ]
        },
        response: { status: 200, example: { status: 'redirect', location: FRONTEND_CALLBACK + '?code=…&state=…' } },
        errors: [EID_DISABLED]
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
        path: '/oidc/interaction/:id/passkey/challenge',
        tag: 'oidc',
        summary:
            'Log in with a passkey, step 1 (OIDC_PASSKEYS; GET /oidc/interaction/:id says `passkey: true`): the options for `navigator.credentials.get()`. The challenge waits in the login cookie and works once.',
        body: {
            example: { csrf: 'from-the-page' },
            fields: [['csrf', 'string', 'required, from GET /oidc/interaction/:id']]
        },
        response: {
            status: 200,
            example: {
                status: 'passkey-challenge',
                options: {
                    challenge: 'q6l0D9YvC2y4ZLm2rHd3o1yHq0jYv1Jx3Cxk0E4b3cM',
                    rpId: 'localhost',
                    userVerification: 'required',
                    timeout: 300000
                }
            }
        },
        errors: [
            [404, 'oidc.PASSKEYS_DISABLED'],
            [410, 'oidc.EXPIRED']
        ]
    },
    {
        method: 'POST',
        path: '/oidc/interaction/:id/passkey',
        tag: 'oidc',
        summary:
            'Log in with a passkey, step 2: the answer of `navigator.credentials.get()` (base64url fields). Checks the challenge, origin, rpId, user verification, signature and sign counter. A passkey with PIN, fingerprint or face counts as two-step verification (amr `pop user mfa`, acr loa2): straight on to the organisation choice. Rate limited.',
        body: {
            example: {
                csrf: 'from-the-page',
                credential: {
                    id: 'base64url credential id',
                    rawId: 'base64url credential id',
                    type: 'public-key',
                    response: {
                        clientDataJSON: 'base64url',
                        authenticatorData: 'base64url',
                        signature: 'base64url',
                        userHandle: 'base64url user id'
                    }
                }
            },
            fields: [
                ['csrf', 'string', 'required, from GET /oidc/interaction/:id'],
                ['credential', 'object', 'required, the PublicKeyCredential as JSON (base64url)']
            ]
        },
        response: {
            status: 200,
            example: { status: 'redirect', location: 'http://localhost:3000/auth/callback?code=...' }
        },
        errors: [
            [400, 'oidc.PASSKEY_EXPIRED'],
            [401, 'oidc.PASSKEY_INVALID'],
            [401, 'oidc.PASSKEY_UNKNOWN'],
            [403, 'oidc.ACCOUNT_DISABLED'],
            [404, 'oidc.PASSKEYS_DISABLED'],
            [429, 'oidc.TOO_MANY_ATTEMPTS']
        ]
    },
    {
        method: 'POST',
        path: '/oidc/interaction/:id/external',
        tag: 'oidc',
        summary:
            '"Log in with <name>": to the other OpenID Connect server (OIDC_EXTERNAL_ISSUER), with PKCE, state and nonce. Form-encoded (303 to that server) or JSON (`{ status: "redirect", location }`). The login waits in a cookie `oidc_ext_<...>` named after its state (only sent to the callback).',
        form: true,
        body: {
            example: { csrf: 'from-the-page' },
            fields: [['csrf', 'string', 'required, the hidden field of the page']]
        },
        response: null,
        errors: [[404, 'oidc.EXTERNAL_DISABLED']]
    },
    {
        method: 'GET',
        path: '/oidc/external/callback',
        tag: 'oidc',
        summary:
            'Back from the other OpenID Connect server: register this URL there as redirect URI. Checks the state, exchanges the code (PKCE, client secret) and checks the ID token with its keys (issuer, audience, expiry, nonce). The account is the one linked to that person, or the one with the same verified email address, or a new one; then the login goes on (second factor, organisation) and ends at the client.',
        pathExample: '/oidc/external/callback?code=SplxlOBeZQQYbYS6WxSbIA&state=af0ifjsldkj',
        response: null,
        errors: [
            [400, 'oidc.EXPIRED'],
            [401, 'oidc.EXTERNAL_FAILED'],
            [400, 'oidc.EXTERNAL_NO_EMAIL'],
            [403, 'oidc.EXTERNAL_EMAIL_UNVERIFIED'],
            [409, 'oidc.EXTERNAL_EMAIL_TAKEN'],
            [409, 'oidc.EXTERNAL_OTHER_LINKED']
        ]
    },
    {
        method: 'POST',
        path: '/oidc/interaction/:id/resume',
        tag: 'oidc',
        summary:
            'For the login page of the frontend after the callback of the other server (GET /oidc/interaction/:id says `pending: true`): goes on with the second factor, setting it up, or the organisation choice.',
        body: {
            example: { csrf: 'from-the-page' },
            fields: [['csrf', 'string', 'required, from GET /oidc/interaction/:id']]
        },
        response: { status: 200, example: { status: 'mfa', csrf: 'from-the-page' } },
        errors: [[410, 'oidc.EXPIRED']]
    },
    {
        method: 'POST',
        path: '/oidc/interaction/:id/consent',
        tag: 'oidc',
        summary:
            'The consent screen "Allow <client>?" of an application that is not our own (`firstParty: false`): it appears after the login (or straight away with single sign-on) when the account did not allow those scopes yet, or with `prompt=consent`. Form-encoded (303) or JSON. `decision: "allow"` remembers the scopes and sends the code; anything else sends `error=access_denied`. Answers once. With `prompt=none` and no consent the client gets `error=consent_required`.',
        form: true,
        body: {
            example: { csrf: 'from-the-page', decision: 'allow' },
            fields: [
                ['csrf', 'string', 'required, the hidden field of the page (or from GET /oidc/interaction/:id)'],
                ['decision', 'string', '`allow`, or `deny` (anything else counts as deny)']
            ]
        },
        response: {
            status: 200,
            example: { status: 'redirect', location: 'https://partner.example.com/callback?code=...&state=xyz&iss=...' }
        },
        errors: [[410, 'oidc.EXPIRED']]
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
            'Exchange the code for tokens, or a refresh token for new tokens. Public clients send client_id (and the PKCE code_verifier); confidential clients also authenticate (Basic or client_secret). Clients with the refresh_token grant also get a refresh_token: bound to the session (at most 12 hours), and used up at every refresh (rotation).',
        form: true,
        variants: [
            {
                title: 'Refresh (grant_type=refresh_token)',
                body: {
                    example: {
                        grant_type: 'refresh_token',
                        refresh_token: 'refresh-token-from-before',
                        client_id: 'frontend'
                    },
                    fields: [
                        ['grant_type', 'string', '`refresh_token`'],
                        [
                            'refresh_token',
                            'string',
                            'required; works once (a second use within 30 seconds is allowed, later it ends the session)'
                        ],
                        ['client_id', 'string', 'required for public clients'],
                        ['scope', 'string', 'optional, the same or smaller than before']
                    ]
                }
            }
        ],
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
                scope: 'openid profile email tenant',
                refresh_token: 'Vb3k…43 characters…'
            }
        },
        oauthErrors: [
            'invalid_request',
            'invalid_client',
            'invalid_grant',
            'invalid_scope',
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
    {
        method: 'POST',
        path: '/oidc/revoke',
        tag: 'oidc',
        summary:
            'Revoke a refresh token (RFC 7009) with its whole family: the frontend does this when the user logs out. Unknown tokens get the same 200 answer. Access tokens cannot be revoked one by one: they live 10 minutes and stop with their session.',
        form: true,
        body: {
            example: { token: 'refresh-token', token_type_hint: 'refresh_token', client_id: 'frontend' },
            fields: [
                ['token', 'string', 'required, the refresh token'],
                ['token_type_hint', 'string', 'optional, `refresh_token`'],
                ['client_id', 'string', 'required for public clients (confidential clients authenticate)']
            ]
        },
        response: { status: 200, example: {} },
        oauthErrors: ['invalid_request', 'invalid_client', 'unsupported_token_type'],
        errors: []
    },
    {
        method: 'POST',
        path: '/oidc/introspect',
        tag: 'oidc',
        summary:
            'Is a token active, and what does it say (RFC 7662)? For confidential clients (resource servers, other backends), authenticated with Basic or client_secret. An access token is active while it did not expire and its session did not end; a refresh token only for its own client.',
        basic: 'server-app',
        form: true,
        body: {
            example: { token: 'eyJhbGciOiJFUzI1NiIs…' },
            fields: [['token', 'string', 'required, an access token or a refresh token']]
        },
        response: {
            status: 200,
            example: {
                active: true,
                token_type: 'Bearer',
                sub: USER_ID,
                client_id: 'frontend',
                scope: 'openid profile email tenant',
                exp: 1760000600,
                sid: '0f8f8a52-55a3-4b8e-9d55-3f1f2f8b1c10',
                tenant: TENANT
            }
        },
        oauthErrors: ['invalid_request', 'invalid_client'],
        errors: []
    },
    {
        method: 'GET',
        path: '/oidc/logout',
        tag: 'oidc',
        summary:
            'Log out (end_session_endpoint, OpenID Connect RP-Initiated Logout 1.0). With an id_token_hint of the user of this browser the session ends at once (and with it its refresh and access tokens); without one the page "Log out?" asks first. Then back to post_logout_redirect_uri, or the page "You are logged out".',
        curl: `curl -i -b 'oidc_session=…' 'http://localhost:${port}/oidc/logout?id_token_hint=eyJ…&post_logout_redirect_uri=${encodeURIComponent(APP_URL)}&state=xyz'`,
        query: [
            ['id_token_hint', 'recommended', 'An ID token this server gave the client (an expired one is fine)'],
            [
                'client_id',
                'optional',
                'The client (needed without id_token_hint when post_logout_redirect_uri is sent)'
            ],
            ['post_logout_redirect_uri', 'optional', 'Exactly one of the `postLogoutRedirectUris` of the client'],
            ['state', 'optional', 'Returned unchanged on the redirect'],
            ['ui_locales', 'optional', 'Language of the pages']
        ],
        response: null,
        errors: []
    },
    {
        method: 'POST',
        path: '/oidc/logout',
        tag: 'oidc',
        summary:
            'The form of the page "Log out?" (form-encoded): the same parameters, with confirm=yes and its CSRF token. Logs out and goes back like GET /oidc/logout.',
        form: true,
        body: {
            example: {
                client_id: 'frontend',
                post_logout_redirect_uri: APP_URL,
                confirm: 'yes',
                csrf: 'from-the-page'
            },
            fields: [
                ['client_id', 'string', 'optional'],
                ['post_logout_redirect_uri', 'string', 'optional, registered for the client'],
                ['confirm', 'string', '`yes`'],
                ['csrf', 'string', 'required, the hidden field of the page (bound to the session cookie)']
            ]
        },
        response: null,
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
        method: 'GET',
        path: '/oidc/account/registration',
        tag: 'account',
        summary:
            'Which ways of registering are open: with a password (OIDC_REGISTRATION=open) and with the Belgian eID (OIDC_EID on or test, registration not closed).',
        response: { status: 200, example: { password: true, eid: true } },
        errors: []
    },
    {
        method: 'POST',
        path: '/oidc/account/eid/challenge',
        tag: 'account',
        summary:
            'Start registering with the Belgian eID: a nonce for the eID bridge and an encrypted challenge to send back with its token (valid 5 minutes). Rate limited.',
        response: { status: 200, example: EID_CHALLENGE },
        errors: [EID_DISABLED, TOO_MANY]
    },
    {
        method: 'POST',
        path: '/oidc/account/register-eid',
        tag: 'account',
        summary:
            'Create an account with the Belgian eID and a new organisation (the account becomes its admin). The name comes from the card; there is no password. Only an HMAC of the national register number is stored. The email address must still be verified. Rate limited.',
        body: {
            example: {
                challenge: EID_CHALLENGE.challenge,
                token: EID_TOKEN,
                email: 'jan@example.com',
                organisation: 'Acme'
            },
            fields: [
                ...EID_TOKEN_FIELDS,
                ['email', 'string', 'required, a valid email address (at most 254)'],
                ['organisation', 'string', 'required, 2 to 100 characters: the name of the new tenant']
            ]
        },
        response: { status: 202, example: { status: 'check-email', name: 'Jan Specimen' } },
        errors: [
            BAD_REQUEST,
            [400, 'oidc.EID_EXPIRED'],
            [401, 'oidc.EID_INVALID'],
            [403, 'oidc.REGISTRATION_CLOSED'],
            EID_DISABLED,
            [409, 'oidc.EID_ALREADY_LINKED'],
            TOO_MANY,
            [503, 'oidc.EID_UNAVAILABLE']
        ]
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
        summary:
            'The details of an invitation, for the page that accepts it: also the apps it gives access to (name, address, the roles that come with it, and whether a seat does).',
        curl: `curl 'http://localhost:${port}/oidc/account/invitation?token=TOKEN'`,
        query: [['token', 'required', 'The token from the link in the invitation email']],
        response: {
            status: 200,
            example: {
                email: 'bob@example.com',
                tenantName: 'Acme',
                role: 'user',
                inviterName: 'Ada Lovelace',
                accountExists: false,
                apps: INVITATION_APPS
            }
        },
        errors: [INVALID_LINK]
    },
    {
        method: 'POST',
        path: '/oidc/account/invitation/accept',
        tag: 'account',
        summary:
            'Accept an invitation. An existing account joins the organisation; otherwise name and password create a (verified) account. The inviter must still be admin and the tenant active. The member gets the roles chosen for each app of the invitation and, when asked, a free seat (`seat: false` when none was free: the trial runs anyway); `url` opens the app.',
        body: {
            example: { token: TOKEN, name: 'Bob', password: 'correct-horse-battery' },
            fields: [
                ['token', 'string', 'required, from the link'],
                ['name', 'string', 'only for a new account, 2 to 100 characters'],
                ['password', 'string', 'only for a new account, 12 to 128 characters']
            ]
        },
        response: {
            status: 200,
            example: {
                status: 'accepted',
                tenantName: 'Acme',
                accountExists: false,
                apps: [{ clientId: 'planner', name: 'Planner', url: 'http://localhost:3001', seat: true }]
            }
        },
        errors: [BAD_REQUEST, INVALID_LINK, [400, 'oidc.ACCOUNT_DETAILS_NEEDED']]
    },
    // ---------------------------------------------------------------- members of the own tenant (admins)
    {
        method: 'GET',
        path: '/tenants/current/members',
        tag: 'tenant members',
        summary:
            'The members of the tenant of the access token: role, status (active or disabled), online (a request in the last 2 minutes) and last seen. For admins of that tenant (and superadmins).',
        bearer: true,
        response: {
            status: 200,
            example: [
                {
                    userId: USER_ID,
                    name: 'Ada Lovelace',
                    email: 'ada@example.com',
                    emailVerified: true,
                    role: 'admin',
                    status: 'active',
                    lastSeenAt: '2026-10-13T09:41:00.000Z',
                    online: true
                }
            ]
        },
        errors: ACCESS('admin')
    },
    {
        method: 'POST',
        path: '/tenants/current/invitations',
        tag: 'tenant members',
        summary:
            'Invite someone by email as user or admin of the tenant (the link is valid 7 days), optionally with apps: the roles in each app (`null`: its default roles) and a free seat of the product it sells. The email names the apps; accepting gives them.',
        bearer: true,
        body: {
            example: {
                email: 'bob@example.com',
                role: 'user',
                apps: [{ clientId: 'planner', roles: ['viewer'], seat: true }]
            },
            fields: [
                ['email', 'string', 'required, a valid email address'],
                ['role', 'string', '`user` or `admin`'],
                [
                    'apps',
                    'object[]',
                    'optional, at most 20 apps of `GET /tenants/current/apps`: `{ clientId, roles, seat }`; `roles` the role keys of the app (`null` or left out: the default roles), `seat` true: one of the free seats (ignored for an app that sells nothing)'
                ]
            ]
        },
        response: { status: 202, example: { status: 'invited', email: 'bob@example.com', id: INVITATION_ID } },
        errors: [
            BAD_REQUEST,
            [400, 'oidc.INVITATION_APP_UNKNOWN'],
            [400, 'oidc.ROLE_UNKNOWN'],
            ...ACCESS('admin'),
            [409, 'oidc.ALREADY_MEMBER']
        ]
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
    {
        method: 'GET',
        path: '/tenants/current/apps',
        tag: 'tenant members',
        summary:
            'The apps the admins of the tenant can give to members and invite to: every app made on /admin and every app with roles. With the address to open it (`url`), the product it sells (`null`: free) and its roles (defined by its developer).',
        bearer: true,
        response: {
            status: 200,
            example: [
                {
                    clientId: 'planner',
                    name: 'Planner',
                    url: 'http://localhost:3001',
                    product: 'planner',
                    roles: APP_ROLES
                }
            ]
        },
        errors: ACCESS('admin')
    },
    {
        method: 'GET',
        path: '/tenants/current/apps/:clientId/members',
        tag: 'tenant members',
        summary:
            'Every member of the tenant with its roles in the app. `assigned: false`: nobody gave roles, the default roles of the app apply.',
        bearer: true,
        pathExample: '/tenants/current/apps/planner/members',
        response: {
            status: 200,
            example: [
                {
                    userId: USER_ID,
                    name: 'Ada Lovelace',
                    email: 'ada@example.com',
                    role: 'admin',
                    status: 'active',
                    roles: ['editor'],
                    assigned: false
                }
            ]
        },
        errors: [...ACCESS('admin'), [404, 'oidc.APP_NOT_FOUND']]
    },
    {
        method: 'PUT',
        path: '/tenants/current/apps/:clientId/members/:userId',
        tag: 'tenant members',
        summary:
            'Give a member roles in the app (the keys of the app); `[]` is no roles, `null` the default roles again. The app sees it at the next login or refresh.',
        bearer: true,
        pathExample: `/tenants/current/apps/planner/members/${USER_ID}`,
        body: {
            example: { roles: ['viewer'] },
            fields: [['roles', 'string[] | null', 'the role keys of the app (at most 20); null: the default roles']]
        },
        response: { status: 200, example: { userId: USER_ID, roles: ['viewer'], assigned: true } },
        errors: [
            BAD_REQUEST,
            [400, 'oidc.ROLE_UNKNOWN'],
            ...ACCESS('admin'),
            [404, 'oidc.APP_NOT_FOUND'],
            [404, 'oidc.MEMBER_NOT_FOUND']
        ]
    },
    {
        method: 'PATCH',
        path: '/tenants/current/members/:userId/status',
        tag: 'tenant members',
        summary:
            'Disable a member (cannot log in to this tenant or use its API; its sessions end at once) or enable it again. The tenant always keeps an active admin.',
        bearer: true,
        pathExample: `/tenants/current/members/${USER_ID}/status`,
        body: { example: { status: 'disabled' }, fields: [['status', 'string', '`active` or `disabled`']] },
        response: { status: 200, example: { userId: USER_ID, status: 'disabled' } },
        errors: [BAD_REQUEST, ...ACCESS('admin'), [404, 'oidc.MEMBER_NOT_FOUND'], [409, 'oidc.LAST_ADMIN']]
    },
    {
        method: 'GET',
        path: '/tenants/current/invitations',
        tag: 'tenant members',
        summary: 'The open invitations of the tenant (not accepted, not withdrawn, not expired), newest first.',
        bearer: true,
        response: {
            status: 200,
            example: [
                {
                    id: INVITATION_ID,
                    tenantId: TENANT.id,
                    email: 'bob@example.com',
                    role: 'user',
                    invitedBy: USER_ID,
                    invitedByName: 'Ada Lovelace',
                    apps: [{ clientId: 'planner', roles: ['viewer'], seat: true }],
                    createdAt: '2026-10-13T09:00:00.000Z',
                    expiresAt: '2026-10-20T09:00:00.000Z'
                }
            ]
        },
        errors: ACCESS('admin')
    },
    {
        method: 'POST',
        path: '/tenants/current/invitations/:id/resend',
        tag: 'tenant members',
        summary: 'Send an open invitation again: a new link, valid for 7 more days.',
        bearer: true,
        pathExample: `/tenants/current/invitations/${INVITATION_ID}/resend`,
        response: { status: 202, example: { status: 'invited', email: 'bob@example.com', id: INVITATION_ID } },
        errors: [...ACCESS('admin'), [404, 'oidc.INVITATION_NOT_FOUND']]
    },
    {
        method: 'DELETE',
        path: '/tenants/current/invitations/:id',
        tag: 'tenant members',
        summary: 'Withdraw an open invitation: the link in the email stops working. Answers 204.',
        bearer: true,
        pathExample: `/tenants/current/invitations/${INVITATION_ID}`,
        response: null,
        errors: [...ACCESS('admin'), [404, 'oidc.INVITATION_NOT_FOUND']]
    },
    {
        method: 'POST',
        path: '/me/heartbeat',
        tag: 'tenant members',
        summary:
            'The logged in member is active: online for the admins of the tenant (the frontend sends it every minute while a page is open). Answers 204.',
        bearer: true,
        response: null,
        errors: [
            [401, 'errors.UNAUTHORIZED'],
            [403, 'errors.FORBIDDEN', 'not a member']
        ]
    },
    // ---------------------------------------------------------------- apps (superadmins)
    {
        method: 'GET',
        path: '/admin/clients',
        tag: 'apps (superadmin)',
        summary:
            'Every app that may log in (OpenID Connect clients): `source: "file"` from config/oidc-clients.json (read-only here) and `source: "admin"` made on /admin. Never a secret or its hash. Superadmins only.',
        bearer: true,
        response: { status: 200, example: [APP_EXAMPLE] },
        errors: ACCESS('superadmin')
    },
    {
        method: 'POST',
        path: '/admin/clients',
        tag: 'apps (superadmin)',
        summary:
            'Makes an app. A confidential one gets a secret (32 random bytes): it is in this answer only, only its sha256 is stored. Every address is checked (https, http only on localhost, no #fragment); `openid` is always in the scopes.',
        bearer: true,
        body: {
            example: {
                name: 'Partner Planner',
                clientId: 'partner.planner',
                type: 'confidential',
                redirectUris: ['https://planner.partner.com/callback'],
                postLogoutRedirectUris: ['https://planner.partner.com'],
                backchannelLogoutUri: 'https://planner.partner.com/backchannel-logout',
                scopes: ['openid', 'profile', 'email'],
                refreshTokens: true,
                firstParty: false,
                product: 'planner'
            },
            fields: [
                ['name', 'string', 'required, 2 to 100 characters'],
                ['clientId', 'string', 'optional, letters, digits, . _ - (3 to 100); empty: made from the name'],
                ['type', 'string', '`public` (PKCE, no secret) or `confidential` (a server, gets a secret)'],
                ['redirectUris', 'string[]', 'required, 1 to 10 exact addresses'],
                ['postLogoutRedirectUris', 'string[]', 'optional, 0 to 10'],
                ['backchannelLogoutUri', 'string', 'optional, back-channel logout; empty: none'],
                ['scopes', 'string[]', '`openid`, `profile`, `email`, `tenant`'],
                ['refreshTokens', 'boolean', 'required, also refresh tokens'],
                ['firstParty', 'boolean', 'required, `true`: your own app (no consent screen, may call this API)'],
                [
                    'product',
                    'string',
                    'optional, the product code of /licenses this app sells (one licence per user, one app per product); empty or `null`: a free app'
                ]
            ]
        },
        response: {
            status: 201,
            example: { client: APP_EXAMPLE, secret: 'Jq3v1yHq0jYv1Jx3Cxk0E4b3cMq6l0D9YvC2y4ZLm2r' }
        },
        errors: [
            [400, 'oidc.CLIENT_INVALID_URI'],
            [400, 'oidc.CLIENT_NO_REDIRECT'],
            [400, 'oidc.CLIENT_UNKNOWN_PRODUCT'],
            ...ACCESS('superadmin'),
            [409, 'oidc.CLIENT_EXISTS'],
            [409, 'oidc.CLIENT_PRODUCT_TAKEN']
        ]
    },
    {
        method: 'PUT',
        path: '/admin/clients/:clientId',
        tag: 'apps (superadmin)',
        summary: 'Changes an app made on /admin: the same fields as making one, except its id and type.',
        pathExample: '/admin/clients/partner.planner',
        bearer: true,
        body: {
            example: {
                name: 'Partner Planner',
                redirectUris: ['https://planner.partner.com/callback'],
                postLogoutRedirectUris: [],
                backchannelLogoutUri: '',
                scopes: ['openid', 'email'],
                refreshTokens: false,
                firstParty: false,
                product: 'planner'
            },
            fields: [
                ['name', 'string', 'required'],
                ['redirectUris', 'string[]', 'required'],
                ['postLogoutRedirectUris', 'string[]', 'optional'],
                ['backchannelLogoutUri', 'string', 'optional'],
                ['scopes', 'string[]', 'required'],
                ['refreshTokens', 'boolean', 'required'],
                ['firstParty', 'boolean', 'required'],
                ['product', 'string', 'optional, the product this app sells; empty or `null`: none']
            ]
        },
        response: { status: 200, example: APP_EXAMPLE },
        errors: [
            [400, 'oidc.CLIENT_INVALID_URI'],
            [400, 'oidc.CLIENT_UNKNOWN_PRODUCT'],
            ...ACCESS('superadmin'),
            [404, 'oidc.CLIENT_NOT_FOUND'],
            [409, 'oidc.CLIENT_FROM_FILE'],
            [409, 'oidc.CLIENT_PRODUCT_TAKEN']
        ]
    },
    {
        method: 'POST',
        path: '/admin/clients/:clientId/link-code',
        tag: 'apps (superadmin)',
        summary:
            'A one-time link code (15 minutes) for an app made on /admin. In the CLI, the backend "App for an existing DafkeDD OIDC server (link code)" links a new app to this app with it (POST /oidc/link). An earlier unused code of the app stops.',
        pathExample: '/admin/clients/partner.planner/link-code',
        bearer: true,
        response: {
            status: 200,
            example: {
                code: 'K7QM-2XPD-9HRT',
                expiresAt: '2026-10-19T15:45:00.000Z',
                issuer: `http://localhost:${port}/oidc`
            }
        },
        errors: [...ACCESS('superadmin'), [404, 'oidc.CLIENT_NOT_FOUND'], [409, 'oidc.CLIENT_FROM_FILE']]
    },
    {
        method: 'POST',
        path: '/oidc/link',
        tag: 'apps (superadmin)',
        summary:
            'Used by the CLI, without login (the code is the permission): uses a link code once and answers the settings of the app, with the addresses of the new project added (redirect URIs, after logout; the back-channel URI only when the app has none). A confidential app gets a new secret here, in this answer only (the old one stops). Rate limited per IP address.',
        body: {
            example: {
                code: 'K7QM-2XPD-9HRT',
                redirectUris: ['http://localhost:3001/api/auth/callback'],
                postLogoutRedirectUris: ['http://localhost:3001'],
                backchannelLogoutUri: 'http://localhost:3001/api/auth/backchannel-logout',
                roles: APP_ROLES
            },
            fields: [
                ['code', 'string', 'required, the link code of /admin (case and dashes do not matter)'],
                ['redirectUris', 'string[]', 'optional, added to the app (https; http only on localhost)'],
                ['postLogoutRedirectUris', 'string[]', 'optional, added to the app'],
                ['backchannelLogoutUri', 'string', 'optional, only when the app has none yet'],
                ['roles', 'object[]', 'optional, the roles of the new app: they replace the roles of the app']
            ]
        },
        response: {
            status: 200,
            example: {
                issuer: `http://localhost:${port}/oidc`,
                apiUrl: `http://localhost:${port}`,
                accountUrl: APP_URL,
                client: {
                    clientId: 'partner.planner',
                    name: 'Partner Planner',
                    type: 'public',
                    scopes: ['openid', 'profile', 'email', 'tenant'],
                    firstParty: true,
                    refreshTokens: true,
                    product: 'planner',
                    roles: ['editor', 'viewer']
                },
                clientSecret: null
            }
        },
        errors: [
            [400, 'oidc.LINK_CODE_INVALID'],
            [400, 'oidc.CLIENT_INVALID_URI'],
            [400, 'oidc.ROLES_INVALID'],
            [429, 'oidc.TOO_MANY_ATTEMPTS']
        ]
    },
    {
        method: 'POST',
        path: '/oidc/link/roles',
        tag: 'apps (superadmin)',
        summary:
            'Used by `npm run roles:push` in the backend of an app, without login (the link code of the app is the permission): the roles of config/app-roles.json replace the roles of the app. Nothing else changes (no new secret). Rate limited per IP address.',
        body: {
            example: { code: 'K7QM-2XPD-9HRT', roles: APP_ROLES },
            fields: [
                ['code', 'string', 'required, a link code of the app (/admin → Apps)'],
                [
                    'roles',
                    'object[]',
                    'required, 0 to 20: `key` (a-z, 0-9, -, starting with a letter), `names` in en, nl, fr and de, `default`'
                ]
            ]
        },
        response: { status: 200, example: { clientId: 'planner', roles: ['editor', 'viewer'] } },
        errors: [[400, 'oidc.LINK_CODE_INVALID'], [400, 'oidc.ROLES_INVALID'], TOO_MANY]
    },
    {
        method: 'POST',
        path: '/admin/clients/:clientId/secret',
        tag: 'apps (superadmin)',
        summary: 'A new secret for a confidential app made on /admin: the old one stops at once. In this answer only.',
        pathExample: '/admin/clients/partner.planner/secret',
        bearer: true,
        response: {
            status: 200,
            example: { client: APP_EXAMPLE, secret: 'q6l0D9YvC2y4ZLm2rHd3o1yHq0jYv1Jx3Cxk0E4b3cM' }
        },
        errors: [...ACCESS('superadmin'), [404, 'oidc.CLIENT_NOT_FOUND'], [409, 'oidc.CLIENT_PUBLIC']]
    },
    {
        method: 'PATCH',
        path: '/admin/clients/:clientId',
        tag: 'apps (superadmin)',
        summary:
            'Disables (`enabled: false`) or enables an app made on /admin. Disabled: nobody can log in with it, its refresh tokens and unused codes stop at once, and its access tokens no longer reach the API.',
        pathExample: '/admin/clients/partner.planner',
        bearer: true,
        body: { example: { enabled: false }, fields: [['enabled', 'boolean', 'required']] },
        response: { status: 200, example: { ...APP_EXAMPLE, disabled: true } },
        errors: [...ACCESS('superadmin'), [404, 'oidc.CLIENT_NOT_FOUND'], [409, 'oidc.CLIENT_FROM_FILE']]
    },
    {
        method: 'DELETE',
        path: '/admin/clients/:clientId',
        tag: 'apps (superadmin)',
        summary:
            'Removes a disabled app made on /admin, with its codes, refresh tokens, consents and session links. Answers 204.',
        pathExample: '/admin/clients/partner.planner',
        bearer: true,
        response: null,
        errors: [
            ...ACCESS('superadmin'),
            [404, 'oidc.CLIENT_NOT_FOUND'],
            [409, 'oidc.CLIENT_DISABLE_FIRST'],
            [409, 'oidc.CLIENT_FROM_FILE']
        ]
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
    },
    // ---------------------------------------------------------------- the eID of the own account
    {
        method: 'GET',
        path: '/me/eid',
        tag: 'eID',
        summary:
            'Is a Belgian eID linked to the logged in account? `enabled`: the server has eID login; `hasPassword`: false when the eID is the only login.',
        bearer: true,
        response: {
            status: 200,
            example: {
                enabled: true,
                linked: true,
                linkedAt: '2026-10-14T09:00:00.000Z',
                lastUsedAt: null,
                hasPassword: true
            }
        },
        errors: [[401, 'errors.UNAUTHORIZED']]
    },
    {
        method: 'POST',
        path: '/me/eid/challenge',
        tag: 'eID',
        summary:
            'Start linking an eID: a nonce for the eID bridge and an encrypted challenge, for this account only (5 minutes).',
        bearer: true,
        response: { status: 200, example: EID_CHALLENGE },
        errors: [[401, 'errors.UNAUTHORIZED'], EID_DISABLED]
    },
    {
        method: 'POST',
        path: '/me/eid',
        tag: 'eID',
        summary:
            'Link the eID: the challenge and the token of the bridge after the PIN. Then the account can log in with it.',
        bearer: true,
        body: { example: { challenge: EID_CHALLENGE.challenge, token: EID_TOKEN }, fields: EID_TOKEN_FIELDS },
        response: {
            status: 200,
            example: {
                enabled: true,
                linked: true,
                linkedAt: '2026-10-14T09:00:00.000Z',
                lastUsedAt: null,
                hasPassword: true
            }
        },
        errors: [
            BAD_REQUEST,
            [400, 'oidc.EID_EXPIRED'],
            [401, 'oidc.EID_INVALID'],
            EID_DISABLED,
            [409, 'oidc.EID_ALREADY_LINKED'],
            [409, 'oidc.EID_OTHER_LINKED'],
            TOO_MANY,
            [503, 'oidc.EID_UNAVAILABLE']
        ]
    },
    {
        method: 'DELETE',
        path: '/me/eid',
        tag: 'eID',
        summary:
            'Unlink the eID. Not for an account without a password: its eID is its only login (choose a password first).',
        bearer: true,
        response: {
            status: 200,
            example: { enabled: true, linked: false, linkedAt: null, lastUsedAt: null, hasPassword: true }
        },
        errors: [
            [401, 'errors.UNAUTHORIZED'],
            [409, 'oidc.EID_ONLY_LOGIN']
        ]
    },
    // ---------------------------------------------------------------- the sessions of the own account
    {
        method: 'GET',
        path: '/me/sessions',
        tag: 'sessions',
        summary:
            'Where the logged in account is logged in: one row per session (browser), with the organisation, how it logged in (amr) and when. `current` is the session of this access token.',
        bearer: true,
        response: {
            status: 200,
            example: [
                {
                    id: '0f8f8a52-55a3-4b8e-9d55-3f1f2f8b1c10',
                    current: true,
                    tenant: { id: TENANT.id, name: 'Acme' },
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) … Chrome/141.0',
                    acr: 'loa2',
                    amr: ['pwd', 'otp', 'mfa'],
                    createdAt: '2026-10-14T08:00:00.000Z',
                    lastUsedAt: '2026-10-14T09:12:00.000Z',
                    expiresAt: '2026-10-14T20:00:00.000Z'
                }
            ]
        },
        errors: [[401, 'errors.UNAUTHORIZED']]
    },
    {
        method: 'DELETE',
        path: '/me/sessions',
        tag: 'sessions',
        summary: 'Log out everywhere else: ends every session of the account except the one of this access token.',
        bearer: true,
        response: { status: 200, example: { ended: 2 } },
        errors: [[401, 'errors.UNAUTHORIZED']]
    },
    {
        method: 'DELETE',
        path: '/me/sessions/:id',
        tag: 'sessions',
        summary:
            'End one session of the account: its refresh token and access tokens stop at once. Ending the own session is logging out.',
        pathExample: '/me/sessions/0f8f8a52-55a3-4b8e-9d55-3f1f2f8b1c10',
        bearer: true,
        response: { status: 200, example: { ended: 1 } },
        errors: [
            [401, 'errors.UNAUTHORIZED'],
            [404, 'oidc.SESSION_NOT_FOUND']
        ]
    },
    // ---------------------------------------------------------------- applications the own account allowed
    {
        method: 'GET',
        path: '/me/consents',
        tag: 'consents',
        summary:
            'The applications that are not our own which the logged in account allowed on the consent screen, with the scopes, newest first.',
        bearer: true,
        response: {
            status: 200,
            example: [
                {
                    clientId: 'partner.app',
                    clientName: 'Partner Planner',
                    scopes: ['email', 'openid', 'profile'],
                    createdAt: '2026-10-15T09:00:00.000Z',
                    updatedAt: '2026-10-15T09:00:00.000Z'
                }
            ]
        },
        errors: [[401, 'errors.UNAUTHORIZED']]
    },
    {
        method: 'DELETE',
        path: '/me/consents/:clientId',
        tag: 'consents',
        summary:
            'Takes the permission back: every refresh token of that application for this account stops at once (its access tokens run out within 10 minutes) and the next login asks again.',
        pathExample: '/me/consents/partner.app',
        bearer: true,
        response: { status: 200, example: { revoked: true } },
        errors: [
            [401, 'errors.UNAUTHORIZED'],
            [404, 'oidc.CONSENT_NOT_FOUND']
        ]
    },
    // ---------------------------------------------------------------- passkeys of the own account
    {
        method: 'GET',
        path: '/me/passkeys',
        tag: 'passkeys',
        summary: 'The passkeys of the logged in account, and whether passkeys are on (OIDC_PASSKEYS).',
        bearer: true,
        response: {
            status: 200,
            example: {
                enabled: true,
                passkeys: [
                    {
                        id: '6a1d1f8e-3c55-4f7b-a1a8-0e2b1b9c2d11',
                        name: 'Laptop',
                        synced: true,
                        createdAt: '2026-10-15T09:00:00.000Z',
                        lastUsedAt: '2026-10-15T10:12:00.000Z'
                    }
                ]
            }
        },
        errors: [[401, 'errors.UNAUTHORIZED']]
    },
    {
        method: 'POST',
        path: '/me/passkeys/options',
        tag: 'passkeys',
        summary:
            'Adding a passkey, step 1: the options for `navigator.credentials.create()` (a discoverable credential with user verification, ES256, RS256 or EdDSA, no attestation) and a token with the challenge, valid 5 minutes.',
        bearer: true,
        response: {
            status: 200,
            example: {
                token: 'sealed challenge',
                options: {
                    challenge: 'q6l0D9YvC2y4ZLm2rHd3o1yHq0jYv1Jx3Cxk0E4b3cM',
                    rp: { id: 'localhost', name: 'shop' },
                    user: { id: 'base64url user id', name: 'jan@example.com', displayName: 'Jan Peeters' },
                    pubKeyCredParams: [
                        { type: 'public-key', alg: -7 },
                        { type: 'public-key', alg: -257 },
                        { type: 'public-key', alg: -8 }
                    ],
                    authenticatorSelection: {
                        residentKey: 'required',
                        requireResidentKey: true,
                        userVerification: 'required'
                    },
                    excludeCredentials: [],
                    attestation: 'none',
                    timeout: 300000
                }
            }
        },
        errors: [
            [401, 'errors.UNAUTHORIZED'],
            [404, 'oidc.PASSKEYS_DISABLED']
        ]
    },
    {
        method: 'POST',
        path: '/me/passkeys',
        tag: 'passkeys',
        summary:
            'Adding a passkey, step 2: the answer of `navigator.credentials.create()`. Checks the challenge, origin, rpId, user presence and verification, and the public key. Max 20 per account.',
        bearer: true,
        body: {
            example: {
                token: 'from POST /me/passkeys/options',
                name: 'Laptop',
                credential: {
                    id: 'base64url credential id',
                    rawId: 'base64url credential id',
                    type: 'public-key',
                    response: { clientDataJSON: 'base64url', attestationObject: 'base64url', transports: ['internal'] }
                }
            },
            fields: [
                ['token', 'string', 'required, from POST /me/passkeys/options'],
                ['credential', 'object', 'required, the PublicKeyCredential as JSON (base64url)'],
                ['name', 'string', 'optional, max 60 (default "Passkey")']
            ]
        },
        response: {
            status: 201,
            example: {
                id: '6a1d1f8e-3c55-4f7b-a1a8-0e2b1b9c2d11',
                name: 'Laptop',
                synced: true,
                createdAt: '2026-10-15T09:00:00.000Z',
                lastUsedAt: null
            }
        },
        errors: [
            [400, 'oidc.PASSKEY_EXPIRED'],
            [400, 'oidc.PASSKEY_INVALID'],
            [401, 'errors.UNAUTHORIZED'],
            [404, 'oidc.PASSKEYS_DISABLED'],
            [409, 'oidc.PASSKEY_EXISTS']
        ]
    },
    {
        method: 'PATCH',
        path: '/me/passkeys/:id',
        tag: 'passkeys',
        summary: 'Renames a passkey of the account.',
        pathExample: '/me/passkeys/6a1d1f8e-3c55-4f7b-a1a8-0e2b1b9c2d11',
        bearer: true,
        body: { example: { name: 'Phone' }, fields: [['name', 'string', 'required, 1 to 60 characters']] },
        response: { status: 200, example: { id: '6a1d1f8e-3c55-4f7b-a1a8-0e2b1b9c2d11', name: 'Phone' } },
        errors: [
            [401, 'errors.UNAUTHORIZED'],
            [404, 'oidc.PASSKEY_NOT_FOUND']
        ]
    },
    {
        method: 'DELETE',
        path: '/me/passkeys/:id',
        tag: 'passkeys',
        summary:
            'Removes a passkey: it no longer logs in (the device may still offer it until it is removed there too). Not the last way to log in of an account without password, eID or other server.',
        pathExample: '/me/passkeys/6a1d1f8e-3c55-4f7b-a1a8-0e2b1b9c2d11',
        bearer: true,
        response: { status: 200, example: { removed: true } },
        errors: [
            [401, 'errors.UNAUTHORIZED'],
            [404, 'oidc.PASSKEY_NOT_FOUND'],
            [409, 'oidc.PASSKEY_LAST_LOGIN']
        ]
    },
    // ---------------------------------------------------------------- the audit log
    {
        method: 'GET',
        path: '/tenants/current/audit',
        tag: 'audit log',
        summary:
            'The audit log of the current organisation, newest first: logins, members, licences. Who did it (`actor`, null for the payment provider), about whom (`target`), the details, the IP address and the browser. Query: `category` (login, account, members, platform, licences), `actor` (user id), `limit` (1 to 100, default 50) and `before` (the `next` of the page before). Read with Row-Level Security: never events of another organisation.',
        bearer: true,
        pathExample: '/tenants/current/audit?category=members&limit=50',
        response: { status: 200, example: AUDIT_PAGE },
        errors: [BAD_REQUEST, ...ACCESS('admin')]
    },
    {
        method: 'GET',
        path: '/admin/audit',
        tag: 'audit log',
        summary:
            'The audit log of the whole platform (superadmins): every organisation, and the events without one (failed logins, two-step verification, eID, superadmins). The same query as above, plus `tenant`: an organisation id, or `platform` for only the events without one.',
        bearer: true,
        pathExample: '/admin/audit?tenant=platform&category=login',
        response: {
            status: 200,
            example: {
                events: [
                    {
                        id: '1531',
                        createdAt: '2026-10-14T09:58:12.000Z',
                        tenant: null,
                        actor: null,
                        action: 'login.failed',
                        target: { type: 'user', id: USER_ID, label: 'ada@example.com' },
                        details: { method: 'password', reason: 'wrong_password', email: 'ada@example.com' },
                        ip: '203.0.113.7',
                        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) … Chrome/141.0'
                    }
                ],
                next: null
            }
        },
        errors: [BAD_REQUEST, ...ACCESS('superadmin')]
    },
    {
        method: 'GET',
        path: '/me/audit',
        tag: 'audit log',
        summary:
            'What happened with the own account: everything it did, and what was done to it (also failed logins with its email address). Shown as "Recent activity" on /security. Query: `category`, `limit`, `before`.',
        bearer: true,
        pathExample: '/me/audit?limit=10',
        response: { status: 200, example: AUDIT_PAGE },
        errors: [BAD_REQUEST, [401, 'errors.UNAUTHORIZED']]
    },
    // ---------------------------------------------------------------- licences of the own organisation (admins)
    {
        method: 'GET',
        path: '/tenants/current/licenses',
        tag: 'licences (admin)',
        summary:
            'Per product: the subscription (seats, month or year, paid until, the next renewal), the free seats of a superadmin, the trials of the members and who has a seat. `assignments[].active` is false for the newest assignments when there are fewer seats than assignments.',
        bearer: true,
        response: { status: 200, example: [OVERVIEW] },
        errors: ACCESS('admin')
    },
    {
        method: 'POST',
        path: '/tenants/current/licenses/quote',
        tag: 'licences (admin)',
        summary:
            'What a purchase costs, with a discount code: the price of one seat, the first payment and every renewal after it (in cents). Nothing is bought.',
        bearer: true,
        body: PURCHASE,
        response: {
            status: 200,
            example: {
                currency: 'EUR',
                unitCents: 9000,
                baseCents: 45000,
                firstCents: 22500,
                renewalCents: 45000,
                discount: {
                    code: 'WELCOME-50',
                    percentOff: 50,
                    amountOffCents: null,
                    duration: 'once',
                    durationPeriods: null
                }
            }
        },
        errors: [BAD_REQUEST, ...ACCESS('admin'), [404, 'billing.PRODUCT_NOT_FOUND'], [400, 'billing.DISCOUNT_INVALID']]
    },
    {
        method: 'POST',
        path: '/tenants/current/licenses/subscriptions',
        tag: 'licences (admin)',
        summary:
            'Buy seats of a product per month or per year (a year is cheaper). Answers the checkout URL of Mollie: send the browser there; it comes back on /licenses/return of the frontend. A discount code that makes it free activates at once (`status: active`, no checkout).',
        bearer: true,
        body: PURCHASE,
        response: {
            status: 201,
            example: {
                status: 'pending',
                checkoutUrl: 'https://www.mollie.com/checkout/select-method/7UhSN1zuXS',
                subscriptionId: SUBSCRIPTION_ID
            }
        },
        errors: [
            BAD_REQUEST,
            ...ACCESS('admin'),
            [404, 'billing.PRODUCT_NOT_FOUND'],
            [400, 'billing.DISCOUNT_INVALID'],
            [409, 'billing.SUBSCRIPTION_EXISTS'],
            [503, 'billing.PAYMENTS_DISABLED']
        ]
    },
    {
        method: 'PATCH',
        path: '/tenants/current/licenses/subscriptions/:productCode',
        tag: 'licences (admin)',
        summary:
            'Change the number of paid seats. More: a payment for the rest of the current period (checkout URL), the renewals cost more after it. Fewer: at once, no refund, only when the seats in use still fit.',
        bearer: true,
        pathExample: '/tenants/current/licenses/subscriptions/planner',
        body: { example: { seats: 8 }, fields: [['seats', 'number', 'required, 1 to 10000']] },
        response: {
            status: 200,
            example: { status: 'pending', checkoutUrl: 'https://www.mollie.com/checkout/select-method/9KqWm2Lp' }
        },
        errors: [
            BAD_REQUEST,
            ...ACCESS('admin'),
            [404, 'billing.PRODUCT_NOT_FOUND'],
            [409, 'billing.NO_SUBSCRIPTION'],
            [409, 'billing.FREE_SUBSCRIPTION'],
            [409, 'billing.RENEWAL_PENDING'],
            [409, 'billing.SEATS_IN_USE']
        ]
    },
    {
        method: 'DELETE',
        path: '/tenants/current/licenses/subscriptions/:productCode',
        tag: 'licences (admin)',
        summary:
            'Cancel a subscription: no more renewals; the seats keep working until the end of the paid period (`endsAt`).',
        bearer: true,
        pathExample: '/tenants/current/licenses/subscriptions/planner',
        response: { status: 200, example: { status: 'canceled', endsAt: '2027-10-14T08:00:00.000Z' } },
        errors: [...ACCESS('admin'), [404, 'billing.PRODUCT_NOT_FOUND'], [409, 'billing.NO_SUBSCRIPTION']]
    },
    {
        method: 'POST',
        path: '/tenants/current/licenses/subscriptions/:id/sync',
        tag: 'licences (admin)',
        summary:
            'After the checkout (the return page of the frontend): fetches the status of the last payment from Mollie and applies it. Works without a webhook (localhost); the status never comes from the browser.',
        bearer: true,
        pathExample: `/tenants/current/licenses/subscriptions/${SUBSCRIPTION_ID}/sync`,
        response: { status: 200, example: { payment: 'paid', subscription: 'active', seats: 5 } },
        errors: [...ACCESS('admin'), [404, 'billing.PAYMENT_NOT_FOUND']]
    },
    {
        method: 'POST',
        path: '/tenants/current/licenses/:productCode/trials/:userId',
        tag: 'licences (admin)',
        summary:
            'Start the 14-day trial (BILLING_TRIAL_DAYS) of a member, for a member that joined before the product existed. New members get it automatically; once per member and product.',
        bearer: true,
        pathExample: `/tenants/current/licenses/planner/trials/${USER_ID}`,
        response: { status: 201, example: { userId: USER_ID, endsAt: '2026-10-28T08:00:00.000Z' } },
        errors: [
            ...ACCESS('admin'),
            [404, 'billing.PRODUCT_NOT_FOUND'],
            [404, 'billing.NOT_A_MEMBER'],
            [409, 'billing.TRIAL_USED']
        ]
    },
    {
        method: 'POST',
        path: '/tenants/current/licenses/:productCode/seats/:userId',
        tag: 'licences (admin)',
        summary:
            'Give a member one of the seats (paid or free). Every member that uses the product after the trial needs one.',
        bearer: true,
        pathExample: `/tenants/current/licenses/planner/seats/${USER_ID}`,
        response: { status: 201, example: { userId: USER_ID, assigned: true } },
        errors: [
            ...ACCESS('admin'),
            [404, 'billing.PRODUCT_NOT_FOUND'],
            [404, 'billing.NOT_A_MEMBER'],
            [409, 'billing.NO_FREE_SEAT']
        ]
    },
    {
        method: 'DELETE',
        path: '/tenants/current/licenses/:productCode/seats/:userId',
        tag: 'licences (admin)',
        summary: 'Take a seat back from a member: it is free at once for another member.',
        bearer: true,
        pathExample: `/tenants/current/licenses/planner/seats/${USER_ID}`,
        response: { status: 200, example: { userId: USER_ID, assigned: false } },
        errors: [...ACCESS('admin'), [404, 'billing.PRODUCT_NOT_FOUND'], [404, 'billing.SEAT_NOT_FOUND']]
    },
    // ---------------------------------------------------------------- the licences of the own account
    {
        method: 'GET',
        path: '/me/licenses',
        tag: 'licences',
        summary:
            'Which products the logged in account may use in the organisation of its token, and why: a running trial (until `endsAt`), a seat, or being a superadmin.',
        bearer: true,
        response: {
            status: 200,
            example: [
                { code: 'planner', name: 'Planner', access: true, via: 'trial', endsAt: '2026-10-28T08:00:00.000Z' },
                { code: 'reports', name: 'Reports', access: false }
            ]
        },
        errors: [[401, 'errors.UNAUTHORIZED']]
    },
    // ---------------------------------------------------------------- the payment provider
    {
        method: 'POST',
        path: '/billing/webhook',
        tag: 'licences',
        summary:
            'The webhook of Mollie (form-encoded `id=tr_…`, no login). The status is always fetched from Mollie, never taken from the call; a paid payment is applied once. Always 200 (500 when the database is down, so Mollie tries again).',
        form: true,
        body: { example: { id: 'tr_WDqYK6vllg' }, fields: [['id', 'string', 'the payment id of Mollie']] },
        response: null,
        errors: []
    },
    // ---------------------------------------------------------------- licences of the platform (superadmins)
    {
        method: 'GET',
        path: '/admin/products',
        tag: 'licences (superadmin)',
        summary: 'Every product, also the ones that are no longer sold (`active: false`).',
        bearer: true,
        response: { status: 200, example: [PRODUCT] },
        errors: ACCESS('superadmin')
    },
    {
        method: 'POST',
        path: '/admin/products',
        tag: 'licences (superadmin)',
        summary:
            'A new product, sold per user (seat): a price per month and a price per year that must be cheaper than twelve months. The code is fixed: the backend checks it with @License(code).',
        bearer: true,
        body: {
            example: {
                code: 'planner',
                name: 'Planner',
                description: 'Plan the week of your team',
                priceMonthCents: 900,
                priceYearCents: 9000
            },
            fields: [
                ['code', 'string', 'required, lowercase letters, digits and dashes (2 to 63)'],
                ['name', 'string', 'required, 2 to 100 characters'],
                ['description', 'string', 'optional, up to 500 characters'],
                ['priceMonthCents', 'number', 'required, per seat per month, in cents'],
                ['priceYearCents', 'number', 'required, per seat per year, in cents: less than 12 × priceMonthCents']
            ]
        },
        response: { status: 201, example: PRODUCT },
        errors: [
            BAD_REQUEST,
            ...ACCESS('superadmin'),
            [400, 'billing.YEAR_NOT_CHEAPER'],
            [409, 'billing.PRODUCT_EXISTS']
        ]
    },
    {
        method: 'PATCH',
        path: '/admin/products/:code',
        tag: 'licences (superadmin)',
        summary:
            'Change a product: name, description, prices (for new purchases and seats) or stop selling it (`active: false`: no new purchases or trials, bought seats keep working until they end).',
        bearer: true,
        pathExample: '/admin/products/planner',
        body: {
            example: {
                name: 'Planner',
                description: 'Plan the week of your team',
                priceMonthCents: 900,
                priceYearCents: 9500,
                active: true
            },
            fields: [
                ['name', 'string', 'optional'],
                ['description', 'string', 'optional'],
                ['priceMonthCents', 'number', 'optional'],
                ['priceYearCents', 'number', 'optional, still less than 12 months'],
                ['active', 'boolean', 'optional']
            ]
        },
        response: { status: 200, example: { ...PRODUCT, priceYearCents: 9500 } },
        errors: [
            BAD_REQUEST,
            ...ACCESS('superadmin'),
            [404, 'billing.PRODUCT_NOT_FOUND'],
            [400, 'billing.YEAR_NOT_CHEAPER']
        ]
    },
    {
        method: 'GET',
        path: '/admin/discounts',
        tag: 'licences (superadmin)',
        summary: 'Every discount code, with its product and how many organisations used it.',
        bearer: true,
        response: { status: 200, example: [DISCOUNT] },
        errors: ACCESS('superadmin')
    },
    {
        method: 'POST',
        path: '/admin/discounts',
        tag: 'licences (superadmin)',
        summary:
            'Make a discount code: a percentage (100 = free, no payment at all) or an amount per payment; for one product or all; for the first payment (`once`), `durationPeriods` periods (`repeating`) or `forever`. Each organisation uses a code once. Without `code` a random one is made (like K7QM-2XPD).',
        bearer: true,
        body: {
            example: {
                code: 'WELCOME-50',
                percentOff: 50,
                productCode: 'planner',
                duration: 'repeating',
                durationPeriods: 3,
                maxRedemptions: 100,
                expiresAt: '2026-12-31T23:59:59Z'
            },
            fields: [
                ['code', 'string', 'optional, 3 to 40 letters, digits and dashes (stored in capitals)'],
                [
                    'percentOff',
                    'number',
                    '1 to 100 (100: free). Instead of it: `amountOffCents`, cents off every discounted payment'
                ],
                ['productCode', 'string', 'optional: left out is every product'],
                ['duration', 'string', '`once`, `repeating` or `forever`'],
                ['durationPeriods', 'number', 'only with `repeating`: 1 to 120 periods'],
                ['maxRedemptions', 'number', 'optional: how many organisations'],
                ['expiresAt', 'string', 'optional ISO date: no longer usable after it']
            ]
        },
        response: { status: 201, example: DISCOUNT },
        errors: [
            BAD_REQUEST,
            ...ACCESS('superadmin'),
            [400, 'billing.DISCOUNT_AMOUNT'],
            [400, 'billing.DISCOUNT_PERIODS'],
            [404, 'billing.PRODUCT_NOT_FOUND'],
            [409, 'billing.DISCOUNT_EXISTS']
        ]
    },
    {
        method: 'PATCH',
        path: '/admin/discounts/:code',
        tag: 'licences (superadmin)',
        summary: 'Switch a discount code off (or on again). Subscriptions that used it keep their discount.',
        bearer: true,
        pathExample: '/admin/discounts/WELCOME-50',
        body: { example: { active: false }, fields: [['active', 'boolean', 'required']] },
        response: { status: 200, example: { code: 'WELCOME-50', active: false } },
        errors: [BAD_REQUEST, ...ACCESS('superadmin'), [404, 'billing.DISCOUNT_INVALID']]
    },
    {
        method: 'GET',
        path: '/admin/tenants/:id/licenses',
        tag: 'licences (superadmin)',
        summary: 'The licences of any organisation: the same overview as GET /tenants/current/licenses.',
        bearer: true,
        pathExample: `/admin/tenants/${TENANT.id}/licenses`,
        response: { status: 200, example: [OVERVIEW] },
        errors: ACCESS('superadmin')
    },
    {
        method: 'POST',
        path: '/admin/tenants/:id/grants',
        tag: 'licences (superadmin)',
        summary:
            'Give an organisation free seats of a product, until `endsAt` or for good. Its admins hand them out like paid seats.',
        bearer: true,
        pathExample: `/admin/tenants/${TENANT.id}/grants`,
        body: {
            example: { productCode: 'planner', seats: 3, endsAt: '2027-06-30T00:00:00Z', note: 'Partner' },
            fields: [
                ['productCode', 'string', 'required'],
                ['seats', 'number', 'required, 1 to 10000'],
                ['endsAt', 'string', 'optional ISO date: left out is for good'],
                ['note', 'string', 'optional, up to 200 characters']
            ]
        },
        response: { status: 201, example: GRANT },
        errors: [BAD_REQUEST, ...ACCESS('superadmin'), [404, 'billing.PRODUCT_NOT_FOUND'], [404, 'errors.NOT_FOUND']]
    },
    {
        method: 'DELETE',
        path: '/admin/tenants/:id/grants/:grantId',
        tag: 'licences (superadmin)',
        summary: 'Take free seats back at once.',
        bearer: true,
        pathExample: `/admin/tenants/${TENANT.id}/grants/${GRANT.id}`,
        response: { status: 200, example: { id: GRANT.id, deleted: true } },
        errors: [...ACCESS('superadmin'), [404, 'errors.NOT_FOUND']]
    },
    {
        method: 'POST',
        path: '/admin/tenants/:id/trials',
        tag: 'licences (superadmin)',
        summary:
            'Extend the trial of a member by a number of days: from its end, or from today when it ended. Starts one when there is none.',
        bearer: true,
        pathExample: `/admin/tenants/${TENANT.id}/trials`,
        body: {
            example: { productCode: 'planner', userId: USER_ID, days: 14 },
            fields: [
                ['productCode', 'string', 'required'],
                ['userId', 'string', 'required, a member of the organisation'],
                ['days', 'number', 'required, 1 to 365']
            ]
        },
        response: { status: 201, example: { userId: USER_ID, endsAt: '2026-11-11T08:00:00.000Z' } },
        errors: [
            BAD_REQUEST,
            ...ACCESS('superadmin'),
            [404, 'billing.PRODUCT_NOT_FOUND'],
            [404, 'billing.NOT_A_MEMBER']
        ]
    }
]
