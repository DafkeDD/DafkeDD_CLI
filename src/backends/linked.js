import { input } from '@inquirer/prompts'

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
            body: JSON.stringify({ code: code.trim(), ...projectUris(port) }),
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
        scopes: body.client.scopes ?? [],
        port
    }
}

/**
 * "Backend": none of its own. The frontend is linked to an existing DafkeDD OIDC server (another project made with
 * this CLI) with a one-time link code of /admin → Apps: it logs in there and calls its API.
 */
export const linked = {
    id: 'linked',
    label: 'Bestaande DafkeDD OIDC-server (koppelcode)',
    description: 'Geen eigen backend: de frontend logt in via je bestaande server (koppelcode via /admin → Apps)',
    dir: null,

    async ask({ hasFrontend = false, prompts = { input }, fetchImpl = fetch } = {}) {
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
                message: 'Op welke poort draait deze nieuwe frontend? (3000 is meestal de frontend van de server zelf)',
                default: String(DEFAULT_PORT),
                validate: value =>
                    /^\d+$/.test(value) && Number(value) >= 1024 && Number(value) <= 65535 && Number(value) !== 4000
                        ? true
                        : 'Een poort tussen 1024 en 65535 (niet 4000)'
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
        return { link }
    },

    /** What the frontend gets to know: the API and the login of that server, as a linked client. */
    apiFor(answers) {
        const link = answers?.link
        if (!link) return null
        const port = Number(new URL(link.apiUrl).port) || (link.apiUrl.startsWith('https:') ? 443 : 80)
        return { port, url: link.apiUrl, oidc: true, linked: link }
    },

    async steps() {
        return []
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
            `Login: ${link.issuer}  |  account en beheer: ${link.accountUrl}`,
            `Deze frontend: http://localhost:${link.port}  (npm run dev in ./frontend)`
        ]
    }
}
