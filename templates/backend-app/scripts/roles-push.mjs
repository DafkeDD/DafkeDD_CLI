// Sends the roles of this app (config/app-roles.json) to the login server: npm run roles:push -- --code K7QM-2XPD-9HRT-W4NB-C8ZF-3VJE
// Make the link code on the login server: /admin -> Apps -> Koppelcode (one time, 15 minutes). The roles replace the
// roles of the app there; the beheerders of every organisation then give them to their members (/members).
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

try {
    process.loadEnvFile('.env')
} catch {
    // no .env file: use the environment as it is
}
const { values } = parseArgs({ options: { code: { type: 'string' }, issuer: { type: 'string' } } })
const issuer = (values.issuer ?? process.env.OIDC_ISSUER ?? '').replace(/\/+$/, '')
if (!values.code || !issuer) {
    console.error('Usage: npm run roles:push -- --code K7QM-2XPD-9HRT-W4NB-C8ZF-3VJE   (OIDC_ISSUER comes from .env)')
    process.exit(1)
}
const roles = JSON.parse(readFileSync('config/app-roles.json', 'utf8'))
const response = await fetch(issuer + '/link/roles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Language': 'en' },
    body: JSON.stringify({ code: values.code, roles })
}).catch(error => {
    console.error(`The login server ${issuer} cannot be reached: ${error.message}`)
    process.exit(1)
})
const body = await response.json().catch(() => ({}))
if (!response.ok) {
    console.error(Array.isArray(body.message) ? body.message.join('\n') : body.message || `Answer ${response.status}`)
    process.exit(1)
}
console.log(`The app ${body.clientId} has the roles: ${body.roles.join(', ')}`)
