import { Suspense } from 'react'
import { setRequestLocale } from 'next-intl/server'
import { OidcLogin } from '@/components/oidc-login'
import { AuthPage } from '@/components/shell/auth-screen'
import { StartLogin } from '@/components/shell/start-login'

type Search = Promise<{ interaction?: string; error?: string }>

/**
 * /login?interaction=<id>: the login screen of the OIDC server (the API sends the browser here, also for every app
 * linked to it). /login without interaction starts a login at once; /login?error=...: why the last login failed.
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
        <AuthPage>
            {/* The query string is only known per request: render that part when the request comes in */}
            <Suspense fallback={null}>
                <LoginContent searchParams={searchParams} />
            </Suspense>
        </AuthPage>
    )
}

async function LoginContent({ searchParams }: { searchParams: Search }) {
    const { interaction, error } = await searchParams
    // ?error=: the login at the other OpenID Connect server did not work (back from its callback)
    if (interaction) return <OidcLogin interaction={interaction} externalError={error} />
    return <StartLogin error={error} />
}
