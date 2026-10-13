import { createPrivateKey, createPublicKey, generateKeyPairSync, type JsonWebKey, KeyObject } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { decrypt, encrypt } from './crypto.js'
import { ALGORITHMS, type JwsAlgorithm, thumbprint, type VerifyKey } from './jose.js'
import { OIDC, OidcConfig } from './oidc.config.js'
import { OIDC_STORE, type OidcStore, type StoredKey } from './store/oidc.store.js'

const DAY = 24 * 60 * 60 * 1000
const CACHE_MS = 60 * 1000

export interface SigningKey {
    kid: string
    alg: JwsAlgorithm
    privateKey: KeyObject
}

interface Loaded {
    at: number
    signing: Map<JwsAlgorithm, SigningKey>
    verify: Map<string, VerifyKey>
    jwks: JsonWebKey[]
}

/**
 * The signing keys: one active RS256 key (ID tokens, required by OpenID Connect) and one active ES256 key (access
 * tokens). A key is replaced after KEY_ROTATION_DAYS; the old one stays in the JWKS for KEY_GRACE_DAYS so tokens and
 * caches keep working. Private keys are stored encrypted with OIDC_MASTER_KEY.
 */
@Injectable()
export class KeysService {
    private loaded: Loaded | null = null

    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly config: OidcConfig
    ) {}

    /** Creates the missing keys and replaces keys that are too old. */
    async ensure(now = new Date()): Promise<void> {
        const keys = await this.store.listKeys()
        const replaceBefore = new Date(now.getTime() - OIDC.KEY_ROTATION_DAYS * DAY)
        let changed = false
        for (const alg of ALGORITHMS) {
            const active = keys.find(key => key.alg === alg && key.status === 'active')
            if (!active || active.createdAt < replaceBefore) {
                changed = (await this.store.activateKey(this.generate(alg, now), replaceBefore)) || changed
            }
        }
        if (changed) this.loaded = null
    }

    /** Replaces the active key of `alg` right away (for example after a leak). */
    async rotate(alg: JwsAlgorithm, now = new Date()): Promise<void> {
        await this.store.activateKey(this.generate(alg, now), new Date(now.getTime() + 1))
        this.loaded = null
    }

    async signingKey(alg: JwsAlgorithm): Promise<SigningKey> {
        const key = (await this.load()).signing.get(alg)
        if (!key) throw new Error(`No active ${alg} signing key`)
        return key
    }

    /** Keys that may verify a token: the active ones and the ones in their grace period. */
    async verificationKeys(): Promise<Map<string, VerifyKey>> {
        return (await this.load()).verify
    }

    /** The public keys for /oidc/jwks. */
    async jwks(): Promise<{ keys: JsonWebKey[] }> {
        return { keys: (await this.load()).jwks }
    }

    private generate(alg: JwsAlgorithm, now: Date): StoredKey {
        const { privateKey, publicKey } =
            alg === 'RS256'
                ? generateKeyPairSync('rsa', { modulusLength: 2048 })
                : generateKeyPairSync('ec', { namedCurve: 'P-256' })
        const jwk = publicKey.export({ format: 'jwk' })
        const kid = thumbprint(jwk)
        const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
        return {
            kid,
            alg,
            publicJwk: { ...jwk, kid, alg, use: 'sig' },
            privateKey: encrypt(pem, this.config.masterKey(), kid),
            status: 'active',
            createdAt: now,
            retiredAt: null
        }
    }

    private async load(): Promise<Loaded> {
        if (this.loaded && Date.now() - this.loaded.at < CACHE_MS) return this.loaded
        const graceStart = Date.now() - OIDC.KEY_GRACE_DAYS * DAY
        const usable = (await this.store.listKeys()).filter(
            key => key.status === 'active' || (key.retiredAt !== null && key.retiredAt.getTime() > graceStart)
        )
        const loaded: Loaded = { at: Date.now(), signing: new Map(), verify: new Map(), jwks: [] }
        for (const key of usable) {
            loaded.verify.set(key.kid, { alg: key.alg, key: createPublicKey({ key: key.publicJwk, format: 'jwk' }) })
            loaded.jwks.push(key.publicJwk)
            if (key.status === 'active') {
                const pem = decrypt(key.privateKey, this.config.masterKey(), key.kid)
                loaded.signing.set(key.alg, { kid: key.kid, alg: key.alg, privateKey: createPrivateKey(pem) })
            }
        }
        this.loaded = loaded
        return loaded
    }
}
