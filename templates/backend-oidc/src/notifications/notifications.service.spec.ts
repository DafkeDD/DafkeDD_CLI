import { ConfigService } from '@nestjs/config'
import { AuditService } from '../audit/audit.service.js'
import { MemoryAuditStore } from '../audit/memory-audit.store.js'
import { MemoryOidcStore } from '../oidc/store/memory-oidc.store.js'
import { MemoryNotificationsStore } from './memory-notifications.store.js'
import { NOTIFICATIONS_LIMIT, NotificationsService, type Viewer } from './notifications.service.js'

function setup() {
    const oidc = new MemoryOidcStore()
    const store = new MemoryNotificationsStore()
    const audit = new AuditService(new MemoryAuditStore(), new ConfigService({}))
    const service = new NotificationsService(store, oidc, audit)
    service.onModuleInit()
    const acme = oidc.addTenant('acme', 'Acme')
    const admin = oidc.addUser({ email: 'admin@example.com', name: 'Ada', passwordHash: null })
    const member = oidc.addUser({ email: 'member@example.com', name: 'Bob', passwordHash: null })
    const root = oidc.addUser({ email: 'root@example.com', name: 'Root', passwordHash: null, isSuperadmin: true })
    oidc.addMembership(acme.id, admin.id, 'admin')
    oidc.addMembership(acme.id, member.id, 'user')
    const viewer = (userId: string, change: Partial<Viewer> = {}): Viewer => ({
        userId,
        tenantId: acme.id,
        role: 'user',
        superadmin: false,
        ...change
    })
    return { oidc, store, audit, service, acme, admin, member, root, viewer }
}

describe('NotificationsService', () => {
    it('sends to the admins of an organisation, to one account and to every superadmin', async () => {
        const { service, store, acme, admin, member, root, viewer } = setup()
        await service.toTenantAdmins(acme.id, 'invoice.created', { number: 'FAC-2026-0001' }, { screen: 'invoices' })
        await service.toUser(member.id, acme.id, 'ticket.reply', { number: 'TIC-1001' }, { screen: 'ticket', id: 't' })
        await service.toPlatform('tenant.created', { name: 'Globex' }, { screen: 'admin-tenant', id: 'x' })
        expect(store.notifications.map(item => [item.userId, item.kind])).toEqual([
            [admin.id, 'invoice.created'],
            [member.id, 'ticket.reply'],
            [root.id, 'tenant.created']
        ])
        expect(await service.list(viewer(member.id))).toMatchObject([
            { kind: 'ticket.reply', params: { number: 'TIC-1001' }, nav: { screen: 'ticket', id: 't' }, read: false }
        ])
        // A superadmin in a platform login sees the platform ones; in an organisation also those of the organisation
        expect(
            (await service.list(viewer(root.id, { tenantId: '', superadmin: true }))).map(item => item.kind)
        ).toEqual(['tenant.created'])
    })

    it('marks one or all as read, only of the own account', async () => {
        const { service, acme, admin, member, viewer } = setup()
        await service.toUser(member.id, acme.id, 'ticket.reply', {}, { screen: 'ticket', id: 'a' })
        await service.toUser(member.id, acme.id, 'ticket.reply', {}, { screen: 'ticket', id: 'b' })
        const [first] = await service.list(viewer(member.id))
        await expect(service.markRead(viewer(admin.id), first!.id)).rejects.toThrow('errors.NOT_FOUND')
        await expect(service.markRead(viewer(member.id), 'not-an-id')).rejects.toThrow('errors.NOT_FOUND')
        await service.markRead(viewer(member.id), first!.id)
        expect((await service.list(viewer(member.id))).map(item => item.read)).toEqual([true, false])
        await service.markAllRead(viewer(member.id))
        expect((await service.list(viewer(member.id))).every(item => item.read)).toBe(true)
    })

    it('mixes in computed notifications with a stable id, whose read state is stored', async () => {
        const { service, member, viewer } = setup()
        const id = 'contract:6f1d4c2e-1111-4111-8111-111111111111:2026-11-01'
        service.addSource(async who =>
            who.role === 'admin'
                ? [
                      {
                          id,
                          kind: 'contract.expiring',
                          params: { app: 'Planner', daysLeft: 12 },
                          nav: { screen: 'dashboard' },
                          createdAt: new Date(Date.now() - 1000)
                      }
                  ]
                : []
        )
        service.addSource(async () => {
            throw new Error('broken source')
        })
        const admin = viewer(member.id, { role: 'admin' })
        expect(await service.list(admin)).toMatchObject([{ id, read: false }])
        // Not seen by a member: cannot be marked either
        await expect(service.markRead(viewer(member.id), id)).rejects.toThrow('errors.NOT_FOUND')
        await service.markRead(admin, id)
        expect(await service.list(admin)).toMatchObject([{ id, read: true }])
    })

    it('shows the newest 40', async () => {
        const { service, acme, member, viewer } = setup()
        for (let i = 0; i < NOTIFICATIONS_LIMIT + 5; i++)
            await service.toUser(member.id, acme.id, 'ticket.reply', { i }, { screen: 'ticket', id: String(i) })
        const list = await service.list(viewer(member.id))
        expect(list).toHaveLength(NOTIFICATIONS_LIMIT)
        expect(list[0]?.params.i).toBe(NOTIFICATIONS_LIMIT + 4)
    })

    it('follows new organisations and invitations in the audit log; never fails when storing fails', async () => {
        const { service, store, audit, acme, root, viewer } = setup()
        await audit.record('platform.tenant_created', { tenantId: acme.id, details: { name: 'Acme' } })
        await audit.record('account.registered', { tenantId: acme.id, details: { organisation: 'Acme' } })
        await audit.record('members.invited', {
            tenantId: acme.id,
            details: { email: 'new@example.com', role: 'user' }
        })
        await audit.record('members.removed', { tenantId: acme.id })
        expect(await service.list(viewer(root.id, { tenantId: '', superadmin: true }))).toMatchObject([
            {
                kind: 'member.invited',
                params: { tenant: 'Acme', email: 'new@example.com' },
                nav: { screen: 'admin-tenant', id: acme.id }
            },
            { kind: 'tenant.created', params: { tenantId: acme.id, name: 'Acme' } },
            { kind: 'tenant.created', params: { name: 'Acme' } }
        ])
        vi.spyOn(store, 'add').mockRejectedValueOnce(new Error('database down'))
        const error = vi.spyOn((service as unknown as { logger: { error: () => void } }).logger, 'error')
        error.mockImplementation(() => undefined)
        await expect(service.toPlatform('tenant.created', {}, { screen: 'admin-tenants' })).resolves.toBeUndefined()
        expect(error).toHaveBeenCalled()
    })

    it('tells the other admins of an organisation who joined it, not the one who joined', async () => {
        const { service, oidc, audit, acme, admin, member, viewer } = setup()
        const second = oidc.addUser({ email: 'second@example.com', name: 'Cleo', passwordHash: null })
        oidc.addMembership(acme.id, second.id, 'admin')
        await audit.record('members.joined', { tenantId: acme.id, actorId: second.id, details: { role: 'admin' } })
        expect(await service.list(viewer(admin.id, { role: 'admin' }))).toMatchObject([
            { kind: 'member.joined', params: { name: 'Cleo', email: 'second@example.com' }, nav: { screen: 'users' } }
        ])
        expect(await service.list(viewer(second.id, { role: 'admin' }))).toEqual([])
        expect(await service.list(viewer(member.id))).toEqual([])
    })
})
