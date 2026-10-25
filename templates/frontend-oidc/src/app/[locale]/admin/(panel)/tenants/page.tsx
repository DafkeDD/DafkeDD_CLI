import { Suspense } from 'react'
import { TenantOverview } from '@/components/pasport/admin/tenants'

export default function TenantsPage() {
    return (
        <Suspense fallback={null}>
            <TenantOverview />
        </Suspense>
    )
}
