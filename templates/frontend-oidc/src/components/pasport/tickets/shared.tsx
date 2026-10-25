'use client'

import { Fragment, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { type Person, type Ticket, type TicketStatus, useFormat } from '@/lib/portal'
import { useT } from '../i18n'
import { Avatar, Badge, Btn, Icon, type Tone } from '../ui'
import { OutOfOfficeNotice } from '../out-of-office'
import { RichText } from './rich-text'

export const TK_STATUS: Record<TicketStatus, [Tone, string]> = {
    open: ['amber', 'statusOpen'],
    in_progress: ['blue', 'statusInProgress'],
    answered: ['accent', 'statusAnswered'],
    closed: ['neutral', 'statusClosed']
}

export function StatusBadge({ status }: { status: TicketStatus }) {
    const t = useT('Tickets')
    const [tone, lbl] = TK_STATUS[status] ?? ['neutral', status]
    return (
        <Badge tone={tone} dot>
            {t(lbl)}
        </Badge>
    )
}

/** The messages of a ticket; `images`: where its images are read (IMAGES.customer or IMAGES.support). */
export function Thread({ ticket, images }: { ticket: Ticket; images: string }) {
    const t = useT('Tickets')
    const f = useFormat()
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {(ticket.messages ?? []).map(m => {
                const support = m.role === 'support'
                return (
                    <div
                        key={m.id}
                        style={{ display: 'flex', gap: 11, flexDirection: support ? 'row-reverse' : 'row' }}
                    >
                        <Avatar
                            name={m.from?.name ?? ''}
                            size={32}
                            color={support ? 'var(--accent)' : 'var(--surface-3)'}
                        />
                        <div style={{ maxWidth: '76%' }}>
                            <div
                                style={{
                                    display: 'flex',
                                    gap: 8,
                                    alignItems: 'baseline',
                                    marginBottom: 4,
                                    flexDirection: support ? 'row-reverse' : 'row'
                                }}
                            >
                                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                                    {m.from?.name ?? '—'}
                                </span>
                                <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                                    {support ? t('roleSupport') : t('roleCustomer')} · {f.dateTime(m.createdAt)}
                                </span>
                            </div>
                            <div
                                style={{
                                    padding: '11px 14px',
                                    borderRadius: 12,
                                    fontSize: 14,
                                    lineHeight: 1.55,
                                    background: support ? 'var(--accent-tint)' : 'var(--surface-2)',
                                    border: '1px solid ' + (support ? 'var(--accent-border)' : 'var(--border)'),
                                    color: 'var(--text)',
                                    borderTopLeftRadius: support ? 12 : 3,
                                    borderTopRightRadius: support ? 3 : 12
                                }}
                            >
                                <RichText text={m.text} images={images} />
                            </div>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

export function AssigneeBar({ ticket, me }: { ticket: Ticket; me: string }) {
    const t = useT('Tickets')
    if (!ticket.assignee)
        return (
            <div className='badge badge-amber'>
                <Icon name='clock' size={12} /> {t('notAssigned')}
            </div>
        )
    const mine = ticket.assignee.id === me
    return (
        <div className={'badge ' + (mine ? 'badge-green' : 'badge-blue')}>
            <Avatar name={ticket.assignee.name} size={16} />{' '}
            {mine ? t('youHandle') : t('handledBy', { name: ticket.assignee.name })}
        </div>
    )
}

/** The one handling the ticket is out of office: its message for the reader (customers or colleagues). */
export function AssigneeAway({ ticket, me }: { ticket: Ticket; me: string }) {
    if (!ticket.assignee || !ticket.assigneeOutOfOffice || ticket.assignee.id === me) return null
    return (
        <div style={{ marginBottom: 14 }}>
            <OutOfOfficeNotice name={ticket.assignee.name} notice={ticket.assigneeOutOfOffice} />
        </div>
    )
}

/* ============================ INTERNAL NOTES (@mentions) ============================ */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The team members tagged in a note (@Name). */
export function mentionsOf(text: string, team: Person[]): Person[] {
    return team.filter(m => new RegExp('@' + escape(m.name) + '(?![\\p{L}])', 'u').test(text))
}

export function renderMentions(text: string, me: string, team: Person[]): ReactNode[] {
    const names = team.map(m => m.name).sort((a, b) => b.length - a.length)
    const myName = team.find(m => m.id === me)?.name
    const tokens: { t: 'm' | 'x'; v: string }[] = []
    let i = 0
    while (i < text.length) {
        if (text[i] === '@') {
            const rest = text.slice(i + 1)
            const hit = names.find(n => rest.startsWith(n))
            if (hit) {
                tokens.push({ t: 'm', v: hit })
                i += 1 + hit.length
                continue
            }
        }
        const last = tokens[tokens.length - 1]
        if (last && last.t === 'x') last.v += text[i]
        else tokens.push({ t: 'x', v: text[i] })
        i++
    }
    return tokens.map((tk, k) =>
        tk.t === 'm' ? (
            <span key={k} className={'mention' + (tk.v === myName ? ' mention-me' : '')}>
                @{tk.v}
            </span>
        ) : (
            <Fragment key={k}>{tk.v}</Fragment>
        )
    )
}

function MentionComposer({
    value,
    onChange,
    onSubmit,
    placeholder,
    team,
    me
}: {
    value: string
    onChange: (v: string) => void
    onSubmit: () => void
    placeholder?: string
    team: Person[]
    me: string
}) {
    const t = useT('Tickets')
    const tp = useT('Presence')
    const taRef = useRef<HTMLTextAreaElement>(null)
    const [sugg, setSugg] = useState<{ start: number; query: string; idx: number } | null>(null)
    const compute = (el: HTMLTextAreaElement) => {
        const pos = el.selectionStart
        const before = el.value.slice(0, pos)
        const m = before.match(/(?:^|\s)@([\p{L}]*)$/u)
        if (m) {
            const query = m[1].toLowerCase()
            if (team.some(p => p.name.toLowerCase().includes(query))) {
                setSugg({ start: pos - m[1].length - 1, query, idx: 0 })
                return
            }
        }
        setSugg(null)
    }
    const options = sugg ? team.filter(p => p.name.toLowerCase().includes(sugg.query)) : []
    const pick = (member: Person) => {
        if (!sugg) return
        const pos = taRef.current ? taRef.current.selectionStart : value.length
        const next = value.slice(0, sugg.start) + '@' + member.name + ' ' + value.slice(pos)
        onChange(next)
        setSugg(null)
        requestAnimationFrame(() => {
            const el = taRef.current
            if (el) {
                el.focus()
                const c = sugg.start + member.name.length + 2
                el.setSelectionRange(c, c)
            }
        })
    }
    const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (sugg && options.length) {
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSugg(s => s && { ...s, idx: (s.idx + 1) % options.length })
                return
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSugg(s => s && { ...s, idx: (s.idx - 1 + options.length) % options.length })
                return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                pick(options[sugg.idx])
                return
            }
            if (e.key === 'Escape') {
                setSugg(null)
                return
            }
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            onSubmit()
        }
    }
    return (
        <div style={{ position: 'relative' }}>
            <textarea
                ref={taRef}
                className='textarea'
                rows={3}
                placeholder={placeholder}
                aria-label={placeholder}
                value={value}
                onChange={e => {
                    onChange(e.target.value)
                    compute(e.target)
                }}
                onClick={e => compute(e.currentTarget)}
                onKeyDown={onKey}
            />
            {sugg && options.length > 0 && (
                <div className='mention-pop' role='listbox'>
                    <div className='mention-pop-head'>
                        <Icon name='atSign' size={12} /> {t('tagMember')}
                    </div>
                    {options.map((p, k) => (
                        <button
                            type='button'
                            key={p.id}
                            role='option'
                            aria-selected={k === sugg.idx}
                            className={'mention-opt' + (k === sugg.idx ? ' active' : '')}
                            onMouseDown={e => {
                                e.preventDefault()
                                pick(p)
                            }}
                            onMouseEnter={() => setSugg(s => s && { ...s, idx: k })}
                        >
                            <Avatar name={p.name} size={26} color={p.id === me ? 'var(--text)' : 'var(--surface-3)'} />
                            <span style={{ flex: 1, minWidth: 0 }}>
                                <span className='mention-opt-name'>{p.name}</span>
                                <span className='mention-opt-role'>
                                    {p.outOfOffice ? (
                                        <>
                                            <span
                                                className='presence-dot-inline presence-ooo'
                                                style={{ display: 'inline-block', width: 8, height: 8, marginRight: 5 }}
                                            />
                                            {tp('ooo')}
                                        </>
                                    ) : (
                                        t('superadmin')
                                    )}
                                </span>
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

export function InternalNotes({
    ticket,
    me,
    team,
    onPost
}: {
    ticket: Ticket
    me: string
    team: Person[]
    onPost: (text: string, mentions: Person[]) => Promise<void>
}) {
    const t = useT('Tickets')
    const f = useFormat()
    const [note, setNote] = useState('')
    const [busy, setBusy] = useState(false)
    const notes = ticket.notes ?? []
    const post = async () => {
        if (!note.trim() || busy) return
        setBusy(true)
        try {
            await onPost(note, mentionsOf(note, team))
            setNote('')
        } finally {
            setBusy(false)
        }
    }
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Badge tone='neutral' icon='lock'>
                    {t('notVisible')}
                </Badge>
                <span className='hint'>{t('notesHint')}</span>
            </div>
            {notes.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {notes.map(n => (
                        <div key={n.id} style={{ display: 'flex', gap: 10 }}>
                            <Avatar
                                name={n.from?.name ?? ''}
                                size={28}
                                color={n.from?.id === me ? 'var(--accent)' : 'var(--surface-3)'}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 3 }}>
                                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                                        {n.from?.id === me ? t('you') : n.from?.name}
                                    </span>
                                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                                        {f.dateTime(n.createdAt)}
                                    </span>
                                </div>
                                <div className='internal-note'>{renderMentions(n.text, me, team)}</div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '2px 0' }}>{t('noNotes')}</div>
            )}
            <div>
                {/* Tagged someone who is out of office: show its message for colleagues at once */}
                {mentionsOf(note, team).flatMap(p =>
                    p.outOfOffice && p.id !== me
                        ? [
                              <div key={p.id} style={{ marginBottom: 10 }}>
                                  <OutOfOfficeNotice name={p.name} notice={p.outOfOffice} />
                              </div>
                          ]
                        : []
                )}
                <MentionComposer
                    value={note}
                    onChange={setNote}
                    onSubmit={() => void post()}
                    placeholder={t('notePlaceholder')}
                    team={team}
                    me={me}
                />
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: 10,
                        gap: 10,
                        flexWrap: 'wrap'
                    }}
                >
                    <span className='hint' style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Icon name='atSign' size={12} /> {t('tagHint')} ·{' '}
                        <span style={{ color: 'var(--text-3)' }}>{t('ctrlEnter')}</span>
                    </span>
                    <Btn
                        size='sm'
                        variant='secondary'
                        icon='message'
                        disabled={!note.trim() || busy}
                        onClick={() => void post()}
                    >
                        {t('postNote')}
                    </Btn>
                </div>
            </div>
        </div>
    )
}
