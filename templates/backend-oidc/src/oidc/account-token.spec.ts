import { randomBytes } from 'node:crypto'
import { accountTokenKey, openAccountToken, sealAccountToken } from './account-token.js'

const key = accountTokenKey(randomBytes(32))
const verify = { userId: 'u1', email: 'ada@example.com' }

describe('account tokens (links in emails)', () => {
    it('opens what it sealed, without the expiry', () => {
        expect(openAccountToken('verify', sealAccountToken('verify', verify, 60, key), key)).toEqual(verify)
    })

    it('is encrypted and URL-safe', () => {
        const token = sealAccountToken('verify', verify, 60, key)
        expect(token).toMatch(/^[A-Za-z0-9._-]+$/)
        expect(Buffer.from(token.split('.')[3] ?? '', 'base64url').toString('latin1')).not.toContain('ada@example')
    })

    it('refuses another kind, another key, a changed token, an expired token and garbage', () => {
        const token = sealAccountToken('verify', verify, 60, key)
        expect(openAccountToken('reset', token, key)).toBeNull()
        expect(openAccountToken('verify', token, accountTokenKey(randomBytes(32)))).toBeNull()
        expect(openAccountToken('verify', token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA'), key)).toBeNull()
        expect(
            openAccountToken('verify', sealAccountToken('verify', verify, 60, key, Date.now() - 61_000), key)
        ).toBeNull()
        expect(openAccountToken('verify', 'not-a-token', key)).toBeNull()
        expect(openAccountToken('verify', undefined, key)).toBeNull()
    })
})
