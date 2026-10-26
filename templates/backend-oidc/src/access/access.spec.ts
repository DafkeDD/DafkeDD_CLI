import { randomBytes } from 'node:crypto'
import { type ExecutionContext } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { AppException } from '../common/app.exception.js'
import { NotificationsController } from '../notifications/notifications.controller.js'
import { EidController } from '../oidc/eid.controller.js'
import { OidcConfig } from '../oidc/oidc.config.js'
import type { OidcService } from '../oidc/oidc.service.js'
import { ProfileController } from '../oidc/profile.controller.js'
import { SessionsController } from '../oidc/sessions.controller.js'
import { MemoryOidcStore } from '../oidc/store/memory-oidc.store.js'
import { PresenceController } from '../tenants/presence.controller.js'
import { Access, AccessGuard, EidOptional } from './access.js'

@Access('user')
class NormalController {
    list() {
        return []
    }

    @EidOptional()
    optional() {
        return []
    }
}

function setup(env: Record<string, string> = {}) {
    const config = new OidcConfig(
        new ConfigService({ OIDC_MASTER_KEY: randomBytes(32).toString('hex'), OIDC_EID: 'test', ...env })
    )
    const store = new MemoryOidcStore()
    store.clients.set('frontend', { clientId: 'frontend', firstParty: true } as never)
    const tenant = store.addTenant('acme', 'Acme')
    const user = store.addUser({ email: 'bob@example.com', name: 'Bob', passwordHash: null })
    const root = store.addUser({ email: 'root@example.com', name: 'Root', passwordHash: null, isSuperadmin: true })
    store.addMembership(tenant.id, user.id, 'user')
    // The token says who calls: `sub` is set per request (the headers carry its id)
    const oidc = {
        verifyAccessToken: async (token: string) => ({
            sub: token,
            client_id: 'frontend',
            tenant: { id: tenant.id, name: tenant.name },
            sid: 'session'
        })
    } as unknown as OidcService
    const guard = new AccessGuard(oidc, store, new Reflector(), config)
    /** Runs the guard for `handler` of `controller` as the user with this id. */
    const call = async (userId: string, controller: object, handler: string) => {
        const request = { headers: { authorization: 'Bearer ' + userId } }
        const context = {
            switchToHttp: () => ({ getRequest: () => request }),
            getHandler: () => (controller as Record<string, unknown>)[handler],
            getClass: () => controller.constructor
        } as unknown as ExecutionContext
        try {
            return await guard.canActivate(context)
        } catch (error) {
            if (error instanceof AppException) return error.key
            throw error
        }
    }
    return { store, user, root, call }
}

const normal = new NormalController()

describe('AccessGuard with OIDC_EID_REQUIRED', () => {
    it('refuses an account without a linked eID on a normal route', async () => {
        const { user, call } = setup()
        expect(await call(user.id, normal, 'list')).toBe('oidc.EID_REQUIRED')
    })

    it('lets it through on the routes marked @EidOptional()', async () => {
        const { user, call } = setup()
        expect(await call(user.id, normal, 'optional')).toBe(true)
        const eid = Object.create(EidController.prototype) as object
        expect(await call(user.id, eid, 'status')).toBe(true)
        expect(await call(user.id, eid, 'link')).toBe(true)
        const profile = Object.create(ProfileController.prototype) as object
        expect(await call(user.id, profile, 'profile')).toBe(true)
        // Changing the profile is not needed to link the eID
        expect(await call(user.id, profile, 'update')).toBe('oidc.EID_REQUIRED')
        expect(await call(user.id, Object.create(PresenceController.prototype) as object, 'heartbeat')).toBe(true)
        expect(await call(user.id, Object.create(NotificationsController.prototype) as object, 'list')).toBe(true)
        expect(await call(user.id, Object.create(SessionsController.prototype) as object, 'list')).toBe(true)
    })

    it('lets an account with a linked eID through', async () => {
        const { store, user, call } = setup()
        await store.linkIdentifier(user.id, 'eid', 'hash')
        expect(await call(user.id, normal, 'list')).toBe(true)
    })

    it('never requires it of a superadmin', async () => {
        const { root, call } = setup()
        expect(await call(root.id, normal, 'list')).toBe(true)
    })

    it('requires nothing when it is off, or when there is no eID login', async () => {
        const envs: Record<string, string>[] = [
            { OIDC_EID_REQUIRED: 'off' },
            { OIDC_EID: 'off', OIDC_EID_REQUIRED: 'on' }
        ]
        for (const env of envs) {
            const { user, call } = setup(env)
            expect(await call(user.id, normal, 'list')).toBe(true)
        }
    })
})

describe('OidcConfig.eidRequired', () => {
    const required = (env: Record<string, string>) => new OidcConfig(new ConfigService(env)).eidRequired

    it('is on by default when the eID login is on or test, off when it is off', () => {
        expect(required({ OIDC_EID: 'on' })).toBe(true)
        expect(required({ OIDC_EID: 'test' })).toBe(true)
        expect(required({ OIDC_EID: 'off' })).toBe(false)
        expect(required({})).toBe(false)
        expect(required({ OIDC_EID: 'on', OIDC_EID_REQUIRED: 'off' })).toBe(false)
        expect(required({ OIDC_EID: 'test', OIDC_EID_REQUIRED: 'on' })).toBe(true)
        // Also for the accounts of Google or Microsoft, also when only they log in
        expect(required({ OIDC_EID: 'on', OIDC_EXTERNAL_ONLY: 'true' })).toBe(true)
    })
})
