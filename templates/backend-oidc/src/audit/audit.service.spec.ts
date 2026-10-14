import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AUDIT_ACTIONS, AUDIT_CATEGORIES } from './audit.actions.js'
import { requestContext, setActor } from './audit.context.js'
import { AuditService } from './audit.service.js'
import type { AuditStore } from './audit.store.js'
import { MemoryAuditStore } from './memory-audit.store.js'

const service = (store: AuditStore = new MemoryAuditStore(), env: Record<string, string> = {}) =>
    new AuditService(store, new ConfigService(env))

const inRequest = <T>(work: () => Promise<T>) =>
    requestContext.run({ ip: '203.0.113.7', userAgent: 'Browser/1', actorId: null, tenantId: null }, work)

describe('AuditService', () => {
    it('every action has a known category and the form category.name', () => {
        for (const category of AUDIT_CATEGORIES)
            for (const action of AUDIT_ACTIONS[category]) expect(action).toMatch(new RegExp(`^${category}\\.[a-z_]+$`))
    })

    it('takes the IP address, the browser and the logged in account from the request', async () => {
        const store = new MemoryAuditStore()
        const audit = service(store)
        await inRequest(async () => {
            setActor('6f1d4c2e-1111-4111-8111-111111111111', '7a2e5d3f-2222-4222-8222-222222222222')
            await audit.record('members.removed', { target: { type: 'user', id: 'u1' } })
        })
        expect(store.events[0]).toMatchObject({
            action: 'members.removed',
            actorId: '6f1d4c2e-1111-4111-8111-111111111111',
            tenantId: '7a2e5d3f-2222-4222-8222-222222222222',
            targetType: 'user',
            targetId: 'u1',
            ip: '203.0.113.7',
            userAgent: 'Browser/1'
        })
        // Outside a request (a timer, a webhook without login): no IP, no account
        await audit.record('licences.subscription_renewed', { tenantId: 't' })
        expect(store.events[1]).toMatchObject({ actorId: null, ip: null, userAgent: null, tenantId: 't' })
    })

    it('given values win over the request, and the details stay short and plain', async () => {
        const store = new MemoryAuditStore()
        await inRequest(async () => {
            setActor('a', 't')
            await service(store).record('login.failed', {
                tenantId: null,
                actorId: null,
                details: { email: 'x'.repeat(500), seats: 3, active: false, gone: undefined }
            })
        })
        const event = store.events[0]
        expect(event).toMatchObject({ tenantId: null, actorId: null })
        expect(event?.details).toEqual({ email: 'x'.repeat(200), seats: 3, active: false })
    })

    it('never fails the request when the log cannot be written', async () => {
        const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
        const broken: AuditStore = {
            add: () => Promise.reject(new Error('database down')),
            list: async () => [],
            purge: async () => 0
        }
        await expect(service(broken).record('login.logout')).resolves.toBeUndefined()
        expect(error).toHaveBeenCalledWith(expect.stringContaining('Could not record login.logout: database down'))
        error.mockRestore()
    })

    it('pages: one more is asked to know whether there is a next page', async () => {
        const store = new MemoryAuditStore()
        const audit = service(store)
        for (let i = 0; i < 3; i++) await audit.record('members.invited', { tenantId: 't' })
        const first = await audit.list({ tenantId: 't', limit: 2 })
        expect(first.events.map(event => event.id)).toEqual(['3', '2'])
        expect(first.next).toBe('2')
        const last = await audit.list({ tenantId: 't', limit: 2, before: first.next ?? '' })
        expect(last).toMatchObject({ events: [{ id: '1' }], next: null })
    })

    it('removes events after AUDIT_RETENTION_DAYS (365); 0 keeps everything', async () => {
        const store = new MemoryAuditStore()
        await service(store).record('login.logout')
        await service(store).record('login.logout')
        store.events[0]!.createdAt = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
        expect(await service(store, { AUDIT_RETENTION_DAYS: '0' }).purge()).toBe(0)
        expect(service(store, { AUDIT_RETENTION_DAYS: 'abc' }).retentionDays).toBe(365)
        const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
        expect(await service(store).purge()).toBe(1)
        expect(store.events).toHaveLength(1)
        log.mockRestore()
    })
})

describe('TRUST_PROXY', () => {
    it('believes X-Forwarded-For from this computer by default; false, a number or addresses otherwise', async () => {
        const { trustProxy } = await import('./audit.module.js')
        expect(trustProxy(undefined)).toBe('loopback')
        expect(trustProxy(' ')).toBe('loopback')
        expect(trustProxy('false')).toBe(false)
        expect(trustProxy('true')).toBe(true)
        expect(trustProxy('2')).toBe(2)
        expect(trustProxy('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8')
    })
})
