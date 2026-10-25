'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { APP_NAME, BRAND } from '@/lib/brand'
import { LocaleFloat, ThemeToggle } from './toast'
import { Icon } from './ui'

/** The left half of the login screens: the teal gradient with the eID card (customer) or the dark one (superadmin). */
function Aside({
    variant,
    title,
    text,
    eid
}: {
    variant: 'customer' | 'admin'
    title: string
    text: string
    eid: boolean
}) {
    const t = useTranslations('AuthScreen')
    if (variant === 'admin')
        return (
            <div className='auth-aside admin'>
                <div className='auth-aside-deco' />
                <div className='auth-grid-lines' />
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11 }}>
                    <div className='brand-mark' style={{ background: 'rgba(255,255,255,.14)' }}>
                        <Icon name='shield' />
                    </div>
                    <div className='brand-name' style={{ color: '#fff' }}>
                        {BRAND}
                    </div>
                </div>
                <div style={{ position: 'relative', maxWidth: 400 }}>
                    <span className='badge badge-neutral'>
                        <Icon name='lock' size={12} />
                        <span style={{ color: 'var(--text-2)' }}>{t('adminArea')}</span>
                    </span>
                    <h2
                        style={{
                            color: '#fff',
                            fontSize: 27,
                            marginTop: 18,
                            letterSpacing: '-0.025em',
                            lineHeight: 1.2
                        }}
                    >
                        {title}
                    </h2>
                    <p style={{ color: 'rgba(255,255,255,.7)', marginTop: 12, fontSize: 14.5 }}>{text}</p>
                    <div style={{ display: 'grid', gap: 12, marginTop: 28 }}>
                        {(
                            [
                                ['building', t('adminPoint1')],
                                ['box', t('adminPoint2')],
                                ['ticket', t('adminPoint3')]
                            ] as const
                        ).map(([ic, label]) => (
                            <div
                                key={label}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    color: 'rgba(255,255,255,.85)',
                                    fontSize: 14
                                }}
                            >
                                <span
                                    style={{
                                        width: 32,
                                        height: 32,
                                        borderRadius: 8,
                                        background: 'rgba(255,255,255,.1)',
                                        display: 'grid',
                                        placeItems: 'center'
                                    }}
                                >
                                    <Icon name={ic} size={16} />
                                </span>
                                {label}
                            </div>
                        ))}
                    </div>
                </div>
                <div style={{ position: 'relative', color: 'rgba(255,255,255,.5)', fontSize: 12 }}>
                    {t('adminFooter')}
                </div>
            </div>
        )
    return (
        <div className='auth-aside'>
            <div className='auth-aside-deco' />
            <div className='auth-grid-lines' />
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11 }}>
                <div
                    className='brand-mark'
                    style={{ background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(4px)' }}
                >
                    <Icon name='shield' />
                </div>
                <div className='brand-name' style={{ color: '#fff' }}>
                    {BRAND}
                </div>
            </div>
            <div style={{ position: 'relative', maxWidth: 380 }}>
                {eid && (
                    <div className='eid-card-visual' aria-hidden='true'>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div className='eid-chip' />
                            <span style={{ fontSize: 11, letterSpacing: '.1em', opacity: 0.8 }}>BELGIË · BELGIQUE</span>
                        </div>
                        <div>
                            <div style={{ fontSize: 11, opacity: 0.7 }}>{t('idCard')}</div>
                            <div style={{ fontSize: 17, fontWeight: 650, marginTop: 2 }}>{t('cardName')}</div>
                            <div className='t-mono' style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                                ••.••.••-•••.••
                            </div>
                        </div>
                    </div>
                )}
                <h2 style={{ color: '#fff', fontSize: 24, marginTop: eid ? 30 : 0, letterSpacing: '-0.02em' }}>
                    {title}
                </h2>
                <p style={{ color: 'rgba(255,255,255,.78)', marginTop: 10, fontSize: 14.5 }}>{text}</p>
            </div>
            <div
                style={{
                    position: 'relative',
                    display: 'flex',
                    gap: 18,
                    color: 'rgba(255,255,255,.7)',
                    fontSize: 12.5
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name='lock' size={14} /> {t('encrypted')}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name='shieldCheck' size={14} /> {t('gdpr')}
                </span>
            </div>
        </div>
    )
}

/** The superadmin variant of the login screen is chosen by /admin/login (a short-lived cookie, pp-login-ui). */
export function loginVariant(): 'customer' | 'admin' {
    if (typeof document === 'undefined') return 'customer'
    return document.cookie.split('; ').includes('pp-login-ui=admin') ? 'admin' : 'customer'
}

/**
 * The login, registration and account screens: brand panel left, the form right (the panel disappears on small
 * screens), with the floating theme and language buttons.
 */
export function AuthLayout({
    variant = 'customer',
    asideTitle,
    asideText,
    eid = true,
    children
}: {
    variant?: 'customer' | 'admin'
    asideTitle?: string
    asideText?: string
    /** The eID card in the panel (the login server); a project with its own login shows only the text. */
    eid?: boolean
    children: ReactNode
}) {
    const t = useTranslations('AuthScreen')
    const shell = useTranslations('Shell')
    return (
        <>
            <div className='auth-wrap'>
                <Aside
                    variant={variant}
                    title={asideTitle ?? (variant === 'admin' ? t('adminTitle') : t('asideTitle'))}
                    text={asideText ?? (variant === 'admin' ? t('adminText') : t('asideText'))}
                    eid={eid}
                />
                <div className='auth-main'>
                    <div className='auth-card fade-in'>
                        <div className='auth-logo'>
                            <div
                                className='brand-mark'
                                style={
                                    variant === 'admin'
                                        ? { background: 'var(--text)', color: 'var(--surface)' }
                                        : undefined
                                }
                            >
                                <Icon name='shield' />
                            </div>
                            <div>
                                <div className='brand-name'>{BRAND}</div>
                                <div className='brand-sub'>
                                    {variant === 'admin' ? shell('superadmin') : (APP_NAME ?? shell('customerPortal'))}
                                </div>
                            </div>
                        </div>
                        {children}
                    </div>
                </div>
            </div>
            <ThemeToggle floating label={shell('theme')} />
            <LocaleFloat label={shell('language')} />
        </>
    )
}

/** The design's three-part progress bar above a multi-step form. */
export function StepBar({ labels, index }: { labels: string[]; index: number }) {
    return (
        <div style={{ display: 'flex', gap: 6, marginBottom: 26 }}>
            {labels.map((s, i) => (
                <div key={s} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div
                        style={{
                            height: 3,
                            borderRadius: 2,
                            background: i <= index ? 'var(--accent)' : 'var(--border)',
                            transition: 'background .3s'
                        }}
                    />
                    <span
                        style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: i === index ? 'var(--accent)' : i < index ? 'var(--text-2)' : 'var(--text-3)'
                        }}
                    >
                        {s}
                    </span>
                </div>
            ))}
        </div>
    )
}

/** The "or" line between two ways ("Nog geen account?"). */
export function Divider({ label }: { label: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: 12.5, color: 'var(--text-3)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {label}
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>
    )
}

/** The heading of an auth screen: the design's 23px title with the explanation under it. */
export function AuthHeading({ title, text }: { title: string; text?: ReactNode }) {
    return (
        <>
            <h1 className='t-h1' style={{ fontSize: 23 }}>
                {title}
            </h1>
            {text && <p style={{ marginTop: 7, marginBottom: 26 }}>{text}</p>}
            {!text && <div style={{ height: 22 }} />}
        </>
    )
}
