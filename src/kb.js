import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * The knowledge base of a generated project (docs/kb): a user manual from the first commit, for every page of the app,
 * in English, Dutch, French and German. The CLI writes the pages it generates with their purpose; the kb agent of
 * Claude Code (templates/project-claude/.claude/agents/kb.md) adds every control, every message and the screenshots,
 * and keeps it up to date with every change.
 */
export const KB_DIR = 'docs/kb'
export const KB_LOCALES = ['en', 'nl', 'fr', 'de']

const WHO = {
    everyone: { en: 'Everyone', nl: 'Iedereen', fr: 'Tout le monde', de: 'Alle' },
    member: {
        en: 'Everyone who is logged in',
        nl: 'Iedereen die ingelogd is',
        fr: 'Toute personne connectée',
        de: 'Alle, die angemeldet sind'
    },
    admin: {
        en: 'The administrator of the organisation',
        nl: 'De beheerder van de organisatie',
        fr: "L'administrateur de l'organisation",
        de: 'Der Administrator der Organisation'
    },
    superadmin: {
        en: 'The platform administrators (superadmin)',
        nl: 'De beheerders van het platform (superadmin)',
        fr: 'Les administrateurs de la plateforme (superadmin)',
        de: 'Die Administratoren der Plattform (Superadmin)'
    }
}

const page = (id, route, who, titles, purposes) => ({ id, route, who, titles, purposes })

