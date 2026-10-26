'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { APP_NAME, BRAND } from '@/lib/brand'
import { LocaleFloat, ThemeToggle } from './toast'
import { Icon } from './ui'

/** The left half of the login screens: the teal gradient with the eID card. */
function Aside({ title, text, eid }: { title: string; text: string; eid: boolean }) {
    const t = useTranslations('AuthScreen')
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

/**
 * The login, registration and account screens: brand panel left, the form right (the panel disappears on small
 * screens), with the floating theme and language buttons.
 */
export function AuthLayout({
    asideTitle,
    asideText,
    eid = true,
    children
}: {
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
                <Aside title={asideTitle ?? t('asideTitle')} text={asideText ?? t('asideText')} eid={eid} />
                <div className='auth-main'>
                    <div className='auth-card fade-in'>
                        <div className='auth-logo'>
                            <div className='brand-mark'>
                                <Icon name='shield' />
                            </div>
                            <div>
                                <div className='brand-name'>{BRAND}</div>
                                <div className='brand-sub'>{APP_NAME ?? shell('customerPortal')}</div>
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
