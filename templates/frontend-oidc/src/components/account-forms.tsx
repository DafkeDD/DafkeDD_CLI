'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { roleLabel } from '@/components/account-ui'
import { EidBridge, EidPin, type EidToken } from '@/components/eid'
import { AuthHeading, AuthLayout, Divider, StepBar } from '@/components/pasport/auth-layout'
import { Badge, Btn, ErrorNote, Field, Icon, Input } from '@/components/pasport/ui'
import { useAccountApi } from '@/lib/account'

const PASSWORD_MIN = 12

/** "Log in" as a full page load: /api/auth/login is a route handler. */
function LoginAction({ label, icon = 'arrowRight' }: { label: string; icon?: string }) {
    return (
        <form action='/api/auth/login' method='get' style={{ display: 'flex', flexDirection: 'column' }}>
            <Btn type='submit' variant='primary' size='lg' className='btn-block' iconRight={icon}>
                {label}
            </Btn>
        </form>
    )
}

/** The design's success screen: the green burst, a title, a text and the next step. */
function Done({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
    return (
        <div
            className='fade-in'
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 20,
                alignItems: 'center',
                textAlign: 'center',
                paddingTop: 8
            }}
        >
            <div className='success-burst'>
                <Icon name='checkCircle' size={38} />
            </div>
            <div>
                <div style={{ fontSize: 20, fontWeight: 650, letterSpacing: '-0.02em' }}>{title}</div>
                <p style={{ marginTop: 8, fontSize: 14 }}>{text}</p>
            </div>
            <div style={{ width: '100%' }}>{children}</div>
        </div>
    )
}

/** "Check your email": shown after every request that sends a mail (the same answer whether the address exists or not). */
function CheckEmail({ email, title, text }: { email: string; title?: string; text?: string }) {
    const t = useTranslations('Oidc')
    return (
        <Done title={title ?? t('checkEmailTitle')} text={text ?? t('checkEmailText', { email })}>
            <LoginAction label={t('signIn')} />
        </Done>
    )
}

type Phase = 'idle' | 'eid' | 'details' | 'review' | 'done'

/**
 * /register: a new account and a new organisation; the account becomes its admin. With the Belgian eID (name from the
 * card, plus a chosen password) or with email and password, as the login server allows (GET /oidc/account/registration).
 * Every account has a password; two-step verification (authenticator app) is set up at the first login.
 */
