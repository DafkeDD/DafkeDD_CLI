'use client'

import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import {
    BUTTON,
    CARD,
    Field,
    Heading,
    LINK,
    LoginButton,
    LoginLink,
    Notice,
    roleLabel,
    SECONDARY
} from '@/components/account-ui'
import { EidBridge, EidPin, type EidToken } from '@/components/eid'
import { useAccountApi } from '@/lib/account'

const PASSWORD = { minLength: 12, maxLength: 128 }

/** The values of a form, as text. */
const valuesOf = (event: FormEvent<HTMLFormElement>) =>
    Object.fromEntries([...new FormData(event.currentTarget)].map(([key, value]) => [key, String(value)]))

/** "Check your email": shown after every request that sends a mail (the same answer whether the address exists or not). */
function CheckEmail({ email }: { email: string }) {
    const t = useTranslations('Oidc')
    return (
        <section className={CARD}>
            <Heading title={t('checkEmailTitle')} text={t('checkEmailText', { email })} />
            <LoginButton label={t('signIn')} />
        </section>
    )
}

const TAB =
    SECONDARY +
    ' flex-1 aria-pressed:border-[var(--accent,#6366f1)] aria-pressed:bg-black/5 dark:aria-pressed:bg-white/10'

/**
 * /register: a new account and a new organisation; the account becomes its admin. With a password, or with the
 * Belgian eID (name from the card, no password) when the login server allows it (GET /oidc/account/registration).
 */
