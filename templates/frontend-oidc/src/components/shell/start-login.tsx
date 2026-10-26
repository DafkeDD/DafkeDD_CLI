'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { AuthHeading, AuthLayout } from '@/components/pasport/auth-layout'
import { Btn, ErrorNote, Icon } from '@/components/pasport/ui'

/**
 * /login without a login request: starts one at once (to the login screen of the login server), so every app shows the
 * same login, and comes back to `returnTo` (the page that needed the login). With ?error= it stays here and says why
 * the last login failed, with a button to try again. One login screen for everybody, superadmins too.
 */
export function StartLogin({ error, returnTo }: { error?: string; returnTo?: string }) {
    const t = useTranslations('Oidc')
    // A GET form, not a link: /api/auth/login is a route handler that needs a full page load
    const form = useRef<HTMLFormElement>(null)
    useEffect(() => {
        if (!error) form.current?.requestSubmit()
    }, [error])
    const back = returnTo
    return (
        <AuthLayout>
            <AuthHeading title={t('loginTitle')} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {error ? (
                    <ErrorNote>{error === 'offline' ? t('offline') : t('failed', { error })}</ErrorNote>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-3)' }}>
                        <Icon name='loader' className='spin' /> {t('busy')}
                    </div>
                )}
                <form
                    ref={form}
                    action='/api/auth/login'
                    method='get'
                    style={{ display: 'flex', flexDirection: 'column' }}
                >
                    {back && <input type='hidden' name='returnTo' value={back} />}
                    <Btn type='submit' size='lg' className='btn-block' icon={error ? 'refresh' : 'arrowRight'}>
                        {error ? t('startAgain') : t('signIn')}
                    </Btn>
                </form>
            </div>
        </AuthLayout>
    )
}
