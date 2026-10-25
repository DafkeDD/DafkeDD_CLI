import { randomBytes, randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import type { I18nService } from 'nestjs-i18n'
import { AuditService } from '../audit/audit.service.js'
import { MemoryAuditStore } from '../audit/memory-audit.store.js'
import { AppException } from '../common/app.exception.js'
import type { Mail, MailService } from '../mail/mail.service.js'
import { AccountService } from './account.service.js'
import { AppLicenses } from './app-licenses.js'
import { AppRolesService } from './app-roles.service.js'
import { EidService } from './eid.service.js'
import { LoginLimiter } from './login-limiter.js'
import { OidcConfig } from './oidc.config.js'
import { hashPassword, verifyPassword } from './password.js'
import { MemoryOidcStore } from './store/memory-oidc.store.js'

const PASSWORD = 'correct-horse-battery'
const NEW_PASSWORD = 'a-new-long-password'

async function setup(rateLimit = '100', env: Record<string, string> = {}) {
    const config = new OidcConfig(
        new ConfigService({
            OIDC_MASTER_KEY: randomBytes(32).toString('hex'),
            APP_URL: 'http://localhost:3000',
            OIDC_EID: 'off',
            OIDC_LOGIN_RATE_LIMIT: rateLimit,
            ...env
        })
    )
    const store = new MemoryOidcStore()
    const auditStore = new MemoryAuditStore()
    const audit = new AuditService(auditStore, new ConfigService({}))
    const outbox: Mail[] = []
    const mail = {
        send: async (message: Mail) => {
            outbox.push(message)
            return true
        }
    } as unknown as MailService
    const i18n = { t: (key: string) => key } as unknown as I18nService
    const accounts = new AccountService(
        store,
        config,
        mail,
        new LoginLimiter(config),
        i18n,
        new EidService(config),
        audit,
        new AppRolesService(store, audit, new AppLicenses())
    )
    const ada = store.addUser({ email: 'ada@example.com', name: 'Ada', passwordHash: await hashPassword(PASSWORD) })
    const jan = store.addUser({ email: 'jan@example.com', name: 'Jan', passwordHash: null })
    /** A new active session of the user; returns its public id. */
    const session = async (userId: string) => {
        const id = randomUUID()
        await store.createSession({
            id,
            idHash: randomUUID(),
            interactionHash: randomUUID(),
            userId,
            tenantId: null,
            authTime: new Date(),
            acr: 'loa2',
            amr: ['pwd'],
            expiresAt: new Date(Date.now() + 3_600_000),
            userAgent: null
        })
        return id
    }
    const sessionIds = async (userId: string) => (await store.listUserSessions(userId)).map(item => item.id)
    return { store, auditStore, outbox, accounts, ada, jan, session, sessionIds }
}

const errorOf = async (promise: Promise<unknown>) => {
    try {
        await promise
    } catch (error) {
        if (error instanceof AppException) return { key: error.key, status: error.getStatus() }
        throw error
    }
    return null
}

describe('AccountService with OIDC_EID_REQUIRED', () => {
    const input = { name: 'Eve', email: 'eve@example.com', password: PASSWORD, organisation: 'Eve BV' }

    it('refuses registering with a password when the eID is required (the default with OIDC_EID=test)', async () => {
        const { accounts, store } = await setup('100', { OIDC_EID: 'test' })
        expect(accounts.registrationOptions()).toEqual({ password: false, eid: true, eidRequired: true })
        expect(await errorOf(accounts.register(input, 'nl', '127.0.0.1'))).toEqual({
            key: 'oidc.EID_REQUIRED',
            status: 403
        })
        expect(await store.findUserByEmail('eve@example.com')).toBeNull()
    })

    it('registers with a password when it is off', async () => {
        const { accounts, store } = await setup('100', { OIDC_EID: 'test', OIDC_EID_REQUIRED: 'off' })
        expect(accounts.registrationOptions()).toEqual({ password: true, eid: true, eidRequired: false })
        expect(await accounts.register(input, 'nl', '127.0.0.1')).toEqual({ status: 'check-email' })
        expect(await store.findUserByEmail('eve@example.com')).not.toBeNull()
    })

    it('says in the eID status whether it is required (never for a superadmin), and keeps a linked eID', async () => {
        const { accounts, store, ada } = await setup('100', { OIDC_EID: 'test' })
        expect(await accounts.eidStatus(ada.id)).toMatchObject({ linked: false, required: true })
        const root = store.addUser({ email: 'root@example.com', name: 'Root', passwordHash: null, isSuperadmin: true })
        expect(await accounts.eidStatus(root.id)).toMatchObject({ required: false })
        await store.linkIdentifier(ada.id, 'eid', 'hash-of-ada')
        expect(await errorOf(accounts.unlinkEid(ada.id))).toEqual({ key: 'oidc.EID_REQUIRED', status: 403 })
        expect(await store.findIdentifier(ada.id, 'eid')).not.toBeNull()
    })

    it('never requires it without an eID login (OIDC_EID=off), even when set on', async () => {
        const { accounts } = await setup('100', { OIDC_EID_REQUIRED: 'on' })
        expect(accounts.registrationOptions()).toMatchObject({ password: true, eidRequired: false })
    })
})

describe('AccountService.changePassword', () => {
    it('needs the current password when the account has one', async () => {
        const { accounts, ada, store } = await setup()
        expect(await errorOf(accounts.changePassword(ada.id, { newPassword: NEW_PASSWORD }, null))).toEqual({
            key: 'oidc.WRONG_PASSWORD',
            status: 403
        })
        expect(
            await errorOf(
                accounts.changePassword(
                    ada.id,
                    { currentPassword: 'not-the-password', newPassword: NEW_PASSWORD },
                    null
                )
            )
        ).toEqual({ key: 'oidc.WRONG_PASSWORD', status: 403 })
        // Nothing changed
        expect(await verifyPassword(PASSWORD, (await store.findUserById(ada.id))?.passwordHash ?? '')).toBe(true)
    })

    it('refuses the same password as now', async () => {
        const { accounts, ada } = await setup()
        expect(
            await errorOf(accounts.changePassword(ada.id, { currentPassword: PASSWORD, newPassword: PASSWORD }, null))
        ).toEqual({ key: 'oidc.SAME_PASSWORD', status: 400 })
    })

    it('rate limits the attempts per account', async () => {
        const { accounts, ada } = await setup('2')
        const wrong = () =>
            errorOf(
                accounts.changePassword(
                    ada.id,
                    { currentPassword: 'guess-guess-guess', newPassword: NEW_PASSWORD },
                    null
                )
            )
        expect((await wrong())?.key).toBe('oidc.WRONG_PASSWORD')
        expect((await wrong())?.key).toBe('oidc.WRONG_PASSWORD')
        expect(await wrong()).toEqual({ key: 'oidc.TOO_MANY_ATTEMPTS', status: 429 })
    })

    it('stores the new password, ends the other sessions, keeps this one, records it and sends no email', async () => {
        const { accounts, ada, jan, store, auditStore, outbox, session, sessionIds } = await setup()
        const current = await session(ada.id)
        await session(ada.id)
        await session(ada.id)
        const other = await session(jan.id)

        const result = await accounts.changePassword(
            ada.id,
            { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
            current
        )
        expect(result).toEqual({ status: 'password-changed', endedSessions: 2 })
        const hash = (await store.findUserById(ada.id))?.passwordHash ?? ''
        expect(await verifyPassword(NEW_PASSWORD, hash)).toBe(true)
        expect(await verifyPassword(PASSWORD, hash)).toBe(false)
        expect(await sessionIds(ada.id)).toEqual([current])
        // Sessions of other accounts stay
        expect(await sessionIds(jan.id)).toEqual([other])
        expect(auditStore.events.map(event => event.action)).toEqual(['account.password_changed'])
        expect(auditStore.events[0]).toMatchObject({
            tenantId: null,
            actorId: ada.id,
            targetType: 'user',
            targetId: ada.id,
            details: { first: false, endedSessions: 2 }
        })
        expect(outbox).toEqual([])
    })

    it('sets the first password of an account without one (eID only), without a current password', async () => {
        const { accounts, jan, store, auditStore, session, sessionIds } = await setup()
        const current = await session(jan.id)
        await session(jan.id)
        expect((await accounts.eidStatus(jan.id)).hasPassword).toBe(false)

        expect(await accounts.changePassword(jan.id, { newPassword: NEW_PASSWORD }, current)).toEqual({
            status: 'password-changed',
            endedSessions: 1
        })
        expect(await verifyPassword(NEW_PASSWORD, (await store.findUserById(jan.id))?.passwordHash ?? '')).toBe(true)
        expect(await sessionIds(jan.id)).toEqual([current])
        expect((await accounts.eidStatus(jan.id)).hasPassword).toBe(true)
        expect(auditStore.events[0]).toMatchObject({ action: 'account.password_changed', details: { first: true } })
        // From now on the current password is needed
        expect(
            (await errorOf(accounts.changePassword(jan.id, { newPassword: 'yet-another-password' }, current)))?.key
        ).toBe('oidc.WRONG_PASSWORD')
    })

    it('ends every session without a current session (no sid)', async () => {
        const { accounts, ada, session, sessionIds } = await setup()
        await session(ada.id)
        const result = await accounts.changePassword(
            ada.id,
            { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
            null
        )
        expect(result.endedSessions).toBe(1)
        expect(await sessionIds(ada.id)).toEqual([])
    })
})