export function Register() {
    const t = useTranslations('Oidc')
    const api = useAccountApi()
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [sentTo, setSentTo] = useState('')
    const [options, setOptions] = useState({ password: true, eid: false })
    const [method, setMethod] = useState<'password' | 'eid'>('password')
    const challenge = useRef('')

    useEffect(() => {
        api('registration')
            .then(result => {
                if (result.status !== 200) return
                const open = { password: result.body.password !== false, eid: result.body.eid === true }
                setOptions(open)
                if (!open.password && open.eid) setMethod('eid')
            })
            .catch(() => undefined)
        // once when the page opens
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    /** eID, step 1: a challenge of the login server; its nonce goes to the card. */
    async function eidNonce(): Promise<string | { error: string }> {
        const result = await api('eid/challenge', {})
        if (result.status !== 200) return { error: result.message || t('offline') }
        challenge.current = String(result.body.challenge)
        return String(result.body.nonce)
    }

    /** eID, step 2: the account, with the token of the card. */
    async function eidRegister(token: EidToken, values: Record<string, string>): Promise<string | null> {
        const result = await api('register-eid', {
            challenge: challenge.current,
            token,
            email: values.email,
            organisation: values.organisation
        })
        if (result.status !== 202) return result.message || t('eidFailed')
        setSentTo(values.email ?? '')
        return null
    }

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const values = valuesOf(event)
        if (values.password !== values.repeat) return setError(t('passwordMismatch'))
        setBusy(true)
        setError('')
        try {
            const result = await api('register', {
                name: values.name,
                email: values.email,
                organisation: values.organisation,
                password: values.password
            })
            if (result.status === 202) setSentTo(values.email ?? '')
            else setError(result.message)
        } catch {
            setError(t('offline'))
        }
        setBusy(false)
    }

    if (sentTo) return <CheckEmail email={sentTo} />
    const organisationField = (
        <Field
            label={t('organisation')}
            hint={t('organisationHint')}
            name='organisation'
            required
            minLength={2}
            maxLength={100}
            autoComplete='organization'
        />
    )
    return (
        <section className={CARD}>
            <Heading title={t('registerTitle')} text={t('registerSubtitle')} />
            {options.password && options.eid && (
                <div className='flex gap-2' role='group'>
                    <button
                        type='button'
                        className={TAB}
                        aria-pressed={method === 'password'}
                        onClick={() => setMethod('password')}
                    >
                        {t('passwordTab')}
                    </button>
                    <button
                        type='button'
                        className={TAB}
                        aria-pressed={method === 'eid'}
                        onClick={() => setMethod('eid')}
                    >
                        {t('eidTab')}
                    </button>
                </div>
            )}
            {method === 'eid' ? (
                <>
                    <p className='text-sm opacity-80'>{t('eidRegisterText')}</p>
                    <EidBridge>
                        <EidPin submitLabel={t('eidRegisterSubmit')} getNonce={eidNonce} onToken={eidRegister}>
                            <Field
                                label={t('email')}
                                name='email'
                                type='email'
                                required
                                maxLength={254}
                                autoComplete='email'
                            />
                            {organisationField}
                        </EidPin>
                    </EidBridge>
                </>
            ) : (
                <form onSubmit={onSubmit} className='flex flex-col gap-5'>
                    <Field label={t('name')} name='name' required minLength={2} maxLength={100} autoComplete='name' />
                    <Field label={t('email')} name='email' type='email' required maxLength={254} autoComplete='email' />
                    {organisationField}
                    <Field
                        label={t('password')}
                        hint={t('passwordHint')}
                        name='password'
                        type='password'
                        required
                        autoComplete='new-password'
                        {...PASSWORD}
                    />
                    <Field
                        label={t('passwordRepeat')}
                        name='repeat'
                        type='password'
                        required
                        autoComplete='new-password'
                        {...PASSWORD}
                    />
                    {error && <Notice tone='error'>{error}</Notice>}
                    <button type='submit' disabled={busy} className={BUTTON}>
                        {busy ? t('busy') : t('registerSubmit')}
                    </button>
                </form>
            )}
            {/* Outside the form above: a form may not contain another form */}
            <div className='flex flex-wrap items-center gap-1.5 text-sm'>
                <span className='opacity-80'>{t('haveAccount')}</span>
                <LoginLink label={t('signIn')} />
            </div>
        </section>
    )
}

/** /verify-email?token=...: confirms the email address as soon as the page opens. */
export function VerifyEmail({ token }: { token: string }) {
    const t = useTranslations('Oidc')
    const api = useAccountApi()
    const [state, setState] = useState<{ email?: string; error?: string }>({})
    const started = useRef(false)

    useEffect(() => {
        if (started.current) return
        started.current = true
        api('verify-email', { token })
            .then(result =>
                setState(result.status === 200 ? { email: String(result.body.email) } : { error: result.message })
            )
            .catch(() => setState({ error: t('offline') }))
        // once per token
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token])

    if (state.email)
        return (
            <section className={CARD}>
                <Heading title={t('verifiedTitle')} text={t('verifiedText', { email: state.email })} />
                <LoginButton label={t('signIn')} />
            </section>
        )
    return (
        <section className={CARD}>
            <Heading title={t('verifyTitle')} />
            {state.error ? (
                <Notice tone='error'>{state.error}</Notice>
            ) : (
                <p className='text-sm opacity-70'>{t('busy')}</p>
            )}
            {state.error && <LoginButton label={t('signIn')} />}
        </section>
    )
}

/** /forgot-password: sends a link to choose a new password. */
export function ForgotPassword() {
    const t = useTranslations('Oidc')
    const api = useAccountApi()
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [sentTo, setSentTo] = useState('')

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const { email = '' } = valuesOf(event)
        setBusy(true)
        setError('')
        try {
            const result = await api('forgot-password', { email })
            if (result.status === 202) setSentTo(email)
            else setError(result.message)
        } catch {
            setError(t('offline'))
        }
        setBusy(false)
    }

    if (sentTo) return <CheckEmail email={sentTo} />
    return (
        <form onSubmit={onSubmit} className={CARD}>
            <Heading title={t('forgotTitle')} text={t('forgotText')} />
            <Field label={t('email')} name='email' type='email' required maxLength={254} autoComplete='email' />
            {error && <Notice tone='error'>{error}</Notice>}
            <button type='submit' disabled={busy} className={BUTTON}>
                {busy ? t('busy') : t('forgotSubmit')}
            </button>
        </form>
    )
}

