'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { usePathname, useRouter } from '@/i18n/navigation'
import {
    ApiFailure,
    type CatalogApp,
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
import { Btn, Field, Icon, Input, Select } from '../ui'
import { Modal } from '../widgets'
import { RatingForm } from './rating'
import { IMAGES, RichEditor, type Uploader } from './rich-text'
import { AssigneeAway, AssigneeBar, StatusBadge, Thread } from './shared'

export function CustomerTickets({ me }: { me: string }) {
    const t = useT('Tickets')
    const f = useFormat()
    const push = useToast()
    const api = useApi()
    const router = useRouter()
    const pathname = usePathname()
    const params = useSearchParams()
    const openId = params.get('ticket')
    const list = useData<Ticket[]>('tenants/current/tickets')
    const catalog = useData<CatalogApp[]>('tenants/current/catalog')
    const detail = useData<Ticket>(openId ? `tenants/current/tickets/${encodeURIComponent(openId)}` : null)
    const [modal, setModal] = useState(false)
    const [draft, setDraft] = useState({ subject: '', appCode: '', text: '' })
    const [reply, setReply] = useState('')
    // A new key empties an editor (after sending)
    const [editor, setEditor] = useState(0)
    const [busy, setBusy] = useState(false)
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

    // A new reply of support arrives while the ticket is open: refresh it now and then
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
            const next = await api<Ticket>(`tenants/current/tickets/${encodeURIComponent(openId)}${path}`, 'POST', body)
            detail.setData(next)
            ticketsChanged()
            return next
        } catch (e) {
            fail(e)
        } finally {
            setBusy(false)
        }
    }

    const upload: Uploader = image => api<{ id: string }>('tenants/current/tickets/attachments', 'POST', image)
    const sendReply = () => {
        if (!reply.trim() || busy) return
        void act('/messages', { text: reply.trim() }).then(n => {
            if (!n) return
            setReply('')
            setEditor(k => k + 1)
            push(t('sent'), 'check', 'green')
        })
    }

    const create = async () => {
        if (!draft.subject.trim() || !draft.text.trim() || busy) return
        setBusy(true)
        try {
            const created = await api<Ticket>('tenants/current/tickets', 'POST', {
                subject: draft.subject.trim(),
                appCode: draft.appCode || null,
                text: draft.text.trim()
            })
            setModal(false)
            setDraft({ subject: '', appCode: '', text: '' })
            setEditor(k => k + 1)
            push(t('created'), 'ticket', 'accent')
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
        return (
            <div className='fade-in' style={{ maxWidth: 760, margin: '0 auto' }}>
                <div className='breadcrumb' style={{ marginBottom: 16 }}>
                    <a
                        onClick={() => open(null)}
                        role='link'
                        tabIndex={0}
                        onKeyDown={e => e.key === 'Enter' && open(null)}
                    >
                        {t('support')}
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
                                {sel.app ? sel.app + ' · ' : ''}
                                {t('createdOn', { date: f.date(sel.createdAt) })}
                            </div>
                        </div>
                        <StatusBadge status={sel.status} />
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
                        {!closed && (
                            <Btn
                                size='sm'
                                variant='ghost'
                                className='btn-danger-soft'
                                icon='x'
                                disabled={busy}
                                onClick={() =>
                                    void act('/close').then(
                                        n => n && push(t('closed', { number: n.number }), 'check', 'neutral')
                                    )
                                }
                            >
                                {t('close')}
                            </Btn>
                        )}
                    </div>
                    <AssigneeAway ticket={sel} me={me} />
                    <Thread ticket={sel} images={IMAGES.customer} />
                </div>
                {!closed ? (
                    <div className='card card-pad' style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div className='t-eyebrow'>{t('respond')}</div>
                        <RichEditor
                            key={`reply-${sel.id}-${editor}`}
                            label={t('respond')}
                            placeholder={t('messagePlaceholder')}
                            images={IMAGES.customer}
                            upload={upload}
                            onChange={setReply}
                            onSubmit={sendReply}
                            disabled={busy}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Btn
                                variant='primary'
                                icon='arrowRight'
                                disabled={!reply.trim() || busy}
                                onClick={sendReply}
                            >
                                {t('send')}
                            </Btn>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className='card card-pad' style={{ marginBottom: 18 }}>
                            <RatingForm
                                key={sel.id + (sel.rating?.ratedAt ?? '')}
                                ticket={sel}
                                onSubmit={async (score, comment) => {
                                    const next = await act('/rating', { score, comment: comment || null })
                                    if (next) push(t('ratingSaved'), 'star', 'green')
                                    return Boolean(next)
                                }}
                            />
                        </div>
                        <div
                            className='card card-pad'
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 12,
                                alignItems: 'center',
                                textAlign: 'center'
                            }}
                        >
                            <div style={{ color: 'var(--text-3)', fontSize: 14 }}>{t('closedText')}</div>
                            <Btn
                                size='sm'
                                variant='secondary'
                                icon='refresh'
                                disabled={busy}
                                onClick={() =>
                                    void act('/reopen').then(
                                        n => n && push(t('reopened', { number: n.number }), 'refresh', 'accent')
                                    )
                                }
                            >
                                {t('reopen')}
                            </Btn>
                        </div>
                    </>
                )}
            </div>
        )
    }

    if (list.loading && !list.data) return <Loading />
    if (list.error && !list.data) return <LoadError message={list.error.message} onRetry={() => void list.reload()} />
    const mine = list.data ?? []

    return (
        <div className='fade-in' style={{ maxWidth: 920, margin: '0 auto' }}>
            <div className='page-head'>
                <div className='ph-text'>
                    <h1>{t('support')}</h1>
                    <p>{t('supportSubtitle')}</p>
                </div>
                <div className='page-actions'>
                    <Btn icon='plus' onClick={() => setModal(true)}>
                        {t('newTicket')}
                    </Btn>
                </div>
            </div>
            {mine.length === 0 ? (
                <div className='card card-pad' style={{ textAlign: 'center', padding: 50 }}>
                    <Icon name='ticket' size={30} style={{ color: 'var(--text-3)' }} />
                    <h3 className='t-h3' style={{ marginTop: 12 }}>
                        {t('noTickets')}
                    </h3>
                    <p style={{ marginTop: 6 }}>{t('noTicketsText')}</p>
                </div>
            ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                    {mine.map(tk => (
                        <div
                            className='card card-hover card-pad'
                            key={tk.id}
                            role='link'
                            tabIndex={0}
                            onClick={() => open(tk.id)}
                            onKeyDown={e => e.key === 'Enter' && open(tk.id)}
                            style={{ display: 'flex', gap: 16, alignItems: 'center' }}
                        >
                            <div
                                style={{
                                    width: 38,
                                    height: 38,
                                    borderRadius: 10,
                                    background: 'var(--accent-tint)',
                                    color: 'var(--accent)',
                                    display: 'grid',
                                    placeItems: 'center',
                                    flex: 'none'
                                }}
                            >
                                <Icon name='ticket' size={18} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                                    <span
                                        className='t-mono'
                                        style={{ fontSize: 12, color: 'var(--text-3)', flex: 'none' }}
                                    >
                                        {tk.number}
                                    </span>
                                    <span
                                        style={{
                                            fontWeight: 600,
                                            fontSize: 15,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        {tk.subject}
                                    </span>
                                </div>
                                {tk.lastMessage && (
                                    <div
                                        className='t-muted'
                                        style={{
                                            fontSize: 13,
                                            marginTop: 3,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        {tk.lastMessage.role === 'support' ? t('lastSupport') : t('lastYou')}
                                        {tk.lastMessage.text}
                                    </div>
                                )}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 7 }}>
                                <StatusBadge status={tk.status} />
                                {tk.assignee && (
                                    <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{tk.assignee.name}</span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Modal
                open={modal}
                onClose={() => setModal(false)}
                title={t('newTicket')}
                width={500}
                footer={
                    <>
                        <Btn variant='ghost' onClick={() => setModal(false)}>
                            {t('cancel')}
                        </Btn>
                        <Btn
                            variant='primary'
                            icon='ticket'
                            disabled={!draft.subject.trim() || !draft.text.trim() || busy}
                            onClick={() => void create()}
                        >
                            {t('create')}
                        </Btn>
                    </>
                }
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 6 }}>
                    <Field label={t('subject')}>
                        <Input
                            value={draft.subject}
                            maxLength={200}
                            onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))}
                            placeholder={t('subjectPlaceholder')}
                            autoFocus
                        />
                    </Field>
                    <Field label={t('aboutApp')}>
                        <Select
                            className='select'
                            value={draft.appCode}
                            onChange={e => setDraft(d => ({ ...d, appCode: e.target.value }))}
                        >
                            <option value=''>{t('general')}</option>
                            {(catalog.data ?? []).map(a => (
                                <option key={a.code} value={a.code}>
                                    {a.name}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <Field label={t('message')}>
                        <RichEditor
                            key={`new-${editor}`}
                            label={t('message')}
                            placeholder={t('problemPlaceholder')}
                            images={IMAGES.customer}
                            upload={upload}
                            minHeight={120}
                            onChange={text => setDraft(d => ({ ...d, text }))}
                            onSubmit={() => void create()}
                        />
                    </Field>
                </div>
            </Modal>
        </div>
    )
}