export function Register() {
    const t = useTranslations('Oidc')
    const p = useTranslations('Register')
    const api = useAccountApi()
    const [options, setOptions] = useState({ password: true, eid: false })
    const [tab, setTab] = useState<'eid' | 'email'>('email')
    const [phase, setPhase] = useState<Phase>('idle')
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [touched, setTouched] = useState(false)
    const [form, setForm] = useState({
        name: '',
        email: '',
        organisation: '',
        password: '',
        repeat: ''
    })
    const challenge = useRef('')
    const token = useRef<EidToken | null>(null)

    useEffect(() => {
        api('registration')
            .then(result => {
                if (result.status !== 200) return
                const open = { password: result.body.password !== false, eid: result.body.eid === true }
                setOptions(open)
                setTab(open.eid ? 'eid' : 'email')
                // Only with the eID (no email and password): no choice to make
                if (open.eid && !open.password) setPhase('eid')
            })
            .catch(() => undefined)
        // once when the page opens
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }))
    const emailValid = /^\S+@\S+\.\S+$/.test(form.email.trim())
    const orgValid = form.organisation.trim().length >= 2
    const nameValid = form.name.trim().length >= 2
    const pwValid = form.password.length >= PASSWORD_MIN
    const pwMatch = form.password === form.repeat
    const bad = (invalid: boolean) => (touched && invalid ? { borderColor: 'var(--red)' } : undefined)
    const viaEid = phase === 'eid' || phase === 'details' || phase === 'review' || (phase === 'idle' && tab === 'eid')

    /** eID, step 1: a challenge of the login server; its nonce goes to the card. */
    async function eidNonce(): Promise<string | { error: string }> {
        const result = await api('eid/challenge', {})
        if (result.status !== 200) return { error: result.message || t('offline') }
        challenge.current = String(result.body.challenge)
        return String(result.body.nonce)
    }
    /** eID, step 2: keep the signed token; the account is made after the details (one request, below). */
    async function eidSigned(signed: EidToken): Promise<string | null> {
        token.current = signed
        setPhase('details')
        return null
    }

    async function registerEid() {
        if (!token.current) return setPhase('eid')
        setBusy(true)
        setError('')
        try {
            const result = await api('register-eid', {
                challenge: challenge.current,
                token: token.current,
                email: form.email.trim(),
                password: form.password,
                organisation: form.organisation.trim()
            })
            if (result.status === 202) setPhase('done')
            else {
                // The challenge is used once: a new attempt reads the card again
                token.current = null
                setError(result.message || t('eidFailed'))
                setPhase('eid')
            }
        } catch {
            setError(t('offline'))
        }
        setBusy(false)
    }

    async function registerPassword() {
        setTouched(true)
        if (!nameValid || !emailValid || !orgValid || !pwValid || !pwMatch) return
        setBusy(true)
        setError('')
        try {
            const result = await api('register', {
                name: form.name.trim(),
                email: form.email.trim(),
                organisation: form.organisation.trim(),
                password: form.password
            })
            if (result.status === 202) setPhase('done')
            else setError(result.message)
        } catch {
            setError(t('offline'))
        }
        setBusy(false)
    }

    const labels = viaEid
        ? [p('stepIdentity'), p('stepDetails'), p('stepReview')]
        : [p('stepDetails'), p('stepConfirm')]
    const index = viaEid ? (phase === 'idle' || phase === 'eid' ? 0 : phase === 'details' ? 1 : 2) : 0
    const orgField = (
        <Field
            label={p('organisation')}
            required
            hint={touched && !orgValid ? p('organisationRequired') : p('organisationHint')}
            error={touched && !orgValid}
        >
            <Input
                icon='building'
                value={form.organisation}
                onChange={e => set('organisation', e.target.value)}
                placeholder={p('organisationPlaceholder')}
                autoComplete='organization'
                maxLength={100}
                style={bad(!orgValid)}
            />
        </Field>
    )

    const passwordFields = (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field
                label={p('password')}
                required
                hint={touched && !pwValid ? p('passwordMin', { n: PASSWORD_MIN }) : null}
                error
            >
                <Input
                    icon='lock'
                    type='password'
                    placeholder={p('passwordPlaceholder', { n: PASSWORD_MIN })}
                    value={form.password}
                    onChange={e => set('password', e.target.value)}
                    autoComplete='new-password'
                    maxLength={128}
                    style={bad(!pwValid)}
                />
            </Field>
            <Field label={p('confirm')} required hint={touched && form.repeat && !pwMatch ? p('noMatch') : null} error>
                <Input
                    icon='lock'
                    type='password'
                    placeholder={p('repeat')}
                    value={form.repeat}
                    onChange={e => set('repeat', e.target.value)}
                    autoComplete='new-password'
                    maxLength={128}
                    style={bad(!!form.repeat && !pwMatch)}
                />
            </Field>
        </div>
    )

    return (
        <AuthLayout asideTitle={p('asideTitle')} asideText={p('asideText')}>
            {phase !== 'done' && <StepBar labels={labels} index={index} />}
            <AuthHeading
                title={
                    phase === 'idle'
                        ? p('title')
                        : phase === 'eid'
                          ? p('verifyTitle')
                          : phase === 'details'
                            ? p('detailsTitle')
                            : phase === 'review'
                              ? p('reviewTitle')
                              : p('doneTitle')
                }
                text={
                    phase === 'idle'
                        ? p('subtitle')
                        : phase === 'eid'
                          ? p('verifyText')
                          : phase === 'details'
                            ? p('detailsText')
                            : phase === 'review'
                              ? p('reviewText')
                              : undefined
                }
            />

            {phase === 'idle' && (
                <div className='fade-in' style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {options.eid && options.password && (
                        <div className='seg' style={{ display: 'flex' }} role='tablist'>
                            <button
                                type='button'
                                role='tab'
                                aria-selected={tab === 'eid'}
                                className={tab === 'eid' ? 'active' : ''}
                                style={{ flex: 1 }}
                                onClick={() => setTab('eid')}
                            >
                                {p('tabEid')}
                            </button>
                            <button
                                type='button'
                                role='tab'
                                aria-selected={tab === 'email'}
                                className={tab === 'email' ? 'active' : ''}
                                style={{ flex: 1 }}
                                onClick={() => setTab('email')}
                            >
                                {p('tabEmail')}
                            </button>
                        </div>
                    )}
                    {tab === 'eid' && options.eid ? (
                        <div className='fade-in' style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <Btn
                                variant='primary'
                                size='lg'
                                className='btn-block'
                                icon='eid'
                                onClick={() => setPhase('eid')}
                            >
                                {p('withEid')}
                            </Btn>
                            <p className='hint' style={{ textAlign: 'center', marginTop: 2 }}>
                                {p('eidHint')}
                            </p>
                        </div>
                    ) : !options.password ? null : (
                        <form
                            className='fade-in'
                            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
                            onSubmit={e => {
                                e.preventDefault()
                                void registerPassword()
                            }}
                        >
                            <Field
                                label={p('name')}
                                required
                                hint={touched && !nameValid ? p('nameRequired') : null}
                                error
                            >
                                <Input
                                    icon='user'
                                    value={form.name}
                                    onChange={e => set('name', e.target.value)}
                                    autoComplete='name'
                                    maxLength={100}
                                    style={bad(!nameValid)}
                                    autoFocus
                                />
                            </Field>
                            <Field
                                label={p('email')}
                                required
                                hint={touched && !emailValid ? p('emailInvalid') : null}
                                error
                            >
                                <Input
                                    icon='mail'
                                    type='email'
                                    placeholder={p('emailPlaceholder')}
                                    value={form.email}
                                    onChange={e => set('email', e.target.value)}
                                    autoComplete='email'
                                    maxLength={254}
                                    style={bad(!emailValid)}
                                />
                            </Field>
                            {orgField}
                            {passwordFields}
                            <ErrorNote>{error}</ErrorNote>
                            <Btn
                                type='submit'
                                variant='primary'
                                size='lg'
                                className='btn-block'
                                iconRight='arrowRight'
                                disabled={busy}
                            >
                                {busy ? t('busy') : p('create')}
                            </Btn>
                            <p className='hint' style={{ textAlign: 'center', marginTop: 2 }}>
                                {p('mfaAfter')}
                            </p>
                        </form>
                    )}
                    <Divider label={p('haveAccount')} />
                    <form action='/api/auth/login' method='get' style={{ display: 'flex', flexDirection: 'column' }}>
                        <Btn type='submit' variant='ghost' size='lg' className='btn-block' icon='arrowLeft'>
                            {p('login')}
                        </Btn>
                    </form>
                </div>
            )}

            {phase === 'eid' && (
                <div className='fade-in' style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <ErrorNote>{error}</ErrorNote>
                    <EidBridge>
                        <EidPin submitLabel={p('readCard')} getNonce={eidNonce} onToken={eidSigned} />
                    </EidBridge>
                    <Btn variant='ghost' size='sm' icon='arrowLeft' onClick={() => setPhase('idle')}>
                        {p('back')}
                    </Btn>
                </div>
            )}

            {phase === 'details' && (
                <form
                    className='fade-in'
                    style={{ display: 'flex', flexDirection: 'column', gap: 15 }}
                    onSubmit={e => {
                        e.preventDefault()
                        setTouched(true)
                        if (emailValid && orgValid && pwValid && pwMatch) setPhase('review')
                    }}
                >
                    <div className='card card-pad' style={{ background: 'var(--surface-2)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div className='t-eyebrow'>{p('identity')}</div>
                            <Badge tone='accent' icon='shieldCheck'>
                                {p('verified')}
                            </Badge>
                        </div>
                        <p style={{ fontSize: 13.5, marginTop: 8 }}>{p('identityText')}</p>
                    </div>
                    <Field label={p('email')} required hint={touched && !emailValid ? p('emailInvalid') : null} error>
                        <Input
                            icon='mail'
                            type='email'
                            placeholder={p('emailPlaceholder')}
                            value={form.email}
                            onChange={e => set('email', e.target.value)}
                            autoComplete='email'
                            style={bad(!emailValid)}
                        />
                    </Field>
                    {orgField}
                    {passwordFields}
                    <Btn type='submit' variant='primary' size='lg' className='btn-block' iconRight='arrowRight'>
                        {p('toReview')}
                    </Btn>
                    <p className='hint' style={{ textAlign: 'center', marginTop: 2 }}>
                        {p('mfaAfter')}
                    </p>
                </form>
            )}

            {phase === 'review' && (
                <div className='fade-in' style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className='card card-pad' style={{ background: 'var(--surface-2)' }}>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: 10
                            }}
                        >
                            <div className='t-eyebrow'>{p('contact')}</div>
                            <Btn variant='ghost' size='sm' icon='edit' onClick={() => setPhase('details')}>
                                {p('change')}
                            </Btn>
                        </div>
                        <div style={{ display: 'grid', gap: 8 }}>
                            {(
                                [
                                    [p('reviewEmail'), form.email],
                                    [p('reviewOrganisation'), form.organisation]
                                ] as const
                            ).map(([k, v]) => (
                                <div
                                    key={k}
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        gap: 12,
                                        fontSize: 13.5
                                    }}
                                >
                                    <span className='t-muted'>{k}</span>
                                    <span style={{ fontWeight: 600, textAlign: 'right' }}>{v}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <ErrorNote>{error}</ErrorNote>
                    <Btn
                        variant='primary'
                        size='lg'
                        className='btn-block'
                        icon='check'
                        disabled={busy}
                        onClick={() => void registerEid()}
                    >
                        {busy ? t('busy') : p('confirmAccount')}
                    </Btn>
                    <Btn variant='ghost' size='sm' icon='arrowLeft' onClick={() => setPhase('details')}>
                        {p('back')}
                    </Btn>
                </div>
            )}

            {phase === 'done' && (
                <CheckEmail email={form.email} title={p('doneTitle')} text={p('doneText', { email: form.email })} />
            )}
        </AuthLayout>
    )
}

