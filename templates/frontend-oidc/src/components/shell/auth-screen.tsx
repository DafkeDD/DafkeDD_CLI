'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AuthLayout, Icon, ThemeToggle } from '@/components/ui'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { APP_NAME, BRAND } from '@/lib/brand'
import { BrandMark } from './shell-view'

/**
 * The login screen of the Pasport design, the same in every app: the teal panel with the eID card on the left, the
 * form on the right (the panel disappears on small screens). Login, registration, password and invitation pages
 * all use it; `admin` gives the dark variant of the superadmin login.
 */
export function AuthPage({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
    const t = useTranslations('Shell')
    return (
        <>
            <AuthLayout asideTone={admin ? 'ink' : 'accent'} aside={<Aside admin={admin} />}>
                <div className='lui-auth-card'>
                    <div className='lui-auth-brand'>
                        <BrandMark />
                        <span className='flex flex-col'>
                            <strong className='text-[16.5px] tracking-tight'>{BRAND}</strong>
                            <span className='text-xs text-[var(--text-3)]'>
                                {admin ? t('superadmin') : (APP_NAME ?? t('account'))}
                            </span>
                        </span>
                    </div>
                    {children}
                </div>
            </AuthLayout>
            <div className='fixed top-4 right-4 z-20 flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--sh-md)]'>
                <LocaleSwitcher />
                <ThemeToggle size='sm' aria-label={t('theme')} />
            </div>
        </>
    )
}

function Aside({ admin }: { admin: boolean }) {
    const t = useTranslations('Shell')
    return (
        <>
            <div className='flex items-center gap-3'>
                <span className='grid size-10 place-items-center rounded-[var(--r-md)] bg-white/15'>
                    <Icon name='shield' size={22} />
                </span>
                <strong className='text-[16.5px] tracking-tight'>{BRAND}</strong>
            </div>
            <div className='max-w-[380px]'>
                {!admin && (
                    <div
                        aria-hidden='true'
                        className='flex aspect-[1.585] flex-col justify-between rounded-[var(--r-lg)] border border-white/30 bg-gradient-to-br from-white/20 to-white/5 p-5 shadow-[0_20px_50px_rgba(0,0,0,.25)]'
                    >
                        <div className='flex items-start justify-between'>
                            <span className='h-8 w-[42px] rounded-md bg-gradient-to-br from-[#fde68a] to-[#d4a017]' />
                            <span className='text-[11px] tracking-[.1em] opacity-80'>BELGIË · BELGIQUE</span>
                        </div>
                        <div>
                            <div className='text-[11px] opacity-70'>{t('idCard')}</div>
                            <div className='mt-0.5 text-[17px] font-semibold'>{t('cardName')}</div>
                            <div className='mt-1 font-mono text-xs opacity-85'>••.••.••-•••.••</div>
                        </div>
                    </div>
                )}
                {/* Spacing with gap: the DafkeDD UI base styles reset the margins of headings and paragraphs */}
                <div className={'flex flex-col gap-2.5' + (admin ? '' : ' pt-7')}>
                    <h2 className='text-2xl tracking-tight' style={{ color: 'inherit' }}>
                        {admin ? t('adminTitle') : t('asideTitle')}
                    </h2>
                    <p className='text-[14.5px] opacity-80' style={{ color: 'inherit' }}>
                        {admin ? t('adminText') : t('asideText')}
                    </p>
                </div>
            </div>
            <div className='flex gap-5 text-[12.5px] opacity-75'>
                <span className='flex items-center gap-1.5'>
                    <Icon name='lock' size={14} /> {t('encrypted')}
                </span>
                <span className='flex items-center gap-1.5'>
                    <Icon name='check' size={14} /> {t('gdpr')}
                </span>
            </div>
        </>
    )
}
