import { randomBytes } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { KeysService } from './keys.service.js'
import { OidcConfig } from './oidc.config.js'
import { MemoryOidcStore } from './store/memory-oidc.store.js'

const DAY = 24 * 60 * 60 * 1000

function setup(masterKey = randomBytes(32).toString('hex')) {
    const store = new MemoryOidcStore()
    const config = new OidcConfig(new ConfigService({ OIDC_MASTER_KEY: masterKey }))
    return { store, keys: new KeysService(store, config) }
}

describe('KeysService', () => {
    it('creates one active RS256 and one active ES256 key, once', async () => {
        const { store, keys } = setup()
        await keys.ensure()
        await keys.ensure()
        expect(store.keys.map(key => `${key.alg}:${key.status}`).sort()).toEqual(['ES256:active', 'RS256:active'])
        expect((await keys.signingKey('ES256')).kid).toBe(store.keys.find(key => key.alg === 'ES256')?.kid)
    })

    it('replaces keys older than 90 days and keeps the old one in the JWKS during the grace period', async () => {
        const { store, keys } = setup()
        await keys.ensure(new Date(Date.now() - 91 * DAY))
        const old = store.keys.map(key => key.kid)
        await keys.ensure()
        expect(store.keys).toHaveLength(4)
        expect(store.keys.filter(key => key.status === 'active').map(key => key.kid)).not.toEqual(
            expect.arrayContaining(old)
        )
        const published = (await keys.jwks()).keys.map(key => (key as { kid: string }).kid)
        expect(published).toEqual(expect.arrayContaining(old))
        expect([...(await keys.verificationKeys()).keys()]).toEqual(expect.arrayContaining(old))
    })

    it('drops retired keys from the JWKS after the grace period', async () => {
        const { store, keys } = setup()
        await keys.ensure()
        const oldKid = store.keys[0]?.kid
        await keys.rotate(store.keys[0]?.alg ?? 'RS256')
        for (const key of store.keys) if (key.status === 'retiring') key.retiredAt = new Date(Date.now() - 15 * DAY)
        await keys.rotate('ES256')
        const published = (await keys.jwks()).keys.map(key => (key as { kid: string }).kid)
        expect(published).not.toContain(oldKid)
        // the new RS256 key, the new ES256 key and the ES256 key that was just replaced
        expect(published).toHaveLength(3)
    })

    it('never publishes or stores a readable private key', async () => {
        const { store, keys } = setup()
        await keys.ensure()
        for (const key of store.keys) expect(key.privateKey).not.toContain('PRIVATE KEY')
        for (const jwk of (await keys.jwks()).keys) expect((jwk as { d?: string }).d).toBeUndefined()
    })

    it('refuses to start without a valid OIDC_MASTER_KEY', async () => {
        await expect(setup('too-short').keys.ensure()).rejects.toThrow('OIDC_MASTER_KEY')
    })
})
