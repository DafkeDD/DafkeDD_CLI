import { ConfigService } from '@nestjs/config'
import { AuditService } from '../audit/audit.service.js'
import { MemoryAuditStore } from '../audit/memory-audit.store.js'
import type { BillingService } from '../billing/billing.service.js'
import { MemoryNotificationsStore } from '../notifications/memory-notifications.store.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import { MemoryOidcStore } from '../oidc/store/memory-oidc.store.js'
import { presence } from '../access/presence.js'
import { MemoryTicketsStore } from './memory-tickets.store.js'
import { attachmentRefs, plainText, preview } from './rich-text.js'
import { IMAGE_MAX_BYTES, imageType, safeFilename, TicketsService } from './tickets.service.js'

/** The first bytes of each kind of image, followed by some content. */
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32, 1)])
const JPEG = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(32, 2)])
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(32, 3)])
const WEBP = Buffer.concat([Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1'), Buffer.alloc(32, 4)])
const upload = (data: Buffer, filename = 'shot.png') => ({ filename, dataBase64: data.toString('base64') })

function setup() {
    const oidc = new MemoryOidcStore()
    const products = [{ code: 'planner', name: 'Planner' }]
    const tickets = new MemoryTicketsStore({
        findUserById: id => oidc.findUserById(id),
        findTenant: id => oidc.findTenant(id),
        findProductByCode: async code => products.find(product => product.code === code) ?? null
    })
    const auditStore = new MemoryAuditStore()
    const audit = new AuditService(auditStore, new ConfigService({}))
    const notificationsStore = new MemoryNotificationsStore()
    const notifications = new NotificationsService(notificationsStore, oidc, audit)
    const billing = { products: async () => products } as unknown as BillingService
    const service = new TicketsService(tickets, oidc, billing, notifications, audit)

    const acme = oidc.addTenant('acme', 'Acme')
    const globex = oidc.addTenant('globex', 'Globex')
    const alice = oidc.addUser({ email: 'alice@example.com', name: 'Alice', passwordHash: null })
    const bob = oidc.addUser({ email: 'bob@example.com', name: 'Bob', passwordHash: null, locale: 'nl' })
    const root = oidc.addUser({ email: 'root@example.com', name: 'Root', passwordHash: null, isSuperadmin: true })
    const ops = oidc.addUser({ email: 'ops@example.com', name: 'Ops', passwordHash: null, isSuperadmin: true })
    oidc.addMembership(acme.id, alice.id, 'admin')
    oidc.addMembership(acme.id, bob.id, 'user')
    // Root is online (made a request just now), Ops is not
    presence.clear()
    presence.touch(root.id)
    return { service, tickets, auditStore, notificationsStore, acme, globex, alice, bob, root, ops }
}

describe('TicketsService', () => {
    it('a member asks; the online support team hears about it (no email); others never see it', async () => {
        const { service, notificationsStore, acme, globex, bob, root } = setup()
        const ticket = await service.create(
            { tenantId: acme.id, userId: bob.id },
            { subject: ' Agenda is empty ', appCode: 'planner', text: 'My appointments are gone.' }
        )
        expect(ticket).toMatchObject({
            number: 'TIC-1001',
            subject: 'Agenda is empty',
            tenant: { id: acme.id, name: 'Acme' },
            customer: { id: bob.id, name: 'Bob' },
            app: 'Planner',
            appCode: 'planner',
            status: 'open',
            priority: 'normal',
            assignee: null,
            messages: [{ from: { id: bob.id, name: 'Bob' }, role: 'customer', text: 'My appointments are gone.' }]
        })
        expect(ticket).not.toHaveProperty('notes')
        // Only the superadmin that is online
        expect(notificationsStore.notifications.filter(item => item.kind === 'ticket.created')).toHaveLength(1)
        expect(notificationsStore.notifications[0]).toMatchObject({
            userId: root.id,
            tenantId: null,
            params: { number: 'TIC-1001', tenant: 'Acme', subject: 'Agenda is empty' },
            nav: { screen: 'admin-ticket', id: ticket.id }
        })

        await expect(service.getForTenant(globex.id, ticket.id)).rejects.toThrow('support.TICKET_NOT_FOUND')
        expect(await service.listForTenant(globex.id)).toEqual([])
        expect(await service.listForTenant(acme.id)).toMatchObject([
            { number: 'TIC-1001', lastMessage: { role: 'customer', text: 'My appointments are gone.' } }
        ])
        await expect(
            service.create({ tenantId: acme.id, userId: bob.id }, { subject: 'Nope', appCode: 'nothing', text: 'x' })
        ).rejects.toThrow('support.APP_NOT_FOUND')
    })

    it('support claims, answers (the customer gets a notification, no email), closes and reopens', async () => {
        const { service, notificationsStore, acme, bob, root } = setup()
        const { id } = await service.create(
            { tenantId: acme.id, userId: bob.id },
            { subject: 'Invoice question', text: 'Where is my invoice?' }
        )
        expect(await service.claim(root.id, id)).toMatchObject({
            status: 'in_progress',
            assignee: { id: root.id, name: 'Root' },
            notes: []
        })
        const answered = await service.replyAsSupport(root.id, id, 'On the invoices page.')
        expect(answered).toMatchObject({ status: 'answered', app: null })
        expect(answered.messages.map(message => message.role)).toEqual(['customer', 'support'])
        expect(notificationsStore.notifications.at(-1)).toMatchObject({
            userId: bob.id,
            tenantId: acme.id,
            kind: 'ticket.reply',
            params: { number: 'TIC-1001', from: 'Root', text: 'On the invoices page.' },
            nav: { screen: 'ticket', id }
        })

        // The customer writes again: open again, and the superadmin handling it hears about it
        expect(await service.replyAsCustomer({ tenantId: acme.id, userId: bob.id }, id, 'Thanks')).toMatchObject({
            status: 'open'
        })
        expect(notificationsStore.notifications.at(-1)).toMatchObject({
            userId: root.id,
            tenantId: null,
            kind: 'ticket.customer_reply',
            params: { number: 'TIC-1001', tenant: 'Acme', from: 'Bob', text: 'Thanks' },
            nav: { screen: 'admin-ticket', id }
        })
        expect(await service.closeForTenant(acme.id, id)).toMatchObject({ status: 'closed' })
        await expect(service.replyAsSupport(root.id, id, 'More')).rejects.toThrow('support.TICKET_CLOSED')
        await expect(service.replyAsCustomer({ tenantId: acme.id, userId: bob.id }, id, 'More')).rejects.toThrow(
            'support.TICKET_CLOSED'
        )
        expect(await service.reopen(id)).toMatchObject({ status: 'in_progress' })
        expect(await service.close(id)).toMatchObject({ status: 'closed' })
        expect(await service.reopenForTenant(acme.id, id)).toMatchObject({ status: 'open' })
    })

    it('filters the list of the support team on status, assignee and a search', async () => {
        const { service, acme, bob, root } = setup()
        const one = await service.create({ tenantId: acme.id, userId: bob.id }, { subject: 'Login fails', text: 'x' })
        const two = await service.create({ tenantId: acme.id, userId: bob.id }, { subject: 'Printing', text: 'y' })
        await service.claim(root.id, one.id)
        expect((await service.list({ assignee: 'me' }, root.id)).map(item => item.id)).toEqual([one.id])
        expect((await service.list({ assignee: 'none' }, root.id)).map(item => item.id)).toEqual([two.id])
        expect((await service.list({ status: 'in_progress' }, root.id)).map(item => item.id)).toEqual([one.id])
        expect((await service.list({ q: 'print' }, root.id)).map(item => item.id)).toEqual([two.id])
        expect((await service.list({ q: 'TIC-1001' }, root.id)).map(item => item.id)).toEqual([one.id])
        expect(await service.list({ q: 'acme' }, root.id)).toHaveLength(2)
    })

    it('a ticket made by support goes to the admins of the organisation; notes mention superadmins only', async () => {
        const { service, notificationsStore, acme, alice, bob, root, ops } = setup()
        const ticket = await service.createAsSupport(root.id, {
            tenantId: acme.id,
            subject: 'Planned maintenance',
            priority: 'high',
            text: 'We will update your planner tonight.'
        })
        expect(ticket).toMatchObject({
            status: 'in_progress',
            priority: 'high',
            customer: { id: root.id },
            assignee: { id: root.id },
            messages: [{ role: 'support' }],
            notes: []
        })
        expect(notificationsStore.notifications.map(item => [item.userId, item.kind])).toEqual([
            [alice.id, 'ticket.reply']
        ])
        await expect(
            service.createAsSupport(root.id, { tenantId: root.id, subject: 'x', priority: 'normal', text: 'x' })
        ).rejects.toThrow('oidc.TENANT_NOT_FOUND')

        await expect(service.addNote(root.id, ticket.id, { text: 'Ask Bob', mentions: [bob.id] })).rejects.toThrow(
            'support.MENTION_NOT_SUPPORT'
        )
        const noted = await service.addNote(root.id, ticket.id, { text: 'Ops, can you do it?', mentions: [ops.id] })
        expect(noted.notes).toMatchObject([
            { from: { id: root.id }, text: 'Ops, can you do it?', mentions: [{ id: ops.id, name: 'Ops' }] }
        ])
        expect(await service.getForTenant(acme.id, ticket.id)).not.toHaveProperty('notes')
        expect((await service.supportTeam()).map(user => user.email).sort()).toEqual([
            'ops@example.com',
            'root@example.com'
        ])
    })

    it('the customer rates a closed ticket only; rating again overwrites it, reopening keeps it', async () => {
        const { service, auditStore, acme, globex, bob, root } = setup()
        const { id } = await service.create({ tenantId: acme.id, userId: bob.id }, { subject: 'Help', text: 'x' })
        expect(await service.getForTenant(acme.id, id)).toMatchObject({ rating: null })
        await expect(service.rateForTenant(acme.id, id, { score: 5 })).rejects.toThrow('support.TICKET_NOT_CLOSED')
        await service.closeForTenant(acme.id, id)
        await expect(service.rateForTenant(globex.id, id, { score: 5 })).rejects.toThrow('support.TICKET_NOT_FOUND')

        const rated = await service.rateForTenant(acme.id, id, { score: 4, comment: '  Quick help  ' })
        expect(rated).toMatchObject({ status: 'closed', rating: { score: 4, comment: 'Quick help' } })
        expect(rated.rating?.ratedAt).toBeInstanceOf(Date)
        const again = await service.rateForTenant(acme.id, id, { score: 2, comment: '   ' })
        expect(again.rating).toMatchObject({ score: 2, comment: null })
        expect(again.rating?.ratedAt.getTime()).toBeGreaterThan(rated.rating?.ratedAt.getTime() ?? 0)
        expect(auditStore.events.filter(event => event.action === 'support.ticket_rated')).toMatchObject([
            { tenantId: acme.id, targetId: id, details: { number: 'TIC-1001', score: 4 } },
            { tenantId: acme.id, targetId: id, details: { number: 'TIC-1001', score: 2 } }
        ])

        // In the lists of the organisation and of the support team; reopening (either side) keeps it
        expect(await service.listForTenant(acme.id)).toMatchObject([{ id, rating: { score: 2, comment: null } }])
        expect(await service.reopenForTenant(acme.id, id)).toMatchObject({ status: 'open', rating: { score: 2 } })
        await service.close(id)
        expect(await service.reopen(id)).toMatchObject({ status: 'in_progress', rating: { score: 2 } })
        expect(await service.list({}, root.id)).toMatchObject([{ id, rating: { score: 2 } }])
        await expect(service.rateForTenant(acme.id, id, { score: 3 })).rejects.toThrow('support.TICKET_NOT_CLOSED')
    })

    it('the superadmin handling a ticket hears it was closed; others no longer see its notifications', async () => {
        const { service, notificationsStore, acme, bob, root, ops } = setup()
        presence.touch(ops.id)
        const { id } = await service.create({ tenantId: acme.id, userId: bob.id }, { subject: 'Help', text: 'x' })
        const viewer = (user: { id: string }) => ({
            userId: user.id,
            tenantId: '',
            role: 'user' as const,
            superadmin: true
        })
        const notifications = service['notifications']
        service.onModuleInit()
        // Nobody has it yet: both online superadmins see the new ticket
        expect((await notifications.list(viewer(ops))).map(item => item.kind)).toEqual(['ticket.created'])
        await service.claim(root.id, id)
        // Root took it: gone from the bell of Ops, still in the bell of Root
        expect(await notifications.list(viewer(ops))).toEqual([])
        expect((await notifications.list(viewer(root))).map(item => item.kind)).toEqual(['ticket.created'])

        await service.closeForTenant(acme.id, id, bob.id)
        expect(notificationsStore.notifications.at(-1)).toMatchObject({
            userId: root.id,
            tenantId: null,
            kind: 'ticket.closed',
            params: { number: 'TIC-1001', tenant: 'Acme', subject: 'Help', from: 'Bob' },
            nav: { screen: 'admin-ticket', id }
        })
        // Closing it yourself: no notification
        await service.reopen(id)
        const before = notificationsStore.notifications.length
        await service.close(id, root.id)
        expect(notificationsStore.notifications).toHaveLength(before)
    })

    it('detects the type of an image from its first bytes, never from the upload', () => {
        expect(imageType(PNG)).toBe('image/png')
        expect(imageType(JPEG)).toBe('image/jpeg')
        expect(imageType(GIF)).toBe('image/gif')
        expect(imageType(WEBP)).toBe('image/webp')
        expect(imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
        expect(imageType(Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1'))).toBeNull()
        expect(imageType(Buffer.alloc(0))).toBeNull()
        expect(safeFilename('  C:\\Users\\bob\\Desktop\\scherm "1".png ')).toBe('scherm 1.png')
        expect(safeFilename('../../etc/passwd')).toBe('passwd')
        expect(safeFilename('.hidden\u0000\u202e.png')).toBe('hidden.png')
        expect(safeFilename('   ')).toBe('image')
        expect(safeFilename('x'.repeat(300) + '.png')).toHaveLength(200)
    })

    it('stores images of the own organisation only: checked, at most 2 MiB, never seen by another', async () => {
        const { service, tickets, acme, globex, bob, root } = setup()
        const actor = { tenantId: acme.id, userId: bob.id }
        const stored = await service.uploadForTenant(actor, {
            filename: ' photos/My shot.png ',
            dataBase64: 'data:image/jpeg;base64,' + PNG.toString('base64').replace(/(.{8})/g, '$1\n')
        })
        // The claimed type (jpeg) is ignored; the path goes
        expect(stored).toEqual({ id: expect.any(String), filename: 'My shot.png', contentType: 'image/png', size: 40 })
        expect(tickets.attachmentRows[0]).toMatchObject({ tenantId: acme.id, uploadedBy: bob.id })
        const image = await service.attachmentForTenant(acme.id, stored.id)
        expect(image).toMatchObject({ filename: 'My shot.png', contentType: 'image/png' })
        expect(image.data.equals(PNG)).toBe(true)
        expect((await service.attachment(stored.id)).contentType).toBe('image/png')
        await expect(service.attachmentForTenant(globex.id, stored.id)).rejects.toThrow('support.ATTACHMENT_NOT_FOUND')
        await expect(service.attachment(globex.id)).rejects.toThrow('support.ATTACHMENT_NOT_FOUND')

        for (const bad of [Buffer.from('GIF7 not really'), Buffer.from('<svg/>')])
            await expect(service.uploadForTenant(actor, upload(bad))).rejects.toThrow('support.IMAGE_INVALID')
        await expect(service.uploadForTenant(actor, { filename: 'x.png', dataBase64: 'no base64!' })).rejects.toThrow(
            'support.IMAGE_INVALID'
        )
        await expect(service.uploadForTenant(actor, { filename: 'x.png', dataBase64: '' })).rejects.toThrow(
            'support.IMAGE_INVALID'
        )
        const exact = Buffer.concat([PNG, Buffer.alloc(IMAGE_MAX_BYTES - PNG.length)])
        expect((await service.uploadForTenant(actor, upload(exact))).size).toBe(IMAGE_MAX_BYTES)
        await expect(
            service.uploadForTenant(actor, upload(Buffer.concat([exact, Buffer.alloc(1)])))
        ).rejects.toMatchObject({ key: 'support.IMAGE_TOO_LARGE', status: 413 })

        // Support uploads for an existing organisation
        const gif = await service.uploadAsSupport(root.id, globex.id, upload(GIF, 'anim.gif'))
        expect(gif).toMatchObject({ contentType: 'image/gif', filename: 'anim.gif' })
        expect((await service.attachmentForTenant(globex.id, gif.id)).contentType).toBe('image/gif')
        await expect(service.uploadAsSupport(root.id, root.id, upload(GIF))).rejects.toThrow('oidc.TENANT_NOT_FOUND')
    })

    it('a message may only show images of the organisation of the ticket', async () => {
        const { service, acme, globex, bob, root } = setup()
        const actor = { tenantId: acme.id, userId: bob.id }
        const own = await service.uploadForTenant(actor, upload(PNG))
        const other = await service.uploadAsSupport(root.id, globex.id, upload(WEBP))
        const image = (id: string) => `Look:\n\n![shot.png](att:${id})`

        const ticket = await service.create(actor, { subject: 'Broken', text: image(own.id) })
        expect(ticket.messages[0]?.text).toBe(image(own.id))
        for (const text of [image(other.id), image('not-a-uuid'), image(globex.id)]) {
            await expect(service.create(actor, { subject: 'Broken', text })).rejects.toThrow(
                'support.ATTACHMENT_UNKNOWN'
            )
            await expect(service.replyAsCustomer(actor, ticket.id, text)).rejects.toThrow('support.ATTACHMENT_UNKNOWN')
            await expect(service.replyAsSupport(root.id, ticket.id, text)).rejects.toThrow('support.ATTACHMENT_UNKNOWN')
        }
        await expect(
            service.createAsSupport(root.id, {
                tenantId: acme.id,
                subject: 'x',
                priority: 'normal',
                text: image(other.id)
            })
        ).rejects.toThrow('support.ATTACHMENT_UNKNOWN')
        // Support may show an image of the organisation, also in upper case; an escaped reference is only text
        await service.replyAsSupport(root.id, ticket.id, image(own.id.toUpperCase()))
        await service.replyAsCustomer(actor, ticket.id, 'Not an image: !\\[x\\](att:nope\\)')
        const supportTicket = await service.createAsSupport(root.id, {
            tenantId: globex.id,
            subject: 'Look',
            priority: 'normal',
            text: image(other.id)
        })
        expect(supportTicket.messages).toHaveLength(1)
    })

    it('notifications and the lists show the text without markup', async () => {
        const { service, notificationsStore, acme, bob, root } = setup()
        const actor = { tenantId: acme.id, userId: bob.id }
        const { id: image } = await service.uploadForTenant(actor, upload(PNG))
        const { id } = await service.create(actor, { subject: 'Help', text: 'x' })
        await service.claim(root.id, id)
        await service.replyAsCustomer(actor, id, `**Still** _broken_:\n\n![a.png](att:${image})`)
        expect(notificationsStore.notifications.at(-1)).toMatchObject({
            kind: 'ticket.customer_reply',
            params: { text: 'Still broken:\n🖼' }
        })
        await service.replyAsSupport(
            root.id,
            id,
            'See [the manual](https://example.com/manual) and `F5` ' + 'x'.repeat(300)
        )
        const reply = notificationsStore.notifications.at(-1)
        expect(reply?.params.text).toBe(('See the manual and F5 ' + 'x'.repeat(300)).slice(0, 140))
        expect((await service.listForTenant(acme.id))[0]?.lastMessage).toEqual({
            role: 'support',
            text: ('See the manual and F5 ' + 'x'.repeat(300)).slice(0, 200)
        })
    })

    it('plainText removes the markup of a message', () => {
        expect(plainText('**bold**, __bold__, _italic_, ~~gone~~ and `code`')).toBe('bold, bold, italic, gone and code')
        expect(
            plainText('A [link](https://example.com/a_b) and ![shot.png](att:1fb82908-476c-4460-951a-0fae1f01fcc6)')
        ).toBe('A link and 🖼')
        expect(plainText('- one\n- two\n\n\n1. first\n   2. second  ')).toBe('- one\n- two\n1. first\n2. second')
        expect(plainText('2 \\* 3 = 6, \\_not italic\\_, a \\\\ and \\[x\\](y)')).toBe(
            '2 * 3 = 6, _not italic_, a \\ and [x](y)'
        )
        expect(plainText('snake_case_name stays, so does 2_000')).toBe('snake_case_name stays, so does 2_000')
        expect(plainText('')).toBe('')
        // Never half an emoji
        expect(preview('ab![x](att:y)', 3)).toBe('ab')
        expect(preview('**abcdef**', 3)).toBe('abc')
        expect(attachmentRefs('![a](att:1) ![b](att:2) [c](att:1) \\!\\[d\\](att:3\\) ![e](https://x/y.png)')).toEqual([
            '1',
            '2'
        ])
    })

    it('records every step in the audit log; claims and notes stay out of the log of the organisation', async () => {
        const { service, auditStore, acme, bob, root } = setup()
        const { id } = await service.create({ tenantId: acme.id, userId: bob.id }, { subject: 'Help', text: 'x' })
        await service.claim(root.id, id)
        await service.replyAsSupport(root.id, id, 'y')
        await service.addNote(root.id, id, { text: 'z' })
        await service.close(id)
        await service.reopen(id)
        expect(auditStore.events.map(event => [event.action, event.tenantId])).toEqual([
            ['support.ticket_created', acme.id],
            ['support.ticket_claimed', null],
            ['support.message_added', acme.id],
            ['support.note_added', null],
            ['support.ticket_closed', acme.id],
            ['support.ticket_reopened', acme.id]
        ])
        expect(auditStore.events[0]).toMatchObject({
            targetType: 'ticket',
            targetId: id,
            details: { number: 'TIC-1001' }
        })
    })
})
