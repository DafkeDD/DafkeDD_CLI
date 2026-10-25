import { randomBytes } from 'node:crypto'
import { MockEidClient, SAMPLE_IDENTITY, SAMPLE_PIN } from '@dafkedd/eid/mock'
import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AppException } from '../common/app.exception.js'
import { EidService } from './eid.service.js'
import { OidcConfig } from './oidc.config.js'

const ORIGIN = 'http://localhost:3000'

function setup(env: Record<string, string> = {}) {
    const config = new OidcConfig(
        new ConfigService({
            OIDC_MASTER_KEY: randomBytes(32).toString('hex'),
            OIDC_EID: 'test',
            APP_URL: ORIGIN,
            ...env
        })
    )
    return new EidService(config)
}

const errorKey = (work: () => unknown) => {
    try {
        work()
    } catch (error) {
        return error instanceof AppException ? error.key : String(error)
    }
    return null
}

describe('EidService', () => {
    it('seals a verified person for one flow, until it expires', () => {
        const eid = setup()
        const person = {
            valueHash: 'hash',
            rrnEncrypted: 'sealed',
            address: null,
            firstNames: 'Jan',
            lastName: 'Specimen',
            name: 'Jan Specimen'
        }
        const now = Date.now()
        const sealed = eid.sealPerson(person, 'invite:1', now)
        expect(sealed).not.toContain('Specimen')
        expect(eid.openPerson(sealed, 'invite:1', now)).toEqual(person)
        expect(errorKey(() => eid.openPerson(sealed, 'invite:2', now))).toBe('oidc.EID_EXPIRED')
        expect(errorKey(() => eid.openPerson(sealed, 'invite:1', now + 16 * 60 * 1000))).toBe('oidc.EID_EXPIRED')
        expect(errorKey(() => eid.openPerson('x', 'invite:1', now))).toBe('oidc.EID_EXPIRED')
    })

    it('opens its own challenge only for the same purpose and account, before it expires', () => {
        const eid = setup()
        const { challenge, nonce, expiresAt } = eid.challenge('link', 'user-1')
        expect(nonce).toHaveLength(44)
        expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now())
        expect(eid.openChallenge(challenge, 'link', 'user-1')).toBe(nonce)
        expect(errorKey(() => eid.openChallenge(challenge, 'link', 'user-2'))).toBe('oidc.EID_EXPIRED')
        expect(errorKey(() => eid.openChallenge(challenge, 'register'))).toBe('oidc.EID_EXPIRED')
        expect(errorKey(() => eid.openChallenge(challenge, 'link', 'user-1', Date.now() + 6 * 60_000))).toBe(
            'oidc.EID_EXPIRED'
        )
        expect(errorKey(() => setup().openChallenge(challenge, 'link', 'user-1'))).toBe('oidc.EID_EXPIRED')
        expect(errorKey(() => eid.openChallenge({}, 'link', 'user-1'))).toBe('oidc.EID_EXPIRED')
    })

    it('verifies a token of the bridge and gives the name, a hash and the encrypted national register number', async () => {
        const eid = setup()
        const nonce = eid.nonce()
        const { token } = await new MockEidClient({ origin: ORIGIN, readDelayMs: 0 }).authenticate({
            nonce,
            pin: SAMPLE_PIN
        })
        const person = await eid.verify(token, nonce)
        expect(person).toEqual({
            valueHash: eid.hash(SAMPLE_IDENTITY.nationalNumber),
            firstNames: SAMPLE_IDENTITY.firstNames,
            lastName: SAMPLE_IDENTITY.lastName,
            name: `${SAMPLE_IDENTITY.firstNames} ${SAMPLE_IDENTITY.lastName}`,
            rrnEncrypted: expect.stringMatching(/^v1\./),
            address: null
        })
        expect(JSON.stringify(person)).not.toContain(SAMPLE_IDENTITY.nationalNumber)
        // Only this server can read it back (for the profile of the account itself)
        expect(eid.openNationalNumber(person.rrnEncrypted)?.replace(/\D/g, '')).toBe(
            SAMPLE_IDENTITY.nationalNumber.replace(/\D/g, '')
        )
    })

    it('refuses the test cards with OIDC_EID=on (only the Belgian root CAs)', async () => {
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
        const eid = setup({ OIDC_EID: 'on' })
        const nonce = eid.nonce()
        const { token } = await new MockEidClient({ origin: ORIGIN, readDelayMs: 0 }).authenticate({
            nonce,
            pin: SAMPLE_PIN
        })
        await expect(eid.verify(token, nonce)).rejects.toMatchObject({ key: 'oidc.EID_INVALID' })
        // The reason is logged (not shown to the user)
        expect(warn).toHaveBeenCalledWith('eID login refused: chain-untrusted')
        warn.mockRestore()
    })

    it('hashes the digits of the national register number with a key of this server', () => {
        const eid = setup()
        expect(eid.hash('85.03.15-123.69')).toBe(eid.hash('85031512369'))
        expect(eid.hash('85031512369')).not.toBe(setup().hash('85031512369'))
        expect(eid.hash('85031512369')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    })

    it('is off by default, and never runs with test cards in production', () => {
        expect(errorKey(() => setup({ OIDC_EID: '' }).challenge('register'))).toBe('oidc.EID_DISABLED')
        expect(() => setup({ NODE_ENV: 'production' })).toThrow(/OIDC_EID=test/)
        expect(setup({ NODE_ENV: 'production', OIDC_EID: 'on' }).enabled).toBe(true)
    })
})
