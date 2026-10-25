import { Suspense } from 'react'
import { Invoices } from '@/components/pasport/customer/invoices'
import { getSession } from '@/lib/session'

export default function InvoicesPage() {
    return (
        <Suspense fallback={null}>
            <Content />
        </Suspense>
    )
}

async function Content() {
    const session = await getSession()
    return <Invoices admin={session?.tenant?.role === 'admin'} />
}
