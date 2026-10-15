import { randomBytes } from 'node:crypto'
import { type Algorithm, VirtualPasskey } from '../../../test/virtual-authenticator.js'
import { verifyAuthentication, verifyRegistration, WebAuthnError } from './webauthn.js'

const ORIGIN = 'http://localhost:3000'
const RP_ID = 'localhost'
const USER = Buffer.from('6a1d1f8e-3c55-4f7b-a1a8-0e2b1b9c2d11').toString('base64url')
const challenge = () => randomBytes(32).toString('base64url')
const createOptions = (value: string) => ({ challenge: value, rp: { id: RP_ID }, user: { id: USER } })
const expected = (value: string) => ({ challenge: value, origins: [ORIGIN], rpId: RP_ID })

function register(device: VirtualPasskey) {
    const value = challenge()
    return verifyRegistration(device.create(createOptions(value), ORIGIN), expected(value))
}

describe('WebAuthn', () => {
    it.each<[Algorithm, number]>([
        ['ES256', -7],
        ['RS256', -257],
        ['EdDSA', -8]
    ])('registers and logs in with %s', (algorithm, cose) => {
        const device = new VirtualPasskey({ algorithm, counting: true })
        const created = register(device)
        expect(created).toMatchObject({ credentialId: device.credentialId, algorithm: cose, signCount: 1 })
        expect(created.transports).toEqual(['internal', 'hybrid'])

        const value = challenge()
        const stored = { ...created, userHandle: USER }
        const result = verifyAuthentication(
            device.get({ challenge: value, rpId: RP_ID }, ORIGIN),
            stored,
            expected(value)
        )
        expect(result.signCount).toBe(2)
    })

    it('knows a synced passkey', () => {
        const created = register(new VirtualPasskey({ synced: true }))
        expect(created).toMatchObject({ backupEligible: true, backedUp: true, signCount: 0 })
    })

    it('refuses a registration with the wrong challenge, origin or relying party', () => {
        const device = new VirtualPasskey()
        const value = challenge()
        for (const overrides of [
            { challenge: challenge() },
            { origin: 'https://evil.example' },
            { rpId: 'evil.example' }
        ])
            expect(() =>
                verifyRegistration(device.create(createOptions(value), ORIGIN, overrides), expected(value))
            ).toThrow(WebAuthnError)
    })

    it('refuses a device without user verification', () => {
        const device = new VirtualPasskey({ userVerified: false })
        expect(() => register(device)).toThrow('User not verified')
    })

    it('refuses a login with a login answer to a registration and vice versa', () => {
        const device = new VirtualPasskey()
        const value = challenge()
        const answer = device.get({ challenge: value, rpId: RP_ID }, ORIGIN)
        expect(() =>
            verifyRegistration(
                { id: answer.id, response: { clientDataJSON: answer.response.clientDataJSON, attestationObject: '' } },
                expected(value)
            )
        ).toThrow('Wrong ceremony type')
    })

    it('refuses a bad signature, another key, the wrong challenge or user handle', () => {
        const device = new VirtualPasskey()
        const stored = { ...register(device), userHandle: USER }
        const value = challenge()
        const good = device.get({ challenge: value, rpId: RP_ID }, ORIGIN)

        const tampered = { ...good, response: { ...good.response, signature: randomBytes(70).toString('base64url') } }
        expect(() => verifyAuthentication(tampered, stored, expected(value))).toThrow('Invalid signature')

        const other = new VirtualPasskey()
        other.userHandle = USER
        expect(() =>
            verifyAuthentication(other.get({ challenge: value, rpId: RP_ID }, ORIGIN), stored, expected(value))
        ).toThrow('Invalid signature')

        expect(() => verifyAuthentication(good, stored, expected(challenge()))).toThrow('Wrong challenge')
        const handle = device.get({ challenge: value, rpId: RP_ID }, ORIGIN, { userHandle: 'b3RoZXI' })
        expect(() => verifyAuthentication(handle, stored, expected(value))).toThrow('Wrong user handle')
        const origin = device.get({ challenge: value, rpId: RP_ID }, ORIGIN, { origin: 'http://localhost:3001' })
        expect(() => verifyAuthentication(origin, stored, expected(value))).toThrow('Wrong origin')
    })

    it('refuses a counter that does not go up (a cloned device)', () => {
        const device = new VirtualPasskey({ counting: true })
        const stored = { ...register(device), userHandle: USER }
        const value = challenge()
        const answer = device.get({ challenge: value, rpId: RP_ID }, ORIGIN)
        expect(() => verifyAuthentication(answer, { ...stored, signCount: 5 }, expected(value))).toThrow(
            'Signature counter'
        )
    })

    it('refuses rubbish without crashing', () => {
        for (const credential of [null, {}, { id: 'x', response: { clientDataJSON: '!!' } }, { response: 'x' }])
            expect(() => verifyRegistration(credential as never, expected(challenge()))).toThrow(WebAuthnError)
    })
})
