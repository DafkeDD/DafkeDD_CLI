import { input, password, select } from '@inquirer/prompts'
import { databases } from '../databases/index.js'
import { slugify } from '../databases/postgres.js'
import { APP_PORT, DEFAULT_ROLES } from './app.js'
import { DIR, nestjs } from './nestjs.js'

/** A link code of /admin: XXXX-XXXX-XXXX (case, dashes and spaces do not matter). */
export const LINK_CODE = /^[A-Z0-9]{4}-?[A-Z0-9]{4}-?[A-Z0-9]{4}$/

const DEFAULT_SERVER = 'http://localhost:4000'
const DEFAULT_PORT = 3001

/** The address of the API of the login server as typed: also with /oidc or /.well-known/... at the end. */
export function normalizeServer(value) {
    const text = String(value ?? '').trim()
    let url
    try {
        url = new URL(text)
    } catch {
        return null
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) return null
    const path = url.pathname.replace(/\/\.well-known\/openid-configuration$/, '').replace(/\/+$/, '')
    return url.origin + path.replace(/\/oidc$/, '')
}

/** The addresses of the new frontend that the app at the login server must know. */
export const projectUris = port => ({
    redirectUris: [`http://localhost:${port}/api/auth/callback`],
    postLogoutRedirectUris: [`http://localhost:${port}`],
    backchannelLogoutUri: `http://localhost:${port}/api/auth/backchannel-logout`
})

/**
 * Uses a link code at the login server (POST /oidc/link): the settings of the app, with the addresses of the new
 * frontend added. Throws an Error with the (translated) message of the server.
 */
export async function useLinkCode({ server, code, port, fetchImpl = fetch }) {
    let response
    try {
        response = await fetchImpl(server + '/oidc/link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Language': 'nl' },
            // The roles of the new app (config/app-roles.json): the login server learns them with the code
            body: JSON.stringify({ code: code.trim(), ...projectUris(port), roles: DEFAULT_ROLES }),
            signal: AbortSignal.timeout(15_000)
        })
    } catch {
        throw new Error(`De server ${server} is niet bereikbaar. Draait de API?`)
    }
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
        const message = Array.isArray(body.message) ? body.message.join(' ') : body.message
        throw new Error(message || `De server antwoordde ${response.status}`)
    }
    if (typeof body.issuer !== 'string' || typeof body.client?.clientId !== 'string')
        throw new Error('Onverwacht antwoord van de server (is dit een DafkeDD OIDC-server van versie 0.33 of later?)')
    return {
        issuer: body.issuer,
        apiUrl: body.apiUrl,
        accountUrl: body.accountUrl,
        clientId: body.client.clientId,
        clientSecret: body.clientSecret ?? null,
        name: body.client.name,
        firstParty: body.client.firstParty === true,
        // The product (licence) the app sells on the login server: its API checks it (OIDC_PRODUCT); null: free
        product: typeof body.client.product === 'string' && body.client.product ? body.client.product : null,
        scopes: body.client.scopes ?? [],
        port
    }
}

/**
 * An app for an existing DafkeDD OIDC server (another project made with this CLI), linked with a one-time link code of
 * /admin → Apps. The frontend logs in there (same design, shell and login screen); the app gets its own NestJS API
 * (./backend, port 4001) with its own PostgreSQL database on the same server, that accepts the access tokens of the
 * login server and keeps its data per organisation (Row-Level Security).
 */
