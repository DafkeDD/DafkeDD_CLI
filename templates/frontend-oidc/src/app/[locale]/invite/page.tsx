import { Suspense } from 'react'
import { setRequestLocale } from 'next-intl/server'
import { AcceptInvitation } from '@/components/account-forms'
import { Page } from '@/components/account-ui'

type Search = Promise<{ token?: string }>

/** The link in the invitation email: /invite?token=... (GET /oidc/account/invitation, POST .../accept). */
export default async function InvitePage({
    params,
    searchParams
}: {
    params: Promise<{ locale: string }>
    searchParams: Search
}) {
    setRequestLocale((await params).locale)
    return (
        <Page>
            {/* The token is only known per request: render that part when the request comes in */}
            <Suspense fallback={null}>
                <WithToken searchParams={searchParams} />
            </Suspense>
        </Page>
    )
}

async function WithToken({ searchParams }: { searchParams: Search }) {
    const { token = '' } = await searchParams
    return <AcceptInvitation token={token} />
}
