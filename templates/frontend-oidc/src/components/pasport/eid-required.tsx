'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { onEidRequired } from '@/lib/account'
import { AuthHeading, AuthLayout } from './auth-layout'
import { EidLinkStep } from './eid-link'
import { Btn, Icon } from './ui'

/**
 * Whether this account must link its eID first (OIDC_EID_REQUIRED): GET /me/eid says so when the page opens, or an API
 * call of the page answered 403 oidc.EID_REQUIRED.
 */
export function useEidRequired() {
    const [required, setRequired] = useState(false)
    useEffect(() => {
        let active = true
        fetch('/api/backend/me/eid', { headers: { Accept: 'application/json' }, cache: 'no-store' })
            .then(response => (response.ok ? response.json() : null))
            .then((status: { required?: boolean; linked?: boolean } | null) => {
                if (active && status?.required && !status.linked) setRequired(true)
            })
            .catch(() => undefined)
        const stop = onEidRequired(() => setRequired(true))
        return () => {
            active = false
            stop()
        }
    }, [])
    return required
}

/**
 * The portal of an account without a linked eID while every account must have one (OIDC_EID_REQUIRED): instead of
 * the page, a full-page screen that explains why and reads the eID (the same link flow as /security). Once it is
 * linked the page loads again into the portal. Logging out stays possible.
 */
export function EidRequired({ email, accountUrl = '' }: { email: string; accountUrl?: string }) {
    const t = useTranslations('EidGate')
    const shell = useTranslations('Shell')
    const [reading, setReading] = useState(false)
    const [linked, setLinked] = useState(false)

    return (
        <AuthLayout asideTitle={t('asideTitle')} asideText={t('asideText')}>
            <AuthHeading title={t('title')} text={t('text')} />
            <div className='fade-in' style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {linked ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-2)' }}>
                        <Icon name='checkCircle' style={{ color: 'var(--green)' }} /> {t('linked')}
                    </div>
                ) : reading ? (
                    <EidLinkStep
                        accountUrl={accountUrl}
                        onLinked={() => {
                            setLinked(true)
                            window.location.reload()
                        }}
                    />
                ) : (
                    <>
                        <div className='card card-pad' style={{ background: 'var(--surface-2)', fontSize: 13.5 }}>
                            {t('needs')}
                        </div>
                        <Btn
                            variant='primary'
                            size='lg'
                            className='btn-block'
                            icon='eid'
                            onClick={() => setReading(true)}
                        >
                            {t('start')}
                        </Btn>
                    </>
                )}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        marginTop: 6,
                        fontSize: 13,
                        color: 'var(--text-3)'
                    }}
                >
                    <span>{t('signedInAs', { email })}</span>
                    {/* A POST form (the route checks the Origin), like the logout of the shell */}
                    <form action='/api/auth/logout' method='post'>
                        <Btn type='submit' variant='ghost' size='sm' icon='logout'>
                            {shell('logout')}
                        </Btn>
                    </form>
                </div>
            </div>
        </AuthLayout>
    )
}
