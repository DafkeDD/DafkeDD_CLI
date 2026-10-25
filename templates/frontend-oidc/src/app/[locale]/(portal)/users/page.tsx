import { Suspense } from 'react'
import { CustomerUsers } from '@/components/pasport/customer/users'
import { getSession } from '@/lib/session'

export default function UsersPage() {
    return (
        <Suspense fallback={null}>
            <Content />
        </Suspense>
    )
}

async function Content() {
    const session = await getSession()
    return <CustomerUsers me={session?.sub ?? ''} admin={session?.tenant?.role === 'admin'} />
}