/** /verify-email?token=...: confirms the email address (or a new address) as soon as the page opens. */
export function VerifyEmail({ token }: { token: string }) {
    const t = useTranslations('Oidc')
    const p = useTranslations('Register')
    const api = useAccountApi()
    const [state, setState] = useState<{ email?: string; changed?: boolean; error?: string }>({})
    const started = useRef(false)

    useEffect(() => {
        if (started.current) return
        started.current = true
        api('verify-email', { token })
            .then(result =>
                setState(
                    result.status === 200
                        ? { email: String(result.body.email), changed: result.body.status === 'email-changed' }
                        : { error: result.message }
                )
            )
            .catch(() => setState({ error: t('offline') }))
        // once per token
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token])

    return (
        <AuthLayout>
            {state.email ? (
                <Done
                    title={state.changed ? p('emailChangedTitle') : t('verifiedTitle')}
                    text={
                        state.changed
                            ? p('emailChangedText', { email: state.email })
                            : t('verifiedText', { email: state.email })
                    }
                >
                    {state.changed ? (
                        <Link href='/profile' className='btn btn-primary btn-lg btn-block'>
                            {p('toProfile')}
                        </Link>
                    ) : (
                        <LoginAction label={t('signIn')} />
                    )}
                </Done>
            ) : (
                <>
                    <AuthHeading title={t('verifyTitle')} />
                    {state.error ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <ErrorNote>{state.error}</ErrorNote>
                            <LoginAction label={t('signIn')} />
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-3)' }}>
                            <Icon name='loader' className='spin' /> {t('busy')}
                        </div>
                    )}
                </>
            )}
        </AuthLayout>
    )
}

