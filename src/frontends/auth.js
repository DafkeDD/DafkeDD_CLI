/**
 * Optional login/register pages of the Next.js frontend. They talk to the auth endpoints of the backend
 * (POST /auth/register, POST /auth/login, POST /auth/logout, GET /auth/me); the session lives in an httpOnly
 * cookie that the browser sends along (fetch with credentials: 'include').
 *
 * The pages are in the Pasport design, like every frontend of DafkeDD_CLI: the login screens in AuthLayout, the profile
 * in the shell (AppPage), the account in its topbar (src/components/shell/account.ts).
 */

/** Texts of the login pages. Every language needs the same keys (checked by the tests). */
export const AUTH_MESSAGES = {
    en: {
        loginText: 'Log in with your email address and password.',
        registerText: 'Create your account: it takes a minute.',
        asideTitle: 'Welcome',
        asideText: 'One account for everything in this application.',
        profileText: 'Your account in this application.',
        accountTitle: 'Your account',
        accountText: 'Log in or create an account to try the login of this project.',
        showPassword: 'Show password',
        hidePassword: 'Hide password',
        loginTitle: 'Log in',
        registerTitle: 'Create an account',
        name: 'Name',
        email: 'Email address',
        password: 'Password',
        passwordHint: 'At least 8 characters',
        login: 'Log in',
        register: 'Register',
        busy: 'One moment…',
        noAccount: 'No account yet?',
        haveAccount: 'Already have an account?',
        offline: 'The API is not reachable. Is the backend running?',
        profileTitle: 'Your profile',
        signedInAs: 'Signed in as {name}',
        memberSince: 'Member since',
        loading: 'Loading…',
        logout: 'Log out',
        profile: 'Profile'
    },
    nl: {
        loginText: 'Log in met je e-mailadres en wachtwoord.',
        registerText: 'Maak je account aan: het duurt een minuut.',
        asideTitle: 'Welkom',
        asideText: 'Eén account voor alles in deze toepassing.',
        profileText: 'Je account in deze toepassing.',
        accountTitle: 'Je account',
        accountText: 'Log in of maak een account aan om de login van dit project te proberen.',
        showPassword: 'Wachtwoord tonen',
        hidePassword: 'Wachtwoord verbergen',
        loginTitle: 'Inloggen',
        registerTitle: 'Account aanmaken',
        name: 'Naam',
        email: 'E-mailadres',
        password: 'Wachtwoord',
        passwordHint: 'Minstens 8 tekens',
        login: 'Inloggen',
        register: 'Registreren',
        busy: 'Even geduld…',
        noAccount: 'Nog geen account?',
        haveAccount: 'Al een account?',
        offline: 'De API is niet bereikbaar. Draait de backend?',
        profileTitle: 'Je profiel',
        signedInAs: 'Ingelogd als {name}',
        memberSince: 'Lid sinds',
        loading: 'Laden…',
        logout: 'Uitloggen',
        profile: 'Profiel'
    },
    fr: {
        loginText: 'Connectez-vous avec votre adresse e-mail et votre mot de passe.',
        registerText: 'Créez votre compte : cela prend une minute.',
        asideTitle: 'Bienvenue',
        asideText: 'Un seul compte pour tout dans cette application.',
        profileText: 'Votre compte dans cette application.',
        accountTitle: 'Votre compte',
        accountText: 'Connectez-vous ou créez un compte pour essayer la connexion de ce projet.',
        showPassword: 'Afficher le mot de passe',
        hidePassword: 'Masquer le mot de passe',
        loginTitle: 'Se connecter',
        registerTitle: 'Créer un compte',
        name: 'Nom',
        email: 'Adresse e-mail',
        password: 'Mot de passe',
        passwordHint: 'Au moins 8 caractères',
        login: 'Se connecter',
        register: "S'inscrire",
        busy: 'Un instant…',
        noAccount: 'Pas encore de compte ?',
        haveAccount: 'Déjà un compte ?',
        offline: "L'API est injoignable. Le backend est-il démarré ?",
        profileTitle: 'Votre profil',
        signedInAs: 'Connecté en tant que {name}',
        memberSince: 'Membre depuis',
        loading: 'Chargement…',
        logout: 'Se déconnecter',
        profile: 'Profil'
    },
    de: {
        loginText: 'Melde dich mit deiner E-Mail-Adresse und deinem Passwort an.',
        registerText: 'Lege dein Konto an: Es dauert eine Minute.',
        asideTitle: 'Willkommen',
        asideText: 'Ein Konto für alles in dieser Anwendung.',
        profileText: 'Dein Konto in dieser Anwendung.',
        accountTitle: 'Dein Konto',
        accountText: 'Melde dich an oder lege ein Konto an, um die Anmeldung dieses Projekts auszuprobieren.',
        showPassword: 'Passwort anzeigen',
        hidePassword: 'Passwort verbergen',
        loginTitle: 'Anmelden',
        registerTitle: 'Konto erstellen',
        name: 'Name',
        email: 'E-Mail-Adresse',
        password: 'Passwort',
        passwordHint: 'Mindestens 8 Zeichen',
        login: 'Anmelden',
        register: 'Registrieren',
        busy: 'Einen Moment…',
        noAccount: 'Noch kein Konto?',
        haveAccount: 'Schon ein Konto?',
        offline: 'Die API ist nicht erreichbar. Läuft das Backend?',
        profileTitle: 'Dein Profil',
        signedInAs: 'Angemeldet als {name}',
        memberSince: 'Mitglied seit',
        loading: 'Wird geladen…',
        logout: 'Abmelden',
        profile: 'Profil'
    }
}

