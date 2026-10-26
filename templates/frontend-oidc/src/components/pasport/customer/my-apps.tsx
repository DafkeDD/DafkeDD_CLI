'use client'

import { useRouter } from '@/i18n/navigation'
import { type CatalogApp, daysUntil, environmentHost, useData } from '@/lib/portal'
import { useMe } from '../portal-shell'
import { useT } from '../i18n'
import { LoadError, Loading } from '../page-state'
import { AppIcon, Badge, Btn, Icon } from '../ui'

/**
 * The first page after logging in at the portal: the apps the user may open (an own licence or a running demo), to
 * click through. Logging in from an app goes straight back to that app; this page is for a login at the portal itself.
 */
export function MyApps() {
    const t = useT('MyApps')
    const router = useRouter()
    const me = useMe()
    const { data, error, loading, reload } = useData<CatalogApp[]>('tenants/current/catalog')

    if (loading && !data) return <Loading />
    if (error && !data) return <LoadError message={error.message} onRetry={() => void reload()} />
    const apps = (data ?? []).filter(a => a.access)
    const admin = me.tenant?.role === 'admin'
    const slug = me.slug ?? 'praktijk'

    return (
        <div className='fade-in'>
            <div className='page-head'>
                <div className='ph-text'>
                    <h1>{t('title')}</h1>
                    <p>{apps.length > 0 ? t('subtitle') : t('noneText')}</p>
                </div>
                <div className='page-actions'>
                    <Btn variant='ghost' icon='dashboard' onClick={() => router.push('/dashboard')}>
                        {t('toPortal')}
                    </Btn>
                </div>
            </div>

            {apps.length === 0 ? (
                <div className='card card-pad' style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ color: 'var(--text-3)' }}>
                            <Icon name='lock' size={20} />
                        </div>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{t('noneTitle')}</div>
                    </div>
                    <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.55 }}>
                        {admin ? t('noneAdmin') : t('noneMember')}
                    </p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Btn icon='compass' onClick={() => router.push('/marketplace')}>
                            {t('discover')}
                        </Btn>
                        {admin && (
                            <Btn variant='ghost' icon='users' onClick={() => router.push('/users')}>
                                {t('licences')}
                            </Btn>
                        )}
                    </div>
                </div>
            ) : (
                <div className='tile-grid'>
                    {apps.map(a => {
                        const demo = !a.owned && !!a.trialEndsAt
                        const content = (
                            <>
                                <div className='tile-head'>
                                    <AppIcon app={a} size={46} />
                                    {demo ? (
                                        <Badge tone='violet' icon='sparkles'>
                                            {t('demoDays', { count: Math.max(0, daysUntil(a.trialEndsAt ?? '')) })}
                                        </Badge>
                                    ) : (
                                        <Badge tone='green' icon='check'>
                                            {t('licence')}
                                        </Badge>
                                    )}
                                </div>
                                <div>
                                    <div className='tile-name'>{a.name}</div>
                                    <div className='tile-prac'>{environmentHost(a.launchUrl, slug)}</div>
                                </div>
                                <div className='tile-foot'>
                                    <span />
                                    {a.launchUrl ? (
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
                                            {t('open')} <Icon name='arrowRight' size={14} />
                                        </span>
                                    ) : (
                                        <span className='hint'>{t('noAddress')}</span>
                                    )}
                                </div>
                            </>
                        )
                        // In the same tab: the app is where the user wanted to go
                        return a.launchUrl ? (
                            <a
                                className='card card-hover tile'
                                key={a.code}
                                href={a.launchUrl}
                                style={{ color: 'inherit' }}
                            >
                                {content}
                            </a>
                        ) : (
                            <div className='card tile' key={a.code}>
                                {content}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
