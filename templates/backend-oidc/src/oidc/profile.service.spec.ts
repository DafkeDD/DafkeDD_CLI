import { randomBytes } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import type { I18nService } from 'nestjs-i18n'
import { AuditService } from '../audit/audit.service.js'
import { MemoryAuditStore } from '../audit/memory-audit.store.js'
import { AppException } from '../common/app.exception.js'
import type { Mail, MailService } from '../mail/mail.service.js'
import { AccountService } from './account.service.js'
import { AppLicenses } from './app-licenses.js'
import { AppRolesService } from './app-roles.service.js'
import { EidService, formatNationalNumber } from './eid.service.js'
import { LoginLimiter } from './login-limiter.js'
import { OidcConfig } from './oidc.config.js'
import { ProfileService } from './profile.service.js'
import { MemoryOidcStore } from './store/memory-oidc.store.js'

function setup() {
    const config = new OidcConfig(
        new ConfigService({
            OIDC_MASTER_KEY: randomBytes(32).toString('hex'),
            APP_URL: 'http://localhost:3000',
            OIDC_EID: 'off',
            OIDC_REGISTRATION: 'open',
            OIDC_LOGIN_RATE_LIMIT: '100'
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
    const eid = new EidService(config)
    const accounts = new AccountService(
        store,
        config,
        mail,
        new LoginLimiter(config),
        i18n,
        eid,
        audit,
        new AppRolesService(store, audit, new AppLicenses())
    )
    const profiles = new ProfileService(store, accounts, eid, audit)
    const tenant = store.addTenant('acme', 'Acme')
    const ada = store.addUser({ email: 'ada@example.com', name: 'Ada', passwordHash: 'x' })
    store.addMembership(tenant.id, ada.id, 'admin')
    const viewer = { userId: ada.id, tenantId: tenant.id, role: 'admin' as const }
    /** The token of the link in the last email. */
    const lastToken = () =>
        new URL(/http\S+/.exec(outbox.at(-1)?.text ?? '')?.[0] ?? 'http://x').searchParams.get('token')
    return { store, auditStore, outbox, accounts, profiles, eid, tenant, ada, viewer, lastToken }
}

const errorKey = async (promise: Promise<unknown>) => {
    try {
        await promise
    } catch (error) {
        if (error instanceof AppException) return error.key
        throw error
    }
    return null
}

describe('ProfileService', () => {
    it('shows the profile with the tenant, role and profession of the token', async () => {
        const { profiles, viewer, tenant, ada } = setup()
        expect(await profiles.profile(viewer)).toEqual({
            id: ada.id,
            name: 'Ada',
            firstName: null,
            lastName: null,
            email: 'ada@example.com',
            emailVerified: true,
            pendingEmail: null,
            phone: null,
            locale: null,
            superadmin: false,
            eid: { linked: false, rrn: null, address: null },
            tenant: { id: tenant.id, name: 'Acme', slug: 'acme', role: 'admin', profession: 'staff' }
        })
        // A platform login (no organisation)
        expect((await profiles.profile({ ...viewer, tenantId: '' })).tenant).toBeNull()
    })

    it('changes first name, last name, phone and language, and keeps the display name in sync', async () => {
        const { profiles, viewer, auditStore } = setup()
        const after = await profiles.update(
            viewer,
            { firstName: ' Ada ', lastName: 'Lovelace', phone: '+32 470 12 34 56', locale: 'nl' },
            'en'
        )
        expect(after).toMatchObject({
            name: 'Ada Lovelace',
            firstName: 'Ada',
            lastName: 'Lovelace',
            phone: '+32 470 12 34 56',
            locale: 'nl'
        })
        // An empty phone number removes it; only a first name keeps the display name as it was
        const cleared = await profiles.update(viewer, { phone: '', firstName: 'Augusta' }, 'en')
        expect(cleared).toMatchObject({ phone: null, name: 'Augusta Lovelace' })
        expect(auditStore.events.map(event => event.action)).toEqual([
            'account.profile_changed',
            'account.profile_changed'
        ])
        expect(auditStore.events[0]?.details).toEqual({ fields: 'firstName,lastName,phone,locale' })
    })

    it('changes the email address only after the link sent to the new address was opened', async () => {
        const { profiles, accounts, viewer, outbox, lastToken, store, auditStore } = setup()
        const pending = await profiles.update(viewer, { email: 'Ada@Example.org' }, 'en')
        expect(pending).toMatchObject({ email: 'ada@example.com', pendingEmail: 'ada@example.org' })
        expect(outbox.at(-1)?.to).toBe('ada@example.org')
        expect(outbox.at(-1)?.subject).toBe('mail.CONFIRM_SUBJECT')
        const token = lastToken() ?? ''
        // The token of a new address is no verification link of another kind (and the other way around)
        expect(await accounts.verifyEmail({ token })).toEqual({ status: 'email-changed', email: 'ada@example.org' })
        expect(await profiles.profile(viewer)).toMatchObject({
            email: 'ada@example.org',
            emailVerified: true,
            pendingEmail: null
        })
        // The link works once: the address is no longer pending
        expect(await errorKey(accounts.verifyEmail({ token }))).toBe('oidc.INVALID_LINK')
        expect(auditStore.events.map(event => event.action)).toContain('account.email_changed')
        expect(store.users.find(user => user.id === viewer.userId)?.email).toBe('ada@example.org')
    })

    it('refuses an address of another account, also when it was taken after the link was sent', async () => {
        const { profiles, accounts, viewer, store, lastToken } = setup()
        store.addUser({ email: 'bob@example.com', name: 'Bob', passwordHash: 'x' })
        expect(await errorKey(profiles.update(viewer, { email: 'BOB@example.com' }, 'en'))).toBe('oidc.EMAIL_TAKEN')
        await profiles.update(viewer, { email: 'new@example.com' }, 'en')
        const token = lastToken() ?? ''
        store.addUser({ email: 'new@example.com', name: 'Eve', passwordHash: 'x' })
        expect(await errorKey(accounts.verifyEmail({ token }))).toBe('oidc.EMAIL_TAKEN')
        // A newer change makes an older link invalid; the current address withdraws the change
        await profiles.update(viewer, { email: 'other@example.com' }, 'en')
        expect(await errorKey(accounts.verifyEmail({ token }))).toBe('oidc.INVALID_LINK')
        expect((await profiles.update(viewer, { email: 'ada@example.com' }, 'en')).pendingEmail).toBeNull()
    })

    it('stores the phone number and language given at registration', async () => {
        const { accounts, store, profiles, tenant } = setup()
        await accounts.register(
            {
                name: 'Jan Peeters',
                email: 'jan@example.com',
                password: 'correct-horse-battery',
                organisation: 'Praktijk',
                phone: ' +32 9 123 45 67 ',
                locale: 'nl'
            },
            'en',
            '127.0.0.1'
        )
        const jan = await store.findUserByEmail('jan@example.com')
        expect(jan?.locale).toBe('nl')
        const membership = (await store.listMemberships(jan?.id ?? ''))[0]
        expect(membership?.tenantId).not.toBe(tenant.id)
        expect(
            await profiles.profile({ userId: jan?.id ?? '', tenantId: membership?.tenantId ?? '', role: 'admin' })
        ).toMatchObject({ phone: '+32 9 123 45 67', locale: 'nl', tenant: { name: 'Praktijk', profession: 'staff' } })
    })

    it('shows the national register number of a linked eID only, formatted', async () => {
        const { profiles, viewer, store, eid } = setup()
        await store.setEidDetails(viewer.userId, {
            rrnEncrypted: eid.sealNationalNumber('85.07.31-003.23'),
            address: 'Kerkstraat 1, 9000 Gent'
        })
        expect((await profiles.profile(viewer)).eid).toEqual({ linked: false, rrn: null, address: null })
        await store.linkIdentifier(viewer.userId, 'eid', 'hash')
        expect((await profiles.profile(viewer)).eid).toEqual({
            linked: true,
            rrn: '85.07.31-003.23',
            address: 'Kerkstraat 1, 9000 Gent'
        })
        expect(formatNationalNumber('85073100323')).toBe('85.07.31-003.23')
        expect(eid.openNationalNumber('not encrypted')).toBeNull()
    })
})