/** /forgot-password: sends a link to choose a new password. */
export function ForgotPassword() {
    const t = useTranslations('Oidc')
    const p = useTranslations('Register')
    const api = useAccountApi()
    const [email, setEmail] = useState('')
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [sentTo, setSentTo] = useState('')

    async function send() {
        setBusy(true)
        setError('')
        try {
            const result = await api('forgot-password', { email: email.trim() })
            if (result.status === 202) setSentTo(email.trim())
            else setError(result.message)
        } catch {
            setError(t('offline'))
        }
        setBusy(false)
    }

    return (
        <AuthLayout>
            {sentTo ? (
                <CheckEmail email={sentTo} />
            ) : (
                <>
                    <AuthHeading title={t('forgotTitle')} text={t('forgotText')} />
                    <form
                        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
                        onSubmit={e => {
                            e.preventDefault()
                            void send()
                        }}
                    >
                        <Field label={t('email')}>
                            <Input
                                icon='mail'
                                type='email'
                                required
                                maxLength={254}
                                autoComplete='email'
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                autoFocus
                            />
                        </Field>
                        <ErrorNote>{error}</ErrorNote>
                        <Btn type='submit' variant='primary' size='lg' className='btn-block' disabled={busy}>
                            {busy ? t('busy') : t('forgotSubmit')}
                        </Btn>
                    </form>
                    <form
                        action='/api/auth/login'
                        method='get'
                        style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}
                    >
                        <Btn type='submit' variant='ghost' className='btn-block' icon='arrowLeft'>
                            {p('backToLogin')}
                        </Btn>
                    </form>
                </>
            )}
        </AuthLayout>
    )
}

