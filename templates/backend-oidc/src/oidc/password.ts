import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'

// scrypt with a random salt per password. The parameters are stored in the hash, so they can be raised later.
// scripts/oidc-user.mjs and the CLI use exactly the same format.
const N = 2 ** 15
const R = 8
const P = 1
const KEY_LENGTH = 64
const MAX_COST = 2 ** 20

function derive(password: string, salt: Buffer, cost: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scryptCallback(password, salt, KEY_LENGTH, { N: cost, r: R, p: P, maxmem: 128 * cost * R * 2 }, (error, key) =>
            error ? reject(error) : resolve(key)
        )
    })
}

/** Returns "scrypt$<N>$<salt>$<hash>". */
export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16)
    const key = await derive(password, salt, N)
    return ['scrypt', N, salt.toString('hex'), key.toString('hex')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const [scheme, cost, saltHex, keyHex] = stored.split('$')
    const n = Number(cost)
    // Only powers of two up to MAX_COST: a tampered hash must not make the server burn memory.
    if (
        scheme !== 'scrypt' ||
        !saltHex ||
        !keyHex ||
        !Number.isInteger(n) ||
        n < 2 ||
        n > MAX_COST ||
        (n & (n - 1)) !== 0
    ) {
        return false
    }
    const expected = Buffer.from(keyHex, 'hex')
    const actual = await derive(password, Buffer.from(saltHex, 'hex'), n)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
}
