'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { API_URL } from '@/lib/api'

type Tenant = { id: string; name: string }
type State =
    | { step: 'loading' }
    | { step: 'login'; clientName: string; csrf: string; loginHint: string }
    | { step: 'tenant'; csrf: string; tenants: Tenant[] }
    | { step: 'fatal'; message: string }

type Answer = {
    status?: string
    message?: string
    location?: string
    csrf?: string
    tenants?: Tenant[]
    step?: string
    clientName?: string
    loginHint?: string
}

const CARD =
    'flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-black/10 bg-black/[.03] p-6 text-left dark:border-white/15 dark:bg-white/[.04]'
const INPUT =
    'h-11 w-full rounded-xl border border-black/15 bg-transparent px-3.5 text-sm outline-none focus:border-[var(--accent,#6366f1)] dark:border-white/20'
const BUTTON =
    'inline-flex h-11 items-center justify-center rounded-xl bg-[var(--accent,#171717)] px-5 text-sm font-semibold text-[var(--accent-fg,#ffffff)] disabled:opacity-60 dark:bg-[var(--accent,#ededed)] dark:text-[var(--accent-fg,#0a0a0a)]'
const CHOICE =
    'flex h-11 items-center rounded-xl border border-black/15 px-4 text-left text-sm font-semibold hover:border-[var(--accent,#6366f1)] disabled:opacity-60 dark:border-white/20'

/**
 * The login page of the OIDC server, shown by this frontend: /login?interaction=<id>. It talks to the JSON variant of
 * /oidc/interaction/<id> on the API (with credentials, so the browser keeps the session cookie of the login server)
 * and finally sends the browser back to the application that asked for the login.
 */
export function OidcLogin({ interaction }: { interaction: string }) {
    const t = useTranslations('Oidc')
    const locale = useLocale()
    const [state, setState] = useState<State>({ step: 'loading' })
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
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
                if (status === 200 && answer.csrf) {
                    setState({
                        step: 'login',
                        clientName: answer.clientName ?? '',
                        csrf: answer.csrf,
                        loginHint: answer.loginHint ?? ''
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

    /** Handles every answer of the login server. */
    function handle(status: number, answer: Answer) {
        if (answer.status === 'redirect' && answer.location) {
            window.location.assign(answer.location)
            return
        }
        if (answer.status === 'choose-tenant' && answer.csrf) {
            setState({ step: 'tenant', csrf: answer.csrf, tenants: answer.tenants ?? [] })
        } else if (status === 401 || status === 429) {
            setError(answer.message ?? null)
        } else {
            setState({ step: 'fatal', message: answer.message ?? t('offline') })
        }
        setBusy(false)
    }

    async function submit(path: string, body: object) {
        setBusy(true)
        setError(null)
        try {
            const { status, answer } = await call(path, body)
            handle(status, answer)
        } catch {
            setError(t('offline'))
            setBusy(false)
        }
    }

    function onLogin(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (state.step !== 'login') return
        const values = Object.fromEntries(new FormData(event.currentTarget))
        void submit('/login', { csrf: state.csrf, email: values.email, password: values.password })
    }

    if (state.step === 'loading') return <p className='text-sm opacity-70'>{t('busy')}</p>

    if (state.step === 'fatal') {
        return (
            <section className={CARD}>
                <h1 className='text-2xl font-bold tracking-tight'>{t('loginTitle')}</h1>
                <p role='alert' className='text-sm text-red-600 dark:text-red-400'>
                    {state.message}
                </p>
                <form action='/api/auth/login' method='get' className='flex flex-col'>
                    <button type='submit' className={BUTTON}>
                        {t('startAgain')}
                    </button>
                </form>
            </section>
        )
    }

    if (state.step === 'tenant') {
        return (
            <section className={CARD}>
                <h1 className='text-2xl font-bold tracking-tight'>{t('tenantTitle')}</h1>
                <p className='text-sm opacity-80'>{t('tenantSubtitle')}</p>
                <div className='flex flex-col gap-2.5'>
                    {state.tenants.map(tenant => (
                        <button
                            key={tenant.id}
                            type='button'
                            disabled={busy}
                            className={CHOICE}
                            onClick={() => void submit('/tenant', { csrf: state.csrf, tenant: tenant.id })}
                        >
                            {tenant.name}
                        </button>
                    ))}
                </div>
            </section>
        )
    }

    return (
        <form onSubmit={onLogin} className={CARD}>
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
                <p role='alert' className='text-sm text-red-600 dark:text-red-400'>
                    {error}
                </p>
            )}
            <button type='submit' disabled={busy} className={BUTTON}>
                {busy ? t('busy') : t('submit')}
            </button>
        </form>
    )
}
