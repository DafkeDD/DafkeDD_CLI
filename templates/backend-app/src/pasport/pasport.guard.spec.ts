import type { ExecutionContext } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import type { Caller } from './access.js'
import type { PasportConfig } from './pasport.config.js'
import { PasportGuard } from './pasport.guard.js'
import type { PasportKeys } from './pasport-keys.service.js'

const TENANT = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Praktijk A',
    slug: 'praktijk-a',
    role: 'user' as const
}

/** The guard with a caller as the token says (the token itself is checked in pasport.e2e-spec.ts). */
function guard(product: string | null, caller: Partial<Caller>) {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector
    const config = { product } as PasportConfig
    const subject = new PasportGuard(reflector, config, {} as PasportKeys)
    const full: Caller = {
        sub: 'u1',
        tenant: TENANT,
        superadmin: false,
        sid: null,
        clientId: 'app',
        license: null,
        roles: null,
        ...caller
    }
    vi.spyOn(subject as unknown as { caller: () => Promise<Caller> }, 'caller').mockResolvedValue(full)
    const request = { headers: {} }
    const context = {
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({ getRequest: () => request })
    } as unknown as ExecutionContext
    return () => subject.canActivate(context)
}

describe('PasportGuard and the licence', () => {
    it('refuses a token that says "no licence", also when OIDC_PRODUCT is empty', async () => {
        await expect(
            guard(null, { license: { product: 'planner', status: 'none', endsAt: null } })()
        ).rejects.toMatchObject({
            key: 'errors.NO_LICENSE'
        })
    })

    it('lets in a licence, and a token without a licence claim when the app sells nothing', async () => {
        await expect(guard(null, { license: { product: 'planner', status: 'seat', endsAt: null } })()).resolves.toBe(
            true
        )
        await expect(guard(null, { license: null })()).resolves.toBe(true)
    })

    it('with OIDC_PRODUCT: only a licence of that product', async () => {
        await expect(guard('planner', { license: null })()).rejects.toMatchObject({
            key: 'errors.NO_LICENSE'
        })
        await expect(
            guard('planner', { license: { product: 'planner', status: 'trial', endsAt: null } })()
        ).resolves.toBe(true)
    })
})