/** The pages of the login server (Pasport): its portal and its account pages. */
const PASPORT_PAGES = [
    page(
        'home',
        '/',
        'everyone',
        { en: 'Home', nl: 'Start', fr: 'Accueil', de: 'Start' },
        {
            en: 'The first page: log in, or go on to your apps (superadmins: the panel).',
            nl: 'De eerste pagina: inloggen, of verder naar je apps (superadmins: het paneel).',
            fr: 'La première page : se connecter, ou continuer vers vos applications (superadmins : le panneau).',
            de: 'Die erste Seite: anmelden oder weiter zu deinen Apps (Superadmins: das Panel).'
        }
    ),
    page(
        'login',
        '/login',
        'everyone',
        { en: 'Log in', nl: 'Inloggen', fr: 'Se connecter', de: 'Anmelden' },
        {
            en: 'Log in with your eID, a passkey or your e-mail address and password, then the code of your authenticator app.',
            nl: 'Inloggen met je eID, een passkey of je e-mailadres en wachtwoord, daarna de code van je authenticator-app.',
            fr: "Se connecter avec votre eID, une passkey ou votre adresse e-mail et mot de passe, puis le code de votre application d'authentification.",
            de: 'Mit deiner eID, einem Passkey oder deiner E-Mail-Adresse und deinem Passwort anmelden, danach der Code deiner Authenticator-App.'
        }
    ),
    page(
        'register',
        '/register',
        'everyone',
        { en: 'Create an account', nl: 'Account maken', fr: 'Créer un compte', de: 'Konto erstellen' },
        {
            en: 'Make your account, with your eID or your e-mail address, and your organisation when you are the first of it.',
            nl: 'Je account maken, met je eID of je e-mailadres, en je organisatie als je er de eerste van bent.',
            fr: 'Créer votre compte, avec votre eID ou votre adresse e-mail, et votre organisation si vous en êtes le premier membre.',
            de: 'Dein Konto erstellen, mit deiner eID oder deiner E-Mail-Adresse, und deine Organisation, wenn du die erste Person darin bist.'
        }
    ),
    page(
        'forgot-password',
        '/forgot-password',
        'everyone',
        {
            en: 'Forgot your password',
            nl: 'Wachtwoord vergeten',
            fr: 'Mot de passe oublié',
            de: 'Passwort vergessen'
        },
        {
            en: 'Ask for an e-mail with a link to choose a new password.',
            nl: 'Een e-mail vragen met een link om een nieuw wachtwoord te kiezen.',
            fr: 'Demander un e-mail avec un lien pour choisir un nouveau mot de passe.',
            de: 'Eine E-Mail mit einem Link anfordern, um ein neues Passwort zu wählen.'
        }
    ),
    page(
        'reset-password',
        '/reset-password',
        'everyone',
        {
            en: 'Choose a new password',
            nl: 'Nieuw wachtwoord kiezen',
            fr: 'Choisir un nouveau mot de passe',
            de: 'Neues Passwort wählen'
        },
        {
            en: 'Choose a new password with the link from the e-mail.',
            nl: 'Een nieuw wachtwoord kiezen met de link uit de e-mail.',
            fr: "Choisir un nouveau mot de passe avec le lien de l'e-mail.",
            de: 'Mit dem Link aus der E-Mail ein neues Passwort wählen.'
        }
    ),
    page(
        'verify-email',
        '/verify-email',
        'everyone',
        {
            en: 'Confirm your e-mail address',
            nl: 'E-mailadres bevestigen',
            fr: 'Confirmer votre adresse e-mail',
            de: 'E-Mail-Adresse bestätigen'
        },
        {
            en: 'Confirm your e-mail address with the link from the e-mail, so you can log in.',
            nl: 'Je e-mailadres bevestigen met de link uit de e-mail, zodat je kunt inloggen.',
            fr: "Confirmer votre adresse e-mail avec le lien de l'e-mail, pour pouvoir vous connecter.",
            de: 'Deine E-Mail-Adresse mit dem Link aus der E-Mail bestätigen, damit du dich anmelden kannst.'
        }
    ),
    page(
        'invite',
        '/invite',
        'everyone',
        { en: 'Invitation', nl: 'Uitnodiging', fr: 'Invitation', de: 'Einladung' },
        {
            en: 'Accept an invitation to an organisation, with the apps and the licence it gives you.',
            nl: 'Een uitnodiging voor een organisatie aanvaarden, met de apps en de licentie die je erbij krijgt.',
            fr: "Accepter une invitation à une organisation, avec les applications et la licence qu'elle vous donne.",
            de: 'Eine Einladung zu einer Organisation annehmen, mit den Apps und der Lizenz, die du dabei bekommst.'
        }
    ),
    page(
        'apps',
        '/apps',
        'member',
        { en: 'My apps', nl: 'Mijn apps', fr: 'Mes applications', de: 'Meine Apps' },
        {
            en: 'The apps you may open (a licence or a demo): click one to work in it.',
            nl: 'De apps die je mag openen (een licentie of een demo): klik er een aan om erin te werken.',
            fr: "Les applications que vous pouvez ouvrir (une licence ou une démo) : cliquez sur l'une d'elles pour y travailler.",
            de: 'Die Apps, die du öffnen darfst (eine Lizenz oder eine Demo): klicke eine an, um darin zu arbeiten.'
        }
    ),
    page(
        'dashboard',
        '/dashboard',
        'member',
        { en: 'Dashboard', nl: 'Dashboard', fr: 'Tableau de bord', de: 'Dashboard' },
        {
            en: 'The apps of your organisation, your licences and your open tickets at a glance.',
            nl: 'De apps van je organisatie, je licenties en je open tickets in één oogopslag.',
            fr: "Les applications de votre organisation, vos licences et vos tickets ouverts en un coup d'œil.",
            de: 'Die Apps deiner Organisation, deine Lizenzen und deine offenen Tickets auf einen Blick.'
        }
    ),
    page(
        'marketplace',
        '/marketplace',
        'member',
        { en: 'Discover apps', nl: 'Ontdek apps', fr: 'Découvrir des applications', de: 'Apps entdecken' },
        {
            en: 'Every app of the platform: try one with a demo, or buy it through the wizard.',
            nl: 'Alle apps van het platform: probeer er een met een demo, of koop ze via de wizard.',
            fr: "Toutes les applications de la plateforme : essayez-en une avec une démo, ou achetez-la avec l'assistant.",
            de: 'Alle Apps der Plattform: probiere eine mit einer Demo aus oder kaufe sie mit dem Assistenten.'
        }
    ),
    page(
        'vault',
        '/vault',
        'member',
        { en: 'Vault', nl: 'Vault', fr: 'Coffre-fort', de: 'Tresor' },
        {
            en: 'Doctors only: your eHealth certificate, stored encrypted, for the apps that sign with it.',
            nl: 'Enkel artsen: je eHealth-certificaat, versleuteld bewaard, voor de apps die ermee ondertekenen.',
            fr: 'Médecins uniquement : votre certificat eHealth, conservé chiffré, pour les applications qui signent avec.',
            de: 'Nur Ärzte: dein eHealth-Zertifikat, verschlüsselt gespeichert, für die Apps, die damit signieren.'
        }
    ),
    page(
        'users',
        '/users',
        'admin',
        { en: 'Users', nl: 'Gebruikers', fr: 'Utilisateurs', de: 'Benutzer' },
        {
            en: 'Invite people, give them apps, roles and licences, disable or remove them, and see who is online.',
            nl: 'Mensen uitnodigen, hun apps, rollen en licenties geven, hen uitschakelen of verwijderen, en zien wie online is.',
            fr: 'Inviter des personnes, leur donner des applications, des rôles et des licences, les désactiver ou les retirer, et voir qui est en ligne.',
            de: 'Personen einladen, ihnen Apps, Rollen und Lizenzen geben, sie deaktivieren oder entfernen und sehen, wer online ist.'
        }
    ),
    page(
        'invoices',
        '/invoices',
        'admin',
        { en: 'Invoices', nl: 'Facturen', fr: 'Factures', de: 'Rechnungen' },
        {
            en: 'The invoices of your organisation: pay the open ones, download the PDF, see when contracts renew.',
            nl: 'De facturen van je organisatie: de open betalen, de pdf downloaden, zien wanneer contracten verlengen.',
            fr: 'Les factures de votre organisation : payer celles qui sont ouvertes, télécharger le PDF, voir quand les contrats se renouvellent.',
            de: 'Die Rechnungen deiner Organisation: offene bezahlen, das PDF herunterladen, sehen, wann Verträge verlängert werden.'
        }
    ),
    page(
        'support',
        '/support',
        'member',
        { en: 'Support', nl: 'Support', fr: 'Support', de: 'Support' },
        {
            en: 'Ask a question in a ticket, follow the answers, and rate the help when it is closed.',
            nl: 'Een vraag stellen in een ticket, de antwoorden volgen, en de hulp beoordelen wanneer het gesloten is.',
            fr: "Poser une question dans un ticket, suivre les réponses et évaluer l'aide une fois le ticket clôturé.",
            de: 'Eine Frage in einem Ticket stellen, die Antworten verfolgen und die Hilfe bewerten, wenn es geschlossen ist.'
        }
    ),
    page(
        'profile',
        '/profile',
        'member',
        { en: 'My profile', nl: 'Mijn profiel', fr: 'Mon profil', de: 'Mein Profil' },
        {
            en: 'Your name, e-mail address, phone and language, the billing details of your organisation and your eID.',
            nl: 'Je naam, e-mailadres, telefoon en taal, de facturatiegegevens van je organisatie en je eID.',
            fr: 'Votre nom, adresse e-mail, téléphone et langue, les données de facturation de votre organisation et votre eID.',
            de: 'Dein Name, deine E-Mail-Adresse, Telefon und Sprache, die Rechnungsdaten deiner Organisation und deine eID.'
        }
    ),
    page(
        'security',
        '/security',
        'member',
        { en: 'Security', nl: 'Beveiliging', fr: 'Sécurité', de: 'Sicherheit' },
        {
            en: 'Your password, two-step verification, passkeys, your eID and the devices where you are logged in.',
            nl: 'Je wachtwoord, tweestapsverificatie, passkeys, je eID en de toestellen waar je ingelogd bent.',
            fr: 'Votre mot de passe, la vérification en deux étapes, les passkeys, votre eID et les appareils où vous êtes connecté.',
            de: 'Dein Passwort, die Zwei-Schritt-Verifizierung, Passkeys, deine eID und die Geräte, auf denen du angemeldet bist.'
        }
    ),
    page(
        'audit',
        '/audit',
        'admin',
        { en: 'Activity', nl: 'Activiteit', fr: 'Activité', de: 'Aktivität' },
        {
            en: 'Who did what and when in the organisation: logins, invitations, changes of roles and licences.',
            nl: 'Wie wat deed en wanneer in de organisatie: logins, uitnodigingen, wijzigingen van rollen en licenties.',
            fr: "Qui a fait quoi et quand dans l'organisation : connexions, invitations, changements de rôles et de licences.",
            de: 'Wer was wann in der Organisation getan hat: Anmeldungen, Einladungen, Änderungen von Rollen und Lizenzen.'
        }
    ),
    page(
        'admin',
        '/admin/stats',
        'superadmin',
        { en: 'Statistics', nl: 'Statistieken', fr: 'Statistiques', de: 'Statistiken' },
        {
            en: 'The superadmin panel opens here: organisations, users, revenue and tickets of the whole platform.',
            nl: 'Het superadminpaneel opent hier: organisaties, gebruikers, omzet en tickets van het hele platform.',
            fr: "Le panneau superadmin s'ouvre ici : organisations, utilisateurs, chiffre d'affaires et tickets de toute la plateforme.",
            de: 'Das Superadmin-Panel öffnet sich hier: Organisationen, Benutzer, Umsatz und Tickets der ganzen Plattform.'
        }
    ),
    page(
        'admin-tenants',
        '/admin/tenants',
        'superadmin',
        { en: 'Tenants', nl: 'Tenants', fr: 'Organisations', de: 'Mandanten' },
        {
            en: 'Every organisation: create, suspend or open one, with its members, apps, licences and billing details.',
            nl: 'Alle organisaties: een aanmaken, schorsen of openen, met haar leden, apps, licenties en facturatiegegevens.',
            fr: 'Toutes les organisations : en créer, suspendre ou ouvrir une, avec ses membres, applications, licences et données de facturation.',
            de: 'Alle Organisationen: eine anlegen, sperren oder öffnen, mit ihren Mitgliedern, Apps, Lizenzen und Rechnungsdaten.'
        }
    ),
    page(
        'admin-tickets',
        '/admin/tickets',
        'superadmin',
        { en: 'Tickets', nl: 'Tickets', fr: 'Tickets', de: 'Tickets' },
        {
            en: 'The support team: claim a ticket, answer it, add an internal note with @mentions, and close it.',
            nl: 'Het supportteam: een ticket opnemen, beantwoorden, een interne notitie met @vermeldingen toevoegen, en sluiten.',
            fr: "L'équipe support : prendre un ticket, y répondre, ajouter une note interne avec des @mentions, et le clôturer.",
            de: 'Das Support-Team: ein Ticket übernehmen, beantworten, eine interne Notiz mit @Erwähnungen hinzufügen und schließen.'
        }
    ),
    page(
        'admin-catalog',
        '/admin/catalog',
        'superadmin',
        { en: 'App catalogue', nl: 'App-catalogus', fr: 'Catalogue des applications', de: 'App-Katalog' },
        {
            en: 'The apps of the platform: their prices, the demo, their connection (link code, secret) and the discount codes.',
            nl: 'De apps van het platform: hun prijzen, de demo, hun koppeling (koppelcode, geheim) en de kortingscodes.',
            fr: 'Les applications de la plateforme : leurs prix, la démo, leur connexion (code de liaison, secret) et les codes de réduction.',
            de: 'Die Apps der Plattform: ihre Preise, die Demo, ihre Verbindung (Verknüpfungscode, Geheimnis) und die Rabattcodes.'
        }
    )
]

