'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { usePathname, useRouter } from '@/i18n/navigation'
import {
    type AdminTenant,
    ApiFailure,
    type Person,
    type Product,
    type Ticket,
    onTicketsChanged,
    ticketsChanged,
    useApi,
    useData,
    useFormat
} from '@/lib/portal'
import { useT } from '../i18n'
import { LoadError, Loading } from '../page-state'
import { useToast } from '../toast'
import { Avatar, Badge, Btn, Field, Icon, Input, Select } from '../ui'
import { Modal } from '../widgets'
import { RatingBadge, RatingView } from './rating'
import { IMAGES, RichEditor, type Uploader } from './rich-text'
import { AssigneeAway, AssigneeBar, InternalNotes, StatusBadge, Thread } from './shared'

type Filter = 'all' | 'unassigned' | 'mine' | 'open' | 'closed'

export function AdminTickets({ me }: { me: string }) {
    const t = useT('Tickets')
    const f = useFormat()
    const push = useToast()
    const api = useApi()
    const router = useRouter()
    const pathname = usePathname()
    const params = useSearchParams()
    const openId = params.get('ticket')
    const list = useData<Ticket[]>('admin/tickets')
    const team = useData<Person[]>('admin/support-team')
    const tenants = useData<AdminTenant[]>('admin/tenants')
    const products = useData<Product[]>('admin/products')
    const detail = useData<Ticket>(openId ? `admin/tickets/${encodeURIComponent(openId)}` : null)
    const reloadDetail = detail.reload
    const reloadList = list.reload
    useEffect(
        () =>
            onTicketsChanged(() => {
                void reloadList()
                void reloadDetail()
            }),
        [reloadList, reloadDetail]
    )
    const [filter, setFilter] = useState<Filter>('all')
    const [q, setQ] = useState('')
    const [reply, setReply] = useState('')
    // A new key empties an editor (after sending)
    const [editor, setEditor] = useState(0)
    const [tab, setTab] = useState<'reply' | 'intern'>('reply')
    const [modal, setModal] = useState(false)
    const [draft, setDraft] = useState({ tenantId: '', subject: '', appCode: '', priority: 'normal', text: '' })
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        if (!openId) return
        const timer = setInterval(() => document.visibilityState === 'visible' && void reloadDetail(), 30_000)
        return () => clearInterval(timer)
    }, [openId, reloadDetail])

    const open = (id: string | null) => router.push(id ? `${pathname}?ticket=${encodeURIComponent(id)}` : pathname)
    const fail = (e: unknown) => push(e instanceof ApiFailure ? e.message : t('failed'), 'alert', 'red')
    const act = async (path: string, body?: object) => {
        if (!openId) return
        setBusy(true)
        try {
            const next = await api<Ticket>(`admin/tickets/${encodeURIComponent(openId)}${path}`, 'POST', body)
            detail.setData(next)
            ticketsChanged()
            return next
        } catch (e) {
            fail(e)
        } finally {
            setBusy(false)
        }
    }

    /** The images go to the organisation of the ticket. */
    const uploadFor =
        (tenantId: string | undefined): Uploader =>
        image =>
            api<{ id: string }>('admin/tickets/attachments', 'POST', { tenantId, ...image })
    const sendReply = () => {
        if (!reply.trim() || busy) return
        void act('/messages', { text: reply.trim() }).then(n => {
            if (!n) return
            setReply('')
            setEditor(k => k + 1)
            push(t('answerSent'), 'check', 'green')
        })
    }

    const createTicket = async () => {
        if (!draft.subject.trim() || !draft.text.trim() || busy || !tenants.data?.length) return
        setBusy(true)
        try {
            const created = await api<Ticket>('admin/tickets', 'POST', {
                tenantId: draft.tenantId || tenants.data?.[0]?.id,
                subject: draft.subject.trim(),
                appCode: draft.appCode || null,
                priority: draft.priority,
                text: draft.text.trim()
            })
            setModal(false)
            setDraft({ tenantId: '', subject: '', appCode: '', priority: 'normal', text: '' })
            setEditor(k => k + 1)
            push(t('createdFor', { number: created.number, tenant: created.tenant.name }), 'ticket', 'accent')
            ticketsChanged()
            open(created.id)
        } catch (e) {
            fail(e)
        } finally {
            setBusy(false)
        }
    }

    if (openId) {
        if (detail.loading && !detail.data) return <Loading />
        if (detail.error && !detail.data)
            return <LoadError message={detail.error.message} onRetry={() => void detail.reload()} />
        const sel = detail.data
        if (!sel) return <Loading />
        const closed = sel.status === 'closed'
        const otherBusy = !!sel.assignee && sel.assignee.id !== me
        return (
            <div className='fade-in content-wide' style={{ maxWidth: 860, margin: '0 auto' }}>
                <div className='breadcrumb' style={{ marginBottom: 16 }}>
                    <a
                        onClick={() => open(null)}
                        role='link'
                        tabIndex={0}
                        onKeyDown={e => e.key === 'Enter' && open(null)}
                    >
                        {t('tickets')}
                    </a>
                    <Icon name='chevronRight' size={13} />
                    <span className='crumb-current t-mono'>{sel.number}</span>
                </div>
                <div className='card card-pad' style={{ marginBottom: 18 }}>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'space-between',
                            gap: 16,
                            marginBottom: 14
                        }}
                    >
                        <div>
                            <h1 style={{ fontSize: 21 }}>{sel.subject}</h1>
                            <div className='t-muted' style={{ fontSize: 13, marginTop: 4 }}>
                                {sel.tenant.name} · {sel.customer.name}
                                {sel.app ? ' · ' + sel.app : ''}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            {sel.priority === 'high' && (
                                <Badge tone='red' dot>
                                    {t('high')}
                                </Badge>
                            )}
                            <StatusBadge status={sel.status} />
                        </div>
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            marginBottom: 18,
                            flexWrap: 'wrap'
                        }}
                    >
                        <AssigneeBar ticket={sel} me={me} />
                        <div style={{ display: 'flex', gap: 8 }}>
                            {sel.assignee?.id !== me && !closed && (
                                <Btn
                                    size='sm'
                                    variant={otherBusy ? 'secondary' : 'primary'}
                                    icon='user'
                                    disabled={busy}
                                    onClick={() =>
                                        void act('/claim').then(n => n && push(t('claimed'), 'user', 'blue'))
                                    }
                                >
                                    {otherBusy ? t('takeOver') : t('claim')}
                                </Btn>
                            )}
                            {!closed && (
                                <Btn
                                    size='sm'
                                    variant='ghost'
                                    className='btn-danger-soft'
                                    icon='x'
                                    disabled={busy}
                                    onClick={() =>
                                        void act('/close').then(n => n && push(t('closedShort'), 'check', 'neutral'))
                                    }
                                >
                                    {t('close')}
                                </Btn>
                            )}
                        </div>
                    </div>
                    {otherBusy && (
                        <div
                            className='card'
                            style={{
                                background: 'var(--blue-tint)',
                                border: '1px solid color-mix(in srgb, var(--blue) 22%, transparent)',
                                padding: '10px 13px',
                                marginBottom: 16,
                                fontSize: 13,
                                color: 'var(--text-2)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 9
                            }}
                        >
                            <Icon name='info' size={15} style={{ color: 'var(--blue)' }} />{' '}
                            <span>
                                <strong style={{ color: 'var(--text)' }}>{sel.assignee?.name}</strong> {t('busyWith')}
                            </span>
                        </div>
                    )}
                    <AssigneeAway ticket={sel} me={me} />
                    <Thread ticket={sel} images={IMAGES.support} />
                </div>
                {sel.rating && (
                    <div className='card card-pad' style={{ marginBottom: 18 }}>
                        <div className='t-eyebrow' style={{ marginBottom: 10 }}>
                            {t('customerRating')}
                        </div>
                        <RatingView rating={sel.rating} />
                        <div className='hint' style={{ marginTop: 8 }}>
                            {t('ratedBy', { name: sel.customer?.name ?? '', date: f.date(sel.rating.ratedAt) })}
                        </div>
                    </div>
                )}
                <div className='card card-pad' style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div className='tabs' style={{ marginBottom: 2 }} role='tablist'>
                        <div
                            className={'tab ' + (tab === 'reply' ? 'active' : '')}
                            role='tab'
                            aria-selected={tab === 'reply'}
                            tabIndex={0}
                            onClick={() => setTab('reply')}
                        >
                            {t('replyTab')}
                        </div>
                        <div
                            className={'tab ' + (tab === 'intern' ? 'active' : '')}
                            role='tab'
                            aria-selected={tab === 'intern'}
                            tabIndex={0}
                            onClick={() => setTab('intern')}
                        >
                            {t('internTab')}
                            {sel.notes && sel.notes.length ? ' · ' + sel.notes.length : ''}
                        </div>
                    </div>
                    {tab === 'reply' ? (
                        !closed ? (
                            <div className='fade-in' style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <Badge tone='accent' icon='mail'>
                                        {t('visibleToCustomer')}
                                    </Badge>
                                    <span className='hint'>{t('sentTo', { name: sel.customer.name })}</span>
                                </div>
                                <RichEditor
                                    key={`reply-${sel.id}-${editor}`}
                                    label={t('replyTab')}
                                    placeholder={t('answerPlaceholder')}
                                    images={IMAGES.support}
                                    upload={uploadFor(sel.tenant.id)}
                                    onChange={setReply}
                                    onSubmit={sendReply}
                                    disabled={busy}
                                />
                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                    <Btn
                                        variant='primary'
                                        icon='mail'
                                        disabled={!reply.trim() || busy}
                                        onClick={sendReply}
                                    >
                                        {t('sendAnswer')}
                                    </Btn>
                                </div>
                            </div>
                        ) : (
                            <div
                                className='fade-in'
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 12,
                                    alignItems: 'center',
                                    textAlign: 'center',
                                    padding: '8px 0'
                                }}
                            >
                                <div style={{ color: 'var(--text-3)', fontSize: 14 }}>{t('closedAdminText')}</div>
                                <Btn
                                    size='sm'
                                    variant='secondary'
                                    icon='refresh'
                                    disabled={busy}
                                    onClick={() =>
                                        void act('/reopen').then(
                                            n => n && push(t('reopenedShort'), 'refresh', 'accent')
                                        )
                                    }
                                >
                                    {t('reopen')}
                                </Btn>
                            </div>
                        )
                    ) : (
                        <div className='fade-in'>
                            <InternalNotes
                                ticket={sel}
                                me={me}
                                team={team.data ?? []}
                                onPost={async (text, mentions) => {
                                    const next = await act('/notes', { text, mentions: mentions.map(m => m.id) })
                                    if (next)
                                        push(
                                            mentions.length
                                                ? t('notePostedTagged', { count: mentions.length })
                                                : t('notePosted'),
                                            'message',
                                            'blue'
                                        )
                                }}
                            />
                        </div>
                    )}
                </div>
            </div>
        )
    }

    if (list.loading && !list.data) return <Loading />
    if (list.error && !list.data) return <LoadError message={list.error.message} onRetry={() => void list.reload()} />
    const tickets = list.data ?? []
    const query = q.toLowerCase()
    const shown = tickets.filter(
        tk =>
            (filter === 'all' ||
                (filter === 'mine'
                    ? tk.assignee?.id === me
                    : filter === 'unassigned'
                      ? !tk.assignee
                      : filter === 'closed'
                        ? tk.status === 'closed'
                        : tk.status !== 'closed')) &&
            (tk.subject.toLowerCase().includes(query) ||
                tk.tenant.name.toLowerCase().includes(query) ||
                tk.number.toLowerCase().includes(query))
    )
    const openCount = tickets.filter(tk => tk.status !== 'closed').length
    const filters: [Filter, string][] = [
        ['all', t('filterAll')],
        ['unassigned', t('filterUnassigned')],
        ['mine', t('filterMine')],
        ['open', t('filterOpen')],
        ['closed', t('filterClosed')]
    ]

    return (
        <div className='fade-in content-wide'>
            <div className='page-head'>
                <div className='ph-text'>
                    <h1>{t('tickets')}</h1>
                    <p>{t('adminSubtitle', { count: openCount })}</p>
                </div>
                <div className='page-actions'>
                    <Btn icon='plus' onClick={() => setModal(true)}>
                        {t('newTicket')}
                    </Btn>
                </div>
            </div>
            <div className='toolbar'>
                <div className='search-input'>
                    <Input
                        icon='search'
                        placeholder={t('searchAdmin')}
                        aria-label={t('searchAdmin')}
                        value={q}
                        onChange={e => setQ(e.target.value)}
                    />
                </div>
                <div className='seg'>
                    {filters.map(([k, l]) => (
                        <button
                            type='button'
                            key={k}
                            className={filter === k ? 'active' : ''}
                            onClick={() => setFilter(k)}
                        >
                            {l}
                        </button>
                    ))}
                </div>
            </div>
            <div className='table-wrap'>
                <table className='tbl'>
                    <thead>
                        <tr>
                            <th>{t('colTicket')}</th>
                            <th>{t('colTenant')}</th>
                            <th>{t('colPriority')}</th>
                            <th>{t('colStatus')}</th>
                            <th>{t('colAssignee')}</th>
                            <th>{t('colRating')}</th>
                            <th>{t('colUpdated')}</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {shown.length === 0 && (
                            <tr>
                                <td colSpan={8} className='empty-row'>
                                    {t('noneFound')}
                                </td>
                            </tr>
                        )}
                        {shown.map(tk => (
                            <tr key={tk.id} className='clickable' onClick={() => open(tk.id)}>
                                <td>
                                    <div className='strong'>{tk.subject}</div>
                                    <div className='t-mono' style={{ fontSize: 12, color: 'var(--text-3)' }}>
                                        {tk.number} · {tk.customer.name}
                                    </div>
                                </td>
                                <td style={{ fontSize: 13 }}>{tk.tenant.name}</td>
                                <td>
                                    {tk.priority === 'high' ? (
                                        <Badge tone='red' dot>
                                            {t('high')}
                                        </Badge>
                                    ) : (
                                        <Badge tone='neutral'>{t('normal')}</Badge>
                                    )}
                                </td>
                                <td>
                                    <StatusBadge status={tk.status} />
                                </td>
                                <td>
                                    {tk.assignee ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <Avatar
                                                name={tk.assignee.name}
                                                size={24}
                                                color={tk.assignee.id === me ? 'var(--accent)' : 'var(--text-3)'}
                                            />
                                            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}>
                                                {tk.assignee.id === me ? t('you') : tk.assignee.name}
                                            </span>
                                        </div>
                                    ) : (
                                        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{t('unassigned')}</span>
                                    )}
                                </td>
                                <td>
                                    <RatingBadge rating={tk.rating} />
                                </td>
                                <td style={{ color: 'var(--text-3)', fontSize: 13 }}>{f.date(tk.updatedAt)}</td>
                                <td>
                                    <Icon name='chevronRight' size={16} style={{ color: 'var(--text-3)' }} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <Modal
                open={modal}
                onClose={() => setModal(false)}
                title={t('newTicketAdmin')}
                width={520}
                footer={
                    <>
                        <Btn variant='ghost' onClick={() => setModal(false)}>
                            {t('cancel')}
                        </Btn>
                        <Btn
                            variant='primary'
                            icon='ticket'
                            disabled={!draft.subject.trim() || !draft.text.trim() || busy || !tenants.data?.length}
                            onClick={() => void createTicket()}
                        >
                            {t('create')}
                        </Btn>
                    </>
                }
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 6 }}>
                    <p className='hint' style={{ marginTop: -2 }}>
                        {t('newTicketAdminHint')}
                    </p>
                    <Field label={t('tenant')}>
                        <Select
                            className='select'
                            value={draft.tenantId || tenants.data?.[0]?.id || ''}
                            onChange={e => setDraft(d => ({ ...d, tenantId: e.target.value }))}
                        >
                            {(tenants.data ?? []).map(tn => (
                                <option key={tn.id} value={tn.id}>
                                    {tn.contact?.name ? `${tn.name} · ${tn.contact.name}` : tn.name}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <Field label={t('subject')}>
                        <Input
                            value={draft.subject}
                            maxLength={200}
                            onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))}
                            placeholder={t('subjectAdminPlaceholder')}
                            autoFocus
                        />
                    </Field>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                        <Field label={t('aboutApp')}>
                            <Select
                                className='select'
                                value={draft.appCode}
                                onChange={e => setDraft(d => ({ ...d, appCode: e.target.value }))}
                            >
                                <option value=''>{t('general')}</option>
                                {(products.data ?? []).map(p => (
                                    <option key={p.code} value={p.code}>
                                        {p.name}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={t('priority')}>
                            <Select
                                className='select'
                                value={draft.priority}
                                onChange={e => setDraft(d => ({ ...d, priority: e.target.value }))}
                            >
                                <option value='normal'>{t('normal')}</option>
                                <option value='high'>{t('high')}</option>
                            </Select>
                        </Field>
                    </div>
                    <Field label={t('noteMessage')}>
                        <RichEditor
                            key={`new-${editor}-${draft.tenantId}`}
                            label={t('noteMessage')}
                            placeholder={t('noteMessagePlaceholder')}
                            images={IMAGES.support}
                            upload={uploadFor(draft.tenantId || tenants.data?.[0]?.id)}
                            minHeight={120}
                            onChange={text => setDraft(d => ({ ...d, text }))}
                            onSubmit={() => void createTicket()}
                        />
                    </Field>
                </div>
            </Modal>
        </div>
    )
}
