'use client'

import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import {
    ApiFailure,
    type CatalogApp,
    daysUntil,
    environmentHost,
    useApi,
    useData,
    useFormat,
    type VaultState
} from '@/lib/portal'
import { useMe } from '../portal-shell'
import { useT } from '../i18n'
import { LoadError, Loading } from '../page-state'
import { useToast } from '../toast'
import { AppIcon, Badge, Btn, Icon } from '../ui'

function VaultWidget() {
    const t = useT('Dashboard')
    const router = useRouter()
    const { data } = useData<VaultState>('me/vault')
    const cert = data?.cert ?? null
    const hasCert = !!cert
    return (
        <div
            className='card card-hover vault-widget'
            role='link'
            tabIndex={0}
            onClick={() => router.push('/vault')}
            onKeyDown={e => e.key === 'Enter' && router.push('/vault')}
            style={hasCert ? { borderColor: 'var(--accent-border)' } : undefined}
        >
            <div
                style={{
                    width: 42,
                    height: 42,
                    borderRadius: 11,
                    background: hasCert ? 'var(--accent-tint)' : 'var(--surface-2)',
                    color: hasCert ? 'var(--accent)' : 'var(--text-3)',
                    display: 'grid',
                    placeItems: 'center',
                    flex: 'none'
                }}
            >
                <Icon name='vault' size={20} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14.5 }}>{t('vaultCert')}</div>
                {hasCert ? (
                    <div
                        className='t-mono t-muted'
                        style={{
                            fontSize: 11.5,
                            marginTop: 2,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                        }}
                    >
                        {cert.thumbprint ? cert.thumbprint.slice(0, 29) + '…' : cert.filename}
                    </div>
                ) : (
                    <div className='t-muted' style={{ fontSize: 13, marginTop: 2 }}>
                        {t('vaultNone')}
                    </div>
                )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
                {hasCert ? (
                    <Badge tone='green' dot>
                        {t('active')}
                    </Badge>
                ) : (
                    <Badge tone='amber' dot>
                        {t('required')}
                    </Badge>
                )}
                <Icon name='arrowRight' size={15} style={{ color: 'var(--text-3)' }} />
            </div>
        </div>
    )
}

function greeting(t: ReturnType<typeof useT>, name: string) {
    const h = new Date().getHours()
    return h < 12 ? t('morning', { name }) : h < 18 ? t('afternoon', { name }) : t('evening', { name })
}

