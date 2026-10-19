'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { AUTH, AUTH_TEXT, AUTH_TITLE, BUTTON } from '@/components/account-ui'
import { Icon } from '@/components/ui'

/**
 * /login without a login request: starts one at once (to the login screen of the login server), so every app shows
 * the same login. With ?error= it stays here and says why the last login failed, with a button to try again.
 */
export function StartLogin({ error, returnTo }: { error?: string; returnTo?: string }) {
    const t = useTranslations('Oidc')
    // A GET form, not a link: /api/auth/login is a route handler that needs a full page load
    const form = useRef<HTMLFormElement>(null)
    useEffect(() => {
        if (!error) form.current?.requestSubmit()
    }, [error])
    return (
        <section className={AUTH}>
            <h1 className={AUTH_TITLE}>{t('loginTitle')}</h1>
            {error ? (
                <div role='alert' className='text-sm text-[var(--red)]'>
                    {error === 'offline' ? t('offline') : t('failed', { error })}
                </div>
            ) : (
                <p className={AUTH_TEXT + ' flex items-center gap-2'}>
                    <Icon name='loader' size={16} className='animate-spin' /> {t('busy')}
                </p>
            )}
            <form ref={form} action='/api/auth/login' method='get' className='flex flex-col'>
                {returnTo && <input type='hidden' name='returnTo' value={returnTo} />}
                <button type='submit' className={BUTTON}>
                    {error ? t('startAgain') : t('signIn')}
                </button>
            </form>
        </section>
    )
}
