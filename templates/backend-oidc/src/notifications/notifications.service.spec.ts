import { ConfigService } from '@nestjs/config'
import { AuditService } from '../audit/audit.service.js'
import { MemoryAuditStore } from '../audit/memory-audit.store.js'
import { MemoryOidcStore } from '../oidc/store/memory-oidc.store.js'
import { MemoryNotificationsStore } from './memory-notifications.store.js'
import { NOTIFICATIONS_LIMIT, NotificationsService } from './notifications.service.js'
import { NOTIFICATION_KINDS } from './notifications.store.js'

async function setup() {
    const oidc = new MemoryOidcStore()
    const store = new MemoryNotificationsStore()
    const audit = new AuditService(new MemoryAuditStore(), new ConfigService({}))
    const notifications = new NotificationsService(store, oidc, audit)
    notifications.onModuleInit()
    const account = async (email: string) =>
        (await oidc.createUser({
            email,
            name: email.split('@')[0],
            passwordHash: null,
            emailVerified: true,
            locale: null
        }))!
    const tenant = await oidc.createTenant('Acme', 'acme')
    const admin = await account('admin@example.com')
    const other = await account('other@example.com')
    const user = await account('user@example.com')
    const root = await account('root@example.com')
    await oidc.addMember(tenant.id, admin.id, 'admin')
    await oidc.addMember(tenant.id, other.id, 'admin')
    await oidc.addMember(tenant.id, user.id, 'user')
    await oidc.setSuperadmin(root.id, true)
    const viewer = (userId: string, superadmin = false, tenantId = tenant.id) => ({ userId, tenantId, superadmin })
    return { audit, notifications, store, tenant, admin, other, user, root, viewer }
}

describe('NotificationsService', () => {
    it('every kind has the form category.name', () => {
        for (const kind of NOTIFICATION_KINDS) expect(kind).toMatch(/^[a-z]+\.[a-z_]+$/)
    })

    it('tells the other admins about an invitation, not the one who invited nor the users', async () => {
        const { audit, notifications, tenant, admin, other, user, viewer } = await setup()
        await audit.record('members.invited', {
            tenantId: tenant.id,
            actorId: admin.id,
            details: { email: 'new@example.com', role: 'user' }
        })
        expect(await notifications.list(viewer(other.id))).toMatchObject([
            { kind: 'member.invited', params: { email: 'new@example.com' }, link: '/members', read: false }
        ])
        expect(await notifications.list(viewer(admin.id))).toEqual([])
        expect(await notifications.list(viewer(user.id))).toEqual([])
    })

    it('tells the superadmins about a new organisation, in the platform scope only', async () => {
        const { audit, notifications, tenant, root, viewer } = await setup()
        await audit.record('platform.tenant_created', { tenantId: tenant.id, details: { name: 'Acme' } })
        expect(await notifications.list(viewer(root.id, true, ''))).toMatchObject([
            { kind: 'tenant.created', params: { name: 'Acme' }, link: '/admin' }
        ])
        // Logged in to an organisation without being superadmin: no platform notifications
        expect(await notifications.list(viewer(root.id, false))).toEqual([])
    })

    it('names the new member for the admins', async () => {
        const { audit, notifications, tenant, user, admin, viewer } = await setup()
        await audit.record('members.joined', { tenantId: tenant.id, actorId: user.id, details: { role: 'user' } })
        expect(await notifications.list(viewer(admin.id))).toMatchObject([
            { kind: 'member.joined', params: { name: 'user', email: 'user@example.com' } }
        ])
    })

    it('marks one or all as read, only for the own account', async () => {
        const { notifications, tenant, admin, other, viewer } = await setup()
        await notifications.toTenantAdmins(tenant.id, 'member.invited', { email: 'a@example.com' }, '/members')
        await notifications.toTenantAdmins(tenant.id, 'member.invited', { email: 'b@example.com' }, '/members')
        const [first] = await notifications.list(viewer(admin.id))
        await expect(notifications.markRead(viewer(other.id), first.id)).rejects.toThrow()
        await expect(notifications.markRead(viewer(admin.id), 'not-a-uuid')).rejects.toThrow()
        await notifications.markRead(viewer(admin.id), first.id)
        expect((await notifications.list(viewer(admin.id))).map(item => item.read)).toEqual([true, false])
        await notifications.markAllRead(viewer(admin.id))
        expect((await notifications.list(viewer(admin.id))).every(item => item.read)).toBe(true)
        expect((await notifications.list(viewer(other.id))).some(item => item.read)).toBe(false)
    })

    it('keeps links inside the frontend and texts short, and shows at most the limit', async () => {
        const { notifications, tenant, admin, viewer } = await setup()
        await notifications.toUser(admin.id, tenant.id, 'member.joined', { name: 'x'.repeat(500) }, '//evil.example')
        const [item] = await notifications.list(viewer(admin.id))
        expect(item.link).toBeNull()
        expect(String(item.params.name)).toHaveLength(200)
        for (let index = 0; index < NOTIFICATIONS_LIMIT + 5; index++)
            await notifications.toUser(admin.id, tenant.id, 'member.joined', { name: String(index) }, '/members')
        expect(await notifications.list(viewer(admin.id))).toHaveLength(NOTIFICATIONS_LIMIT)
    })

    it('removes old notifications', async () => {
        const { notifications, store, tenant, admin, viewer } = await setup()
        await notifications.toUser(admin.id, tenant.id, 'member.joined', {}, null)
        store.notifications[0].createdAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000)
        expect(await store.purge(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))).toBe(1)
        expect(await notifications.list(viewer(admin.id))).toEqual([])
    })
})
