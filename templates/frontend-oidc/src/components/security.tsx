'use client'

import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { BUTTON, CARD, Heading, INPUT, LoginButton, Notice, SECONDARY } from '@/components/account-ui'
import { EidBridge, EidPin, type EidToken } from '@/components/eid'
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
                <p className='text-sm text-[var(--text-3)]'>{t('busy')}</p>
            ) : status.enabled ? (
                <div role='status' className='text-sm font-semibold text-[var(--green)]'>
                    {t('mfaOn')} · {t('recoveryLeft', { count: status.recoveryCodesLeft })}
                </div>
            ) : (
                <Notice tone='error'>{t('mfaOff')}</Notice>
            )}
            {error && <Notice tone='error'>{error}</Notice>}

            {codes.length > 0 && (
                <div className='flex flex-col gap-2'>
                    <h2 className='text-base font-semibold'>{t('recoveryTitle')}</h2>
                    <p className='text-sm text-[var(--text-2)]'>{t('recoveryText')}</p>
                    <RecoveryCodes codes={codes} copyLabel={t('copyCodes')} copiedLabel={t('copied')} />
                </div>
            )}

            {status?.enabled && (
                <form onSubmit={event => void withCode(event, 'me/mfa/recovery-codes')} className='flex flex-col gap-3'>
                    <h2 className='text-base font-semibold'>{t('newRecoveryCodes')}</h2>
                    <p className='text-sm text-[var(--text-2)]'>{t('newRecoveryCodesText')}</p>
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
                    <p className='text-sm text-[var(--text-2)]'>{t('mfaSetupText')}</p>
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

type EidStatus = { enabled: boolean; linked: boolean; linkedAt: string | null; hasPassword: boolean }

/**
 * /security: the Belgian eID of the own account (GET/POST/DELETE /me/eid through /api/backend). Linked, the account
 * can log in with the card and its PIN. Hidden when the login server has no eID login (OIDC_EID=off).
 */
export function EidSecurity() {
    const t = useTranslations('Oidc')
    const locale = useLocale()
    const backend = useBackend()
    const [status, setStatus] = useState<EidStatus | null>(null)
    const [linking, setLinking] = useState(false)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const challenge = useRef('')

    useEffect(() => {
        backend('me/eid')
            .then(result => {
                if (result.status === 200) setStatus(result.body as unknown as EidStatus)
            })
            .catch(() => undefined)
        // once when the page opens
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function nonce(): Promise<string | { error: string }> {
        const result = await backend('me/eid/challenge', 'POST')
        if (result.status !== 200) return { error: result.message || t('offline') }
        challenge.current = String(result.body.challenge)
        return String(result.body.nonce)
    }

    async function link(token: EidToken): Promise<string | null> {
        const result = await backend('me/eid', 'POST', { challenge: challenge.current, token })
        if (result.status !== 200) return result.message || t('eidFailed')
        setStatus(result.body as unknown as EidStatus)
        setLinking(false)
        return null
    }

    async function unlink() {
        setBusy(true)
        setError('')
        const result = await backend('me/eid', 'DELETE').catch(() => null)
        if (result?.status === 200) setStatus(result.body as unknown as EidStatus)
        else setError(result?.message || t('offline'))
        setBusy(false)
    }

    if (!status?.enabled) return null
    return (
        <section className={CARD}>
            <Heading title={t('eidSecurityTitle')} text={status.linked ? t('eidLinked') : t('eidNotLinked')} />
            {status.linked && status.linkedAt && (
                <div role='status' className='text-sm font-semibold text-[var(--green)]'>
                    {t('eidLinkedSince', { date: new Date(status.linkedAt).toLocaleDateString(locale) })}
                </div>
            )}
            {error && <Notice tone='error'>{error}</Notice>}
            {status.linked ? (
                status.hasPassword ? (
                    <button
                        type='button'
                        disabled={busy}
                        className={SECONDARY + ' self-start'}
                        onClick={() => void unlink()}
                    >
                        {t('eidUnlink')}
                    </button>
                ) : (
                    <p className='text-sm text-[var(--text-2)]'>{t('eidOnlyLogin')}</p>
                )
            ) : linking ? (
                <EidBridge>
                    <EidPin submitLabel={t('eidLinkSubmit')} getNonce={nonce} onToken={link} />
                </EidBridge>
            ) : (
                <button type='button' className={BUTTON} onClick={() => setLinking(true)}>
                    {t('eidLink')}
                </button>
            )}
        </section>
    )
}

type SessionRow = {
    id: string
    current: boolean
    tenant: { id: string; name: string | null } | null
    userAgent: string | null
    amr: string[]
    createdAt: string
    lastUsedAt: string | null
}

/** "Chrome · Windows" from a User-Agent: enough to recognise a device, no library needed. */
export function describeBrowser(userAgent: string | null): string | null {
    if (!userAgent) return null
    const browser =
        [
            ['Edg/', 'Edge'],
            ['OPR/', 'Opera'],
            ['Firefox/', 'Firefox'],
            ['Chrome/', 'Chrome'],
            ['Safari/', 'Safari']
        ].find(([needle]) => userAgent.includes(needle!))?.[1] ?? null
    const system =
        [
            ['iPhone', 'iPhone'],
            ['iPad', 'iPad'],
            ['Android', 'Android'],
            ['Windows', 'Windows'],
            ['Mac OS X', 'macOS'],
            ['Linux', 'Linux']
        ].find(([needle]) => userAgent.includes(needle!))?.[1] ?? null
    return [browser, system].filter(Boolean).join(' · ') || null
}

/**
 * /security: where the account is logged in (GET /me/sessions through /api/backend). End one other session, or all
 * of them at once; ending a session stops its tokens at once. This device logs out with the normal log out button.
 */
export function SessionsSecurity() {
    const t = useTranslations('Oidc')
    const format = useFormatter()
    const backend = useBackend()
    const [sessions, setSessions] = useState<SessionRow[] | null>(null)
    // "active 3 minutes ago" is counted from when the list was loaded
    const [loadedAt, setLoadedAt] = useState(() => new Date())
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [busy, setBusy] = useState(false)

    function show(result: Answer | null) {
        if (result?.status === 200) {
            setSessions(result.body as unknown as SessionRow[])
            setLoadedAt(new Date())
        } else setError(result?.message || t('offline'))
    }

    useEffect(() => {
        backend('me/sessions')
            .then(show)
            .catch(() => show(null))
        // once when the page opens
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function end(path: string) {
        setBusy(true)
        setError('')
        setNotice('')
        const result = await backend(path, 'DELETE').catch(() => null)
        if (result?.status === 200) {
            setNotice(t('sessionsEnded', { count: Number(result.body.ended ?? 0) }))
            show(await backend('me/sessions').catch(() => null))
        } else setError(result?.message || t('offline'))
        setBusy(false)
    }

    const method = (amr: string[]) =>
        amr.includes('sc')
            ? t('method_eid')
            : amr.includes('pop')
              ? t('method_passkey')
              : amr.includes('mfa')
                ? t('method_mfa')
                : t('method_pwd')
    const others = (sessions ?? []).filter(session => !session.current).length

    return (
        <section className={CARD}>
            <Heading title={t('sessionsTitle')} text={t('sessionsText')} />
            {error && <Notice tone='error'>{error}</Notice>}
            {notice && <Notice tone='success'>{notice}</Notice>}
            {!sessions ? (
                <p className='text-sm text-[var(--text-3)]'>{t('busy')}</p>
            ) : (
                <ul className='flex flex-col gap-3'>
                    {sessions.map(session => (
                        <li
                            key={session.id}
                            className='flex items-start justify-between gap-3 rounded-[var(--r-md)] border border-[var(--border)] p-3 text-sm'
                        >
                            <div className='flex flex-col gap-0.5'>
                                <span className='font-semibold'>
                                    {describeBrowser(session.userAgent) ?? t('unknownBrowser')}
                                    {session.current && (
                                        <span className='ml-2 text-xs font-medium text-[var(--green)]'>
                                            {t('thisDevice')}
                                        </span>
                                    )}
                                </span>
                                <span className='text-xs text-[var(--text-3)]'>
                                    {session.tenant?.name ?? t('platformTitle')} · {method(session.amr)}
                                </span>
                                <span className='text-xs text-[var(--text-3)]'>
                                    {t('sessionSince', {
                                        date: format.dateTime(new Date(session.createdAt), {
                                            dateStyle: 'medium',
                                            timeStyle: 'short'
                                        })
                                    })}
                                    {session.lastUsedAt &&
                                        ' · ' +
                                            t('sessionLastActive', {
                                                date: format.relativeTime(new Date(session.lastUsedAt), loadedAt)
                                            })}
                                </span>
                            </div>
                            {!session.current && (
                                <button
                                    type='button'
                                    disabled={busy}
                                    className={SECONDARY + ' shrink-0'}
                                    onClick={() => void end('me/sessions/' + session.id)}
                                >
                                    {t('sessionEnd')}
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {others > 0 && (
                <button
                    type='button'
                    disabled={busy}
                    className={SECONDARY + ' self-start'}
                    onClick={() => void end('me/sessions')}
                >
                    {t('sessionsEndOthers')}
                </button>
            )}
        </section>
    )
}