export const linked = {
    id: 'linked',
    label: 'App voor een bestaande DafkeDD OIDC-server (koppelcode)',
    description:
        'Eigen NestJS-API en database (multi-tenant) voor een app die inlogt via je bestaande server (koppelcode via /admin → Apps)',
    dir: DIR,
    docsFile: 'api.md',
    api: { port: APP_PORT },

    async ask({ hasFrontend = false, prompts = { input, password, select }, fetchImpl = fetch, projectDir } = {}) {
        if (!hasFrontend) return { link: null, reason: 'frontend' }
        const server = normalizeServer(
            await prompts.input({
                message: 'Adres van de API van je bestaande DafkeDD OIDC-server:',
                default: DEFAULT_SERVER,
                validate: value =>
                    normalizeServer(value) ? true : 'Geef een http- of https-adres, bv. http://localhost:4000'
            })
        )
        const port = Number(
            await prompts.input({
                message:
                    'Op welke poort draait de frontend van deze app? (3000 is meestal de frontend van de server zelf)',
                default: String(DEFAULT_PORT),
                validate: value =>
                    /^\d+$/.test(value) &&
                    Number(value) >= 1024 &&
                    Number(value) <= 65535 &&
                    ![4000, APP_PORT].includes(Number(value))
                        ? true
                        : `Een poort tussen 1024 en 65535 (niet 4000 of ${APP_PORT})`
            })
        )
        let link = null
        await prompts.input({
            message: 'Koppelcode (op de server: /admin → Apps → Koppelcode):',
            validate: async value => {
                const code = value.toUpperCase().replace(/\s+/g, '')
                if (!LINK_CODE.test(code)) return 'Een koppelcode ziet eruit als K7QM-2XPD-9HRT'
                try {
                    link = await useLinkCode({ server, code, port, fetchImpl })
                    return true
                } catch (error) {
                    return error instanceof Error ? error.message : String(error)
                }
            }
        })
        // Its own database on the PostgreSQL server of the login server
        const database = await databases.postgres.ask({
            projectDir,
            prompts,
            shared: { name: slugify(link.name) }
        })
        return { link, database }
    },

    /** What the frontend gets to know: the API of this app, and the login server it logs in at. */
    apiFor(answers) {
        const link = answers?.link
        if (!link) return null
        return { port: APP_PORT, url: `http://localhost:${APP_PORT}`, oidc: true, linked: link }
    },

    /** The NestJS API of this app (see nestjs.buildFiles: `app`). */
    async steps({ projectDir, answers = {}, ...rest }) {
        if (!answers?.link) return []
        return nestjs.steps({ projectDir, ...rest, answers: { database: answers.database, app: answers.link } })
    },

    summary(answers) {
        const link = answers?.link
        if (!link)
            return [
                {
                    ok: false,
                    text: 'Niet gekoppeld: een koppeling met een bestaande OIDC-server heeft een frontend nodig. Kies eerst Next.js.'
                }
            ]
        return [
            {
                ok: true,
                text: `Gekoppeld aan ${link.issuer} als app "${link.name}" (${link.clientId}); de adressen van deze frontend zijn aan die app toegevoegd`
            },
            ...nestjs.summary({ database: answers.database }),
            {
                ok: true,
                text: `De API van de app (http://localhost:${APP_PORT}) aanvaardt enkel tokens van die login server voor deze app; de data staat per organisatie in ${answers.database?.database ?? 'de eigen database'} (Row-Level Security)`
            },
            link.product
                ? {
                      ok: true,
                      text: `De app verkoopt het product "${link.product}": enkel wie er een licentie van heeft (proefperiode of plaats) ziet de data; licenties beheer je op ${link.accountUrl}/licenses`
                  }
                : {
                      ok: true,
                      text: 'De app verkoopt (nog) geen product: kies er een op /admin → Apps en zet de code in OIDC_PRODUCT van ./backend/.env'
                  },
            ...(link.firstParty
                ? []
                : [
                      {
                          ok: true,
                          text: 'Deze app is een app van anderen: gebruikers zien bij de eerste login een toestemmingsscherm, en de API van de server (beheer, licenties) blijft dicht. Vink op /admin "Onze eigen toepassing" aan als het je eigen app is.'
                      }
                  ]),
            ...(link.clientSecret
                ? [
                      {
                          ok: true,
                          text: 'Het nieuwe secret van de app staat in ./frontend/.env.local (het vorige werkt niet meer)'
                      }
                  ]
                : [])
        ]
    },

    next(answers) {
        const link = answers?.link
        if (!link) return []
        return [
            `cd ${DIR}`,
            'npm run db:check    (test the database connection, creates the database)',
            'npm run start:dev',
            `API: http://localhost:${APP_PORT}  |  docs: http://localhost:${APP_PORT}/docs`,
            `Login: ${link.issuer}  |  account en beheer: ${link.accountUrl}`,
            `Deze frontend: http://localhost:${link.port}  (npm run dev in ./frontend)`
        ]
    }
}
