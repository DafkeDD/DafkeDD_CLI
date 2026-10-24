'use client'

/* The states of a page in the Pasport design: loading (shimmer), an error with retry, a centred notice, a redirect. */
import { useEffect } from 'react'
import { useRouter } from '@/i18n/navigation'
import { Btn, Icon, Skeleton } from './ui'
import { useTranslations } from 'next-intl'

/**
 * Sends the browser to another page of the app. Used instead of redirect() where the decision depends on the session:
 * a server redirect inside a layout breaks the instant-navigation validation of Next.js in development.
 */
export function ClientRedirect({ to }: { to: string }) {
    const router = useRouter()
    useEffect(() => {
        router.replace(to)
    }, [router, to])
    return null
}

/** Placeholder while a page loads its data: the design's shimmer. */
export function Loading({ rows = 3 }: { rows?: number }) {
    return (
        <div className='fade-in' style={{ display: 'grid', gap: 14 }} aria-busy='true'>
            <Skeleton h={28} w={260} />
            <Skeleton h={16} w={420} style={{ marginBottom: 12 }} />
            {Array.from({ length: rows }, (_, i) => (
                <Skeleton key={i} h={64} />
            ))}
        </div>
    )
}

/** The data could not be loaded: the message of the API and a retry button. */
export function LoadError({ message, onRetry }: { message?: string; onRetry?: () => void }) {
    const t = useTranslations('Shell')
    return (
        <div className='card card-pad fade-in' style={{ textAlign: 'center', padding: 46 }}>
            <Icon name='alert' size={28} style={{ color: 'var(--red)' }} />
            <h3 className='t-h3' style={{ marginTop: 12 }}>
                {t('loadFailed')}
            </h3>
            {message && <p style={{ marginTop: 6 }}>{message}</p>}
            {onRetry && (
                <Btn variant='secondary' size='sm' icon='refresh' style={{ marginTop: 16 }} onClick={onRetry}>
                    {t('retry')}
                </Btn>
            )}
        </div>
    )
}

/** A centred message instead of a page (no access, no organisation, …). */
export function Notice({ icon = 'lock', title, text }: { icon?: string; title: string; text?: string }) {
    return (
        <div className='fade-in' style={{ maxWidth: 560, margin: '80px auto 0', textAlign: 'center' }}>
            <div
                style={{
                    width: 68,
                    height: 68,
                    borderRadius: 18,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    display: 'grid',
                    placeItems: 'center',
                    margin: '0 auto 20px',
                    color: 'var(--text-3)'
                }}
            >
                <Icon name={icon} size={30} />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 650, letterSpacing: '-0.02em' }}>{title}</h2>
            {text && <p style={{ marginTop: 10, color: 'var(--text-2)', fontSize: 14.5, lineHeight: 1.6 }}>{text}</p>}
        </div>
    )
}
