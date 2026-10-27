import { randomBytes } from 'node:crypto'
import { randomToken } from './crypto.js'
import { type Interaction, interactionKey, openInteraction, sealInteraction } from './interaction.js'
import { OIDC } from './oidc.config.js'

const key = interactionKey(randomBytes(32))

const interaction = (overrides: Partial<Interaction> = {}): Interaction => ({
    id: randomToken(),
    params: {
        clientId: 'frontend',
        redirectUri: 'http://localhost:3000/api/auth/callback',
        scope: ['openid', 'profile', 'email', 'tenant'],
        state: 'state',
        nonce: 'nonce',
        codeChallenge: 'c'.repeat(43),
        prompt: [],
        maxAge: null,
        loginHint: null,
        tenantHint: null,
        uiLocales: ['nl']
    },
    csrf: randomToken(),
    userId: null,
    mfaPending: false,
    enrolling: false,
    amr: [],
    eidNonce: null,
    passkeyChallenge: null,
    consent: null,
    license: null,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0',
    expiresAt: Date.now() + 60_000,
    ...overrides
})

describe('login cookie (interaction)', () => {
    it('keeps the "no licence" screen of a login (its session and organisation)', () => {
        const original = interaction({ userId: 'user-1', license: { sessionId: 's-1', tenantId: 't-1' } })
        expect(openInteraction(original.id, sealInteraction(original, key), key)?.license).toEqual({
            sessionId: 's-1',
            tenantId: 't-1'
        })
    })

    it('opens what it sealed', () => {
        const original = interaction({ userId: 'user-1', mfaPending: true, amr: ['pwd'] })
        expect(openInteraction(original.id, sealInteraction(original, key), key)).toEqual(original)
    })

    it('keeps the nonce of an eID login', () => {
        const original = interaction({ eidNonce: randomToken() })
        expect(openInteraction(original.id, sealInteraction(original, key), key)?.eidNonce).toBe(original.eidNonce)
    })

    it('refuses another id, a changed cookie, another key and a missing cookie', () => {
        const original = interaction()
        const sealed = sealInteraction(original, key)
        expect(openInteraction(randomToken(), sealed, key)).toBeNull()
        expect(openInteraction(original.id, sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA'), key)).toBeNull()
        expect(openInteraction(original.id, sealed, interactionKey(randomBytes(32)))).toBeNull()
        expect(openInteraction(original.id, undefined, key)).toBeNull()
        expect(openInteraction('not-an-id', sealed, key)).toBeNull()
    })

    it('refuses an expired login', () => {
        const original = interaction({ expiresAt: Date.now() - 1 })
        expect(openInteraction(original.id, sealInteraction(original, key), key)).toBeNull()
    })

    it('uses another key than the master key itself', () => {
        const master = randomBytes(32)
        expect(interactionKey(master).equals(master)).toBe(false)
        expect(interactionKey(master).equals(interactionKey(master))).toBe(true)
    })

    it('stays below the cookie limit with the largest request the server accepts', () => {
        const largest = interaction({
            userId: crypto.randomUUID(),
            params: {
                ...interaction().params,
                redirectUri: 'https://' + 'a'.repeat(200) + '.example.com/callback',
                state: 'x'.repeat(1024),
                nonce: 'y'.repeat(512),
                loginHint: 'z'.repeat(254),
                tenantHint: 't'.repeat(100),
                prompt: ['login', 'consent', 'select_account'],
                uiLocales: ['en', 'nl', 'fr', 'de']
            }
        })
        expect(sealInteraction(largest, key).length).toBeLessThan(OIDC.MAX_INTERACTION_COOKIE)
    })
})
