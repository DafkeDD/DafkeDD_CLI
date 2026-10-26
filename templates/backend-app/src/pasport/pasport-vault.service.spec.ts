import { ConfigService } from '@nestjs/config'
import { PasportConfig } from './pasport.config.js'
import { PasportVault } from './pasport-vault.service.js'

const vault = (env: Record<string, string>) => {
    const config = new ConfigService({
        OIDC_AUDIENCE: 'http://login.test',
        OIDC_CLIENT_IDS: 'planner',
        ...env
    })
    return new PasportVault(new PasportConfig(config), config)
}

describe('PasportVault (the eHealth vault of the login server)', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('asks the login server with the client id and secret of this app and the token of the doctor', async () => {
        const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ filename: 'dr.p12', subject: 'CN=Dr' })))
        vi.stubGlobal('fetch', fetch)
        const result = await vault({ OIDC_CLIENT_SECRET: 's3cr:t' }).credentials('the-token')
        expect(result).toMatchObject({ filename: 'dr.p12', subject: 'CN=Dr' })
        const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('http://login.test/vault/credentials')
        expect((init.headers as Record<string, string>).Authorization).toBe(
            'Basic ' + Buffer.from('planner:s3cr%3At').toString('base64')
        )
        expect(JSON.parse(String(init.body))).toEqual({ accessToken: 'the-token' })
    })

    it('asks for the certificate of a doctor who chose this account, and for those doctors', async () => {
        const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify([{ id: 'd1', self: false }])))
        vi.stubGlobal('fetch', fetch)
        const pasport = vault({ OIDC_CLIENT_SECRET: 'x' })
        await pasport.credentials('the-token', 'd1')
        expect(JSON.parse(String((fetch.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
            accessToken: 'the-token',
            doctorId: 'd1'
        })
        expect(await pasport.doctors('the-token')).toEqual([{ id: 'd1', self: false }])
        expect((fetch.mock.calls[1] as [string])[0]).toBe('http://login.test/vault/doctors')
    })

    it('says why not, in the words of this app', async () => {
        expect(vault({}).enabled).toBe(false)
        await expect(vault({}).credentials('t')).rejects.toMatchObject({ key: 'errors.VAULT_NOT_SET_UP' })
        for (const [status, key] of [
            [404, 'errors.VAULT_EMPTY'],
            [403, 'errors.VAULT_NOT_ALLOWED'],
            [409, 'errors.VAULT_NOT_READY'],
            [500, 'errors.VAULT_UNAVAILABLE']
        ] as const) {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })))
            await expect(vault({ OIDC_CLIENT_SECRET: 'x' }).credentials('t')).rejects.toMatchObject({ key })
        }
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
        await expect(vault({ OIDC_CLIENT_SECRET: 'x' }).credentials('t')).rejects.toMatchObject({
            key: 'errors.VAULT_UNAVAILABLE'
        })
    })
})
