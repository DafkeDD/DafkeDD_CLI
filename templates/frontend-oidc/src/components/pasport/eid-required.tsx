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
    return useEidStatus().required
}

/**
 * The eID of the logged in account: `required` (it must be linked first, see above) or `missing` (the server has the
 * eID, the account has not linked it yet, but it may: a reminder with a button).
 */
export function useEidStatus() {
    const [state, setState] = useState({ required: false, missing: false })
    useEffect(() => {
        let active = true
        fetch('/api/backend/me/eid', { headers: { Accept: 'application/json' }, cache: 'no-store' })
            .then(response => (response.ok ? response.json() : null))
            .then((status: { enabled?: boolean; required?: boolean; linked?: boolean } | null) => {
                if (!active || !status || status.linked) return
                if (status.required) setState({ required: true, missing: false })
                else if (status.enabled) setState(s => ({ ...s, missing: true }))
            })
            .catch(() => undefined)
        const stop = onEidRequired(() => setState({ required: true, missing: false }))
        return () => {
            active = false
            stop()
        }
    }, [])
    return state
}

/** The app that sent the account to /security of the login server to read its eID (?app=<client id>). */
export function useEidBack() {
    const [back, setBack] = useState<{ name: string; url: string } | null>(null)
    useEffect(() => {
        const app = new URLSearchParams(window.location.search).get('app')
        if (!app) return
        let active = true
        fetch('/api/backend/me/eid/back?client=' + encodeURIComponent(app), {
            headers: { Accept: 'application/json' },
            cache: 'no-store'
        })
            .then(response => (response.ok ? response.json() : null))
            .then((found: { name?: string; url?: string } | null) => {
                if (active && found?.name && found.url) setBack({ name: found.name, url: found.url })
            })
            .catch(() => undefined)
        return () => {
            active = false
        }
    }, [])
    return back
}

/** /security?app=<client id>: an app sent the account here to read its eID; a button goes back to it. */
export function EidBackBanner() {
    const t = useTranslations('EidGate')
    const back = useEidBack()
    if (!back) return null
    return (
        <div
            className='card card-pad fade-in'
            style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}
        >
            <div style={{ flex: 1, minWidth: 220, fontSize: 13.5, color: 'var(--text-2)' }}>
                {t('backText', { app: back.name })}
            </div>
            <a href={back.url} className='btn btn-primary btn-sm'>
                {t('back', { app: back.name })} <Icon name='arrowRight' size={15} />
            </a>
        </div>
    )
}

/**
 * Right after the login, for an account that has not read its eID yet (while it is not required): a clear message
 * with a button that reads it at once (`href`: /security here, the security page of the login server in a linked app).
 * "Later" hides it for this browser session.
 */
export function EidReminder({ href }: { href: string }) {
    const t = useTranslations('EidGate')
    const { missing } = useEidStatus()
    const [hidden, setHidden] = useState(() => {
        try {
            return typeof window !== 'undefined' && sessionStorage.getItem('eid-reminder') === 'later'
        } catch {
            return false
        }
    })
    if (!missing || hidden) return null
    const later = () => {
        try {
            sessionStorage.setItem('eid-reminder', 'later')
        } catch {
            // private mode: hidden until the next page load
        }
        setHidden(true)
    }
    // A tinted notice (accent-tint with its hairline and an icon tile), never a coloured left border
    return (
        <div
            className='card card-pad fade-in'
            role='status'
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                flexWrap: 'wrap',
                marginBottom: 18,
                background: 'var(--accent-tint)',
                borderColor: 'var(--accent-border)'
            }}
        >
            <div
                aria-hidden
                style={{
                    display: 'grid',
                    placeItems: 'center',
                    width: 40,
                    height: 40,
                    flex: 'none',
                    borderRadius: 'var(--r-md)',
                    background: 'var(--surface)',
                    color: 'var(--accent)'
                }}
            >
                <Icon name='eid' size={20} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 650, fontSize: 14.5, color: 'var(--text)' }}>{t('reminderTitle')}</div>
                <div style={{ fontSize: 13, marginTop: 2, color: 'var(--text-2)' }}>{t('reminderText')}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn variant='ghost' size='sm' onClick={later}>
                    {t('reminderLater')}
                </Btn>
                <a href={href} className='btn btn-primary btn-sm'>
                    <Icon name='eid' size={15} /> {t('start')}
                </a>
            </div>
        </div>
    )
}

/**
 * The portal of an account without a linked eID while every account must have one (OIDC_EID_REQUIRED): instead of
 * the page, a full-page screen that explains why and reads the eID (the same link flow as /security). Once it is
 * linked the page loads again into the portal. Logging out stays possible.
 */
export function EidRequired({
    email,
    accountUrl = '',
    app = ''
}: {
    email: string
    accountUrl?: string
    /** The client id of a linked app: the login server sends the account back to it after reading the eID. */
    app?: string
}) {
    const t = useTranslations('EidGate')
    const shell = useTranslations('Shell')
    const [reading, setReading] = useState(false)
    const [linked, setLinked] = useState(false)
    // Sent here by an app (?app=): back to it once the eID is linked
    const back = useEidBack()

    return (
        <AuthLayout asideTitle={t('asideTitle')} asideText={t('asideText')}>
            <AuthHeading
                title={t('title')}
                text={back ? t('text') + ' ' + t('backText', { app: back.name }) : t('text')}
            />
            <div className='fade-in' style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {linked ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-2)' }}>
                        <Icon name='checkCircle' style={{ color: 'var(--green)' }} />{' '}
                        {back ? t('backLinked', { app: back.name }) : t('linked')}
                    </div>
                ) : reading ? (
                    <EidLinkStep
                        accountUrl={accountUrl}
                        app={app}
                        onLinked={() => {
                            setLinked(true)
                            if (back) window.location.assign(back.url)
                            else window.location.reload()
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
