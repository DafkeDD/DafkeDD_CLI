'use client'

import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useEid } from '@dafkedd/eid/react'
import { Link } from '@/i18n/navigation'
import { EidBridge, EidPin, type EidToken } from '@/components/eid'
import { AuthHeading, AuthLayout, Divider } from '@/components/pasport/auth-layout'
import { Badge, Btn, ErrorNote, Field, Icon, Input, OkNote } from '@/components/pasport/ui'
import { OtpInput, QrSvg } from '@/components/pasport/widgets'
import { useAccountApi } from '@/lib/account'
import { cancelled, getPasskey, type GetOptions, passkeysSupported } from '@/lib/webauthn'
import { API_URL } from '@/lib/api'

type Tenant = { id: string; name: string; role?: 'user' | 'admin' }
type Login = {
    clientId: string
    clientName: string
    csrf: string
    loginHint: string
    registration: boolean
    eid: boolean
    /** "Log in with a passkey" (OIDC_PASSKEYS, and this browser can). */
    passkey: boolean
    /** Email and password (false: only the other OpenID Connect server). */
    password: boolean
    /** "Log in with <name>": other OpenID Connect servers (for example itsme®, Google and Microsoft), one button each. */
    externals: External[]
}
type External = { id: string; name: string }
type State =
    | { step: 'loading' }
    | ({ step: 'login' | 'eid' } & Login)
    | { step: 'tenant'; csrf: string; tenants: Tenant[]; platform: boolean }
    | { step: 'mfa'; csrf: string }
    | { step: 'mfa-setup'; csrf: string; secret: string; qrSvg: string }
    | { step: 'recovery-codes'; csrf: string; codes: string[] }
    /** An application that is not our own asks for data of the account: allow or not. */
    | { step: 'consent'; csrf: string; clientName: string; email: string; scopes: string[] }
    | { step: 'fatal'; message: string }

type Answer = {
    status?: string
    error?: string
    message?: string
    location?: string
    csrf?: string
    tenants?: Tenant[]
    clientId?: string
    clientName?: string
    loginHint?: string
    registration?: boolean
    eid?: boolean
    passkey?: boolean
    options?: GetOptions
    password?: boolean
    external?: { name: string } | null
    externals?: External[]
    pending?: boolean
    nonce?: string
    secret?: string
    qrSvg?: string
    recoveryCodes?: string[]
    scopes?: string[]
    email?: string
    platform?: boolean
}

/** What a scope gives an application, in words (the consent screen and /security). */
export function scopeLabel(t: (key: string) => string, scope: string): string {
    switch (scope) {
        case 'openid':
            return t('scopeOpenid')
        case 'profile':
            return t('scopeProfile')
        case 'email':
            return t('scopeEmail')
        case 'tenant':
            return t('scopeTenant')
        default:
            return scope
    }
}

/** From this many organisations on, the choice gets a search field. */
const SEARCH_FROM = 7

/** The design's three steps of the eID: card, reading (PIN), verified, driven by the state of the eID program. */
function EidSteps() {
    const p = useTranslations('AuthScreen')
    const eid = useEid()
    const waiting = ['connecting', 'no-bridge', 'bridge-outdated', 'no-reader', 'no-card'].includes(eid.phase)
    const steps = [
        { key: 'insert', txt: p('stepInsert'), sub: p('stepInsertSub'), ic: 'eid', st: waiting ? 'active' : 'done' },
        { key: 'reading', txt: p('stepPin'), sub: p('stepPinSub'), ic: 'key', st: waiting ? 'pending' : 'active' },
        { key: 'success', txt: p('stepVerified'), sub: p('stepVerifiedSub'), ic: 'shieldCheck', st: 'pending' }
    ]
    return (
        <div className='step-list' style={{ marginBottom: 18 }}>
            {steps.map(s => (
                <div className={`step-row ${s.st}`} key={s.key}>
                    <div className='step-ic'>
                        {s.st === 'done' ? (
                            <Icon name='check' size={16} />
                        ) : (
                            <Icon
                                name={s.key === 'insert' && eid.phase === 'connecting' ? 'loader' : s.ic}
                                size={16}
                                className={s.key === 'insert' && eid.phase === 'connecting' ? 'spin' : ''}
                            />
                        )}
                    </div>
                    <div>
                        <div className='step-txt'>{s.txt}</div>
                        <div className='step-sub'>{s.sub}</div>
                    </div>
                </div>
            ))}
        </div>
    )
}

