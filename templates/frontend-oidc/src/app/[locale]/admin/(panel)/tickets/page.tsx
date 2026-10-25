import { Suspense } from 'react'
import { AdminTickets } from '@/components/pasport/tickets/admin-tickets'
import { getSession } from '@/lib/session'

export default function AdminTicketsPage() {
    return (
        <Suspense fallback={null}>
            <Content />
        </Suspense>
    )
}

async function Content() {
    const session = await getSession()
    return <AdminTickets me={session?.sub ?? ''} />
}