// The login screens, the profile and the account of the shell, in the Pasport design (src/components/pasport)
export const authFiles = () => ({
    'src/app/[locale]/login/page.tsx': `import { setRequestLocale } from 'next-intl/server'
import { AuthForm } from '@/components/auth-form'

/** Log in: the login screen of the Pasport design. */
export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    return <AuthForm mode='login' />
}
`,

    'src/app/[locale]/register/page.tsx': `import { setRequestLocale } from 'next-intl/server'
import { AuthForm } from '@/components/auth-form'

/** Create an account: the login screen of the Pasport design. */
export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    return <AuthForm mode='register' />
}
`,

    'src/app/[locale]/profile/page.tsx': `import { setRequestLocale } from 'next-intl/server'
import { Profile } from '@/components/profile'
import { AppPage } from '@/components/shell/app-shell'

/** The own profile, in the shell (GET /auth/me; without a login: to /login). */
export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    return (
        <AppPage>
            <Profile />
        </AppPage>
    )
}
`,

    'src/components/auth-form.tsx': `'use client'

import { type FormEvent, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AuthHeading, AuthLayout } from '@/components/pasport/auth-layout'
import { Btn, ErrorNote, Field, Input, PasswordInput } from '@/components/pasport/ui'
import { Link, useRouter } from '@/i18n/navigation'
import { ApiError } from '@/lib/api'
import { useApi } from '@/lib/use-api'

/** Log in or create an account (POST /auth/login, /auth/register). Errors come from the API, in the language. */
export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
    const t = useTranslations('Auth')
    const api = useApi()
    const router = useRouter()
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const isRegister = mode === 'register'

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const values = Object.fromEntries(new FormData(event.currentTarget))
        setBusy(true)
        setError(null)
        try {
            await api.post(isRegister ? '/auth/register' : '/auth/login', values)
            router.push('/profile')
        } catch (err) {
            setError(err instanceof ApiError ? err.message : t('offline'))
            setBusy(false)
        }
    }

    return (
        <AuthLayout eid={false} asideTitle={t('asideTitle')} asideText={t('asideText')}>
            <AuthHeading
                title={isRegister ? t('registerTitle') : t('loginTitle')}
                text={isRegister ? t('registerText') : t('loginText')}
            />
            <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {isRegister && (
                    <Field label={t('name')}>
                        <Input name='name' icon='user' required maxLength={100} autoComplete='name' />
                    </Field>
                )}
                <Field label={t('email')}>
                    <Input name='email' type='email' icon='mail' required autoComplete='email' />
                </Field>
                <Field label={t('password')} hint={isRegister ? t('passwordHint') : undefined}>
                    <PasswordInput
                        name='password'
                        required
                        minLength={isRegister ? 8 : undefined}
                        maxLength={128}
                        autoComplete={isRegister ? 'new-password' : 'current-password'}
                        showLabel={t('showPassword')}
                        hideLabel={t('hidePassword')}
                    />
                </Field>
                <ErrorNote>{error}</ErrorNote>
                <Btn type='submit' size='lg' className='btn-block' disabled={busy} iconRight='arrowRight'>
                    {busy ? t('busy') : isRegister ? t('register') : t('login')}
                </Btn>
                <p style={{ fontSize: 13.5, color: 'var(--text-2)', textAlign: 'center' }}>
                    {isRegister ? t('haveAccount') : t('noAccount')}{' '}
                    <Link href={isRegister ? '/login' : '/register'} className='link-btn'>
                        {isRegister ? t('login') : t('register')}
                    </Link>
                </p>
            </form>
        </AuthLayout>
    )
}
`,

    'src/components/profile.tsx': `'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { PageHead } from '@/components/pasport/page-head'
import { Avatar, Btn, ErrorNote, Skeleton } from '@/components/pasport/ui'
import { useRouter } from '@/i18n/navigation'
import { ApiError } from '@/lib/api'
import { useApi } from '@/lib/use-api'

type Me = { id: string; name: string; email: string; createdAt: string }

/** The own profile from the database (GET /auth/me); without a session to /login. */
export function Profile() {
    const t = useTranslations('Auth')
    const locale = useLocale()
    const api = useApi()
    const router = useRouter()
    const [user, setUser] = useState<Me | null>(null)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        let active = true
        api.get<Me>('/auth/me')
            .then(me => {
                if (active) setUser(me)
            })
            .catch(error => {
                if (!active) return
                if (error instanceof ApiError && error.status === 401) router.replace('/login')
                else setFailed(true)
            })
        return () => {
            active = false
        }
        // router is stable for a locale; only a language change (a new api client) needs a new request
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api])

    async function logout() {
        await api.post('/auth/logout', {})
        router.push('/login')
    }

    return (
        <div className='fade-in' style={{ maxWidth: 760, margin: '0 auto' }}>
            <PageHead title={t('profileTitle')} text={t('profileText')} />
            <ErrorNote>{failed ? t('offline') : null}</ErrorNote>
            {!failed && !user && <Skeleton h={120} />}
            {user && (
                <div className='card card-pad' style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <Avatar name={user.name} size={52} />
                        <div>
                            <div style={{ fontWeight: 650, fontSize: 17 }}>{user.name}</div>
                            <div style={{ color: 'var(--text-3)', fontSize: 13.5 }}>{user.email}</div>
                        </div>
                    </div>
                    <dl className='form-grid'>
                        <div>
                            <dt className='t-eyebrow'>{t('name')}</dt>
                            <dd>{user.name}</dd>
                        </div>
                        <div>
                            <dt className='t-eyebrow'>{t('memberSince')}</dt>
                            <dd>
                                {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                                    new Date(user.createdAt)
                                )}
                            </dd>
                        </div>
                    </dl>
                    <div>
                        <Btn variant='secondary' icon='logout' onClick={logout}>
                            {t('logout')}
                        </Btn>
                    </div>
                </div>
            )}
        </div>
    )
}
`,

    // The account in the topbar of the shell: logged in (name, profile, log out) or not (nothing; see AuthLinks)
    'src/components/shell/account.ts': `'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { NavItem, ShellAccount } from '@/components/pasport/shell'
import { useRouter } from '@/i18n/navigation'
import { useApi } from '@/lib/use-api'

type Me = { name: string; email: string }

/** The logged in account in the topbar of the shell (GET /auth/me), with the profile in its menu. */
export function useAccount(): { account: ShellAccount | null; menu: NavItem[] } {
    const t = useTranslations('Auth')
    const api = useApi()
    const router = useRouter()
    const [me, setMe] = useState<Me | null>(null)
    useEffect(() => {
        let active = true
        api.get<Me>('/auth/me')
            .then(user => {
                if (active) setMe(user)
            })
            // 401: not logged in; the API down: no account either
            .catch(() => undefined)
        return () => {
            active = false
        }
    }, [api])
    if (!me) return { account: null, menu: [] }
    return {
        account: {
            name: me.name,
            sub: me.email,
            email: me.email,
            onLogout: () =>
                void api
                    .post('/auth/logout', {})
                    .catch(() => undefined)
                    .then(() => router.push('/login'))
        },
        menu: [{ key: '/profile', name: t('profile'), icon: 'user', href: '/profile' }]
    }
}
`,

    'src/components/auth-links.tsx': `'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Icon } from '@/components/pasport/ui'
import { Link } from '@/i18n/navigation'
import { useApi } from '@/lib/use-api'

type State = { kind: 'loading' } | { kind: 'offline' } | { kind: 'anonymous' } | { kind: 'user'; name: string }

/** A card on the home page: log in and register, or "Signed in as ..." with a link to the profile. */
export function AuthLinks() {
    const t = useTranslations('Auth')
    const api = useApi()
    const [state, setState] = useState<State>({ kind: 'loading' })

    useEffect(() => {
        let active = true
        api.get<{ name: string }>('/auth/me')
            .then(me => {
                if (active) setState({ kind: 'user', name: me.name })
            })
            // 401 means: not logged in. Any other error means the API cannot be reached.
            .catch((error: { status?: number }) => {
                if (active) setState({ kind: error.status === 401 ? 'anonymous' : 'offline' })
            })
        return () => {
            active = false
        }
    }, [api])

    if (state.kind === 'loading' || state.kind === 'offline') return null

    return (
        <section className='card card-pad' style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span className='kpi-icon'>
                <Icon name='user' size={18} />
            </span>
            <div style={{ flex: '1 1 220px' }}>
                <h2 className='t-h3'>{t('accountTitle')}</h2>
                <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
                    {state.kind === 'user' ? t('signedInAs', { name: state.name }) : t('accountText')}
                </p>
            </div>
            {state.kind === 'user' ? (
                <Link href='/profile' className='btn btn-secondary'>
                    {t('profile')}
                </Link>
            ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                    <Link href='/login' className='btn btn-primary'>
                        {t('login')}
                    </Link>
                    <Link href='/register' className='btn btn-secondary'>
                        {t('register')}
                    </Link>
                </div>
            )}
        </section>
    )
}
`
})