/** /reset-password?token=...: a new password; afterwards every session of the account has ended. */
export function ResetPassword({ token }: { token: string }) {
    const t = useTranslations('Oidc')
    const p = useTranslations('Register')
    const api = useAccountApi()
    const [password, setPassword] = useState('')
    const [repeat, setRepeat] = useState('')
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [done, setDone] = useState(false)

    async function save() {
        if (password !== repeat) return setError(t('passwordMismatch'))
        setBusy(true)
        setError('')
        try {
            const result = await api('reset-password', { token, password })
            if (result.status === 200) setDone(true)
            else setError(result.message)
        } catch {
            setError(t('offline'))
        }
        setBusy(false)
    }

    return (
        <AuthLayout>
            {done ? (
                <Done title={t('resetDoneTitle')} text={t('resetDoneText')}>
                    <LoginAction label={t('signIn')} />
                </Done>
            ) : (
                <>
                    <AuthHeading title={t('resetTitle')} text={t('passwordHint')} />
                    <form
                        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
                        onSubmit={e => {
                            e.preventDefault()
                            void save()
                        }}
                    >
                        <Field label={t('password')}>
                            <Input
                                icon='lock'
                                type='password'
                                required
                                minLength={PASSWORD_MIN}
                                maxLength={128}
                                autoComplete='new-password'
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                autoFocus
                            />
                        </Field>
                        <Field label={t('passwordRepeat')}>
                            <Input
                                icon='lock'
                                type='password'
                                required
                                minLength={PASSWORD_MIN}
                                maxLength={128}
                                autoComplete='new-password'
                                value={repeat}
                                onChange={e => setRepeat(e.target.value)}
                            />
                        </Field>
                        {error && (
                            <ErrorNote>
                                {error}{' '}
                                <Link href='/forgot-password' style={{ fontWeight: 600, textDecoration: 'underline' }}>
                                    {t('forgotPassword')}
                                </Link>
                            </ErrorNote>
                        )}
                        <Btn
                            type='submit'
                            variant='primary'
                            size='lg'
                            className='btn-block'
                            icon='check'
                            disabled={busy}
                        >
                            {busy ? t('busy') : t('resetSubmit')}
                        </Btn>
                    </form>
                    <div style={{ marginTop: 10 }}>
                        <Link href='/forgot-password' className='btn btn-ghost btn-block'>
                            {p('newLink')}
                        </Link>
                    </div>
                </>
            )}
        </AuthLayout>
    )
}

type Invitation = {
    email: string
    tenantName: string
    role: 'user' | 'admin'
    inviterName: string
    accountExists: boolean
    /** The apps it gives access to: the roles that come with them (named per language) and whether a licence does. */
    apps?: {
        clientId: string
        name: string
        url: string | null
        roles: { key: string; names: Record<'en' | 'nl' | 'fr' | 'de', string> }[]
        seat: boolean
    }[]
}
/** An app after accepting: where to open it, and whether the licence was given (false: no free seat). */
type AcceptedApp = { clientId: string; name: string; url: string | null; seat: boolean }

