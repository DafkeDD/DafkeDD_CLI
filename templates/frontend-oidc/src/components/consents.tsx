'use client'

import { useEffect, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { CARD, Heading, Notice, SECONDARY } from '@/components/account-ui'
import { scopeLabel } from '@/components/oidc-login'
import { type Answer, useBackend } from '@/lib/account'

const SCOPES = ['openid', 'profile', 'email', 'tenant']
/** As on the consent screen: who, name, email, organisation (unknown scopes last). */
const scopeOrder = (scope: string) => (SCOPES.includes(scope) ? SCOPES.indexOf(scope) : SCOPES.length)

type Consent = { clientId: string; clientName: string; scopes: string[]; createdAt: string; updatedAt: string }

/**
 * /security: the applications that are not our own which this account allowed on the consent screen, with what they
 * get; "Take back" revokes it (their refresh tokens stop, the next login asks again). Hidden when there are none.
 */
export function ConsentsSecurity() {
    const t = useTranslations('Oidc')
    const format = useFormatter()
    const backend = useBackend()
    const [consents, setConsents] = useState<Consent[] | null>(null)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [busy, setBusy] = useState(false)

    function show(result: Answer | null) {
        if (result?.status === 200) setConsents(result.body as unknown as Consent[])
        else setError(result?.message || t('offline'))
    }

    useEffect(() => {
        backend('me/consents')
            .then(show)
            .catch(() => show(null))
        // once when the page opens
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function revoke(consent: Consent) {
        setBusy(true)
        setError('')
        setNotice('')
        const result = await backend('me/consents/' + encodeURIComponent(consent.clientId), 'DELETE').catch(() => null)
        if (result?.status === 200) {
            setNotice(t('consentRevoked', { client: consent.clientName }))
            show(await backend('me/consents').catch(() => null))
        } else setError(result?.message || t('offline'))
        setBusy(false)
    }

    if (!consents?.length && !notice) return error ? <Notice tone='error'>{error}</Notice> : null
    return (
        <section className={CARD}>
            <Heading title={t('consentsTitle')} text={t('consentsText')} />
            {error && <Notice tone='error'>{error}</Notice>}
            {notice && <Notice tone='success'>{notice}</Notice>}
            {consents?.length === 0 ? (
                <p className='text-sm text-[var(--text-3)]'>{t('consentsNone')}</p>
            ) : (
                <ul className='flex flex-col gap-3'>
                    {consents?.map(consent => (
                        <li
                            key={consent.clientId}
                            className='flex items-start justify-between gap-3 rounded-[var(--r-md)] border border-[var(--border)] p-3 text-sm'
                        >
                            <div className='flex flex-col gap-0.5'>
                                <span className='font-semibold'>{consent.clientName}</span>
                                <span className='text-xs text-[var(--text-3)]'>
                                    {[...consent.scopes]
                                        .sort((a, b) => scopeOrder(a) - scopeOrder(b))
                                        .map(scope => scopeLabel(t, scope))
                                        .join(' · ')}
                                </span>
                                <span className='text-xs text-[var(--text-3)]'>
                                    {t('consentSince', {
                                        date: format.dateTime(new Date(consent.createdAt), { dateStyle: 'medium' })
                                    })}
                                </span>
                            </div>
                            <button
                                type='button'
                                disabled={busy}
                                className={SECONDARY + ' shrink-0'}
                                onClick={() => void revoke(consent)}
                            >
                                {t('consentRevoke')}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    )
}
