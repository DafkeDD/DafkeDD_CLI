'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { BUTTON, CARD, INPUT, LINK, OUTLINE, roleLabel } from '@/components/account-ui'
import { EidBridge, EidPin, type EidToken } from '@/components/eid'
import { MfaQr, RecoveryCodes } from '@/components/mfa-ui'
import { useAccountApi } from '@/lib/account'
import { cancelled, getPasskey, type GetOptions, passkeysSupported } from '@/lib/webauthn'
import { API_URL } from '@/lib/api'

type Tenant = { id: string; name: string; role?: 'user' | 'admin' }
type State =
    | { step: 'loading' }
    | {
          step: 'login' | 'eid'
          clientName: string
          csrf: string
          loginHint: string
          registration: boolean
          eid: boolean
          /** "Log in with a passkey" (OIDC_PASSKEYS, and this browser can). */
          passkey: boolean
          /** Email and password (false: only the other OpenID Connect server). */
          password: boolean
          /** "Log in with <name>": another OpenID Connect server. */
          external: { name: string } | null
      }
    | { step: 'tenant'; csrf: string; tenants: Tenant[]; platform: boolean }
    | { step: 'mfa'; csrf: string }
    | { step: 'mfa-setup'; csrf: string; secret: string; qrSvg: string }
    | { step: 'recovery-codes'; csrf: string; codes: string[] }
    | { step: 'fatal'; message: string }

type Answer = {
    status?: string
    error?: string
    message?: string
    location?: string
    csrf?: string
    tenants?: Tenant[]
    step?: string
    clientName?: string
    loginHint?: string
    registration?: boolean
    eid?: boolean
    passkey?: boolean
    options?: GetOptions
    password?: boolean
    external?: { name: string } | null
    pending?: boolean
    nonce?: string
    secret?: string
    qrSvg?: string
    recoveryCodes?: string[]
    platform?: boolean
}

const CHOICE =
    'flex h-11 items-center justify-between gap-3 rounded-xl border border-black/15 px-4 text-left text-sm font-semibold hover:border-[var(--accent,#6366f1)] disabled:opacity-60 dark:border-white/20'
/** From this many organisations on, the choice gets a search field. */
const SEARCH_FROM = 7

/**
 * The login page of the OIDC server, shown by this frontend: /login?interaction=<id>. It talks to the JSON variant of
 * /oidc/interaction/<id> on the API (with credentials, so the browser keeps the session cookie of the login server)
 * and finally sends the browser back to the application that asked for the login.
 */
