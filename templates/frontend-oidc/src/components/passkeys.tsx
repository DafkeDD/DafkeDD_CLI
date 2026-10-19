'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { BUTTON, CARD, Heading, INPUT, Notice, SECONDARY } from '@/components/account-ui'
import { type Answer, useBackend } from '@/lib/account'
import { cancelled, createPasskey, type CreateOptions, passkeysSupported } from '@/lib/webauthn'

type Passkey = { id: string; name: string; synced: boolean; createdAt: string; lastUsedAt: string | null }
type Status = { enabled: boolean; passkeys: Passkey[] }

/**
 * /security: the passkeys of the own account. Adds one on this device (fingerprint, face, PIN or a security key),
 * renames and removes them. Calls /me/passkeys through /api/backend. Hidden when passkeys are off on the server.
 */
export function PasskeysSecurity() {
    const t = useTranslations('Oidc')
    const format = useFormatter()
    const backend = useBackend()
    const [status, setStatus] = useState<Status | null>(null)
    const [supported] = useState(passkeysSupported)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [busy, setBusy] = useState(false)
    const [editing, setEditing] = useState<string | null>(null)

    function show(result: Answer | null) {
        if (result?.status === 200) setStatus(result.body as unknown as Status)
        else setError(result?.message || t('offline'))
    }

    useEffect(() => {
        backend('me/passkeys')
            .then(show)
            .catch(() => show(null))
        // once when the page opens
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function reload() {
        show(await backend('me/passkeys').catch(() => null))
    }

    async function add(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        const name = String(new FormData(form).get('name') ?? '').trim()
        setBusy(true)
        setError('')
        setNotice('')
        try {
            const start = await backend('me/passkeys/options', 'POST')
            if (start.status !== 200) throw new Error(start.message || t('offline'))
            const credential = await createPasskey(start.body.options as unknown as CreateOptions)
            const result = await backend('me/passkeys', 'POST', {
                token: start.body.token,
                credential,
                ...(name ? { name } : {})
            })
            if (result.status !== 201 && result.status !== 200) throw new Error(result.message || t('passkeyFailed'))
            setNotice(t('passkeyAdded'))
            form.reset()
            await reload()
        } catch (failure) {
            if (cancelled(failure)) setError(t('passkeyCancelled'))
            else if (failure instanceof DOMException && failure.name === 'InvalidStateError')
                setError(t('passkeyOnDevice'))
            else setError(failure instanceof Error && failure.message ? failure.message : t('passkeyFailed'))
        }
        setBusy(false)
    }

    async function rename(event: FormEvent<HTMLFormElement>, id: string) {
        event.preventDefault()
        const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
        if (!name) return
        setBusy(true)
        setError('')
        const result = await backend('me/passkeys/' + id, 'PATCH', { name }).catch(() => null)
        if (result?.status === 200) {
            setEditing(null)
            await reload()
        } else setError(result?.message || t('offline'))
        setBusy(false)
    }

    async function remove(id: string) {
        setBusy(true)
        setError('')
        setNotice('')
        const result = await backend('me/passkeys/' + id, 'DELETE').catch(() => null)
        if (result?.status === 200) {
            setNotice(t('passkeyRemoved'))
            await reload()
        } else setError(result?.message || t('offline'))
        setBusy(false)
    }

    if (!status?.enabled) return error ? <Notice tone='error'>{error}</Notice> : null
    return (
        <section className={CARD}>
            <Heading title={t('passkeysTitle')} text={t('passkeysText')} />
            {error && <Notice tone='error'>{error}</Notice>}
            {notice && <Notice tone='success'>{notice}</Notice>}
            {status.passkeys.length === 0 ? (
                <p className='text-sm text-[var(--text-3)]'>{t('passkeysNone')}</p>
            ) : (
                <ul className='flex flex-col gap-3'>
                    {status.passkeys.map(passkey => (
                        <li
                            key={passkey.id}
                            className='flex flex-col gap-2 rounded-[var(--r-md)] border border-[var(--border)] p-3 text-sm'
                        >
                            {editing === passkey.id ? (
                                <form className='flex gap-2' onSubmit={event => void rename(event, passkey.id)}>
                                    <input
                                        name='name'
                                        aria-label={t('passkeyName')}
                                        required
                                        maxLength={60}
                                        defaultValue={passkey.name}
                                        className={INPUT + ' min-w-0 flex-1'}
                                    />
                                    <button type='submit' disabled={busy} className={SECONDARY + ' shrink-0'}>
                                        {t('passkeySave')}
                                    </button>
                                </form>
                            ) : (
                                <div className='flex flex-col gap-0.5'>
                                    <span className='font-semibold'>{passkey.name}</span>
                                    <span className='text-xs text-[var(--text-3)]'>
                                        {passkey.synced ? t('passkeySynced') : t('passkeyDevice')} ·{' '}
                                        {t('passkeyAddedOn', {
                                            date: format.dateTime(new Date(passkey.createdAt), { dateStyle: 'medium' })
                                        })}
                                        {passkey.lastUsedAt &&
                                            ' · ' +
                                                t('passkeyUsedOn', {
                                                    date: format.dateTime(new Date(passkey.lastUsedAt), {
                                                        dateStyle: 'medium',
                                                        timeStyle: 'short'
                                                    })
                                                })}
                                    </span>
                                </div>
                            )}
                            {editing !== passkey.id && (
                                <div className='flex gap-2'>
                                    <button
                                        type='button'
                                        disabled={busy}
                                        className={SECONDARY}
                                        onClick={() => setEditing(passkey.id)}
                                    >
                                        {t('passkeyRename')}
                                    </button>
                                    <button
                                        type='button'
                                        disabled={busy}
                                        className={SECONDARY}
                                        onClick={() => void remove(passkey.id)}
                                    >
                                        {t('passkeyRemove')}
                                    </button>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {supported ? (
                <form className='flex flex-col gap-2' onSubmit={event => void add(event)}>
                    <label className='flex flex-col gap-1.5 text-sm font-medium'>
                        {t('passkeyName')}
                        <input name='name' maxLength={60} placeholder={t('passkeyNamePlaceholder')} className={INPUT} />
                    </label>
                    <button type='submit' disabled={busy} className={BUTTON}>
                        {busy ? t('busy') : t('passkeyAdd')}
                    </button>
                </form>
            ) : (
                <p className='text-sm text-[var(--text-2)]'>{t('passkeyUnsupported')}</p>
            )}
        </section>
    )
}
