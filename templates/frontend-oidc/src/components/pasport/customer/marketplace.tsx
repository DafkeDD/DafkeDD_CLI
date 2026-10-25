'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/i18n/navigation'
import { ApiFailure, type CatalogApp, daysUntil, useApi, useData, useFormat } from '@/lib/portal'
import { useMe } from '../shell'
import { useT } from '../i18n'
import { LoadError, Loading } from '../page-state'
import { useToast } from '../toast'
import { AppIcon, Badge, Btn, Icon, Input } from '../ui'

/** Opens the app in a new tab; without an address (not set in the catalogue yet) the button is greyed out. */
function OpenButton({
    url,
    label,
    missing,
    variant = 'primary'
}: {
    url: string | null
    label: string
    missing: string
    variant?: 'primary' | 'secondary'
}) {
    if (!url)
        return (
            <Btn size='sm' variant={variant} disabled title={missing}>
                {label} <Icon name='external' size={15} />
            </Btn>
        )
    return (
        <a className={`btn btn-${variant} btn-sm`} href={url} target='_blank' rel='noopener noreferrer'>
            {label} <Icon name='external' size={15} />
        </a>
    )
}

export function Marketplace() {
    const t = useT('Marketplace')
    const f = useFormat()
    const router = useRouter()
    const me = useMe()
    const admin = me.tenant?.role === 'admin'
    const params = useSearchParams()
    const [q, setQ] = useState(params.get('q') ?? '')
    const [cat, setCat] = useState<string | null>(null)
    const { data, error, loading, reload } = useData<CatalogApp[]>('tenants/current/catalog')
    const api = useApi()
    const push = useToast()
    const [asking, setAsking] = useState<string | null>(null)

    /** A demo for myself: a trial of 14 days, once per app. */
    const askDemo = async (app: CatalogApp) => {
        setAsking(app.code)
        try {
            const demo = await api<{ endsAt: string }>(`me/licenses/${encodeURIComponent(app.code)}/trial`, 'POST')
            push(t('demoStarted', { app: app.name, date: f.date(demo.endsAt) }), 'sparkles', 'green')
            await reload()
        } catch (e) {
            push(e instanceof ApiFailure ? e.message : t('demoFailed'), 'alert', 'red')
        } finally {
            setAsking(null)
        }
    }

    if (loading && !data) return <Loading />
    if (error && !data) return <LoadError message={error.message} onRetry={() => void reload()} />
    const apps = data ?? []
    const cats = Array.from(new Set(apps.map(a => a.category).filter(Boolean)))
    const query = q.toLowerCase()
    const list = apps.filter(
        a =>
            (cat === null || a.category === cat) &&
            (a.name.toLowerCase().includes(query) || (a.short || a.description).toLowerCase().includes(query))
    )

    return (
        <div className='fade-in'>
            <div className='page-head'>
                <div className='ph-text'>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
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
                    <button type='button' className={cat === null ? 'active' : ''} onClick={() => setCat(null)}>
                        {t('all')}
                    </button>
                    {cats.map(c => (
                        <button type='button' key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>
                            {c}
                        </button>
                    ))}
                </div>
            </div>
            {list.length === 0 && (
                <div className='card card-pad' style={{ textAlign: 'center', padding: 50 }}>
                    <Icon name='search' size={28} style={{ color: 'var(--text-3)' }} />
                    <h3 className='t-h3' style={{ marginTop: 12 }}>
                        {t('nothingFound')}
                    </h3>
                </div>
            )}
            <div className='market-grid'>
                {list.map((a, idx) => (
                    <div
                        className='card card-hover market-card'
                        key={a.code}
                        style={{ animationDelay: `${idx * 45}ms` }}
                    >
                        <div className='market-top'>
                            <AppIcon app={a} size={52} />
                            <div className='market-info'>
                                <div className='market-name'>{a.name}</div>
                                <div className='market-cat'>{a.category}</div>
                            </div>
                            {a.owned ? (
                                <Badge tone='green' icon='check'>
                                    {t('opened')}
                                </Badge>
                            ) : (
                                <div className='market-price'>
                                    <span className='price'>
                                        {f.eur(a.priceMonthCents)}
                                        <small> {t('perMonth')}</small>
                                    </span>
                                    {a.trialEndsAt && (
                                        <Badge tone='violet' icon='sparkles'>
                                            {t('demoDays', { count: Math.max(0, daysUntil(a.trialEndsAt)) })}
                                        </Badge>
                                    )}
                                </div>
                            )}
                        </div>
                        <p className='market-desc'>{a.short || a.description}</p>
                        {a.owned ? (
                            <div className='market-foot'>
                                <span className='price'>
                                    <span style={{ fontSize: 14, color: 'var(--text-3)', fontWeight: 600 }}>
                                        {t('active')}
                                    </span>
                                </span>
                                {/* Bought, but opening needs a licence of my own (like the dashboard) */}
                                {a.access ? (
                                    <OpenButton url={a.launchUrl} label={t('open')} missing={t('noAddress')} />
                                ) : admin ? (
                                    <Btn
                                        size='sm'
                                        variant='secondary'
                                        icon='users'
                                        onClick={() => router.push('/users')}
                                    >
                                        {t('manageSeats')}
                                    </Btn>
                                ) : (
                                    <Btn size='sm' variant='primary' disabled title={t('askAdmin')}>
                                        {t('open')} <Icon name='external' size={15} />
                                    </Btn>
                                )}
                            </div>
                        ) : (
                            // The demo on the left, the purchase on the right
                            <div className='market-foot'>
                                <div
                                    style={{ display: 'flex', gap: 8, justifyContent: 'space-between', width: '100%' }}
                                >
                                    {/* My demo runs: open it here, buying stays possible on the right */}
                                    {a.access ? (
                                        <OpenButton
                                            url={a.launchUrl}
                                            label={t('openDemo')}
                                            missing={t('noAddress')}
                                            variant='secondary'
                                        />
                                    ) : a.trialAvailable ? (
                                        <Btn
                                            size='sm'
                                            variant='secondary'
                                            icon='sparkles'
                                            disabled={asking === a.code}
                                            onClick={() => void askDemo(a)}
                                        >
                                            {t('askDemo')}
                                        </Btn>
                                    ) : (
                                        <span />
                                    )}
                                    <Btn
                                        size='sm'
                                        variant='primary'
                                        icon='plus'
                                        disabled={!admin}
                                        title={admin ? undefined : t('adminOnly')}
                                        onClick={() => router.push(`/wizard?app=${encodeURIComponent(a.code)}`)}
                                    >
                                        {t('buy')}
                                    </Btn>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}
