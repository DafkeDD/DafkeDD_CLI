import { Suspense } from 'react'
import { AdminUsers } from '@/components/pasport/admin/users'
import { getSession } from '@/lib/session'

export default function AdminUsersPage() {
    return (
        <Suspense fallback={null}>
            <Content />
        </Suspense>
    )
}

async function Content() {
    const session = await getSession()
    return <AdminUsers me={session?.sub ?? ''} />
}
