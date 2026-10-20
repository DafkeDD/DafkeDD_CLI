import { createPublicKey, type JsonWebKey } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import type { VerifyKey } from './jose.js'
import { PasportConfig } from './pasport.config.js'

/** How long the keys are trusted before they are fetched again, and how often an unknown key may cause a fetch. */
const REFRESH_MS = 10 * 60_000
const MIN_FETCH_INTERVAL_MS = 30_000

/**
 * The public keys of the login server (its JWKS, found through its discovery document). Kept in memory; fetched
 * again every 10 minutes, and earlier when a token names a key that is not known yet (the login server rotated its
 * keys), but at most every 30 seconds so that made-up key ids cannot make this API hammer the login server.
 */
@Injectable()
export class PasportKeys {
    private readonly logger = new Logger(PasportKeys.name)
    private keys = new Map<string, VerifyKey>()
    private fetchedAt = 0
    private pending: Promise<void> | null = null

    constructor(private readonly config: PasportConfig) {}

    /** The key with this id, or undefined. */
    async find(kid: string): Promise<VerifyKey | undefined> {
        const stale = Date.now() - this.fetchedAt > REFRESH_MS
        const unknown = !this.keys.has(kid) && Date.now() - this.fetchedAt > MIN_FETCH_INTERVAL_MS
        if (stale || unknown) await this.refresh()
        return this.keys.get(kid)
    }

    private refresh(): Promise<void> {
        this.pending ??= this.load()
            .catch((error: unknown) => {
                // The login server is down: keep the keys we had, try again at the next token
                this.logger.warn('Could not fetch the keys of the login server: ' + String(error))
            })
            .finally(() => {
                this.fetchedAt = Date.now()
                this.pending = null
            })
        return this.pending
    }

    private async load() {
        const discovery = (await this.json(this.config.issuer + '/.well-known/openid-configuration')) as {
            issuer?: string
            jwks_uri?: string
        }
        if (discovery.issuer !== this.config.issuer || typeof discovery.jwks_uri !== 'string')
            throw new Error('The discovery document does not belong to ' + this.config.issuer)
        const { keys } = (await this.json(discovery.jwks_uri)) as { keys?: (JsonWebKey & { kid?: string })[] }
        const next = new Map<string, VerifyKey>()
        for (const jwk of keys ?? []) {
            if (typeof jwk.kid !== 'string' || (jwk.use !== undefined && jwk.use !== 'sig')) continue
            const alg = jwk.kty === 'EC' && jwk.crv === 'P-256' ? 'ES256' : jwk.kty === 'RSA' ? 'RS256' : null
            if (!alg) continue
            next.set(jwk.kid, { alg, key: createPublicKey({ key: jwk, format: 'jwk' }) })
        }
        this.keys = next
    }

    private async json(url: string): Promise<unknown> {
        const response = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(5000)
        })
        if (!response.ok) throw new Error(`${url} answered ${response.status}`)
        return response.json()
    }
}
