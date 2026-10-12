/**
 * Optional login/register pages of the Next.js frontend. They talk to the auth endpoints of the backend
 * (POST /auth/register, POST /auth/login, POST /auth/logout, GET /auth/me); the session lives in an httpOnly
 * cookie that the browser sends along (fetch with credentials: 'include').
 *
 * The pages look the same with and without DafkeDD UI: they use plain Tailwind classes and pick up the accent
 * colour of DafkeDD UI (--accent) when it is installed.
 */

/** Texts of the login pages. Every language needs the same keys (checked by the tests). */
export const AUTH_MESSAGES = {
    en: {
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

const page = (name, body) => `import { use } from 'react';
import { setRequestLocale } from 'next-intl/server';
${body.import}

export default function ${name}Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 pt-10 pb-28">
      ${body.element}
    </main>
  );
}
`

const CARD =
    'flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-black/10 bg-black/[.03] p-6 text-left dark:border-white/15 dark:bg-white/[.04]'
const INPUT =
    'h-11 w-full rounded-xl border border-black/15 bg-transparent px-3.5 text-sm outline-none focus:border-[var(--accent,#6366f1)] dark:border-white/20'
const BUTTON =
    'inline-flex h-11 items-center justify-center rounded-xl bg-[var(--accent,#171717)] px-5 text-sm font-semibold text-[var(--accent-fg,#ffffff)] disabled:opacity-60 dark:bg-[var(--accent,#ededed)] dark:text-[var(--accent-fg,#0a0a0a)]'

// Spacing uses flex gap, not margins: DafkeDD UI resets the margins of headings and paragraphs.
export const authFiles = () => ({
    'src/app/[locale]/login/page.tsx': page('Login', {
        import: "import { AuthForm } from '@/components/auth-form';",
        element: '<AuthForm mode="login" />'
    }),

    'src/app/[locale]/register/page.tsx': page('Register', {
        import: "import { AuthForm } from '@/components/auth-form';",
        element: '<AuthForm mode="register" />'
    }),

    'src/app/[locale]/profile/page.tsx': page('Profile', {
        import: "import { Profile } from '@/components/profile';",
        element: '<Profile />'
    }),

    'src/components/auth-form.tsx': `'use client';

import { FormEvent, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/** Login and register form. Errors come from the API, already in the selected language. */
export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const t = useTranslations('Auth');
  const api = useApi();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isRegister = mode === 'register';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError(null);
    try {
      await api.post(isRegister ? '/auth/register' : '/auth/login', values);
      router.push('/profile');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('offline'));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="${CARD}">
      <h1 className="text-2xl font-bold tracking-tight">{isRegister ? t('registerTitle') : t('loginTitle')}</h1>

      {isRegister && (
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('name')}
          <input name="name" type="text" required maxLength={100} autoComplete="name" className="${INPUT}" />
        </label>
      )}

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t('email')}
        <input name="email" type="email" required autoComplete="email" className="${INPUT}" />
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t('password')}
        <input
          name="password"
          type="password"
          required
          minLength={isRegister ? 8 : undefined}
          maxLength={128}
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          className="${INPUT}"
        />
        {isRegister && <span className="text-xs font-normal opacity-70">{t('passwordHint')}</span>}
      </label>

      {error && (
        <p role="alert" className="text-sm whitespace-pre-line text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy} className="${BUTTON}">
        {busy ? t('busy') : isRegister ? t('register') : t('login')}
      </button>

      <p className="text-sm opacity-80">
        {isRegister ? t('haveAccount') : t('noAccount')}{' '}
        <Link href={isRegister ? '/login' : '/register'} className="font-semibold underline">
          {isRegister ? t('login') : t('register')}
        </Link>
      </p>
    </form>
  );
}
`,

    'src/components/profile.tsx': `'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';

type Me = { id: string; name: string; email: string; createdAt: string };

/** Protected page: shows the logged in user from the database, or sends you to the login page. */
export function Profile() {
  const t = useTranslations('Auth');
  const locale = useLocale();
  const api = useApi();
  const router = useRouter();
  const [user, setUser] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get<Me>('/auth/me')
      .then((me) => {
        if (active) setUser(me);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) router.replace('/login');
        else setFailed(true);
      });
    return () => {
      active = false;
    };
    // router is stable for a locale; only a language change (a new api client) needs a new request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  async function logout() {
    await api.post('/auth/logout', {});
    router.push('/');
  }

  return (
    <section className="${CARD}">
      <h1 className="text-2xl font-bold tracking-tight">{t('profileTitle')}</h1>
      {failed && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t('offline')}</p>}
      {!failed && !user && <p className="text-sm opacity-70">{t('loading')}</p>}
      {user && (
        <>
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs opacity-70">{t('name')}</dt>
              <dd className="font-medium">{user.name}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs opacity-70">{t('email')}</dt>
              <dd className="font-medium">{user.email}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs opacity-70">{t('memberSince')}</dt>
              <dd className="font-medium">
                {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(user.createdAt))}
              </dd>
            </div>
          </dl>
          <button type="button" onClick={logout} className="${BUTTON}">
            {t('logout')}
          </button>
        </>
      )}
    </section>
  );
}
`,

    'src/components/auth-links.tsx': `'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useApi } from '@/lib/use-api';

type State = { kind: 'loading' } | { kind: 'offline' } | { kind: 'anonymous' } | { kind: 'user'; name: string };

/** Links on the home page: log in and register, or "Signed in as ..." with a link to the profile. */
export function AuthLinks() {
  const t = useTranslations('Auth');
  const api = useApi();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    api
      .get<{ name: string }>('/auth/me')
      .then((me) => {
        if (active) setState({ kind: 'user', name: me.name });
      })
      // 401 means: not logged in. Any other error means the API cannot be reached.
      .catch((error: { status?: number }) => {
        if (active) setState({ kind: error.status === 401 ? 'anonymous' : 'offline' });
      });
    return () => {
      active = false;
    };
  }, [api]);

  if (state.kind === 'loading' || state.kind === 'offline') return null;

  return (
    <div className="relative flex flex-wrap items-center justify-center gap-3 text-sm">
      {state.kind === 'user' ? (
        <>
          <span>{t('signedInAs', { name: state.name })}</span>
          <Link href="/profile" className="font-semibold underline">
            {t('profile')}
          </Link>
        </>
      ) : (
        <>
          <Link href="/login" className="font-semibold underline">
            {t('login')}
          </Link>
          <Link href="/register" className="font-semibold underline">
            {t('register')}
          </Link>
        </>
      )}
    </div>
  );
}
`
})