/** The pages of an app linked to a login server (its account pages live on that server). */
const APP_PAGES = [
    page(
        'home',
        '/',
        'member',
        { en: 'Home', nl: 'Start', fr: 'Accueil', de: 'Start' },
        {
            en: 'The first page of the app: your licence and the notes of your organisation.',
            nl: 'De eerste pagina van de app: je licentie en de notities van je organisatie.',
            fr: "La première page de l'application : votre licence et les notes de votre organisation.",
            de: 'Die erste Seite der App: deine Lizenz und die Notizen deiner Organisation.'
        }
    ),
    page(
        'login',
        '/login',
        'everyone',
        { en: 'Log in', nl: 'Inloggen', fr: 'Se connecter', de: 'Anmelden' },
        {
            en: 'You log in on the login server, which every app of the platform shares, and come back here.',
            nl: 'Je logt in op de loginserver, die alle apps van het platform delen, en komt hier terug.',
            fr: 'Vous vous connectez sur le serveur de connexion, commun à toutes les applications de la plateforme, puis revenez ici.',
            de: 'Du meldest dich auf dem Anmeldeserver an, den alle Apps der Plattform teilen, und kommst hierher zurück.'
        }
    ),
    page(
        'profile',
        '/profile',
        'member',
        { en: 'Profile', nl: 'Profiel', fr: 'Profil', de: 'Profil' },
        {
            en: 'Your name, organisation and role in this app, and the way to your account on the login server.',
            nl: 'Je naam, organisatie en rol in deze app, en de weg naar je account op de loginserver.',
            fr: 'Votre nom, votre organisation et votre rôle dans cette application, et le lien vers votre compte sur le serveur de connexion.',
            de: 'Dein Name, deine Organisation und Rolle in dieser App und der Weg zu deinem Konto auf dem Anmeldeserver.'
        }
    )
]

