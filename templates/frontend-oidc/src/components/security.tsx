'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BUTTON, CARD, Heading, INPUT, LoginButton, Notice } from '@/components/account-ui'
import { MfaQr, RecoveryCodes } from '@/components/mfa-ui'
import { type Answer, useBackend } from '@/lib/account'

type Status = { enabled: boolean; recoveryCodesLeft: number }
type Setup = { secret: string; qrSvg: string }

/**
 * /security: two-step verification of the own account. Shows whether it is on and how many recovery codes are left,
 * makes new recovery codes, and sets it up when it is not on yet. Calls /me/mfa through /api/backend.
 */
export function Security() {
    const t = useTranslations('Oidc')
    const backend = useBackend()
    const [status, setStatus] = useState<Status | null>(null)
    const [setup, setSetup] = useState<Setup | null>(null)
    const [codes, setCodes] = useState<string[]>([])
    const [error, setError] = useState('')
    const [expired, setExpired] = useState(false)
    const [busy, setBusy] = useState(false)

    function show(result: Answer) {
        if (result.status === 401) setExpired(true)
        else if (result.status !== 200) setError(result.message || t('offline'))
        else setStatus(result.body as unknown as Status)
    }

    useEffect(() => {
        backend('me/mfa')
            .then(show)
            .catch(() => setError(t('offline')))
        // once when the page opens
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    /** Sends a code to `path`; shows the new recovery codes it answers with. */
    async function withCode(event: FormEvent<HTMLFormElement>, path: string) {
        event.preventDefault()
        const form = event.currentTarget
        const code = String(new FormData(form).get('code') ?? '')
        setBusy(true)
        setError('')
        try {
            const result = await backend(path, 'POST', { code })
            if (result.status === 401) setExpired(true)
            else if (result.status !== 200) setError(result.message || t('offline'))
            else {
                setCodes((result.body.recoveryCodes as string[]) ?? [])
                setSetup(null)
                form.reset()
                show(await backend('me/mfa'))
            }
        } catch {
            setError(t('offline'))
        }
        setBusy(false)
    }

    async function startSetup() {
        setBusy(true)
        setError('')
        const result = await backend('me/mfa/setup', 'POST').catch(() => null)
        if (result?.status === 200) setSetup(result.body as unknown as Setup)
        else setError(result?.message || t('offline'))
        setBusy(false)
    }

    if (expired)
        return (
            <section className={CARD}>
                <Notice tone='error'>{t('sessionExpired')}</Notice>
                <LoginButton label={t('signIn')} returnTo='/security' />
            </section>
        )

    const codeField = (
        <input
            name='code'
            required
            minLength={6}
            maxLength={20}
            autoComplete='one-time-code'
            placeholder={t('mfaCode')}
            aria-label={t('mfaCode')}
            className={INPUT + ' tracking-widest'}
        />
    )

    return (
        <section className={CARD}>
            <Heading title={t('securityTitle')} text={t('securityText')} />
            {!status ? (
                <p className='text-sm opacity-70'>{t('busy')}</p>
            ) : status.enabled ? (
                <div role='status' className='text-sm font-semibold text-green-700 dark:text-green-400'>
                    {t('mfaOn')} · {t('recoveryLeft', { count: status.recoveryCodesLeft })}
                </div>
            ) : (
                <Notice tone='error'>{t('mfaOff')}</Notice>
            )}
            {error && <Notice tone='error'>{error}</Notice>}

            {codes.length > 0 && (
                <div className='flex flex-col gap-2'>
                    <h2 className='text-base font-semibold'>{t('recoveryTitle')}</h2>
                    <p className='text-sm opacity-80'>{t('recoveryText')}</p>
                    <RecoveryCodes codes={codes} copyLabel={t('copyCodes')} copiedLabel={t('copied')} />
                </div>
            )}

            {status?.enabled && (
                <form onSubmit={event => void withCode(event, 'me/mfa/recovery-codes')} className='flex flex-col gap-3'>
                    <h2 className='text-base font-semibold'>{t('newRecoveryCodes')}</h2>
                    <p className='text-sm opacity-80'>{t('newRecoveryCodesText')}</p>
                    {codeField}
                    <button type='submit' disabled={busy} className={BUTTON}>
                        {t('newRecoveryCodes')}
                    </button>
                </form>
            )}

            {status && !status.enabled && !setup && (
                <button type='button' disabled={busy} className={BUTTON} onClick={() => void startSetup()}>
                    {t('setupMfa')}
                </button>
            )}
            {setup && (
                <form onSubmit={event => void withCode(event, 'me/mfa/enable')} className='flex flex-col gap-3'>
                    <p className='text-sm opacity-80'>{t('mfaSetupText')}</p>
                    <MfaQr qrSvg={setup.qrSvg} secret={setup.secret} label={t('mfaQr')} secretLabel={t('mfaSecret')} />
                    {codeField}
                    <button type='submit' disabled={busy} className={BUTTON}>
                        {t('mfaSubmit')}
                    </button>
                </form>
            )}
        </section>
    )
}
