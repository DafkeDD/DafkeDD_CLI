import { Suspense } from 'react'
import { CustomerTickets } from '@/components/pasport/tickets/customer-tickets'
import { getSession } from '@/lib/session'

export default function SupportPage() {
    return (
        <Suspense fallback={null}>
            <Content />
        </Suspense>
    )
}

async function Content() {
    const session = await getSession()
    return <CustomerTickets me={session?.sub ?? ''} />
}