const SIMPLE_PAGES = [
    page(
        'home',
        '/',
        'everyone',
        { en: 'Home', nl: 'Start', fr: 'Accueil', de: 'Start' },
        {
            en: 'The first page of the app.',
            nl: 'De eerste pagina van de app.',
            fr: "La première page de l'application.",
            de: 'Die erste Seite der App.'
        }
    )
]

/** The pages the CLI generates for this kind of project. */
export const kbPages = kind => (kind === 'pasport' ? PASPORT_PAGES : kind === 'app' ? APP_PAGES : SIMPLE_PAGES)

const LABELS = {
    en: {
        title: 'Knowledge base',
        intro: 'How to use every page of the app: what each button, field and table does, the messages you can get, with screenshots.',
        where: 'Where',
        who: 'Who',
        what: 'What you can do here',
        control: 'Control',
        does: 'What it does',
        then: 'What you see then',
        messages: 'Messages',
        message: 'Message',
        when: 'When',
        todo: 'What to do',
        dark: 'In the dark theme',
        pending:
            'This page is filled in by the knowledge base agent: every control, every message and the screenshots.',
        pages: 'Pages'
    },
    nl: {
        title: 'Kennisbank',
        intro: 'Hoe je elke pagina van de app gebruikt: wat elke knop, elk veld en elke tabel doet, de meldingen die je kunt krijgen, met screenshots.',
        where: 'Waar',
        who: 'Wie',
        what: 'Wat je hier kunt doen',
        control: 'Element',
        does: 'Wat het doet',
        then: 'Wat je dan ziet',
        messages: 'Meldingen',
        message: 'Melding',
        when: 'Wanneer',
        todo: 'Wat je doet',
        dark: 'In het donkere thema',
        pending:
            'Deze pagina wordt aangevuld door de agent van de kennisbank: elk element, elke melding en de screenshots.',
        pages: "Pagina's"
    },
    fr: {
        title: 'Base de connaissances',
        intro: "Comment utiliser chaque page de l'application : ce que fait chaque bouton, champ et tableau, les messages que vous pouvez recevoir, avec des captures d'écran.",
        where: 'Où',
        who: 'Qui',
        what: 'Ce que vous pouvez faire ici',
        control: 'Élément',
        does: 'Ce qu’il fait',
        then: 'Ce que vous voyez ensuite',
        messages: 'Messages',
        message: 'Message',
        when: 'Quand',
        todo: 'Que faire',
        dark: 'Dans le thème sombre',
        pending:
            "Cette page est complétée par l'agent de la base de connaissances : chaque élément, chaque message et les captures d'écran.",
        pages: 'Pages'
    },
    de: {
        title: 'Wissensdatenbank',
        intro: 'Wie du jede Seite der App benutzt: was jede Schaltfläche, jedes Feld und jede Tabelle tut, die Meldungen, die du bekommen kannst, mit Screenshots.',
        where: 'Wo',
        who: 'Wer',
        what: 'Was du hier tun kannst',
        control: 'Element',
        does: 'Was es tut',
        then: 'Was du dann siehst',
        messages: 'Meldungen',
        message: 'Meldung',
        when: 'Wann',
        todo: 'Was du tust',
        dark: 'Im dunklen Design',
        pending:
            'Diese Seite wird vom Agenten der Wissensdatenbank ergänzt: jedes Element, jede Meldung und die Screenshots.',
        pages: 'Seiten'
    }
}