export function Dashboard() {
    const t = useT('Dashboard')
    const f = useFormat()
    const router = useRouter()
    const me = useMe()
    const { data: catalog, error, loading, reload } = useData<CatalogApp[]>('tenants/current/catalog')
    const api = useApi()
    const push = useToast()
    const admin = me.tenant?.role === 'admin'
    const [taking, setTaking] = useState<string | null>(null)

    /** The admin takes one of the bought seats for themselves. */
    const takeSeat = async (app: CatalogApp) => {
        setTaking(app.code)
        try {
            await api(`tenants/current/licenses/${encodeURIComponent(app.code)}/seat`, 'POST')
            push(t('seatTaken', { app: app.name }), 'check', 'green')
            await reload()
        } catch (e) {
            push(e instanceof ApiFailure ? e.message : t('seatFailed'), 'alert', 'red')
        } finally {
            setTaking(null)
        }
    }
    const slug = me.slug ?? 'praktijk'
    const firstName = me.firstName || me.name.split(' ')[0]

    if (loading && !catalog) return <Loading />
    if (error && !catalog) return <LoadError message={error.message} onRetry={() => void reload()} />
    const apps = catalog ?? []
    // The apps of the organisation, and the ones I try (a demo)
    const owned = apps.filter(a => a.owned || a.trialEndsAt)

    return (
        <div className='fade-in'>
            <div className='page-head'>
                <div className='ph-text'>
                    <h1>{greeting(t, firstName)} 👋</h1>
                    <p>{t('activeEnvironments', { count: owned.length, practice: me.tenant?.name ?? '' })}</p>
                </div>
                <div className='page-actions'>
                    <Btn icon='plus' onClick={() => router.push('/marketplace')}>
                        {t('addApp')}
                    </Btn>
                </div>
            </div>

            <div className='t-eyebrow' style={{ marginBottom: 14 }}>
                {t('yourApps')}
            </div>
            <div className='tile-grid'>
                {owned.map(a => {
                    const demo = !a.owned && !!a.trialEndsAt
                    // The label: the licences of the organisation (or the days of my demo)
                    const label = demo ? (
                        <Badge tone='violet' icon='sparkles'>
                            {t('demoDays', { count: Math.max(0, daysUntil(a.trialEndsAt ?? '')) })}
                        </Badge>
                    ) : a.seatsTotal > 0 ? (
                        <Badge
                            tone={a.access ? 'green' : 'accent'}
                            icon='users'
                            title={t('seats', { used: a.seatsUsed, total: a.seatsTotal })}
                        >
                            <span className='seat-count'>
                                {a.seatsUsed} <span>/</span> {a.seatsTotal}
                            </span>
                        </Badge>
                    ) : (
                        <Badge tone='amber' icon='lock'>
                            {t('noLicense')}
                        </Badge>
                    )
                    const head = (
                        <>
                            <div className='tile-head'>
                                <AppIcon app={a} size={46} />
                                {label}
                            </div>
                            <div>
                                <div className='tile-name'>{a.name}</div>
                                <div className='tile-prac'>{environmentHost(a.launchUrl, slug)}</div>
                            </div>
                        </>
                    )
                    // Left in the foot: what I can do about my licence
                    const action =
                        demo && admin ? (
                            <button
                                type='button'
                                className='link-btn'
                                onClick={e => {
                                    e.preventDefault()
                                    router.push(`/wizard?app=${encodeURIComponent(a.code)}`)
                                }}
                            >
                                {t('buyNow')} <Icon name='arrowRight' size={13} />
                            </button>
                        ) : a.access ? (
                            <span />
                        ) : admin && a.seatsTotal > a.seatsUsed ? (
                            <button
                                type='button'
                                className='link-btn'
                                disabled={taking === a.code}
                                onClick={() => void takeSeat(a)}
                            >
                                {t('takeSeat')} <Icon name='arrowRight' size={13} />
                            </button>
                        ) : admin ? (
                            <button type='button' className='link-btn' onClick={() => router.push('/users')}>
                                {t('manageSeats')} <Icon name='arrowRight' size={13} />
                            </button>
                        ) : (
                            <span className='hint'>{t('askAdmin')}</span>
                        )
                    if (!a.access)
                        return (
                            <div className='card tile' key={a.code}>
                                {head}
                                <div className='tile-foot'>{action}</div>
                            </div>
                        )
                    return (
                        <a
                            className='card card-hover tile'
                            key={a.code}
                            href={a.launchUrl ?? undefined}
                            target='_blank'
                            rel='noopener noreferrer'
                            style={{ color: 'inherit' }}
                            aria-disabled={!a.launchUrl}
                        >
                            {head}
                            <div className='tile-foot'>
                                {action}
                                {a.launchUrl && (
                                    <span
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 5,
                                            color: 'var(--accent)',
                                            fontWeight: 600,
                                            fontSize: 13
                                        }}
                                    >
                                        {t('open')} <Icon name='external' size={14} />
                                    </span>
                                )}
                            </div>
                        </a>
                    )
                })}
                <button type='button' className='tile-add' onClick={() => router.push('/marketplace')}>
                    <Icon name='plus' size={22} />
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{t('discoverMore')}</span>
                </button>
            </div>

            {me.doctor && (
                <>
                    <div className='t-eyebrow' style={{ margin: '34px 0 14px' }}>
                        {t('vault')}
                    </div>
                    <VaultWidget />
                </>
            )}

            {apps.some(a => !a.owned) && (
                <>
                    <div className='t-eyebrow' style={{ margin: '34px 0 14px' }}>
                        {t('recommended')}
                    </div>
                    <div className='market-grid'>
                        {apps
                            .filter(a => !a.owned)
                            .slice(0, 3)
                            .map(a => (
                                <div
                                    className='card card-hover market-card'
                                    key={a.code}
                                    role='link'
                                    tabIndex={0}
                                    onClick={() => router.push(`/wizard?app=${encodeURIComponent(a.code)}`)}
                                    onKeyDown={e =>
                                        e.key === 'Enter' && router.push(`/wizard?app=${encodeURIComponent(a.code)}`)
                                    }
                                >
                                    <div className='market-top'>
                                        <AppIcon app={a} size={48} />
                                        <div className='market-info'>
                                            <div className='market-name'>{a.name}</div>
                                            <div className='market-cat'>{a.category}</div>
                                        </div>
                                    </div>
                                    <p className='market-desc'>{a.short || a.description}</p>
                                    <div className='market-foot'>
                                        <span className='price'>
                                            {f.eur(a.priceMonthCents)}
                                            <small> {t('perMonth')}</small>
                                        </span>
                                        <Btn size='sm' variant='secondary' iconRight='arrowRight'>
                                            {t('view')}
                                        </Btn>
                                    </div>
                                </div>
                            ))}
                    </div>
                </>
            )}
        </div>
    )
}
