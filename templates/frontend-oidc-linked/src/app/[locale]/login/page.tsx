import { Suspense } from 'react'
import { setRequestLocale } from 'next-intl/server'
import { StartLogin } from '@/components/shell/start-login'

type Search = Promise<{ error?: string; returnTo?: string }>

/**
 * /login: starts a login at once at the login server this app is linked to and comes back to ?returnTo= (the proxy
 * sends every protected page here without a session); its login screen (the same in every app) does the rest, also
 * registering. /login?error=...: why the last login failed (for example access_denied).
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
        // The query string is only known per request: render that part when the request comes in
        <Suspense fallback={null}>
            <LoginContent searchParams={searchParams} />
        </Suspense>
    )
}

async function LoginContent({ searchParams }: { searchParams: Search }) {
    const { error, returnTo } = await searchParams
    const back = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : undefined
    return <StartLogin error={error} returnTo={back} />
}
