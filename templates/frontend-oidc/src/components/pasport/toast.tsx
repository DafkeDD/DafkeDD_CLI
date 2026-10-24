'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { useLocale } from 'next-intl'
import { useTheme } from '@/components/ui'
import { usePathname, useRouter } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'
import { Icon } from './ui'

/* ============================ TOASTS ============================ */
export type ToastTone = 'accent' | 'green' | 'red' | 'neutral' | 'blue' | 'violet' | 'amber'
type Toast = { id: number; msg: string; icon: string; tone: ToastTone; onClick?: () => void }
/** A toast; with onClick it is a button (e.g. open the ticket) and stays a little longer. */
type Push = (msg: string, icon?: string, tone?: ToastTone, onClick?: () => void) => void

const ToastContext = createContext<Push | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([])
    const close = useCallback((id: number) => setToasts(t => t.filter(x => x.id !== id)), [])
    const push = useCallback<Push>(
        (msg, icon = 'check', tone = 'accent', onClick) => {
            const id = Date.now() + Math.random()
            setToasts(t => [...t, { id, msg, icon, tone, onClick }])
            setTimeout(() => close(id), onClick ? 8000 : 3200)
        },
        [close]
    )
    const bg = (tone: ToastTone) =>
        tone === 'accent'
            ? 'var(--accent-tint)'
            : tone === 'green' || tone === 'red' || tone === 'amber'
              ? `var(--${tone}-tint)`
              : 'var(--surface-3)'
    const fg = (tone: ToastTone) =>
        tone === 'accent' ? 'var(--accent)' : tone === 'neutral' ? 'var(--text-3)' : `var(--${tone})`
    return (
        <ToastContext.Provider value={push}>
            {children}
            <div className='toast-wrap' aria-live='polite'>
                {toasts.map(t => {
                    const body = (
                        <>
                            <span className='toast-ic' style={{ background: bg(t.tone), color: fg(t.tone) }}>
                                <Icon name={t.icon} size={15} />
                            </span>
                            {t.msg}
                        </>
                    )
                    return t.onClick ? (
                        <button
                            type='button'
                            className='toast toast-link'
                            key={t.id}
                            onClick={() => {
                                close(t.id)
                                t.onClick?.()
                            }}
                        >
                            {body}
                            <Icon name='chevronRight' size={15} className='toast-go' />
                        </button>
                    ) : (
                        <div className='toast' key={t.id}>
                            {body}
                        </div>
                    )
                })}
            </div>
        </ToastContext.Provider>
    )
}

export function useToast(): Push {
    const push = useContext(ToastContext)
    if (!push) throw new Error('useToast must be used within ToastProvider')
    return push
}

/* ============================ THEME ============================ */
/** The moon/sun button of the design; the choice is kept by the existing ThemeProvider (localStorage lui-theme). */
export function ThemeToggle({ floating, label }: { floating?: boolean; label: string }) {
    const { resolved, setTheme } = useTheme()
    return (
        <button
            type='button'
            className={'btn btn-ghost btn-icon btn-sm' + (floating ? ' theme-float' : '')}
            onClick={() => setTheme(resolved === 'light' ? 'dark' : 'light')}
            title={label}
            aria-label={label}
        >
            <Icon name={resolved === 'light' ? 'moon' : 'sun'} size={17} />
        </button>
    )
}

/* ============================ LANGUAGE ============================ */
/** Switches the language of the page (cookie NEXT_LOCALE, no locale in the URL). */
export function useSwitchLocale() {
    const router = useRouter()
    const pathname = usePathname()
    return (locale: string) => {
        const search = typeof window !== 'undefined' ? window.location.search : ''
        router.replace(pathname + search, { locale })
    }
}

/** The language choice next to the floating theme button on the login and registration screens. */
export function LocaleFloat({ label }: { label: string }) {
    const locale = useLocale()
    const switchLocale = useSwitchLocale()
    return (
        <div className='locale-float' role='group' aria-label={label}>
            {routing.locales.map(l => (
                <button
                    key={l}
                    type='button'
                    className={l === locale ? 'active' : ''}
                    aria-pressed={l === locale}
                    onClick={() => switchLocale(l)}
                >
                    {l}
                </button>
            ))}
        </div>
    )
}