/**
 * The login page of the OIDC server, shown by this frontend: /login?interaction=<id>. It talks to the JSON variant of
 * /oidc/interaction/<id> on the API (with credentials, so the browser keeps the session cookie of the login server)
 * and finally sends the browser back to the application that asked for the login.
 */
export function OidcLogin({
    interaction,
    externalError,
    ownClient
}: {
    interaction: string
    externalError?: string
    /** The client id of this frontend: a login for another app says "Log in to <app>". */
    ownClient?: string
}) {
    const t = useTranslations('Oidc')
    const p = useTranslations('AuthScreen')
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
    const [tab, setTab] = useState<'eid' | 'email'>('eid')
    // Set when the password was right but the email address is not verified yet: offers to send the email again
    const [unverified, setUnverified] = useState('')
    const [resent, setResent] = useState(false)
    const [search, setSearch] = useState('')
    const [code, setCode] = useState('')
    const [useRecovery, setUseRecovery] = useState(false)
    const [copied, setCopied] = useState(false)
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
                    const login: Login = {
                        clientId: answer.clientId ?? '',
                        clientName: answer.clientName ?? '',
                        csrf: answer.csrf,
                        loginHint: answer.loginHint ?? '',
                        registration: answer.registration !== false,
                        eid: answer.eid === true,
                        passkey: answer.passkey === true && passkeysSupported(),
                        password: answer.password !== false,
                        // A login server of before several were possible only says `external` (the first)
                        externals:
                            answer.externals ?? (answer.external ? [{ id: '1', name: answer.external.name }] : [])
                    }
                    // Without eID, itsme® or passkey there is nothing on the first tab: open the email tab
                    if (!login.eid && !login.externals.length && !login.passkey) setTab('email')
                    setState({ step: 'login', ...login })
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
            setCode('')
            setBusy(false)
            return
        }
        if (answer.status === 'consent' && answer.csrf) {
            setState({
                step: 'consent',
                csrf: answer.csrf,
                clientName: answer.clientName ?? '',
                email: answer.email ?? '',
                scopes: answer.scopes ?? []
            })
            setError(null)
        } else if (answer.status === 'choose-tenant' && answer.csrf) {
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
    function onExternal(provider: string) {
        if (state.step !== 'login') return
        void submit('/external', { csrf: state.csrf, provider })
    }

    /** "Log in with a passkey": a challenge, the device signs it (fingerprint, face or PIN), the answer goes back. */
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
        } catch (e) {
            setError(cancelled(e) ? t('passkeyCancelled') : t('passkeyFailed'))
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
        // The card and PIN are the first factor only: the authenticator code (or its setup) follows
        if (
            ['redirect', 'choose-tenant', 'no-tenant', 'expired', 'mfa', 'mfa-setup', 'consent'].includes(
                answer.status ?? ''
            )
        ) {
            handle(status, answer)
            return null
        }
        return answer.message ?? t('eidFailed')
    }

    const sendCode = (value = code) => {
        if (state.step !== 'mfa' && state.step !== 'mfa-setup') return
        if (!useRecovery && value.length < 6) return
        void submit('/mfa', { csrf: state.csrf, code: value })
    }

    const layout = (children: ReactNode) => <AuthLayout>{children}</AuthLayout>

    if (state.step === 'loading')
        return layout(
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-3)' }}>
                <Icon name='loader' className='spin' /> {t('busy')}
            </div>
        )

    if (state.step === 'fatal')
        return layout(
            <>
                <AuthHeading title={t('loginTitle')} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <ErrorNote>{state.message}</ErrorNote>
                    <form action='/api/auth/login' method='get' style={{ display: 'flex', flexDirection: 'column' }}>
                        <Btn type='submit' size='lg' className='btn-block' icon='refresh'>
                            {t('startAgain')}
                        </Btn>
                    </form>
                </div>
            </>
        )

    if (state.step === 'mfa' || state.step === 'mfa-setup') {
        const setup = state.step === 'mfa-setup' ? state : null
        return layout(
            <>
                <AuthHeading
                    title={setup ? p('mfaSetupTitle') : p('mfaTitle')}
                    text={setup ? p('mfaSetupText') : p('mfaText')}
                />
                <form
                    key={state.step}
                    style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
                    onSubmit={e => {
                        e.preventDefault()
                        sendCode()
                    }}
                >
                    <div className='mfa-head'>
                        <div className='mfa-badge'>
                            <Icon name='lock' size={20} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div className='step-txt' style={{ fontSize: 14.5 }}>
                                {setup ? p('authenticatorSetup') : p('authenticator')}
                            </div>
                            <div className='step-sub'>{setup ? p('authenticatorSetupSub') : p('authenticatorSub')}</div>
                        </div>
                        {setup ? (
                            <Badge tone='amber' icon='alert'>
                                {p('required')}
                            </Badge>
                        ) : (
                            <Badge tone='accent' icon='shieldCheck'>
                                2FA
                            </Badge>
                        )}
                    </div>
                    {setup && (
                        <div
                            className='card card-pad'
                            style={{
                                background: 'var(--surface-2)',
                                display: 'flex',
                                gap: 18,
                                alignItems: 'flex-start',
                                flexWrap: 'wrap'
                            }}
                        >
                            <QrSvg svg={setup.qrSvg} size={132} label={t('mfaQr')} />
                            <div style={{ flex: '1 1 200px', minWidth: 200 }}>
                                <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
                                    {p('scanText')}
                                </p>
                                <div style={{ marginTop: 12 }}>
                                    <div className='hint' style={{ marginBottom: 5 }}>
                                        {t('mfaSecret')}
                                    </div>
                                    <div
                                        className='t-mono'
                                        style={{
                                            fontSize: 13,
                                            fontWeight: 600,
                                            background: 'var(--surface)',
                                            border: '1px solid var(--border)',
                                            borderRadius: 'var(--r-sm)',
                                            padding: '8px 11px',
                                            letterSpacing: '.04em',
                                            wordBreak: 'break-all',
                                            userSelect: 'all'
                                        }}
                                    >
                                        {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div>
                        {useRecovery ? (
                            <Field label={p('recoveryCode')}>
                                <Input
                                    className='t-mono'
                                    value={code}
                                    autoFocus
                                    autoComplete='off'
                                    maxLength={20}
                                    onChange={e => setCode(e.target.value.trim())}
                                />
                            </Field>
                        ) : (
                            <OtpInput
                                length={6}
                                value={code}
                                setValue={v => {
                                    setCode(v)
                                    if (error) setError(null)
                                }}
                                onComplete={v => sendCode(v)}
                                error={!!error}
                                autoFocus
                                label={n => p('digit', { n })}
                            />
                        )}
                        {error ? (
                            <p
                                className='hint'
                                style={{
                                    color: 'var(--red)',
                                    marginTop: 11,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6
                                }}
                            >
                                <Icon name='alert' size={13} /> {error}
                            </p>
                        ) : (
                            <p className='hint' style={{ marginTop: 11 }}>
                                {useRecovery ? p('recoveryHint') : setup ? p('setupCodeHint') : p('codeHint')}
                            </p>
                        )}
                    </div>
                    {setup && (
                        <div
                            className='card card-pad'
                            style={{
                                display: 'flex',
                                gap: 10,
                                alignItems: 'flex-start',
                                background: 'var(--amber-tint)',
                                border: '1px solid var(--amber-border)'
                            }}
                        >
                            <div style={{ color: 'var(--amber)', marginTop: 1, flex: 'none' }}>
                                <Icon name='shieldCheck' size={16} />
                            </div>
                            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55 }}>{p('mandatory')}</p>
                        </div>
                    )}
                    <Btn
                        type='submit'
                        variant='primary'
                        size='lg'
                        className='btn-block'
                        icon='shieldCheck'
                        disabled={(useRecovery ? code.length < 6 : code.length < 6) || busy}
                    >
                        {busy ? p('verifying') : setup ? p('confirmActivate') : p('verifyLogin')}
                    </Btn>
                    {!setup && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                            <a
                                role='button'
                                tabIndex={0}
                                style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}
                                onClick={() => {
                                    setUseRecovery(r => !r)
                                    setCode('')
                                    setError(null)
                                }}
                            >
                                {useRecovery ? p('useApp') : p('useRecovery')}
                            </a>
                        </div>
                    )}
                </form>
            </>
        )
    }

    if (state.step === 'recovery-codes')
        return layout(
            <>
                <AuthHeading title={t('recoveryTitle')} text={t('recoveryText')} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                    <div
                        className='card card-pad t-mono'
                        style={{
                            background: 'var(--surface-2)',
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: '8px 24px',
                            fontSize: 14,
                            fontWeight: 600,
                            letterSpacing: '.03em'
                        }}
                    >
                        {state.codes.map(c => (
                            <span key={c}>{c}</span>
                        ))}
                    </div>
                    <Btn
                        variant='secondary'
                        icon={copied ? 'check' : 'copy'}
                        onClick={() =>
                            void navigator.clipboard
                                ?.writeText(state.codes.join('\n'))
                                .then(() => setCopied(true))
                                .catch(() => undefined)
                        }
                    >
                        {copied ? t('copied') : t('copyCodes')}
                    </Btn>
                    <Btn
                        variant='primary'
                        size='lg'
                        className='btn-block'
                        iconRight='arrowRight'
                        disabled={busy}
                        onClick={() => void submit('/continue', { csrf: state.csrf })}
                    >
                        {busy ? t('busy') : t('continue')}
                    </Btn>
                </div>
            </>
        )

    if (state.step === 'consent')
        return layout(
            <>
                <AuthHeading
                    title={t('consentTitle', { client: state.clientName })}
                    text={t('consentText', { client: state.clientName, email: state.email })}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div className='card card-pad' style={{ background: 'var(--surface-2)', display: 'grid', gap: 10 }}>
                        {state.scopes.map(scope => (
                            <div key={scope} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
                                <span
                                    style={{
                                        width: 22,
                                        height: 22,
                                        borderRadius: 999,
                                        background: 'var(--accent-tint)',
                                        color: 'var(--accent)',
                                        display: 'grid',
                                        placeItems: 'center',
                                        flex: 'none'
                                    }}
                                >
                                    <Icon name='check' size={13} />
                                </span>
                                {scopeLabel(t, scope)}
                            </div>
                        ))}
                    </div>
                    <p className='hint'>{t('consentNote')}</p>
                    <ErrorNote>{error}</ErrorNote>
                    <Btn
                        variant='primary'
                        size='lg'
                        className='btn-block'
                        icon='check'
                        disabled={busy}
                        onClick={() => void submit('/consent', { csrf: state.csrf, decision: 'allow' })}
                    >
                        {busy ? t('busy') : t('consentAllow')}
                    </Btn>
                    <Btn
                        variant='ghost'
                        size='lg'
                        className='btn-block'
                        disabled={busy}
                        onClick={() => void submit('/consent', { csrf: state.csrf, decision: 'deny' })}
                    >
                        {t('consentDeny')}
                    </Btn>
                </div>
            </>
        )

    if (state.step === 'tenant') {
        const query = search.trim().toLowerCase()
        const shown = state.tenants.filter(tenant => tenant.name.toLowerCase().includes(query))
        const choice = (key: string, label: string, sub: string, icon: string, tenant: string) => (
            <button
                type='button'
                key={key}
                className='step-row'
                disabled={busy}
                style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }}
                onClick={() => void submit('/tenant', { csrf: state.csrf, tenant })}
            >
                <div className='step-ic'>
                    <Icon name={icon} size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div className='step-txt'>{label}</div>
                    <div className='step-sub'>{sub}</div>
                </div>
                <Icon name='chevronRight' size={16} style={{ color: 'var(--text-3)' }} />
            </button>
        )
        return layout(
            <>
                <AuthHeading title={t('tenantTitle')} text={t('tenantSubtitle')} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {state.tenants.length >= SEARCH_FROM && (
                        <Input
                            icon='search'
                            type='search'
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder={t('searchTenant')}
                            aria-label={t('searchTenant')}
                        />
                    )}
                    <div className='step-list' style={{ maxHeight: 380, overflowY: 'auto', gap: 8 }}>
                        {state.platform &&
                            choice('platform', t('platformChoice'), t('superadmin'), 'shield', 'platform')}
                        {shown.map(tenant =>
                            choice(
                                tenant.id,
                                tenant.name,
                                tenant.role === 'admin' ? t('role_admin') : t('role_user'),
                                'building',
                                tenant.id
                            )
                        )}
                        {shown.length === 0 && <p className='hint'>{t('noTenantFound')}</p>}
                    </div>
                    <ErrorNote>{error}</ErrorNote>
                </div>
            </>
        )
    }

    if (state.step === 'eid')
        return layout(
            <>
                <AuthHeading title={p('eidTitle')} text={p('eidText')} />
                <EidBridge>
                    <EidSteps />
                    <EidPin submitLabel={p('eidSubmit')} getNonce={eidNonce} onToken={eidSubmit} />
                </EidBridge>
                <div style={{ marginTop: 16 }}>
                    <Btn
                        variant='ghost'
                        size='sm'
                        icon='arrowLeft'
                        onClick={() => setState({ ...state, step: 'login' })}
                    >
                        {p('back')}
                    </Btn>
                </div>
            </>
        )

    // The first screen: eID / itsme® / passkey, or email and password
    const firstTab = state.eid || state.externals.length > 0 || state.passkey
    const externalIcon = (name: string) => (/itsme/i.test(name) ? 'itsme' : 'globe')
    return layout(
        <>
            <AuthHeading
                title={
                    state.clientName && state.clientId !== ownClient
                        ? t('loginTitleApp', { client: state.clientName })
                        : p('welcome')
                }
                text={
                    state.clientName && state.clientId !== ownClient
                        ? t('loginSubtitle', { client: state.clientName })
                        : p('welcomeText')
                }
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {firstTab && state.password && (
                    <div className='seg' style={{ display: 'flex' }} role='tablist'>
                        <button
                            type='button'
                            role='tab'
                            aria-selected={tab === 'eid'}
                            className={tab === 'eid' ? 'active' : ''}
                            style={{ flex: 1 }}
                            onClick={() => setTab('eid')}
                        >
                            {state.externals.some(external => /itsme/i.test(external.name))
                                ? p('tabEidItsme')
                                : p('tabEid')}
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
                <ErrorNote>{error}</ErrorNote>
                {(tab === 'eid' && firstTab) || !state.password ? (
                    <div className='fade-in' style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {state.eid && (
                            <Btn
                                variant='primary'
                                size='lg'
                                className='btn-block'
                                icon='eid'
                                disabled={busy}
                                onClick={() => {
                                    setError(null)
                                    setState({ ...state, step: 'eid' })
                                }}
                            >
                                {p('loginEid')}
                            </Btn>
                        )}
                        {state.externals.map((external, index) => (
                            <Btn
                                key={external.id}
                                variant={state.eid || index > 0 ? 'secondary' : 'primary'}
                                size='lg'
                                className='btn-block'
                                icon={externalIcon(external.name)}
                                disabled={busy}
                                onClick={() => onExternal(external.id)}
                            >
                                {p('loginWith', { name: external.name })}
                            </Btn>
                        ))}
                        {state.passkey && (
                            <Btn
                                variant='secondary'
                                size='lg'
                                className='btn-block'
                                icon='fingerprint'
                                disabled={busy}
                                onClick={() => void onPasskey()}
                            >
                                {t('passkeyLogin')}
                            </Btn>
                        )}
                        <p className='hint' style={{ textAlign: 'center', marginTop: 2 }}>
                            {p('eidHint')}
                        </p>
                    </div>
                ) : (
                    <form
                        key='login'
                        onSubmit={onLogin}
                        className='fade-in'
                        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
                    >
                        <Field label={t('email')}>
                            <Input
                                icon='mail'
                                name='email'
                                type='email'
                                required
                                maxLength={254}
                                autoComplete='username'
                                placeholder={p('emailPlaceholder')}
                                defaultValue={state.loginHint}
                            />
                        </Field>
                        <Field label={t('password')}>
                            <Input
                                icon='lock'
                                name='password'
                                type='password'
                                required
                                maxLength={128}
                                autoComplete='current-password'
                                placeholder='••••••••••'
                            />
                        </Field>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
                            <Link
                                href='/forgot-password'
                                style={{
                                    fontSize: 13.5,
                                    color: 'var(--accent)',
                                    fontWeight: 600,
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                {t('forgotPassword')}
                            </Link>
                        </div>
                        {unverified && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <Btn variant='secondary' size='sm' icon='mail' onClick={() => void resend()}>
                                    {t('resend')}
                                </Btn>
                                {resent && <OkNote>{t('resent')}</OkNote>}
                            </div>
                        )}
                        <Btn
                            type='submit'
                            variant='primary'
                            size='lg'
                            className='btn-block'
                            iconRight='arrowRight'
                            disabled={busy}
                        >
                            {busy ? t('busy') : p('login')}
                        </Btn>
                        <p className='hint' style={{ textAlign: 'center', marginTop: 2 }}>
                            {p('emailHint')}
                        </p>
                    </form>
                )}
                {state.registration && (
                    <>
                        <Divider label={t('noAccount')} />
                        <Link href='/register' className='btn btn-ghost btn-lg btn-block'>
                            <Icon name='plus' size={16} /> {t('register')}
                        </Link>
                    </>
                )}
            </div>
        </>
    )
}
