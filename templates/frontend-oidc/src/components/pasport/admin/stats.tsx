'use client'

import { useState } from 'react'
import { type Stats, useData, useFormat } from '@/lib/portal'
import { useT } from '../i18n'
import { LoadError, Loading } from '../page-state'
import { appColor, Icon, Select } from '../ui'
import { BarChart, Donut, LineChart, Sparkline } from '../widgets'

const OTHER_COLOR = '#94a3b8'

export function AdminStats() {
    const t = useT('Stats')
    const f = useFormat()
    const [range, setRange] = useState('6m')
    const { data, error, loading, reload } = useData<Stats>(`admin/stats?range=${range}`)

    if (loading && !data) return <Loading />
    if (error && !data) return <LoadError message={error.message} onRetry={() => void reload()} />
    if (!data) return <Loading />

    const labels = data.months.map(f.month)
    const kpis = [
        {
            key: 'tenants',
            icon: 'building',
            color: 'var(--accent)',
            value: f.number(data.kpis.tenants.value),
            k: data.kpis.tenants
        },
        {
            key: 'activeUsers',
            icon: 'users',
            color: 'var(--blue)',
            value: f.number(data.kpis.activeUsers.value),
            k: data.kpis.activeUsers
        },
        {
            key: 'purchasedApps',
            icon: 'box',
            color: 'var(--violet)',
            value: f.number(data.kpis.purchasedApps.value),
            k: data.kpis.purchasedApps
        },
        {
            key: 'revenue',
            icon: 'euro',
            color: 'var(--green)',
            value: f.eur(data.kpis.revenueMonthCents.value),
            k: data.kpis.revenueMonthCents
        }
    ]
    const segments = data.appBreakdown.map(s => ({
        label: s.code === 'other' ? t('other') : s.name,
        value: s.count,
        color: s.code === 'other' ? OTHER_COLOR : appColor(s)
    }))
    const euros = (cents: number) => Math.round(cents / 100)

    return (
        <div className='fade-in'>
            <div className='page-head'>
                <div className='ph-text'>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>
                <div className='page-actions'>
                    <Select
                        className='select'
                        style={{ width: 170 }}
                        value={range}
                        onChange={e => setRange(e.target.value)}
                        ariaLabel={t('period')}
                    >
                        <option value='6m'>{t('range6m')}</option>
                        <option value='year'>{t('rangeYear')}</option>
                        <option value='all'>{t('rangeAll')}</option>
                    </Select>
                </div>
            </div>

            <div className='kpi-grid' style={{ marginBottom: 18 }}>
                {kpis.map(({ key, icon, color, value, k }) => {
                    const up = k.deltaPct >= 0
                    return (
                        <div className='card kpi' key={key}>
                            <div className='kpi-top'>
                                <div
                                    className='kpi-icon'
                                    style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
                                >
                                    <Icon name={icon} size={18} />
                                </div>
                                <Sparkline data={k.spark} color={color} w={66} h={28} />
                            </div>
                            <div className='kpi-value'>{value}</div>
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    marginTop: 6
                                }}
                            >
                                <span className='kpi-label'>{t('kpi_' + key)}</span>
                                <span className={'kpi-delta ' + (up ? 'up' : 'down')} style={{ marginTop: 0 }}>
                                    <Icon name='chart' size={12} /> {(up ? '+' : '') + Math.round(k.deltaPct)}%
                                </span>
                            </div>
                        </div>
                    )
                })}
            </div>

            <div className='stats-row-a'>
                <div className='card card-pad'>
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 18,
                            gap: 12
                        }}
                    >
                        <div>
                            <div className='t-h3'>{t('revenue')}</div>
                            <div className='hint'>{t('revenueHint')}</div>
                        </div>
                        <div className='legend'>
                            <span className='legend-item'>
                                <span className='legend-swatch' style={{ background: 'var(--accent)' }} />{' '}
                                {t('revenueLegend')}
                            </span>
                        </div>
                    </div>
                    <LineChart
                        series={[{ data: data.revenueCents.map(euros), color: 'var(--accent)' }]}
                        labels={labels}
                        h={220}
                    />
                </div>
                <div className='card card-pad'>
                    <div className='t-h3' style={{ marginBottom: 4 }}>
                        {t('appsTitle')}
                    </div>
                    <div className='hint' style={{ marginBottom: 14 }}>
                        {t('appsHint')}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                        <Donut segments={segments} size={140} totalLabel={t('total')} />
                        <div className='legend' style={{ flexDirection: 'column', gap: 9 }}>
                            {segments.map(s => (
                                <span className='legend-item' key={s.label}>
                                    <span className='legend-swatch' style={{ background: s.color }} /> {s.label}{' '}
                                    <span style={{ color: 'var(--text-3)', marginLeft: 2 }}>{s.value}</span>
                                </span>
                            ))}
                            {segments.length === 0 && <span className='hint'>{t('noApps')}</span>}
                        </div>
                    </div>
                </div>
            </div>

            <div className='stats-row-b'>
                <div className='card card-pad'>
                    <div className='t-h3' style={{ marginBottom: 4 }}>
                        {t('signups')}
                    </div>
                    <div className='hint' style={{ marginBottom: 18 }}>
                        {t('signupsHint')}
                    </div>
                    <BarChart data={data.signups} labels={labels} color='var(--blue)' h={150} />
                </div>
                <div className='card card-pad'>
                    <div className='t-h3' style={{ marginBottom: 4 }}>
                        {t('codes')}
                    </div>
                    <div className='hint' style={{ marginBottom: 18 }}>
                        {t('codesHint')}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                        <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.03em' }}>
                            {f.number(data.codesRedeemedTotal)}
                        </span>
                        <span className='kpi-delta up'>
                            <Icon name='ticket' size={13} /> {t('overCodes', { count: data.codesTotal })}
                        </span>
                    </div>
                    {data.codes.length > 0 && (
                        <BarChart
                            data={data.codes.map(c => c.redemptions)}
                            labels={data.codes.map(c => c.code.slice(0, 6))}
                            color='var(--violet)'
                            h={110}
                        />
                    )}
                </div>
            </div>
        </div>
    )
}
