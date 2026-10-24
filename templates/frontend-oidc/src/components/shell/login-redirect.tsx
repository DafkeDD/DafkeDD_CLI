'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { AuthHeading, AuthLayout } from '@/components/pasport/auth-layout'
import { Btn } from '@/components/pasport/ui'

/** How long a login that came back without a session stops the next automatic one (no endless loop). */
const RETRY_MS = 15_000
const KEY = 'login-redirect'

/**
 * A page without a login (any more), when the proxy did not catch it already (the session ended while the page was
 * open): starts a login that comes back to this page. When the last automatic login came back without a session a
 * moment ago (cookies blocked, for example), it says so and waits for the button instead of trying again and again.
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
        <AuthLayout>
            <AuthHeading title={t('loginTitle')} />
            <p ref={stuck} hidden role='alert' style={{ marginBottom: 16 }}>
                {t('loginStuck')}
            </p>
            <form ref={form} action='/api/auth/login' method='get' style={{ display: 'flex', flexDirection: 'column' }}>
                <input ref={returnTo} type='hidden' name='returnTo' defaultValue='/' />
                <Btn type='submit' size='lg' className='btn-block' icon='arrowRight'>
                    {t('signIn')}
                </Btn>
            </form>
        </AuthLayout>
    )
}
