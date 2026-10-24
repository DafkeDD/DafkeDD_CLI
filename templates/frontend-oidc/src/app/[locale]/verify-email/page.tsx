import { Suspense } from 'react'
import { setRequestLocale } from 'next-intl/server'
import { VerifyEmail } from '@/components/account-forms'

type Search = Promise<{ token?: string }>

/** The link in the verification email: /verify-email?token=... (POST /oidc/account/verify-email). */
export default async function VerifyEmailPage({
    params,
    searchParams
}: {
    params: Promise<{ locale: string }>
    searchParams: Search
}) {
    setRequestLocale((await params).locale)
    return (
        <>
            {/* The token is only known per request: render that part when the request comes in */}
            <Suspense fallback={null}>
                <WithToken searchParams={searchParams} />
            </Suspense>
        </>
    )
}

async function WithToken({ searchParams }: { searchParams: Search }) {
    const { token = '' } = await searchParams
    return <VerifyEmail token={token} />
}