export function OidcLogin({ interaction, externalError }: { interaction: string; externalError?: string }) {
    const t = useTranslations('Oidc')
    const locale = useLocale()
    const [state, setState] = useState<State>({ step: 'loading' })
    // Why the login at the other OpenID Connect server did not work (?error= of its callback)
    const [error, setError] = useState<string | null>(() =>
        !externalError
            ? null
            : externalError === 'EXTERNAL_NO_EMAIL'
              ? t('externalNoEmail')
              : externalError === 'EXTERNAL_EMAIL_UNVERIFIED'
                ? t('externalEmailUnverified')
                : externalError === 'EXTERNAL_EMAIL_TAKEN'
                  ? t('externalEmailTaken')
                  : externalError === 'EXTERNAL_OTHER_LINKED'
                    ? t('externalOtherLinked')
                    : t('externalFailed')
    )
    const [busy, setBusy] = useState(false)
    // Set when the password was right but the email address is not verified yet: offers to send the email again
    const [unverified, setUnverified] = useState('')
    const [resent, setResent] = useState(false)
    const [search, setSearch] = useState('')
    const account = useAccountApi()
    const base = `${API_URL}/oidc/interaction/${encodeURIComponent(interaction)}`

    async function call(path: string, body?: object): Promise<{ status: number; answer: Answer }> {
        const response = await fetch(base + path, {
            method: body ? 'POST' : 'GET',
            credentials: 'include',
            headers: {
                Accept: 'application/json',
                'Accept-Language': locale,
                ...(body ? { 'Content-Type': 'application/json' } : {})
            },
            body: body ? JSON.stringify(body) : undefined
        })
        return { status: response.status, answer: (await response.json()) as Answer }
    }

    useEffect(() => {
        let active = true
        call('')
            .then(({ status, answer }) => {
                if (!active) return
                if (status === 200 && answer.csrf && answer.pending) {
                    // Back from the other server, halfway: the second factor or the organisation
                    return call('/resume', { csrf: answer.csrf }).then(
                        next => active && handle(next.status, next.answer)
                    )
                }
                if (status === 200 && answer.csrf) {
                    setState({
                        step: 'login',
                        clientName: answer.clientName ?? '',
                        csrf: answer.csrf,
                        loginHint: answer.loginHint ?? '',
                        registration: answer.registration !== false,
                        eid: answer.eid === true,
                        passkey: answer.passkey === true && passkeysSupported(),
                        password: answer.password !== false,
                        external: answer.external ?? null
                    })
                } else {
                    setState({ step: 'fatal', message: answer.message ?? t('offline') })
                }
            })
            .catch(() => {
                if (active) setState({ step: 'fatal', message: t('offline') })
            })
        return () => {
            active = false
        }
        // only once per login request (a language change keeps the same request)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [interaction])

    /** Handles every answer of the login server. `email` is what the user typed (for "send the email again"). */
    function handle(status: number, answer: Answer, email = '') {
        if (answer.status === 'redirect' && answer.location) {
            window.location.assign(answer.location)
            return
        }
        // Two-step verification: the code after the password, setting it up, or the recovery codes after setting it up
        if (
            answer.csrf &&
            (answer.status === 'mfa' || answer.status === 'mfa-setup' || answer.status === 'recovery-codes')
        ) {
            if (answer.status === 'mfa') setState({ step: 'mfa', csrf: answer.csrf })
            else if (answer.status === 'mfa-setup')
                setState({
                    step: 'mfa-setup',
                    csrf: answer.csrf,
                    secret: answer.secret ?? '',
                    qrSvg: answer.qrSvg ?? ''
                })
            else setState({ step: 'recovery-codes', csrf: answer.csrf, codes: answer.recoveryCodes ?? [] })
            setError(answer.message ?? null)
            setBusy(false)
            return
        }
        if (answer.status === 'choose-tenant' && answer.csrf) {
            setState({
                step: 'tenant',
                csrf: answer.csrf,
                tenants: answer.tenants ?? [],
                platform: answer.platform === true
            })
        } else if (status === 403 && answer.error === 'EMAIL_NOT_VERIFIED') {
            setError(answer.message ?? null)
            setUnverified(email)
        } else if (status === 401 || status === 429) {
            setError(answer.message ?? null)
        } else {
            setState({ step: 'fatal', message: answer.message ?? t('offline') })
        }
        setBusy(false)
    }

    async function submit(path: string, body: object, email = '') {
        setBusy(true)
        setError(null)
        try {
            const { status, answer } = await call(path, body)
            handle(status, answer, email)
        } catch {
            setError(t('offline'))
            setBusy(false)
        }
    }

    function onLogin(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (state.step !== 'login') return
        const values = Object.fromEntries(new FormData(event.currentTarget))
        setUnverified('')
        setResent(false)
        void submit(
            '/login',
            { csrf: state.csrf, email: values.email, password: values.password },
            String(values.email)
        )
    }

    /** "Log in with ...": to the other server (the answer is { status: "redirect", location }). */
    function onExternal() {
        if (state.step !== 'login') return
        void submit('/external', { csrf: state.csrf })
    }

    /**
     * "Log in with a passkey": a challenge from the login server (kept in its login cookie), the device shows its
     * passkeys for this site (fingerprint, face or PIN), and the signed answer goes back. Counts as two-step
     * verification: on to the organisation choice or back to the application.
     */
    async function onPasskey() {
        if (state.step !== 'login') return
        setBusy(true)
        setError(null)
        try {
            const first = await call('/passkey/challenge', { csrf: state.csrf })
            if (first.status !== 200 || !first.answer.options) return handle(first.status, first.answer)
            const credential = await getPasskey(first.answer.options)
            const { status, answer } = await call('/passkey', { csrf: state.csrf, credential })
            if (answer.status === 'error') {
                setError(answer.message ?? t('passkeyFailed'))
                setBusy(false)
                return
            }
            handle(status, answer)
        } catch (error) {
            setError(cancelled(error) ? t('passkeyCancelled') : t('passkeyFailed'))
            setBusy(false)
        }
    }

    async function resend() {
        setResent(false)
        await account('resend-verification', { email: unverified }).catch(() => null)
        setResent(true)
    }

    /** Step 1 of the eID login: a nonce from the login server (kept in its login cookie, used once). */
    async function eidNonce(): Promise<string | { error: string }> {
        if (state.step !== 'eid') return { error: t('eidFailed') }
        const { status, answer } = await call('/eid/challenge', { csrf: state.csrf })
        if (status === 200 && answer.nonce) return answer.nonce
        if (status === 410) handle(status, answer)
        return { error: answer.message ?? t('eidFailed') }
    }

    /** Step 2: the token of the card. Logged in: on to the organisation choice or back to the application. */
    async function eidSubmit(token: EidToken): Promise<string | null> {
        if (state.step !== 'eid') return t('eidFailed')
        const { status, answer } = await call('/eid', { csrf: state.csrf, token })
        // Logged in (or the login expired): the same handling as after the password
        if (['redirect', 'choose-tenant', 'no-tenant', 'expired'].includes(answer.status ?? '')) {
            handle(status, answer)
            return null
        }
        return answer.message ?? t('eidFailed')
    }

    if (state.step === 'loading') return <p className='text-sm opacity-70'>{t('busy')}</p>

    if (state.step === 'fatal') {
        return (
            <section className={CARD}>
                <h1 className='text-2xl font-bold tracking-tight'>{t('loginTitle')}</h1>
                <div role='alert' className='text-sm text-red-600 dark:text-red-400'>
                    {state.message}
                </div>
                <form action='/api/auth/login' method='get' className='flex flex-col'>
                    <button type='submit' className={BUTTON}>
                        {t('startAgain')}
                    </button>
                </form>
            </section>
        )
    }

    if (state.step === 'mfa' || state.step === 'mfa-setup') {
        const setup = state.step === 'mfa-setup' ? state : null
        return (
            <form
                // A new form (not the login form reused by React): the password must never end up in the code field
                key={state.step}
                className={CARD}
                onSubmit={event => {
                    event.preventDefault()
                    const code = String(new FormData(event.currentTarget).get('code') ?? '')
                    void submit('/mfa', { csrf: state.csrf, code })
                }}
            >
                <div className='flex flex-col gap-1.5'>
                    <h1 className='text-2xl font-bold tracking-tight'>{setup ? t('mfaSetupTitle') : t('mfaTitle')}</h1>
                    <p className='text-sm opacity-80'>{setup ? t('mfaSetupText') : t('mfaText')}</p>
                </div>
                {setup && (
                    <MfaQr qrSvg={setup.qrSvg} secret={setup.secret} label={t('mfaQr')} secretLabel={t('mfaSecret')} />
                )}
                <label className='flex flex-col gap-1.5 text-sm font-medium'>
                    {t('mfaCode')}
                    <input
                        name='code'
                        required
                        minLength={6}
                        maxLength={setup ? 7 : 20}
                        autoComplete='one-time-code'
                        inputMode={setup ? 'numeric' : 'text'}
                        autoFocus
                        className={INPUT + ' tracking-widest'}
                    />
                </label>
                {error && (
                    <div role='alert' className='text-sm text-red-600 dark:text-red-400'>
                        {error}
                    </div>
                )}
                <button type='submit' disabled={busy} className={BUTTON}>
                    {busy ? t('busy') : t('mfaSubmit')}
                </button>
            </form>
        )
    }

    if (state.step === 'recovery-codes') {
        return (
            <section className={CARD}>
                <div className='flex flex-col gap-1.5'>
                    <h1 className='text-2xl font-bold tracking-tight'>{t('recoveryTitle')}</h1>
                    <p className='text-sm opacity-80'>{t('recoveryText')}</p>
                </div>
                <RecoveryCodes codes={state.codes} copyLabel={t('copyCodes')} copiedLabel={t('copied')} />
                <button
                    type='button'
                    disabled={busy}
                    className={BUTTON}
                    onClick={() => void submit('/continue', { csrf: state.csrf })}
                >
                    {busy ? t('busy') : t('continue')}
                </button>
            </section>
        )
    }

    if (state.step === 'tenant') {
        const query = search.trim().toLowerCase()
        const shown = state.tenants.filter(tenant => tenant.name.toLowerCase().includes(query))
        return (
            <section className={CARD}>
                <h1 className='text-2xl font-bold tracking-tight'>{t('tenantTitle')}</h1>
                <p className='text-sm opacity-80'>{t('tenantSubtitle')}</p>
                {state.tenants.length >= SEARCH_FROM && (
                    <input
                        type='search'
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        placeholder={t('searchTenant')}
                        aria-label={t('searchTenant')}
                        className={INPUT}
                    />
                )}
                <div className='flex max-h-96 flex-col gap-2.5 overflow-y-auto'>
                    {state.platform && (
                        // A superadmin can also continue without an organisation: platform management
                        <button
                            type='button'
                            disabled={busy}
                            className={CHOICE}
                            onClick={() => void submit('/tenant', { csrf: state.csrf, tenant: 'platform' })}
                        >
                            <span>{t('platformChoice')}</span>
                            <span className='text-xs font-medium opacity-60'>{t('superadmin')}</span>
                        </button>
                    )}
                    {shown.map(tenant => (
                        <button
                            key={tenant.id}
                            type='button'
                            disabled={busy}
                            className={CHOICE}
                            onClick={() => void submit('/tenant', { csrf: state.csrf, tenant: tenant.id })}
                        >
                            <span>{tenant.name}</span>
                            {tenant.role && (
                                <span className='text-xs font-medium opacity-60'>{roleLabel(t, tenant.role)}</span>
                            )}
                        </button>
                    ))}
                    {shown.length === 0 && <p className='text-sm opacity-70'>{t('noTenantFound')}</p>}
                </div>
            </section>
        )
    }

    if (state.step === 'eid') {
        return (
            <section className={CARD}>
                <div className='flex flex-col gap-1.5'>
                    <h1 className='text-2xl font-bold tracking-tight'>{t('eidTitle')}</h1>
                    <p className='text-sm opacity-80'>{t('eidText')}</p>
                </div>
                <EidBridge>
                    <EidPin submitLabel={t('eidSubmit')} getNonce={eidNonce} onToken={eidSubmit} />
                </EidBridge>
                <div className='flex flex-wrap items-center justify-between gap-2 text-sm'>
                    <button type='button' className={LINK} onClick={() => setState({ ...state, step: 'login' })}>
                        {t('eidBack')}
                    </button>
                    {state.registration && (
                        <Link href='/register' className={LINK}>
                            {t('register')}
                        </Link>
                    )}
                </div>
            </section>
        )
    }

    const externalButton = state.external && (
        <button type='button' disabled={busy} className={state.password ? OUTLINE : BUTTON} onClick={onExternal}>
            {t('externalLogin', { name: state.external.name })}
        </button>
    )

    // Only the other OpenID Connect server (OIDC_EXTERNAL_ONLY)
    if (!state.password) {
        return (
            <section className={CARD}>
                <div className='flex flex-col gap-1.5'>
                    <h1 className='text-2xl font-bold tracking-tight'>{t('loginTitle')}</h1>
                    <p className='text-sm opacity-80'>{t('loginSubtitle', { client: state.clientName })}</p>
                </div>
                {error && (
                    <div role='alert' className='text-sm text-red-600 dark:text-red-400'>
                        {error}
                    </div>
                )}
                {externalButton}
            </section>
        )
    }

    return (
        <form key='login' onSubmit={onLogin} className={CARD}>
            <div className='flex flex-col gap-1.5'>
                <h1 className='text-2xl font-bold tracking-tight'>{t('loginTitle')}</h1>
                <p className='text-sm opacity-80'>{t('loginSubtitle', { client: state.clientName })}</p>
            </div>
            <label className='flex flex-col gap-1.5 text-sm font-medium'>
                {t('email')}
                <input
                    name='email'
                    type='email'
                    required
                    maxLength={254}
                    autoComplete='username'
                    defaultValue={state.loginHint}
                    className={INPUT}
                />
            </label>
            <label className='flex flex-col gap-1.5 text-sm font-medium'>
                {t('password')}
                <input
                    name='password'
                    type='password'
                    required
                    maxLength={128}
                    autoComplete='current-password'
                    className={INPUT}
                />
            </label>
            {error && (
                <div role='alert' className='text-sm text-red-600 dark:text-red-400'>
                    {error}
                </div>
            )}
            {unverified && (
                <div className='flex flex-col gap-1.5 text-sm'>
                    <button type='button' className={LINK + ' self-start'} onClick={() => void resend()}>
                        {t('resend')}
                    </button>
                    {resent && <div role='status'>{t('resent')}</div>}
                </div>
            )}
            <button type='submit' disabled={busy} className={BUTTON}>
                {busy ? t('busy') : t('submit')}
            </button>
            {(state.eid || state.external || state.passkey) && (
                <div className='flex items-center gap-3 text-xs uppercase opacity-60'>
                    <span className='h-px flex-1 bg-current opacity-30' />
                    {t('or')}
                    <span className='h-px flex-1 bg-current opacity-30' />
                </div>
            )}
            {state.passkey && (
                <button type='button' disabled={busy} className={OUTLINE} onClick={() => void onPasskey()}>
                    {t('passkeyLogin')}
                </button>
            )}
            {externalButton}
            {state.eid && (
                <>
                    <button
                        type='button'
                        className={OUTLINE}
                        onClick={() => {
                            setError(null)
                            setState({ ...state, step: 'eid' })
                        }}
                    >
                        {t('eidLogin')}
                    </button>
                </>
            )}
            <div className='flex flex-wrap items-center justify-between gap-2 text-sm'>
                <Link href='/forgot-password' className={LINK}>
                    {t('forgotPassword')}
                </Link>
                {state.registration && (
                    <span>
                        <span className='opacity-80'>{t('noAccount')}</span>{' '}
                        <Link href='/register' className={LINK}>
                            {t('register')}
                        </Link>
                    </span>
                )}
            </div>
        </form>
    )
}
