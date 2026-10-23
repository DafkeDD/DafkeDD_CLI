'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { AUTH, AUTH_TEXT, AUTH_TITLE, BUTTON } from '@/components/account-ui'

/** How long a login that came back without a session stops the next automatic one (no endless loop). */
const RETRY_MS = 15_000
const KEY = 'login-redirect'

/**
 * A page of a linked app without a login (any more): starts a login at the login server that comes back to this page.
 * When the last automatic login came back without a session a moment ago (cookies blocked, for example), it says so
 * and waits for the button instead of trying again and again.
 */
export function LoginRedirect() {
    const t = useTranslations('Oidc')
    // A GET form, not a link: /api/auth/login is a route handler that needs a full page load
    const form = useRef<HTMLFormElement>(null)
    const returnTo = useRef<HTMLInputElement>(null)
    const stuck = useRef<HTMLParagraphElement>(null)
    useEffect(() => {
        if (returnTo.current) returnTo.current.value = window.location.pathname + window.location.search
        let last = 0
        try {
            last = Number(sessionStorage.getItem(KEY)) || 0
            sessionStorage.setItem(KEY, String(Date.now()))
        } catch {
            // No sessionStorage (a private window): just log in
        }
        if (Date.now() - last < RETRY_MS) {
            if (stuck.current) stuck.current.hidden = false
            return
        }
        form.current?.requestSubmit()
    }, [])
    return (
        <section className={AUTH + ' m-auto'}>
            <h1 className={AUTH_TITLE}>{t('loginTitle')}</h1>
            <p ref={stuck} hidden role='alert' className={AUTH_TEXT}>
                {t('loginStuck')}
            </p>
            <form ref={form} action='/api/auth/login' method='get' className='flex flex-col'>
                <input ref={returnTo} type='hidden' name='returnTo' defaultValue='/' />
                <button type='submit' className={BUTTON}>
                    {t('signIn')}
                </button>
            </form>
        </section>
    )
}
