'use client'

import { type FormEvent, type ReactNode, useState } from 'react'
import { useTranslations } from 'next-intl'
import { EidProvider, useEid, useEidLogin } from '@dafkedd/eid/react'
import { BUTTON, Field, LINK, Notice } from '@/components/account-ui'

/** The token of the bridge after the PIN (EidAuthToken): sent as it is to the login server. */
export type EidToken = NonNullable<ReturnType<typeof useEidLogin>['token']>

/** Where users download the DafkeDD eID program (the bridge between the browser and the card reader). */
export const EID_DOWNLOAD = 'https://github.com/DafkeDD/DafkeDD_EID/releases/latest'

/**
 * Talks to the DafkeDD eID program on this computer (http://127.0.0.1:47820). Only mounted when the user chooses the
 * eID: the page never contacts the program otherwise. The card is not read (no personal data in the browser): the PIN
 * only lets the card sign the nonce of the server.
 */
export function EidBridge({ children }: { children: ReactNode }) {
    return (
        <EidProvider autoRead={false} photo={false}>
            {children}
        </EidProvider>
    )
}

/** The translated message for an error of the bridge or the card. */
function errorMessage(
    t: ReturnType<typeof useTranslations<'Oidc'>>,
    code: string | undefined,
    triesLeft: number | null
) {
    switch (code) {
        case 'pin-incorrect':
            return t('eidPinWrong', { count: triesLeft ?? 0 })
        case 'pin-blocked':
            return t('eidPinBlocked')
        case 'auth-not-allowed':
        case 'origin-not-allowed':
            return t('eidNotAllowed')
        case 'no-card':
        case 'card-removed':
            return t('eidNoCard')
        case 'pin-cancelled':
        case 'timeout':
        case 'aborted':
            return t('eidCancelled')
        default:
            return t('eidFailed')
    }
}

/**
 * The eID step (inside EidBridge): what to do when the program, the reader or the card is missing, else the PIN.
 * `getNonce` asks the server a nonce right before the card signs; `onToken` sends the token to the server and returns
 * an error message (or null). `children` are extra fields of the same form (for example email and organisation); the
 * values of the form go to both callbacks.
 */
export function EidPin({
    submitLabel,
    getNonce,
    onToken,
    children
}: {
    submitLabel: string
    getNonce: (values: Record<string, string>) => Promise<string | { error: string }>
    onToken: (token: EidToken, values: Record<string, string>) => Promise<string | null>
    children?: ReactNode
}) {
    const t = useTranslations('Oidc')
    const eid = useEid()
    const signer = useEidLogin()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    // The card refused (wrong PIN, ...): the reason is in the state of useEidLogin, shown below
    const [signFailed, setSignFailed] = useState(false)

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        const values = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, String(value)]))
        const { pin = '', ...rest } = values
        setBusy(true)
        setError('')
        setSignFailed(false)
        try {
            const nonce = await getNonce(rest)
            if (typeof nonce !== 'string') {
                setError(nonce.error)
            } else {
                const token = await signer.login({ nonce, pin })
                if (!token) setSignFailed(true)
                else {
                    const failed = await onToken(token, rest)
                    if (failed) setError(failed)
                }
            }
        } catch {
            setError(t('eidFailed'))
        }
        // The PIN is never kept, also not in the field
        const field = form.elements.namedItem('pin')
        if (field instanceof HTMLInputElement) field.value = ''
        setBusy(false)
    }

    const message = error || (signFailed ? errorMessage(t, signer.error?.code, signer.triesLeft) : '')

    if (eid.phase === 'connecting') return <p className='text-sm text-[var(--text-3)]'>{t('eidConnecting')}</p>
    if (eid.phase === 'no-bridge' || eid.phase === 'bridge-outdated')
        return (
            <div className='flex flex-col gap-2 text-sm'>
                <Notice tone='error'>{eid.phase === 'no-bridge' ? t('eidNoBridge') : t('eidOutdated')}</Notice>
                <a href={EID_DOWNLOAD} target='_blank' rel='noreferrer' className={LINK + ' self-start'}>
                    {t('eidDownload')}
                </a>
            </div>
        )
    if (eid.phase === 'no-reader') return <Notice tone='error'>{t('eidNoReader')}</Notice>
    if (eid.phase === 'no-card') return <p className='text-sm font-medium'>{t('eidNoCard')}</p>

    return (
        <form onSubmit={event => void onSubmit(event)} className='flex flex-col gap-5'>
            {children}
            {eid.phase === 'error' && <Notice tone='error'>{t('eidCardError')}</Notice>}
            <Field
                label={t('eidPin')}
                hint={t('eidPinHint')}
                name='pin'
                type='password'
                inputMode='numeric'
                pattern='[0-9]{4,12}'
                minLength={4}
                maxLength={12}
                autoComplete='off'
                required
            />
            {message && <Notice tone='error'>{message}</Notice>}
            <button type='submit' disabled={busy} className={BUTTON}>
                {busy ? t('busy') : submitLabel}
            </button>
        </form>
    )
}
