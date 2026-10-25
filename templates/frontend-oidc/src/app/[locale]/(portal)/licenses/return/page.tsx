import { Suspense } from 'react'
import { redirect } from 'next/navigation'

type Search = Promise<{ subscription?: string }>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Back from the checkout of the payment provider: the purchase wizard shows the provisioning and the result. */
export default function LicenseReturnPage({ searchParams }: { searchParams: Search }) {
    return (
        <Suspense fallback={null}>
            <Content searchParams={searchParams} />
        </Suspense>
    )
}

async function Content({ searchParams }: { searchParams: Search }): Promise<null> {
    const { subscription = '' } = await searchParams
    redirect(UUID.test(subscription) ? `/wizard?subscription=${subscription}` : '/marketplace')
}
