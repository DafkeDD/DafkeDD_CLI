'use client'

import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { type Ticket, useData, useFormat } from '@/lib/portal'
import { useT } from '../i18n'
import { LoadError, Loading } from '../page-state'
import { Avatar, Btn, Icon, Input } from '../ui'
import { Stars } from '../tickets/rating'

type Rated = Ticket & { rating: NonNullable<Ticket['rating']> }

/** A value for a CSV cell (quoted when needed). */
const cell = (value: string | number) => {
    const text = String(value)
    return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** The ratings that customers gave after a ticket was closed: the average, the spread and the list. */
export function TicketRatings() {
    const t = useT('Ratings')
    const tt = useT('Tickets')
    const f = useFormat()
    const router = useRouter()
    const { data, error, loading, reload } = useData<Ticket[]>('admin/tickets')
    const [score, setScore] = useState<number | null>(null)
    const [q, setQ] = useState('')

    if (loading && !data) return <Loading />
    if (error && !data) return <LoadError message={error.message} onRetry={() => void reload()} />

    const rated = (data ?? [])
        .filter((tk): tk is Rated => !!tk.rating)
        .sort((a, b) => new Date(b.rating.ratedAt).getTime() - new Date(a.rating.ratedAt).getTime())
    const count = rated.length
    const average = count ? rated.reduce((sum, tk) => sum + tk.rating.score, 0) / count : 0
    const satisfied = count ? Math.round((rated.filter(tk => tk.rating.score >= 4).length / count) * 100) : 0
    const withComment = rated.filter(tk => tk.rating.comment).length
    const spread = [5, 4, 3, 2, 1].map(n => ({ n, total: rated.filter(tk => tk.rating.score === n).length }))
    const query = q.toLowerCase()
    const list = rated.filter(
        tk =>
            (score === null || tk.rating.score === score) &&
            [
                tk.number,
                tk.subject,
                tk.tenant.name,
                tk.customer?.name ?? '',
                tk.assignee?.name ?? '',
                tk.rating.comment ?? ''
            ]
                .join(' ')
                .toLowerCase()
                .includes(query)
    )

    const exportCsv = () => {
        const head = [
            t('colTicket'),
            t('colSubject'),
            t('colTenant'),
            t('colCustomer'),
            t('colAssignee'),
            t('colScore'),
            t('colComment'),
            t('colDate')
        ]
        const rows = list.map(tk => [
            tk.number,
            tk.subject,
            tk.tenant.name,
            tk.customer?.name ?? '',
            tk.assignee?.name ?? '',
            tk.rating.score,
            tk.rating.comment ?? '',
            tk.rating.ratedAt.slice(0, 10)
        ])
        const csv = '﻿' + [head, ...rows].map(row => row.map(cell).join(';')).join('\r\n')
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
        const link = document.createElement('a')
        link.href = url
        link.download = `beoordelingen-${new Date().toISOString().slice(0, 10)}.csv`
        link.click()
        URL.revokeObjectURL(url)
    }

    const kpis = [
        ['kpiAverage', count ? average.toFixed(1) : '—', 'star', '#f59e0b'],
        ['kpiCount', String(count), 'ticket', 'var(--accent)'],
        ['kpiSatisfied', count ? satisfied + '%' : '—', 'checkCircle', 'var(--green)'],
        ['kpiComments', String(withComment), 'message', 'var(--blue)']
    ] as const

    return (
        <div className='fade-in content-wide'>
            <div className='page-head'>
                <div className='ph-text'>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>
                <div className='page-actions'>
                    <Btn variant='secondary' icon='upload' disabled={list.length === 0} onClick={exportCsv}>
                        {t('export')}
                    </Btn>
                </div>
            </div>

            <div className='kpi-grid kpi-grid-4' style={{ marginBottom: 18 }}>
                {kpis.map(([l, v, ic, col]) => (
                    <div className='card kpi' key={l} style={{ padding: '16px 18px' }}>
                        <div className='kpi-top'>
                            <div
                                className='kpi-icon'
                                style={{ background: `color-mix(in srgb, ${col} 14%, transparent)`, color: col }}
                            >
                                <Icon name={ic} size={17} className={ic === 'star' ? 'star on' : undefined} />
                            </div>
                        </div>
                        <div className='kpi-value' style={{ fontSize: 26 }}>
                            {v}
                            {l === 'kpiAverage' && count > 0 && (
                                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-3)' }}> / 5</span>
                            )}
                        </div>
                        <div className='kpi-label' style={{ marginTop: 5 }}>
                            {t(l)}
                        </div>
                    </div>
                ))}
            </div>

            <div className='card card-pad' style={{ marginBottom: 18 }}>
                <div className='t-h3' style={{ marginBottom: 4 }}>
                    {t('spread')}
                </div>
                <div className='hint' style={{ marginBottom: 14 }}>
                    {t('spreadHint')}
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                    {spread.map(({ n, total }) => (
                        <button
                            type='button'
                            key={n}
                            className='rating-row'
                            aria-pressed={score === n}
                            onClick={() => setScore(s => (s === n ? null : n))}
                        >
                            <Stars value={n} size={15} label={x => tt('stars', { count: x })} />
                            <span className='rating-bar'>
                                <span style={{ width: count ? `${(total / count) * 100}%` : 0 }} />
                            </span>
                            <span className='rating-count'>{total}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className='toolbar'>
                <div className='search-input'>
                    <Input
                        icon='search'
                        placeholder={t('search')}
                        aria-label={t('search')}
                        value={q}
                        onChange={e => setQ(e.target.value)}
                    />
                </div>
                <div className='seg'>
                    <button type='button' className={score === null ? 'active' : ''} onClick={() => setScore(null)}>
                        {t('all')}
                    </button>
                    {[5, 4, 3, 2, 1].map(n => (
                        <button
                            type='button'
                            key={n}
                            className={score === n ? 'active' : ''}
                            onClick={() => setScore(n)}
                        >
                            {n} ★
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
                            <th>{t('colAssignee')}</th>
                            <th>{t('colScore')}</th>
                            <th>{t('colComment')}</th>
                            <th>{t('colDate')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {list.length === 0 && (
                            <tr>
                                <td colSpan={6} className='empty-row'>
                                    {count === 0 ? t('none') : t('noneFound')}
                                </td>
                            </tr>
                        )}
                        {list.map(tk => (
                            <tr
                                key={tk.id}
                                className='clickable'
                                onClick={() => router.push(`/admin/tickets?ticket=${encodeURIComponent(tk.id)}`)}
                            >
                                <td>
                                    <div className='strong'>{tk.subject}</div>
                                    <div className='t-mono' style={{ fontSize: 12, color: 'var(--text-3)' }}>
                                        {tk.number} · {tk.customer?.name ?? '—'}
                                    </div>
                                </td>
                                <td style={{ fontSize: 13 }}>{tk.tenant.name}</td>
                                <td>
                                    {tk.assignee ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <Avatar name={tk.assignee.name} size={24} color='var(--text-3)' />
                                            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                                                {tk.assignee.name}
                                            </span>
                                        </div>
                                    ) : (
                                        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>—</span>
                                    )}
                                </td>
                                <td>
                                    <Stars value={tk.rating.score} size={15} label={x => tt('stars', { count: x })} />
                                </td>
                                <td style={{ maxWidth: 320, fontSize: 13, color: 'var(--text-2)' }}>
                                    <span
                                        style={{
                                            display: 'block',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}
                                        title={tk.rating.comment ?? undefined}
                                    >
                                        {tk.rating.comment ?? <span style={{ color: 'var(--text-3)' }}>—</span>}
                                    </span>
                                </td>
                                <td style={{ color: 'var(--text-3)', fontSize: 13 }}>{f.date(tk.rating.ratedAt)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
