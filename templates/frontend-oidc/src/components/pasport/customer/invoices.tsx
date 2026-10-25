'use client'

import { useState } from 'react'
import {
    ApiFailure,
    type Billing,
    daysUntil,
    type Invoice,
    type LicenseItem,
    useApi,
    useData,
    useFormat
} from '@/lib/portal'
import { useMe } from '../shell'
import { useT } from '../i18n'
import { LoadError, Loading, Notice } from '../page-state'
import { useToast } from '../toast'
import { Badge, Btn, Icon } from '../ui'
import { Modal, QrCode } from '../widgets'

const INV_STATUS: Record<Invoice['status'], ['green' | 'amber' | 'violet', string]> = {
    paid: ['green', 'statusPaid'],
    open: ['amber', 'statusOpen'],
    free: ['violet', 'statusFree']
}
const PAY_METHODS: [string, string, string][] = [
    ['bancontact', 'methodBancontact', 'creditcard'],
    ['card', 'methodCard', 'creditcard'],
    ['qr', 'methodQr', 'qrcode'],
    ['sepa', 'methodSepa', 'external']
]

export function Invoices({ admin }: { admin: boolean }) {
    const t = useT('Invoices')
    const f = useFormat()
    const push = useToast()
    const api = useApi()
    const me = useMe()
    const invoices = useData<Invoice[]>(admin ? 'tenants/current/invoices' : null)
    const billing = useData<Billing>('tenants/current/billing')
    const licenses = useData<LicenseItem[]>(admin ? 'tenants/current/licenses' : null)
    const [payOpen, setPayOpen] = useState(false)
    const [method, setMethod] = useState('bancontact')
    const [busy, setBusy] = useState(false)
    // The subscription that is being cancelled (the confirmation is open)
    const [stopping, setStopping] = useState<{ code: string; app: string; ends: string | null } | null>(null)

    if (!admin) return <Notice title={t('adminOnly')} />
    if (invoices.loading && !invoices.data) return <Loading />
    if (invoices.error && !invoices.data)
        return <LoadError message={invoices.error.message} onRetry={() => void invoices.reload()} />

    const list = invoices.data ?? []
    const openInv = list.filter(i => i.status === 'open')
    const total = openInv.reduce((a, i) => a + i.totalCents, 0)
    const vat = billing.data?.vat || '—'
    // Every running subscription; a free one (100% code) may have no end
    const contracts = (licenses.data ?? [])
        .filter(i => i.subscription && i.subscription.valid)
        .map(i => {
            const s = i.subscription!
            return {
                id: s.id,
                code: i.product.code,
                app: i.product.name,
                plan: s.interval === 'year' ? t('planYear') : t('planMonth'),
                renews: s.currentPeriodEnd,
                daysLeft: s.currentPeriodEnd ? daysUntil(s.currentPeriodEnd) : Infinity,
                amount:
                    s.renewalCents ??
                    (s.interval === 'year' ? i.product.priceYearCents : i.product.priceMonthCents) * s.seats,
                canceled: s.cancelAtPeriodEnd
            }
        })

    /** Cancel: no renewal any more; the app keeps working until the end of the paid period (a free one stops now). */
    const stop = async () => {
        if (!stopping) return
        setBusy(true)
        try {
            await api(`tenants/current/licenses/subscriptions/${encodeURIComponent(stopping.code)}`, 'DELETE')
            push(
                stopping.ends
                    ? t('cancelDone', { app: stopping.app, date: f.date(stopping.ends) })
                    : t('cancelDoneNow', { app: stopping.app }),
                'check',
                'neutral'
            )
            setStopping(null)
            void licenses.reload()
        } catch (e) {
            push(e instanceof ApiFailure ? e.message : t('cancelFailed'), 'alert', 'red')
        } finally {
            setBusy(false)
        }
    }

    const payAll = async () => {
        setBusy(true)
        try {
            const result = await api<{ checkoutUrl: string | null }>('tenants/current/invoices/pay', 'POST')
            if (result.checkoutUrl) window.location.assign(result.checkoutUrl)
            else {
                push(t('allPaid'), 'check', 'green')
                setPayOpen(false)
                void invoices.reload()
            }
        } catch (e) {
            push(e instanceof ApiFailure ? e.message : t('payFailed'), 'alert', 'red')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className='fade-in' style={{ maxWidth: 920, margin: '0 auto' }}>
            <div className='page-head'>
                <div className='ph-text'>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle', { email: billing.data?.billingEmail || me.email })}</p>
                </div>
                {openInv.length > 0 && (
                    <div className='page-actions'>
                        <Btn icon='creditcard' onClick={() => setPayOpen(true)}>
                            {t('payAll', { amount: f.eur(total) })}
                        </Btn>
                    </div>
                )}
            </div>

            <div className='kpi-grid' style={{ marginBottom: 20, gridTemplateColumns: 'repeat(3,1fr)' }}>
                {(
                    [
                        ['invoices', String(list.length), 'invoice', 'var(--accent)', false],
                        ['outstanding', f.eur(total), 'clock', 'var(--amber)', false],
                        ['vat', vat, 'building', 'var(--text-3)', true]
                    ] as const
                ).map(([l, v, ic, col, mono]) => (
                    <div className='card kpi' key={l} style={{ padding: '16px 18px' }}>
                        <div className='kpi-top'>
                            <div
                                className='kpi-icon'
                                style={{ background: `color-mix(in srgb, ${col} 14%, transparent)`, color: col }}
                            >
                                <Icon name={ic} size={17} />
                            </div>
                        </div>
                        <div
                            className='kpi-value'
                            style={{
                                fontSize: mono ? 17 : 26,
                                fontFamily: mono ? 'var(--mono)' : 'inherit',
                                marginTop: mono ? 14 : 10
                            }}
                        >
                            {v}
                        </div>
                        <div className='kpi-label' style={{ marginTop: 5 }}>
                            {t('kpi_' + l)}
                        </div>
                    </div>
                ))}
            </div>

            {contracts.length > 0 && (
                <div className='card card-pad' style={{ marginBottom: 20 }} data-tour='subscriptions'>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: 14
                        }}
                    >
                        <div className='t-eyebrow'>{t('subscriptions')}</div>
                        <Badge tone='neutral' icon='refresh'>
                            {t('autoRenew')}
                        </Badge>
                    </div>
                    <div style={{ display: 'grid', gap: 10 }}>
                        {contracts.map(c => {
                            const soon = c.daysLeft <= 30
                            return (
                                <div
                                    key={c.id}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 14,
                                        padding: '12px 14px',
                                        border: '1px solid ' + (soon ? 'var(--amber-border)' : 'var(--border)'),
                                        borderRadius: 'var(--r-md)',
                                        background: soon ? 'var(--amber-tint)' : 'var(--surface-2)'
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 36,
                                            height: 36,
                                            borderRadius: 9,
                                            background: soon
                                                ? 'color-mix(in srgb, var(--amber) 18%, transparent)'
                                                : 'var(--accent-tint-2)',
                                            color: soon ? 'var(--amber)' : 'var(--accent)',
                                            display: 'grid',
                                            placeItems: 'center',
                                            flex: 'none'
                                        }}
                                    >
                                        <Icon name={soon ? 'alert' : 'refresh'} size={17} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: 14.5 }}>{c.app}</div>
                                        <div className='t-muted' style={{ fontSize: 13 }}>
                                            {c.plan} · {f.eur(c.amount)}
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right', flex: 'none' }}>
                                        {c.canceled ? (
                                            <Badge tone='neutral' dot>
                                                {t('canceled')}
                                            </Badge>
                                        ) : soon ? (
                                            <Badge tone='amber' dot>
                                                {t('expiresIn', { count: Math.max(0, c.daysLeft) })}
                                            </Badge>
                                        ) : (
                                            <Badge tone='green' dot>
                                                {t('active')}
                                            </Badge>
                                        )}
                                        <div className='t-muted' style={{ fontSize: 12, marginTop: 5 }}>
                                            {!c.renews
                                                ? t('noEnd')
                                                : c.canceled
                                                  ? t('endsOn', { date: f.date(c.renews) })
                                                  : t('renews', { date: f.date(c.renews) })}
                                        </div>
                                    </div>
                                    {!c.canceled && (
                                        <Btn
                                            size='sm'
                                            variant='ghost'
                                            icon='x'
                                            onClick={() => setStopping({ code: c.code, app: c.app, ends: c.renews })}
                                        >
                                            {t('cancelSub')}
                                        </Btn>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            <div className='table-wrap'>
                <table className='tbl'>
                    <thead>
                        <tr>
                            <th>{t('colNumber')}</th>
                            <th>{t('colDate')}</th>
                            <th>{t('colApp')}</th>
                            <th>{t('colPeriod')}</th>
                            <th>{t('colAmount')}</th>
                            <th>{t('colStatus')}</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {list.length === 0 && (
                            <tr>
                                <td colSpan={7} className='empty-row'>
                                    {t('none')}
                                </td>
                            </tr>
                        )}
                        {list.map(inv => {
                            const [tone, lbl] = INV_STATUS[inv.status] ?? ['neutral', inv.status]
                            return (
                                <tr key={inv.id}>
                                    <td>
                                        <span className='t-mono strong' style={{ fontSize: 13 }}>
                                            {inv.number}
                                        </span>
                                    </td>
                                    <td style={{ color: 'var(--text-3)', fontSize: 13 }}>{f.date(inv.issuedAt)}</td>
                                    <td>
                                        <span className='strong' style={{ fontWeight: 500 }}>
                                            {inv.app}
                                        </span>
                                    </td>
                                    <td style={{ fontSize: 13 }}>
                                        {inv.period === 'year'
                                            ? t('periodYear')
                                            : inv.period === 'month'
                                              ? t('periodMonth')
                                              : '—'}
                                    </td>
                                    <td>
                                        <span className='strong'>
                                            {f.eur(inv.status === 'free' ? 0 : inv.totalCents)}
                                        </span>
                                    </td>
                                    <td>
                                        <Badge tone={tone} dot>
                                            {t(lbl)}
                                        </Badge>
                                    </td>
                                    <td>
                                        <a
                                            className='btn btn-ghost btn-sm'
                                            href={`/api/backend/tenants/current/invoices/${encodeURIComponent(inv.id)}/pdf`}
                                            target='_blank'
                                            rel='noopener noreferrer'
                                            onClick={() =>
                                                push(t('downloaded', { number: inv.number }), 'invoice', 'accent')
                                            }
                                        >
                                            <Icon name='external' size={15} /> PDF
                                        </a>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>

            <Modal
                open={!!stopping}
                onClose={() => setStopping(null)}
                title={t('cancelTitle', { app: stopping?.app ?? '' })}
                width={460}
                footer={
                    <>
                        <Btn variant='ghost' onClick={() => setStopping(null)}>
                            {t('cancelKeep')}
                        </Btn>
                        <Btn variant='danger' icon='x' disabled={busy} onClick={() => void stop()}>
                            {t('cancelConfirm')}
                        </Btn>
                    </>
                }
            >
                <p style={{ fontSize: 14, lineHeight: 1.55 }}>
                    {stopping?.ends ? t('cancelText', { date: f.date(stopping.ends) }) : t('cancelTextNow')}
                </p>
            </Modal>

            <Modal
                open={payOpen}
                onClose={() => setPayOpen(false)}
                title={t('payTitle')}
                width={460}
                footer={
                    <>
                        <Btn variant='ghost' onClick={() => setPayOpen(false)}>
                            {t('cancel')}
                        </Btn>
                        <Btn variant='primary' icon='lock' disabled={busy} onClick={() => void payAll()}>
                            {t('pay', { amount: f.eur(total) })}
                        </Btn>
                    </>
                }
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 4 }}>
                    <div className='card' style={{ background: 'var(--surface-2)', padding: '14px 16px' }}>
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: 13.5,
                                marginBottom: 10
                            }}
                        >
                            <span className='t-muted'>{t('openCount', { count: openInv.length })}</span>
                            <span className='t-muted'>{t('amount')}</span>
                        </div>
                        <div style={{ display: 'grid', gap: 7 }}>
                            {openInv.map(i => (
                                <div
                                    key={i.id}
                                    style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}
                                >
                                    <span className='t-mono' style={{ color: 'var(--text-2)' }}>
                                        {i.number} · {i.app}
                                    </span>
                                    <span style={{ fontWeight: 600 }}>{f.eur(i.totalCents)}</span>
                                </div>
                            ))}
                        </div>
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                borderTop: '1px solid var(--border)',
                                marginTop: 11,
                                paddingTop: 11,
                                fontSize: 15
                            }}
                        >
                            <span style={{ fontWeight: 600 }}>{t('total')}</span>
                            <span style={{ fontWeight: 700 }}>{f.eur(total)}</span>
                        </div>
                    </div>
                    <div>
                        <div className='t-eyebrow' style={{ marginBottom: 9 }}>
                            {t('method')}
                        </div>
                        <div style={{ display: 'grid', gap: 8 }}>
                            {PAY_METHODS.map(([k, l, ic]) => (
                                <label
                                    key={k}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 11,
                                        padding: '11px 13px',
                                        border: '1px solid ' + (method === k ? 'var(--accent)' : 'var(--border)'),
                                        borderRadius: 'var(--r-md)',
                                        background: method === k ? 'var(--accent-tint)' : 'var(--surface)',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <input
                                        type='radio'
                                        name='paymethod'
                                        checked={method === k}
                                        onChange={() => setMethod(k)}
                                        style={{ accentColor: 'var(--accent)', width: 16, height: 16 }}
                                    />
                                    <Icon name={ic} size={16} style={{ color: 'var(--text-3)' }} />
                                    <span style={{ fontSize: 14, fontWeight: 500 }}>{t(l)}</span>
                                </label>
                            ))}
                        </div>
                        {method === 'qr' && (
                            <div
                                className='fade-in'
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 16,
                                    marginTop: 12,
                                    padding: 14,
                                    border: '1px solid var(--border)',
                                    borderRadius: 'var(--r-md)',
                                    background: 'var(--surface-2)'
                                }}
                            >
                                <QrCode value={`pasport-pay-${total}`} size={96} />
                                <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
                                    {t('qrText')} <strong style={{ color: 'var(--text)' }}>{f.eur(total)}</strong>.
                                </div>
                            </div>
                        )}
                    </div>
                    <p className='hint' style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Icon name='lock' size={13} /> {t('secure')}
                    </p>
                </div>
            </Modal>
        </div>
    )
}