/** /reset-password?token=...: a new password; afterwards every session of the account has ended. */
export function ResetPassword({ token }: { token: string }) {
    const t = useTranslations('Oidc')
    const api = useAccountApi()
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [done, setDone] = useState(false)

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const values = valuesOf(event)
        if (values.password !== values.repeat) return setError(t('passwordMismatch'))
        setBusy(true)
        setError('')
        try {
            const result = await api('reset-password', { token, password: values.password })
            if (result.status === 200) setDone(true)
            else setError(result.message)
        } catch {
            setError(t('offline'))
        }
        setBusy(false)
    }

    if (done)
        return (
            <section className={CARD}>
                <Heading title={t('resetDoneTitle')} text={t('resetDoneText')} />
                <LoginButton label={t('signIn')} />
            </section>
        )
    return (
        <form onSubmit={onSubmit} className={CARD}>
            <Heading title={t('resetTitle')} />
            <Field
                label={t('password')}
                hint={t('passwordHint')}
                name='password'
                type='password'
                required
                autoComplete='new-password'
                {...PASSWORD}
            />
            <Field
                label={t('passwordRepeat')}
                name='repeat'
                type='password'
                required
                autoComplete='new-password'
                {...PASSWORD}
            />
            {error && (
                <Notice tone='error'>
                    {error}{' '}
                    <Link href='/forgot-password' className={LINK}>
                        {t('forgotPassword')}
                    </Link>
                </Notice>
            )}
            <button type='submit' disabled={busy} className={BUTTON}>
                {busy ? t('busy') : t('resetSubmit')}
            </button>
        </form>
    )
}

type Invitation = {
    email: string
    tenantName: string
    role: 'user' | 'admin'
    inviterName: string
    accountExists: boolean
}

/** /invite?token=...: joins an organisation; without an account it creates one (already verified). */
export function AcceptInvitation({ token }: { token: string }) {
    const t = useTranslations('Oidc')
    const api = useAccountApi()
    const [invitation, setInvitation] = useState<Invitation | null>(null)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [done, setDone] = useState(false)
    const started = useRef(false)

    useEffect(() => {
        if (started.current) return
        started.current = true
        api('invitation?token=' + encodeURIComponent(token))
            .then(result => {
                if (result.status === 200) setInvitation(result.body as unknown as Invitation)
                else setError(result.message)
            })
            .catch(() => setError(t('offline')))
        // once per token
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token])

    async function accept(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const values = valuesOf(event)
        if (!invitation?.accountExists && values.password !== values.repeat) return setError(t('passwordMismatch'))
        setBusy(true)
        setError('')
        try {
            const result = await api(
                'invitation/accept',
                invitation?.accountExists ? { token } : { token, name: values.name, password: values.password }
            )
            if (result.status === 200) setDone(true)
            else setError(result.message)
        } catch {
            setError(t('offline'))
        }
        setBusy(false)
    }

    if (!invitation)
        return (
            <section className={CARD}>
                <Heading title={t('inviteTitle')} />
                {error ? <Notice tone='error'>{error}</Notice> : <p className='text-sm opacity-70'>{t('busy')}</p>}
            </section>
        )
    if (done)
        return (
            <section className={CARD}>
                <Heading title={t('inviteDoneTitle', { tenant: invitation.tenantName })} text={t('inviteDoneText')} />
                <LoginButton label={t('signIn')} />
            </section>
        )
    return (
        <form onSubmit={accept} className={CARD}>
            <Heading
                title={t('inviteTitle')}
                text={t('inviteText', {
                    inviter: invitation.inviterName,
                    tenant: invitation.tenantName,
                    role: roleLabel(t, invitation.role)
                })}
            />
            {invitation.accountExists ? (
                <p className='text-sm opacity-80'>
                    {t('inviteExisting', { email: invitation.email, tenant: invitation.tenantName })}
                </p>
            ) : (
                <>
                    <p className='text-sm opacity-80'>{t('inviteNewAccount', { email: invitation.email })}</p>
                    <Field label={t('name')} name='name' required minLength={2} maxLength={100} autoComplete='name' />
                    <Field
                        label={t('password')}
                        hint={t('passwordHint')}
                        name='password'
                        type='password'
                        required
                        autoComplete='new-password'
                        {...PASSWORD}
                    />
                    <Field
                        label={t('passwordRepeat')}
                        name='repeat'
                        type='password'
                        required
                        autoComplete='new-password'
                        {...PASSWORD}
                    />
                </>
            )}
            {error && <Notice tone='error'>{error}</Notice>}
            <button type='submit' disabled={busy} className={BUTTON}>
                {busy ? t('busy') : t('inviteAccept')}
            </button>
        </form>
    )
}
