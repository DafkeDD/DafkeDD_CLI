import { Suspense } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { OidcLogin } from '@/components/oidc-login'

const BUTTON =
    'inline-flex h-11 items-center justify-center rounded-xl bg-[var(--accent,#171717)] px-5 text-sm font-semibold text-[var(--accent-fg,#ffffff)] dark:bg-[var(--accent,#ededed)] dark:text-[var(--accent-fg,#0a0a0a)]'
const CARD =
    'flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-black/10 bg-black/[.03] p-6 text-left dark:border-white/15 dark:bg-white/[.04]'

type Search = Promise<{ interaction?: string; error?: string }>

/**
 * /login?interaction=<id>: the login page of the OIDC server (the API sends the browser here).
 * /login without interaction: a button that starts a login; /login?error=...: why the last login failed.
 */
export default async function LoginPage({
    params,
    searchParams
}: {
    params: Promise<{ locale: string }>
    searchParams: Search
}) {
    const { locale } = await params
    setRequestLocale(locale)

    return (
        <main className='flex flex-1 flex-col items-center justify-center px-6 pt-10 pb-28'>
            {/* The query string is only known per request: render that part when the request comes in */}
            <Suspense fallback={null}>
                <LoginContent searchParams={searchParams} />
            </Suspense>
        </main>
    )
}

async function LoginContent({ searchParams }: { searchParams: Search }) {
    const { interaction, error } = await searchParams
    const t = await getTranslations('Oidc')
    // ?error=: the login at the other OpenID Connect server did not work (back from its callback)
    if (interaction) return <OidcLogin interaction={interaction} externalError={error} />

    return (
        <section className={CARD}>
            <h1 className='text-2xl font-bold tracking-tight'>{t('loginTitle')}</h1>
            <p className='text-sm opacity-80'>{t('startText')}</p>
            {error && (
                <div role='alert' className='text-sm text-red-600 dark:text-red-400'>
                    {error === 'offline' ? t('offline') : t('failed', { error })}
                </div>
            )}
            {/* A form, not a link: /api/auth/login is a route handler that needs a full page load */}
            <form action='/api/auth/login' method='get' className='flex flex-col'>
                <button type='submit' className={BUTTON}>
                    {t('signIn')}
                </button>
            </form>
        </section>
    )
}
