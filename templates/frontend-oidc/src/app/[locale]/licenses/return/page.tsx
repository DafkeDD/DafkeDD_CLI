import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { Page } from '@/components/account-ui'
import { LicenseReturn } from '@/components/licenses'
import { getSession } from '@/lib/session'

type Search = Promise<{ subscription?: string }>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Back from the checkout of the payment provider: /licenses/return?subscription=<id>. */
export default async function LicenseReturnPage({
    params,
    searchParams
}: {
    params: Promise<{ locale: string }>
    searchParams: Search
}) {
    setRequestLocale((await params).locale)
    return (
        <Page wide>
            <Suspense fallback={null}>
                <Content searchParams={searchParams} />
            </Suspense>
        </Page>
    )
}

async function Content({ searchParams }: { searchParams: Search }) {
    const { subscription = '' } = await searchParams
    if (!(await getSession()))
        redirect('/api/auth/login?returnTo=' + encodeURIComponent('/licenses/return?subscription=' + subscription))
    if (!UUID.test(subscription)) redirect('/licenses')
    return <LicenseReturn subscriptionId={subscription} />
}
