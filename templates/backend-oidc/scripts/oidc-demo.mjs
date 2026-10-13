// A tiny OpenID Connect client to try the login: npm run oidc:demo, then open http://localhost:4400
// It does what every client does: discovery, a redirect with PKCE, the code exchange, verifying the ID token with the
// JWKS, and a call to userinfo. No dependencies, only node:crypto and fetch. Client "demo" in config/oidc-clients.json.
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto'
import { createServer } from 'node:http'

try {
    process.loadEnvFile()
} catch {
    // no .env file
}

const ISSUER = (process.env.OIDC_ISSUER ?? 'http://localhost:__PORT__/oidc').replace(/\/+$/, '')
const PORT = 4400
const CLIENT_ID = 'demo'
const REDIRECT_URI = `http://localhost:${PORT}/callback`
const pending = new Map() // state -> { verifier, nonce }

const b64url = buffer => Buffer.from(buffer).toString('base64url')
const escape = value => String(value).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const page = (title, body) =>
    `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title>` +
    `<body style="font:15px/1.5 system-ui;max-width:860px;margin:40px auto;padding:0 16px">` +
    `<h1>${escape(title)}</h1>${body}</body>`

async function discovery() {
    const response = await fetch(ISSUER + '/.well-known/openid-configuration')
    if (!response.ok) throw new Error('Discovery failed: ' + response.status + ' (is the API running?)')
    return response.json()
}

/** Verifies the ID token: signature with the JWKS, issuer, audience, expiry and nonce. */
async function verifyIdToken(token, config, nonce) {
    const [header, payload, signature] = token.split('.')
    const head = JSON.parse(Buffer.from(header, 'base64url'))
    const claims = JSON.parse(Buffer.from(payload, 'base64url'))
    const { keys } = await (await fetch(config.jwks_uri)).json()
    const jwk = keys.find(key => key.kid === head.kid)
    if (!jwk || head.alg !== 'RS256' || jwk.alg !== 'RS256') throw new Error('Unknown key or algorithm')
    const valid = verify(
        'sha256',
        Buffer.from(header + '.' + payload),
        createPublicKey({ key: jwk, format: 'jwk' }),
        Buffer.from(signature, 'base64url')
    )
    if (!valid) throw new Error('Invalid signature')
    if (claims.iss !== config.issuer || claims.aud !== CLIENT_ID) throw new Error('Wrong issuer or audience')
    if (claims.exp * 1000 < Date.now()) throw new Error('ID token expired')
    if (claims.nonce !== nonce) throw new Error('Wrong nonce')
    return claims
}

createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://localhost:${PORT}`)
    const send = (status, html) => response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }).end(html)
    try {
        const config = await discovery()
        if (url.pathname === '/') {
            const state = b64url(randomBytes(16))
            const nonce = b64url(randomBytes(16))
            const verifier = b64url(randomBytes(32))
            pending.set(state, { verifier, nonce })
            const authorize = new URL(config.authorization_endpoint)
            authorize.search = new URLSearchParams({
                client_id: CLIENT_ID,
                redirect_uri: REDIRECT_URI,
                response_type: 'code',
                scope: 'openid profile email tenant',
                state,
                nonce,
                code_challenge: b64url(createHash('sha256').update(verifier).digest()),
                code_challenge_method: 'S256'
            }).toString()
            return response.writeHead(302, { Location: authorize.toString() }).end()
        }
        if (url.pathname === '/callback') {
            const state = url.searchParams.get('state')
            const flow = state ? pending.get(state) : undefined
            if (url.searchParams.get('error'))
                return send(
                    400,
                    page(
                        'Login failed',
                        `<p>${escape(url.searchParams.get('error'))}: ${escape(url.searchParams.get('error_description') ?? '')}</p>`
                    )
                )
            if (!flow) return send(400, page('Unknown state', '<p><a href="/">Start again</a></p>'))
            if (url.searchParams.get('iss') !== config.issuer) return send(400, page('Wrong issuer', ''))
            pending.delete(state)
            const tokenResponse = await fetch(config.token_endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: url.searchParams.get('code') ?? '',
                    redirect_uri: REDIRECT_URI,
                    client_id: CLIENT_ID,
                    code_verifier: flow.verifier
                })
            })
            const tokens = await tokenResponse.json()
            if (!tokenResponse.ok)
                return send(400, page('Token request failed', `<pre>${escape(JSON.stringify(tokens, null, 2))}</pre>`))
            const claims = await verifyIdToken(tokens.id_token, config, flow.nonce)
            const userinfo = await (
                await fetch(config.userinfo_endpoint, { headers: { Authorization: 'Bearer ' + tokens.access_token } })
            ).json()
            return send(
                200,
                page(
                    `Logged in as ${claims.sub}`,
                    `<p>The ID token is verified (signature, issuer, audience, expiry, nonce).</p>` +
                        `<h2>ID token claims</h2><pre>${escape(JSON.stringify(claims, null, 2))}</pre>` +
                        `<h2>Userinfo</h2><pre>${escape(JSON.stringify(userinfo, null, 2))}</pre>` +
                        `<p><a href="/">Log in again</a></p>`
                )
            )
        }
        send(404, page('Not found', '<p><a href="/">Start</a></p>'))
    } catch (error) {
        send(500, page('Error', `<pre>${escape(error instanceof Error ? error.message : String(error))}</pre>`))
    }
}).listen(PORT, '127.0.0.1', () => console.log(`OIDC demo client: http://localhost:${PORT} (issuer ${ISSUER})`))