/** The apps of an invitation: name, roles and "with a licence". */
function InvitationApps({ apps }: { apps: NonNullable<Invitation['apps']> }) {
    const v = useTranslations('Invite')
    const locale = useLocale() as 'en' | 'nl' | 'fr' | 'de'
    if (apps.length === 0) return null
    return (
        <div className='card card-pad' style={{ background: 'var(--surface-2)', fontSize: 13.5 }}>
            <div className='t-eyebrow'>{v('appsTitle')}</div>
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {apps.map(app => (
                    <li key={app.clientId} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                        <strong>{app.name}</strong>
                        {app.roles.length > 0 && (
                            <span className='t-muted'>
                                {app.roles.map(role => role.names[locale] ?? role.names.en).join(', ')}
                            </span>
                        )}
                        {app.seat && (
                            <Badge tone='accent' icon='check'>
                                {v('withLicense')}
                            </Badge>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    )
}

/**
 * /invite?token=...: joins an organisation; without an account it creates one (already verified) with a name and a
 * password. The apps of the invitation (roles, licence) are shown, and can be opened right after accepting.
 */
export function AcceptInvitation({ token }: { token: string }) {
    const t = useTranslations('Oidc')
    const v = useTranslations('Invite')
    const api = useAccountApi()
    const [invitation, setInvitation] = useState<Invitation | null>(null)
    const [form, setForm] = useState({ name: '', password: '', repeat: '' })
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [done, setDone] = useState(false)
    const [accepted, setAccepted] = useState<AcceptedApp[]>([])
    const started = useRef(false)

    useEffect(() => {
        if (started.current) return
        started.current = true
        api('invitation?token=' + encodeURIComponent(token))
            .then(result => {
                if (result.status !== 200) return setError(result.message)
                setInvitation(result.body as unknown as Invitation)
            })
            .catch(() => setError(t('offline')))
        // once per token
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token])

    async function accept() {
        if (!invitation?.accountExists && form.password !== form.repeat) return setError(t('passwordMismatch'))
        setBusy(true)
        setError('')
        try {
            const result = await api(
                'invitation/accept',
                invitation?.accountExists ? { token } : { token, name: form.name.trim(), password: form.password }
            )
            if (result.status === 200) {
                // The apps of the invitation that can be opened right away
                setAccepted(((result.body as { apps?: AcceptedApp[] }).apps ?? []).filter(app => app.url))
                setDone(true)
            } else setError(result.message)
        } catch {
            setError(t('offline'))
        }
        setBusy(false)
    }

    if (!invitation)
        return (
            <AuthLayout>
                <AuthHeading title={t('inviteTitle')} />
                {error ? (
                    <ErrorNote>{error}</ErrorNote>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-3)' }}>
                        <Icon name='loader' className='spin' /> {t('busy')}
                    </div>
                )}
            </AuthLayout>
        )
    if (done)
        return (
            <AuthLayout>
                <Done title={t('inviteDoneTitle', { tenant: invitation.tenantName })} text={t('inviteDoneText')}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {accepted.map(app => (
                            <div key={app.clientId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <a href={app.url!} className='btn btn-primary btn-lg btn-block'>
                                    {v('openApp', { app: app.name })}
                                    <Icon name='arrowRight' size={16} />
                                </a>
                                {invitation.apps?.some(item => item.clientId === app.clientId && item.seat) &&
                                    !app.seat && (
                                        <span className='t-muted' style={{ fontSize: 12.5 }}>
                                            {v('noFreeLicense')}
                                        </span>
                                    )}
                            </div>
                        ))}
                        {accepted.length > 0 ? (
                            <form
                                action='/api/auth/login'
                                method='get'
                                style={{ display: 'flex', flexDirection: 'column' }}
                            >
                                <Btn type='submit' variant='secondary' size='lg' className='btn-block'>
                                    {t('signIn')}
                                </Btn>
                            </form>
                        ) : (
                            <LoginAction label={t('signIn')} />
                        )}
                    </div>
                </Done>
            </AuthLayout>
        )
    const inviteText = t('inviteText', {
        inviter: invitation.inviterName,
        tenant: invitation.tenantName,
        role: roleLabel(t, invitation.role)
    })
    return (
        <AuthLayout>
            <AuthHeading title={t('inviteTitle')} text={inviteText} />

            <InvitationApps apps={invitation.apps ?? []} />

            <form
                className='fade-in'
                style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
                onSubmit={e => {
                    e.preventDefault()
                    void accept()
                }}
            >
                <div className='card card-pad' style={{ background: 'var(--surface-2)', fontSize: 13.5 }}>
                    {invitation.accountExists
                        ? t('inviteExisting', { email: invitation.email, tenant: invitation.tenantName })
                        : t('inviteNewAccount', { email: invitation.email })}
                </div>
                {!invitation.accountExists && (
                    <>
                        <Field label={t('name')}>
                            <Input
                                icon='user'
                                required
                                minLength={2}
                                maxLength={100}
                                autoComplete='name'
                                value={form.name}
                                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                autoFocus
                            />
                        </Field>
                        <Field label={t('password')} hint={t('passwordHint')}>
                            <Input
                                icon='lock'
                                type='password'
                                required
                                minLength={PASSWORD_MIN}
                                maxLength={128}
                                autoComplete='new-password'
                                value={form.password}
                                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                            />
                        </Field>
                        <Field label={t('passwordRepeat')}>
                            <Input
                                icon='lock'
                                type='password'
                                required
                                minLength={PASSWORD_MIN}
                                maxLength={128}
                                autoComplete='new-password'
                                value={form.repeat}
                                onChange={e => setForm(f => ({ ...f, repeat: e.target.value }))}
                            />
                        </Field>
                    </>
                )}
                <ErrorNote>{error}</ErrorNote>
                <Btn type='submit' variant='primary' size='lg' className='btn-block' icon='check' disabled={busy}>
                    {busy ? t('busy') : t('inviteAccept')}
                </Btn>
            </form>
        </AuthLayout>
    )
}