/** One page of the knowledge base in one language. */
export function kbPage(entry, locale) {
    const t = LABELS[locale]
    const title = entry.titles[locale]
    return [
        `# ${title}`,
        '',
        entry.purposes[locale],
        '',
        `**${t.where}**: \`${entry.route}\` · **${t.who}**: ${WHO[entry.who][locale]}`,
        '',
        `![${title}](../screenshots/${locale}/${entry.id}-light.png)`,
        '',
        `## ${t.what}`,
        '',
        `<!-- kb: ${t.pending} -->`,
        '',
        `| ${t.control} | ${t.does} | ${t.then} |`,
        '| --- | --- | --- |',
        '',
        `## ${t.messages}`,
        '',
        `| ${t.message} | ${t.when} | ${t.todo} |`,
        '| --- | --- | --- |',
        '',
        `## ${t.dark}`,
        '',
        `![${title}](../screenshots/${locale}/${entry.id}-dark.png)`,
        ''
    ].join('\n')
}

/** Every file of the knowledge base of a project. */
export function kbFiles(project) {
    const pages = kbPages(project.kind)
    const files = {
        [`${KB_DIR}/pages.json`]:
            JSON.stringify(
                pages.map(({ id, route, who, titles }) => ({ id, route, who, titles, screenshots: false })),
                null,
                4
            ) + '\n',
        [`${KB_DIR}/README.md`]: [
            `# ${LABELS.en.title}`,
            '',
            'The user manual of this project, in four languages, from the first commit on. Every page of the app has a',
            'page here with every control, every message and screenshots in the light and the dark theme.',
            '',
            ...KB_LOCALES.map(locale => `- [${LABELS[locale].title}](${locale}/README.md) (${locale})`),
            '',
            '- `pages.json`: every page of the app (route, who sees it, its title per language, whether its screenshots exist).',
            '- `<language>/<page>.md`: the pages; `screenshots/<language>/<page>[-<state>]-<light|dark>.png`: the screenshots.',
            '',
            ...(project.claude === false
                ? [
                      'Keep it up to date with every change to a screen: describe every control and every message on the page',
                      'of every language, take the screenshots (light and dark) and set `screenshots` in `pages.json`.'
                  ]
                : [
                      'It is written and kept up to date by the `kb` agent of Claude Code (`.claude/agents/kb.md`): run it once to fill',
                      'in every control and the screenshots, and after every change to a screen (the `docs` agent checks it).'
                  ]),
            ''
        ].join('\n')
    }
    for (const locale of KB_LOCALES) {
        const t = LABELS[locale]
        files[`${KB_DIR}/${locale}/README.md`] = [
            `# ${t.title}`,
            '',
            t.intro,
            '',
            `## ${t.pages}`,
            '',
            ...pages.map(entry => `- [${entry.titles[locale]}](${entry.id}.md): ${entry.purposes[locale]}`),
            ''
        ].join('\n')
        for (const entry of pages) files[`${KB_DIR}/${locale}/${entry.id}.md`] = kbPage(entry, locale)
        files[`${KB_DIR}/screenshots/${locale}/.gitkeep`] = ''
    }
    return files
}

/** The step of the CLI that writes the knowledge base (an existing file is never overwritten). */
export function kbSteps({ projectDir, project }) {
    return [
        {
            title: 'Kennisbank aanmaken (docs/kb, 4 talen)',
            weight: 1,
            run: async () => {
                for (const [rel, content] of Object.entries(kbFiles(project))) {
                    const target = path.join(projectDir, rel)
                    await fs.mkdir(path.dirname(target), { recursive: true })
                    await fs.writeFile(target, content, { flag: 'wx' }).catch(error => {
                        if (error.code !== 'EEXIST') throw error
                    })
                }
            }
        }
    ]
}
