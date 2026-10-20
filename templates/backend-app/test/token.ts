import { generateKeyPairSync, type KeyObject, randomUUID, sign } from 'node:crypto'
import type { VerifyKey } from '../src/pasport/jose.js'

/** A login server for the tests: its key, and access tokens like the real one signs them (ES256, typ at+jwt). */
export const ISSUER = 'http://login.test/oidc'
export const AUDIENCE = 'http://login.test'
export const CLIENT_ID = 'planner'
/** The product the app sells (OIDC_PRODUCT in the tests). */
export const PRODUCT = 'planner'
export const KID = 'test-key'

const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })

/** What PasportKeys answers in the tests: only our test key. */
export const testKeys = {
    find: (kid: string): Promise<VerifyKey | undefined> =>
        Promise.resolve(kid === KID ? { alg: 'ES256', key: pair.publicKey } : undefined)
}

export const TENANT_A = { id: '11111111-1111-4111-8111-111111111111', name: 'Praktijk A', role: 'admin' as const }
export const TENANT_B = { id: '22222222-2222-4222-8222-222222222222', name: 'Praktijk B', role: 'user' as const }

const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

/** An access token; `claims` overrides or removes (undefined) claims, `header` the header, `key` signs. */
export function accessToken(
    claims: Record<string, unknown> = {},
    { header = {}, key = pair.privateKey }: { header?: object; key?: KeyObject } = {}
): string {
    const now = Math.floor(Date.now() / 1000)
    const payload = {
        iss: ISSUER,
        sub: randomUUID(),
        aud: AUDIENCE,
        client_id: CLIENT_ID,
        scope: 'openid profile email tenant',
        iat: now,
        exp: now + 600,
        jti: randomUUID(),
        sid: randomUUID(),
        tenant: TENANT_A,
        // A running trial of the product of the app
        license: { product: PRODUCT, status: 'trial', ends_at: now + 14 * 24 * 60 * 60 },
        // The default role of config/app-roles.json
        roles: ['editor'],
        ...claims
    }
    const input = part({ alg: 'ES256', kid: KID, typ: 'at+jwt', ...header }) + '.' + part(payload)
    const signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
    return input + '.' + signature.toString('base64url')
}

/** A key the login server does not have (a forged token). */
export const OTHER_KEY = other.privateKey
